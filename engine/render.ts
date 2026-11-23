/**
 * THE deterministic renderer. renderFrame(project, t, ctx, resolver) draws the
 * exact frame for time t. Preview and export both call this — identical output.
 * Pure with respect to (project, t, resolver state). No DOM, no globals that
 * affect pixels, so it also runs in a worker with OffscreenCanvas.
 */
import type { Clip, Project, Transform } from './types';
import { getMedia, defaultTransform, sourceTimeOf } from './types';
import { evalKeyframes } from './easing';
import { resolveEffects, applyPixelOps, drawVignette } from './effects';
import { bakeLut } from './luts';
import { layoutCaption, drawCaption } from './captions';
import { drawGenerator } from './generators';
import { drawMotif } from './motifs';
import { strokeBounds, boundsSize, drawStrokes, type Bounds } from './drawing';
import type { DrawingStroke } from './types';
import type { MediaResolver } from './media';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let filterSupport: boolean | null = null;
export function supportsFilter(ctx: Ctx2D): boolean {
  if (filterSupport === null) {
    try { filterSupport = typeof (ctx as CanvasRenderingContext2D).filter === 'string'; } catch { filterSupport = false; }
  }
  return filterSupport;
}

let fxCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let fxCtx: Ctx2D | null = null;
const genCanvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>();

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function getFx(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D } {
  if (!fxCanvas) { fxCanvas = makeCanvas(w, h); fxCtx = fxCanvas.getContext('2d', { willReadFrequently: true }) as Ctx2D; }
  if (fxCanvas.width !== w || fxCanvas.height !== h) { fxCanvas.width = w; fxCanvas.height = h; }
  return { canvas: fxCanvas, ctx: fxCtx! };
}

export function resolvedTransform(clip: Clip, localT: number): Transform {
  // Merge defaults so projects saved before skewX/skewY still render.
  const tr = { ...defaultTransform(), ...clip.transform };
  const kf = (path: string, base: number) => evalKeyframes(clip.keyframes.filter((k) => k.path === path), localT, base);
  tr.x = kf('transform.x', tr.x);
  tr.y = kf('transform.y', tr.y);
  tr.scale = kf('transform.scale', tr.scale);
  tr.rotation = kf('transform.rotation', tr.rotation);
  tr.skewX = kf('transform.skewX', tr.skewX);
  tr.skewY = kf('transform.skewY', tr.skewY);
  tr.opacity = kf('transform.opacity', tr.opacity);
  return tr;
}

export function clipVolumeAt(clip: Clip, localT: number): number {
  return Math.max(0, evalKeyframes(clip.keyframes.filter((k) => k.path === 'volume'), localT, clip.volume));
}

interface LayerOpts { alpha?: number; dx?: number; extraScale?: number; extraRotation?: number; clipRect?: [number, number, number, number]; composite?: GlobalCompositeOperation }

function drawMediaLayer(p: Project, clip: Clip, t: number, ctx: Ctx2D, resolver: MediaResolver | null, o: LayerOpts = {}) {
  const W = p.settings.width, H = p.settings.height;
  const asset = getMedia(p, clip.mediaId);
  if (!asset) return;
  const localT = t - clip.start;
  const srcT = sourceTimeOf(clip, t);
  const tr = resolvedTransform(clip, localT);
  // Video fade in/out (visual half of clip.fades — audio.ts applies the
  // audible half with equal-power curves; video uses the standard linear
  // alpha ramp so preview and export agree).
  let vf = 1;
  if (clip.fades.in > 0 && localT < clip.fades.in) vf = Math.max(0, localT / clip.fades.in);
  if (clip.fades.out > 0 && localT > clip.duration - clip.fades.out) vf = Math.max(0, (clip.duration - localT) / clip.fades.out);
  const alpha = Math.max(0, Math.min(1, tr.opacity * vf * (o.alpha ?? 1)));
  if (alpha <= 0.003) return;

  let source: CanvasImageSource | null = null;
  let sw = asset.width || W, sh = asset.height || H;
  if (asset.type === 'generator' && asset.generator) {
    let gc = genCanvases.get(asset.id);
    if (!gc) { gc = makeCanvas(sw, sh); genCanvases.set(asset.id, gc); }
    if (gc.width !== sw || gc.height !== sh) { gc.width = sw; gc.height = sh; }
    const gctx = gc.getContext('2d') as Ctx2D;
    drawGenerator(gctx, asset.generator, srcT, sw, sh);
    source = gc;
  } else if (asset.type === 'image' || asset.type === 'video') {
    source = resolver?.frame(asset.id, srcT, clip.id) ?? null;
    const size = resolver?.size(asset.id);
    if (size) { sw = size.width; sh = size.height; }
    if (!source) return;
  } else return;

  const cw = sw * (1 - tr.cropL - tr.cropR), ch = sh * (1 - tr.cropT - tr.cropB);
  if (cw <= 2 || ch <= 2) return;
  const sx = tr.cropL * sw, sy = tr.cropT * sh;
  let scaleX: number, scaleY: number;
  if (clip.fit === 'fill') { scaleX = W / cw; scaleY = H / ch; }
  else {
    const s = clip.fit === 'contain' ? Math.min(W / cw, H / ch) : Math.max(W / cw, H / ch);
    scaleX = s; scaleY = s;
  }
  const drawW = cw * scaleX * tr.scale * (o.extraScale ?? 1);
  const drawH = ch * scaleY * tr.scale * (o.extraScale ?? 1);

  const fx = resolveEffects(clip, localT, supportsFilter(ctx));
  ctx.save();
  if (o.clipRect) { ctx.beginPath(); ctx.rect(...o.clipRect); ctx.clip(); }
  const mask = clip.mask;
  if (mask && mask.shape !== 'none' && mask.w > 0 && mask.h > 0) {
    const mx = mask.x * W, my = mask.y * H, mw = mask.w * W, mh = mask.h * H;
    ctx.beginPath();
    if (mask.shape === 'ellipse') ctx.ellipse(mx + mw / 2, my + mh / 2, mw / 2, mh / 2, 0, 0, Math.PI * 2);
    else ctx.rect(mx, my, mw, mh);
    ctx.clip();
  }
  ctx.globalAlpha = alpha;
  // Blend mode: transition-level composite wins over the clip-level one.
  if (o.composite) ctx.globalCompositeOperation = o.composite;
  else if (clip.blendMode && clip.blendMode !== 'normal') ctx.globalCompositeOperation = clip.blendMode;
  ctx.translate(W / 2 + tr.x + (o.dx ?? 0), H / 2 + tr.y);
  ctx.rotate(((tr.rotation + (o.extraRotation ?? 0)) * Math.PI) / 180);
  // True 2D skew (affine shear): x' = x + tan(skewX)·y, y' = y + tan(skewY)·x.
  if (Math.abs(tr.skewX) > 0.01 || Math.abs(tr.skewY) > 0.01) {
    ctx.transform(1, Math.tan((tr.skewY * Math.PI) / 180), Math.tan((tr.skewX * Math.PI) / 180), 1, 0, 0);
  }

  const useScratch = fx.needsPixels || (fx.filter !== '' && !supportsFilter(ctx));
  if (fx.lut) {
    // Resolve the lut id against the project's imported LUTs; bake once (cached).
    const lutObj = p.luts?.find((l) => l.id === fx.lut!.lut.id);
    if (lutObj) { fx.lut.lut = lutObj; fx.lut.baked = bakeLut(lutObj); }
    else fx.lut = undefined; // LUT was deleted from the project — skip gracefully
  }
  if (useScratch || fx.filter) {
    const capW = 1600;
    const rw = Math.max(2, Math.min(Math.round(drawW), capW));
    const rh = Math.max(2, Math.round((rw * drawH) / Math.max(1, drawW)));
    const { canvas: fc, ctx: fctx } = getFx(rw, rh);
    fctx.save();
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, rw, rh);
    fctx.filter = supportsFilter(ctx) ? fx.filter || 'none' : 'none';
    fctx.drawImage(source, sx, sy, cw, ch, 0, 0, rw, rh);
    fctx.filter = 'none';
    fctx.restore();
    if (fx.needsPixels) applyPixelOps(fc, fx, supportsFilter(ctx));
    ctx.drawImage(fc, -drawW / 2, -drawH / 2, drawW, drawH);
  } else {
    ctx.drawImage(source, sx, sy, cw, ch, -drawW / 2, -drawH / 2, drawW, drawH);
  }
  if (fx.vignette > 0.01) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-drawW / 2, -drawH / 2, drawW, drawH);
    ctx.clip();
    drawVignette(ctx, drawW, drawH, fx.vignette);
    ctx.restore();
  }
  ctx.restore();
}

function prevClipOnTrack(p: Project, clip: Clip): Clip | undefined {
  return p.clips
    .filter((c) => c.trackId === clip.trackId && c.kind === 'media' && c.id !== clip.id && c.start + c.duration <= clip.start + 0.06 && c.start + c.duration > clip.start - 0.5)
    .sort((a, b) => b.start + b.duration - (a.start + a.duration))[0];
}

function nextClipOnTrack(p: Project, clip: Clip): Clip | undefined {
  return p.clips
    .filter((c) => c.trackId === clip.trackId && c.kind === 'media' && c.id !== clip.id
      && c.start >= clip.start + clip.duration - 0.06 && c.start < clip.start + clip.duration + 0.5)
    .sort((a, b) => a.start - b.start)[0];
}

export type BlendTransitionType =
  | 'blend-multiply' | 'blend-screen' | 'blend-overlay' | 'blend-soft-light'
  | 'blend-hard-light' | 'blend-difference' | 'blend-exclusion' | 'blend-lighten'
  | 'blend-darken' | 'blend-color-dodge' | 'blend-color-burn'
  | 'blend-hue' | 'blend-saturation' | 'blend-color' | 'blend-luminosity';

const BLEND_TRANSITIONS: Record<BlendTransitionType, GlobalCompositeOperation> = {
  'blend-multiply': 'multiply',
  'blend-screen': 'screen',
  'blend-overlay': 'overlay',
  'blend-soft-light': 'soft-light',
  'blend-hard-light': 'hard-light',
  'blend-difference': 'difference',
  'blend-exclusion': 'exclusion',
  'blend-lighten': 'lighten',
  'blend-darken': 'darken',
  'blend-color-dodge': 'color-dodge',
  'blend-color-burn': 'color-burn',
  'blend-hue': 'hue',
  'blend-saturation': 'saturation',
  'blend-color': 'color',
  'blend-luminosity': 'luminosity',
};

function drawMediaClip(p: Project, clip: Clip, t: number, ctx: Ctx2D, resolver: MediaResolver | null) {
  const W = p.settings.width, H = p.settings.height;
  const localT = t - clip.start;
  const tin = clip.transitionIn;
  if (tin && localT < tin.duration) {
    const prog = Math.max(0, Math.min(1, localT / tin.duration));
    const e = prog * prog * (3 - 2 * prog); // smoothstep
    const prev = prevClipOnTrack(p, clip);
    const prevT = prev ? prev.start + prev.duration - 0.001 : t;
    switch (tin.type) {
      case 'crossfade':
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver);
        drawMediaLayer(p, clip, t, ctx, resolver, { alpha: e });
        break;
      case 'dip-black':
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver, { alpha: 1 - e });
        drawMediaLayer(p, clip, t, ctx, resolver, { alpha: e });
        break;
      case 'dip-white':
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver, { alpha: 1 - e });
        drawMediaLayer(p, clip, t, ctx, resolver, { alpha: e });
        ctx.save(); ctx.globalAlpha = 4 * e * (1 - e) * 0.9; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
        break;
      case 'wipe-left':
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver);
        drawMediaLayer(p, clip, t, ctx, resolver, { clipRect: [0, 0, e * W, H] });
        break;
      case 'slide-left':
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver, { dx: -e * W });
        drawMediaLayer(p, clip, t, ctx, resolver, { dx: (1 - e) * W });
        break;
      case 'zoom-in':
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver, { alpha: 1 - e, extraScale: 1 + e * 0.12 });
        drawMediaLayer(p, clip, t, ctx, resolver, { alpha: e, extraScale: 1.12 - 0.12 * e });
        break;
      case 'push':
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver, { dx: -e * W });
        drawMediaLayer(p, clip, t, ctx, resolver, { dx: (1 - e) * W });
        break;
      case 'spin':
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver, { alpha: 1 - e, extraRotation: e * 35 });
        drawMediaLayer(p, clip, t, ctx, resolver, { alpha: e, extraRotation: (1 - e) * -35, extraScale: 0.85 + 0.15 * e });
        break;
      case 'glitch': {
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver, { alpha: 1 - e });
        const jitter = Math.sin(localT * 90) * 12 * (1 - e);
        drawMediaLayer(p, clip, t, ctx, resolver, { alpha: e, dx: jitter });
        ctx.save(); ctx.globalAlpha = 4 * e * (1 - e) * 0.35;
        ctx.fillStyle = e > 0.5 ? '#22D3EE' : '#FF2D95'; ctx.fillRect(0, 0, W, H); ctx.restore();
        break;
      }
      case 'light-leak':
      case 'film':
      case 'cinematic':
        if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver, { alpha: 1 - e });
        drawMediaLayer(p, clip, t, ctx, resolver, { alpha: e });
        ctx.save();
        ctx.globalAlpha = 4 * e * (1 - e);
        ctx.fillStyle = tin.type === 'light-leak' ? '#FF8A3D' : tin.type === 'film' ? '#D8B07A' : '#102040';
        ctx.globalCompositeOperation = tin.type === 'cinematic' ? 'multiply' : 'screen';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        break;
      default: {
        // Blend transitions: incoming clip composited over the previous one
        // with the named canvas blend mode (multiply/screen/overlay/…).
        const op = BLEND_TRANSITIONS[tin.type as BlendTransitionType];
        if (op) {
          if (prev) drawMediaLayer(p, prev, prevT, ctx, resolver);
          drawMediaLayer(p, clip, t, ctx, resolver, { alpha: e, composite: op });
        }
        break;
      }
    }
  } else {
    drawMediaLayer(p, clip, t, ctx, resolver);
  }
  const tout = clip.transitionOut;
  if (tout && localT > clip.duration - tout.duration) {
    const prog = Math.max(0, Math.min(1, (localT - (clip.duration - tout.duration)) / tout.duration));
    const e = prog * prog * (3 - 2 * prog);
    const next = nextClipOnTrack(p, clip);
    if (next) {
      // Out transitions are the mirror of in transitions: the following clip
      // is composited over the current one using the selected type.
      const nextT = Math.max(next.start + 0.001, t);
      switch (tout.type) {
        case 'crossfade':
        case 'dip-black':
        case 'dip-white':
          drawMediaLayer(p, next, nextT, ctx, resolver, { alpha: e });
          if (tout.type !== 'crossfade') {
            ctx.save();
            ctx.globalAlpha = tout.type === 'dip-white' ? 4 * e * (1 - e) * 0.9 : 2 * Math.abs(e - 0.5) * 0.8;
            ctx.fillStyle = tout.type === 'dip-white' ? '#fff' : '#000';
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
          }
          break;
        case 'wipe-left':
          drawMediaLayer(p, next, nextT, ctx, resolver, { clipRect: [0, 0, e * W, H] });
          break;
        case 'slide-left':
          drawMediaLayer(p, next, nextT, ctx, resolver, { dx: (1 - e) * W });
          break;
        case 'zoom-in':
          drawMediaLayer(p, next, nextT, ctx, resolver, { alpha: e, extraScale: 1.12 - 0.12 * e });
          break;
        case 'push':
          drawMediaLayer(p, next, nextT, ctx, resolver, { dx: (1 - e) * W });
          break;
        case 'spin':
          drawMediaLayer(p, next, nextT, ctx, resolver, { alpha: e, extraRotation: (1 - e) * -35, extraScale: 0.85 + 0.15 * e });
          break;
        case 'glitch': {
          const jitter = Math.sin(localT * 90) * 12 * e;
          drawMediaLayer(p, next, nextT, ctx, resolver, { alpha: e, dx: jitter });
          ctx.save(); ctx.globalAlpha = 4 * e * (1 - e) * 0.35;
          ctx.fillStyle = '#22D3EE'; ctx.fillRect(0, 0, W, H); ctx.restore();
          break;
        }
        case 'light-leak':
        case 'film':
        case 'cinematic':
          drawMediaLayer(p, next, nextT, ctx, resolver, { alpha: e });
          ctx.save();
          ctx.globalAlpha = 4 * e * (1 - e);
          ctx.fillStyle = tout.type === 'light-leak' ? '#FF8A3D' : tout.type === 'film' ? '#D8B07A' : '#102040';
          ctx.globalCompositeOperation = tout.type === 'cinematic' ? 'multiply' : 'screen';
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
          break;
        default: {
          const op = BLEND_TRANSITIONS[tout.type as BlendTransitionType];
          if (op) drawMediaLayer(p, next, nextT, ctx, resolver, { alpha: e, composite: op });
          break;
        }
      }
    } else {
      // No successor on this track: the only honest visual is a fade to black.
      ctx.save();
      ctx.globalAlpha = prog;
      ctx.fillStyle = tout.type === 'dip-white' ? '#fff' : '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
}

/** Adjustment layers: their effects are applied to the already-composited
 * frame, so they affect everything underneath without touching source media. */
function applyAdjustmentLayers(p: Project, t: number, ctx: Ctx2D) {
  const layers = p.clips.filter((c) => c.kind === 'adjustment' && t >= c.start && t < c.start + c.duration);
  if (!layers.length) return;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  // Each layer is a separate pass: its own local time (so effect keyframes
  // animate), its own opacity and its own blend mode. Stacking order matters.
  for (const c of layers) {
    const effects = c.effects.filter((e) => e.enabled);
    if (!effects.length) continue;
    const localT = Math.max(0, t - c.start);
    const fx = resolveEffects({ ...c, effects }, localT, supportsFilter(ctx));
    const scratch = getFx(w, h);
    scratch.ctx.setTransform(1, 0, 0, 1, 0, 0);
    scratch.ctx.clearRect(0, 0, w, h);
    scratch.ctx.drawImage(ctx.canvas, 0, 0);
    if (fx.needsPixels) applyPixelOps(scratch.canvas, fx, supportsFilter(ctx));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, c.transform?.opacity ?? 1));
    if (c.blendMode && c.blendMode !== 'normal') ctx.globalCompositeOperation = c.blendMode;
    else if (!fx.needsPixels && fx.filter && supportsFilter(ctx)) ctx.filter = fx.filter;
    ctx.drawImage(scratch.canvas, 0, 0);
    ctx.restore();
  }
}

/* ---------------- Drawing clips (vector overlay layers) ---------------- */

const drawCache = new Map<string, { key: string; canvas: HTMLCanvasElement | OffscreenCanvas; bounds: Bounds }>();

/** Rasterize a drawing clip's strokes onto a transparent bbox-sized layer,
 * cached by stroke data (invalidated automatically when the JSON changes). */
function getDrawingLayer(clip: Clip, clipKey: string): { canvas: HTMLCanvasElement | OffscreenCanvas; bounds: Bounds } | null {
  if (!clip.drawing || !clip.drawing.strokes.length) return null;
  const bounds0 = strokeBounds(clip.drawing.strokes);
  if (!bounds0) return null;
  const minX = Math.floor(bounds0.minX), minY = Math.floor(bounds0.minY);
  const bounds: Bounds = { minX, minY, maxX: Math.ceil(bounds0.maxX), maxY: Math.ceil(bounds0.maxY) };
  const key = JSON.stringify(clip.drawing.strokes);
  const hit = drawCache.get(clipKey);
  if (hit && hit.key === key) return { canvas: hit.canvas, bounds };
  const { w, h } = boundsSize(bounds);
  const canvas = makeCanvas(w, h);
  const c = canvas.getContext('2d') as Ctx2D;
  drawStrokes(c, clip.drawing.strokes, -minX, -minY);
  drawCache.set(clipKey, { key, canvas, bounds });
  return { canvas, bounds };
}

export function clearDrawingCache(clipId?: string) {
  if (clipId) drawCache.delete(clipId); else drawCache.clear();
}

function drawDrawingClip(p: Project, clip: Clip, t: number, ctx: Ctx2D) {
  const layer = getDrawingLayer(clip, clip.id);
  if (!layer) return;
  const localT = t - clip.start;
  const tr = resolvedTransform(clip, localT);
  let vf = 1;
  if (clip.fades.in > 0 && localT < clip.fades.in) vf = Math.max(0, localT / clip.fades.in);
  if (clip.fades.out > 0 && localT > clip.duration - clip.fades.out) vf = Math.max(0, (clip.duration - localT) / clip.fades.out);
  const alpha = Math.max(0, Math.min(1, tr.opacity * vf));
  if (alpha <= 0.003) return;
  const cx = (layer.bounds.minX + layer.bounds.maxX) / 2;
  const cy = (layer.bounds.minY + layer.bounds.maxY) / 2;
  ctx.save();
  if (clip.blendMode && clip.blendMode !== 'normal') ctx.globalCompositeOperation = clip.blendMode;
  ctx.globalAlpha = alpha;
  // Transform about the drawing's own bbox center: identity transform renders
  // the layer exactly where it was drawn; scale/rotation pivot on the element.
  ctx.translate(cx + tr.x, cy + tr.y);
  ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.scale(tr.scale, tr.scale);
  if (Math.abs(tr.skewX) > 0.01 || Math.abs(tr.skewY) > 0.01) {
    ctx.transform(1, Math.tan((tr.skewY * Math.PI) / 180), Math.tan((tr.skewX * Math.PI) / 180), 1, 0, 0);
  }
  ctx.translate(-cx, -cy);
  ctx.drawImage(layer.canvas, layer.bounds.minX, layer.bounds.minY);
  ctx.restore();
}

/** Draw the exact frame at timeline time t onto ctx (canvas already sized). */
export function renderFrame(p: Project, t: number, ctx: Ctx2D, resolver: MediaResolver | null) {
  const cw = ctx.canvas.width, chh = ctx.canvas.height;
  const s = cw / p.settings.width;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = p.settings.background || '#000';
  ctx.fillRect(0, 0, cw, chh);
  ctx.scale(s, s);
  // Text tracks are overlays; preserve top-first ordering within each kind.
  const tracks = [...p.tracks].reverse().sort((a, b) => Number(a.kind === 'text') - Number(b.kind === 'text'));
  for (const track of tracks) {
    if (track.kind === 'audio' || track.hidden) continue;
    const clips = p.clips
      .filter((c) => c.trackId === track.id && t >= c.start && t < c.start + c.duration)
      .sort((a, b) => a.start - b.start);
    for (const clip of clips) {
      if (clip.kind === 'media') drawMediaClip(p, clip, t, ctx, resolver);
      else if (clip.kind === 'text' && clip.text) {
        const local = t - clip.start;
        // Text/title clips honour in/out transitions too: they fade over the
        // transition duration instead of popping hard onto the frame. The
        // renderer is shared by preview and export, so this is burned in.
        let alpha = 1;
        if (clip.transitionIn?.duration) alpha = Math.min(alpha, Math.max(0, local / clip.transitionIn.duration));
        if (clip.transitionOut?.duration) alpha = Math.min(alpha, Math.max(0, (clip.duration - local) / clip.transitionOut.duration));
        if (alpha > 0.01) {
          ctx.save();
          ctx.globalAlpha *= alpha * alpha * (3 - 2 * alpha);
          if (clip.blendMode && clip.blendMode !== 'normal') ctx.globalCompositeOperation = clip.blendMode;
          const layout = layoutCaption(ctx, clip.text.text, clip.text.style, p.settings.width, p.settings.height, local, clip.text.words);
          drawCaption(ctx, layout, clip.text.style, p.settings.width, p.settings.height, local, clip.duration);
          ctx.restore();
        }
      } else if (clip.kind === 'motif' && clip.motif) {
        drawMotif(ctx, clip.motif, t - clip.start, clip.duration, p.settings.width, p.settings.height);
      } else if (clip.kind === 'drawing' && clip.drawing) {
        drawDrawingClip(p, clip, t, ctx);
      }
    }
  }
  ctx.restore();
  applyAdjustmentLayers(p, t, ctx);
}

/** Editor-only overlay (never part of exported pixels). */
export function drawSafeZones(ctx: Ctx2D, p: Project, margin = 0.05) {
  const W = p.settings.width, H = p.settings.height;
  const s = ctx.canvas.width / W;
  ctx.save();
  ctx.scale(s, s);
  ctx.strokeStyle = 'rgba(56,189,248,0.5)';
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2 / s;
  ctx.strokeRect(W * margin, H * margin, W * (1 - margin * 2), H * (1 - margin * 2));
  if (p.settings.aspect === '9:16') {
    ctx.strokeStyle = 'rgba(251,113,133,0.45)';
    ctx.strokeRect(W * 0.03, H * 0.12, W * 0.94, H * 0.66);
  }
  ctx.restore();
}

/** Rule-of-thirds + centre cross overlay for composition. */
export function drawThirdsGrid(ctx: Ctx2D, p: Project) {
  const W = p.settings.width, H = p.settings.height;
  const s = ctx.canvas.width / W;
  ctx.save();
  ctx.scale(s, s);
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1.5 / s;
  ctx.beginPath();
  for (let i = 1; i < 3; i++) {
    ctx.moveTo((W * i) / 3, 0);
    ctx.lineTo((W * i) / 3, H);
    ctx.moveTo(0, (H * i) / 3);
    ctx.lineTo(W, (H * i) / 3);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(76,154,255,0.55)';
  ctx.lineWidth = 1 / s;
  ctx.beginPath();
  ctx.moveTo(W / 2 - W * 0.02, H / 2); ctx.lineTo(W / 2 + W * 0.02, H / 2);
  ctx.moveTo(W / 2, H / 2 - H * 0.02); ctx.lineTo(W / 2, H / 2 + H * 0.02);
  ctx.stroke();
  ctx.restore();
}

export function clearGenCache(mediaId?: string) {
  if (mediaId) genCanvases.delete(mediaId);
  else genCanvases.clear();
}