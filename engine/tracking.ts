/**
 * Minimal single-point (patch) tracking helpers — pure math + action building.
 *
 * This is deliberately NOT object detection, multipoint tracking, stabilization
 * or rotoscoping. A user picks one box on one source frame; NCC follows that
 * patch frame to frame with a local search around the previous match. Low
 * confidence holds the previous position instead of guessing. The result is
 * ordinary, editable transform.x/y keyframes on a target clip (a 📍 sticker
 * drawing layer by default).
 */
import type { Action } from './actions';
import {
  sourceTimeOf,
  type Clip,
  type Project,
  type TrackSample,
  type TrackSeed,
} from './types';

/** Grayscale frame in 0..1, row-major, `width * height` samples. */
export interface GreyFrame { width: number; height: number; data: Float32Array }

/** Zero-mean NCC template in 0..1 pixel space of a downscaled grey frame. */
export interface GreyTemplate { width: number; height: number; data: Float32Array; norm: number }

export interface TrackMatch { x: number; y: number; score: number; margin: number }
export interface ResolvedMatch extends TrackMatch { accepted: boolean }

export const TRACK_MIN_SCORE = 0.55;
export const TRACK_MIN_MARGIN = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Rec.601 luma, normalized to 0..1. Accepts RGBA bytes from a small canvas. */
export function rgbaToGrey(rgba: ArrayLike<number>, width: number, height: number): GreyFrame {
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
  }
  return { width, height, data };
}

/** Box-average downscale to `outW` columns (height keeps the source aspect).
 * Used by tests and by any caller holding a full-resolution RGBA frame. */
export function downscaleGrey(rgba: ArrayLike<number>, srcW: number, srcH: number, outW = 160): GreyFrame {
  const width = Math.max(2, Math.min(outW, srcW));
  const height = Math.max(2, Math.round((width * srcH) / srcW));
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * srcH) / height), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * srcW) / width), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / width));
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const p = (sy * srcW + sx) * 4;
          sum += 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
        }
      }
      data[y * width + x] = sum / (255 * (x1 - x0) * (y1 - y0));
    }
  }
  return { width, height, data };
}

/** Extract and zero-mean the patch described by a frame-normalized seed box. */
export function templateFromGrey(frame: GreyFrame, seed: TrackSeed): GreyTemplate {
  const tw = Math.max(3, Math.round(seed.w * frame.width));
  const th = Math.max(3, Math.round(seed.h * frame.height));
  let x0 = Math.round(seed.x * frame.width - tw / 2);
  let y0 = Math.round(seed.y * frame.height - th / 2);
  x0 = clamp(x0, 0, Math.max(0, frame.width - tw));
  y0 = clamp(y0, 0, Math.max(0, frame.height - th));
  const w = Math.min(tw, frame.width), h = Math.min(th, frame.height);
  const data = new Float32Array(w * h);
  let sum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sum += frame.data[(y0 + y) * frame.width + x0 + x];
  const mean = sum / data.length;
  let normSq = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = frame.data[(y0 + y) * frame.width + x0 + x] - mean;
    data[y * w + x] = v;
    normSq += v * v;
  }
  return { width: w, height: h, data, norm: Math.sqrt(normSq) };
}

/**
 * Locate a zero-mean template near `guess` (frame-normalized center) in a new
 * grey frame. Only a LOCAL window is searched: the patch cannot jump across the
 * frame on a single noisy frame. Confidence is NCC score; `margin` is the gap
 * to the best distinct second candidate (best/second-best discrimination).
 */
export function matchTemplate(frame: GreyFrame, template: GreyTemplate, guess: { x: number; y: number }, searchRadius?: number): TrackMatch {
  const { width: tw, height: th, data: tpl } = template;
  const fallback: TrackMatch = { x: guess.x, y: guess.y, score: 0, margin: 0 };
  if (!(template.norm > 1e-6) || tw > frame.width || th > frame.height) return fallback;
  const radius = searchRadius ?? Math.max(12, Math.round(Math.min(frame.width, frame.height) * 0.18));
  const gx = guess.x * frame.width - tw / 2;
  const gy = guess.y * frame.height - th / 2;
  const xMin = Math.max(0, Math.floor(gx - radius));
  const xMax = Math.min(frame.width - tw, Math.ceil(gx + radius));
  const yMin = Math.max(0, Math.floor(gy - radius));
  const yMax = Math.min(frame.height - th, Math.ceil(gy + radius));
  if (xMax < xMin || yMax < yMin) return fallback;

  const minSep = Math.max(2, Math.round(Math.min(tw, th) / 2));
  let best = { x: 0, y: 0, score: -1 };
  let second = { x: 0, y: 0, score: -1 };
  const distinct = (ax: number, ay: number, bx: number, by: number) =>
    Math.abs(ax - bx) >= minSep || Math.abs(ay - by) >= minSep;

  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      let sum = 0;
      for (let j = 0; j < th; j++) {
        const row = (y + j) * frame.width + x;
        for (let i = 0; i < tw; i++) sum += frame.data[row + i];
      }
      const mean = sum / tpl.length;
      let dot = 0, normSq = 0;
      for (let j = 0; j < th; j++) {
        const row = (y + j) * frame.width + x;
        for (let i = 0; i < tw; i++) {
          const v = frame.data[row + i] - mean;
          dot += tpl[j * tw + i] * v;
          normSq += v * v;
        }
      }
      if (!(normSq > 1e-6)) continue;
      const score = clamp(dot / (template.norm * Math.sqrt(normSq)), -1, 1);
      if (score > best.score) {
        if (distinct(x, y, best.x, best.y)) second = best;
        best = { x, y, score };
      } else if (score > second.score && distinct(x, y, best.x, best.y)) {
        second = { x, y, score };
      }
    }
  }
  if (best.score < 0) return fallback;
  const margin = Math.max(0, best.score - Math.max(0, second.score));
  return {
    x: (best.x + tw / 2) / frame.width,
    y: (best.y + th / 2) / frame.height,
    score: Math.max(0, best.score),
    margin,
  };
}

/** Apply the confidence gate. A rejected match holds the previous position
 * exactly (no drift on ambiguous frames). */
export function resolveMatch(previous: { x: number; y: number }, match: TrackMatch,
  minScore = TRACK_MIN_SCORE, minMargin = TRACK_MIN_MARGIN): ResolvedMatch {
  const accepted = match.score >= minScore && match.margin >= minMargin;
  return {
    ...match,
    x: accepted ? match.x : previous.x,
    y: accepted ? match.y : previous.y,
    accepted,
  };
}

/**
 * Frame-normalized SOURCE coordinates → PROJECT pixels, using the same
 * cover/contain/fill + crop + scale geometry as render.ts. Rotation/skew are
 * ignored here (the sticker follows translation only) — that is a documented
 * limitation of this minimal tracker.
 */
export function sourceToProjectPoint(
  nx: number, ny: number,
  clip: Pick<Clip, 'fit' | 'transform'>,
  sourceSize: { width: number; height: number },
  projectSize: { width: number; height: number },
): { x: number; y: number } {
  const { width: W, height: H } = projectSize;
  const { width: sw, height: sh } = sourceSize;
  const tr = clip.transform;
  const cropX = 1 - tr.cropL - tr.cropR, cropY = 1 - tr.cropT - tr.cropB;
  const cw = sw * cropX, ch = sh * cropY;
  if (!(cw > 0 && ch > 0 && sw > 0 && sh > 0)) return { x: W / 2 + tr.x, y: H / 2 + tr.y };
  let scaleX: number, scaleY: number;
  if (clip.fit === 'fill') { scaleX = W / cw; scaleY = H / ch; }
  else {
    const s = clip.fit === 'contain' ? Math.min(W / cw, H / ch) : Math.max(W / cw, H / ch);
    scaleX = s; scaleY = s;
  }
  const drawW = cw * scaleX * tr.scale, drawH = ch * scaleY * tr.scale;
  const fx = (nx - tr.cropL) / cropX - 0.5;
  const fy = (ny - tr.cropT) / cropY - 0.5;
  return { x: W / 2 + tr.x + fx * drawW, y: H / 2 + tr.y + fy * drawH };
}

/** Inverse of sourceTimeOf: clip-local time for a source position. Handles
 * speed ramps and reversed clips by binary search on the monotonic map. */
export function localTimeAtSource(clip: Clip, sourceT: number): number {
  if (!(clip.duration > 0)) return 0;
  // sourceTimeOf takes TIMELINE time, so add the clip start to a local probe.
  const a = sourceTimeOf(clip, clip.start), b = sourceTimeOf(clip, clip.start + clip.duration);
  const ascending = b >= a;
  let lo = 0, hi = clip.duration;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const v = sourceTimeOf(clip, clip.start + mid);
    if (ascending ? v < sourceT : v > sourceT) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface TrackBuildOptions {
  /** Decoded media dimensions (used by cover/contain/fill geometry). */
  sourceSize: { width: number; height: number };
  /** Existing target clip id. When absent, a new drawing clip is created. */
  targetClipId?: string;
  /** Explicit id for the generated sticker clip (so one commit is replayable). */
  newClipId?: string;
}

/**
 * Build the ONE atomic action group for a track: provenance on the source clip,
 * optionally a 📍 sticker drawing layer at the seed, then editable transform
 * keyframes on the target. Keyframe values are PIXEL OFFSETS from the seed
 * point, so an existing target should be a sticker anchored at that seed.
 */
export function buildTrackActions(
  project: Project,
  clip: Clip,
  seed: TrackSeed,
  samples: TrackSample[],
  opts: TrackBuildOptions,
): Action[] {
  const targetId = opts.targetClipId ?? opts.newClipId;
  if (!targetId) return [];
  const seedPx = sourceToProjectPoint(seed.x, seed.y, clip, opts.sourceSize, project.settings);
  const actions: Action[] = [{ type: 'set_tracking', clipId: clip.id, tracking: { seed, samples } }];
  if (!opts.targetClipId && opts.newClipId) {
    const trackId = project.tracks.find((t) => t.kind === 'text' && !t.locked)?.id
      ?? project.tracks.find((t) => t.kind === 'text')?.id;
    const size = Math.max(28, Math.round(Math.min(project.settings.width, project.settings.height) * 0.045));
    actions.push({
      type: 'add_drawing', trackId, id: opts.newClipId,
      start: clip.start, duration: clip.duration,
      strokes: [{ tool: 'sticker', points: [[seedPx.x, seedPx.y]], color: '#C6F24E', size, opacity: 1, char: '📍' }],
    });
  }
  actions.push(
    { type: 'clear_keyframes', clipId: targetId, path: 'transform.x' },
    { type: 'clear_keyframes', clipId: targetId, path: 'transform.y' },
  );
  for (const s of samples) {
    const px = sourceToProjectPoint(s.x, s.y, clip, opts.sourceSize, project.settings);
    const t = localTimeAtSource(clip, s.t);
    actions.push(
      { type: 'add_keyframe', clipId: targetId, path: 'transform.x', time: t, value: Math.round(px.x - seedPx.x), easing: 'easeInOut' },
      { type: 'add_keyframe', clipId: targetId, path: 'transform.y', time: t, value: Math.round(px.y - seedPx.y), easing: 'easeInOut' },
    );
  }
  return actions;
}
