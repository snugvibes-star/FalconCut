/**
 * Motion tools: zoom_on_emphasis, reframe (face-follow), add_transitions
 * (only at real scene changes), snap_to_beats, add_motif.
 */
import type { Action } from '../engine/actions';
import type { Aspect, Clip, MediaAnalysis, MotifType } from '../engine/types';
import { ASPECT_SIZES, getMedia, projectDuration, uid } from '../engine/types';
import { MOTIF_DEFAULTS } from '../engine/motifs';
import type { ToolContext, ToolResult } from './cutTools';
import { firstTextTrack, sourceToTimeline, speechClips, timelineToSource } from './helpers';

function faceAt(p: ToolContext['project'], mediaId: string, srcT: number): { x: number; y: number } | null {
  const ma = p.analysis?.byMedia[mediaId];
  if (!ma?.faces.length) return null;
  let best = ma.faces[0];
  for (const f of ma.faces) if (Math.abs(f.t - srcT) < Math.abs(best.t - srcT)) best = f;
  if (best.conf < 0.12) return null;
  return { x: best.x, y: best.y };
}

/** Offset that keeps the face centered when zoomed, clamped so no gaps show. */
function faceAnchor(p: ToolContext['project'], clip: Clip, srcT: number, scale: number): { x: number; y: number } {
  const asset = getMedia(p, clip.mediaId);
  const face = faceAt(p, clip.mediaId!, srcT);
  if (!asset || !face || scale <= 1.001) return { x: 0, y: 0 };
  const W = p.settings.width, H = p.settings.height;
  const base = Math.max(W / asset.width, H / asset.height);
  const drawnW = asset.width * base * scale, drawnH = asset.height * base * scale;
  const maxX = Math.max(0, (drawnW - W) / 2), maxY = Math.max(0, (drawnH - H) / 2);
  const x = Math.max(-maxX, Math.min(maxX, (0.5 - face.x) * drawnW));
  const y = Math.max(-maxY, Math.min(maxY, (0.5 - face.y) * drawnH * 0.6));
  return { x, y };
}

export function zoomOnEmphasis(ctx: ToolContext): ToolResult {
  const p = ctx.project;
  if (!ctx.pack.zoom.enabled) return { actions: [], summary: 'Zooms are disabled by your rules/pack.' };
  const actions: Action[] = [];
  const maxScale = Math.min(1.5, ctx.pack.zoom.maxScale);
  const dur = ctx.pack.zoom.durationSec;
  let zooms = 0;
  for (const clip of speechClips(p)) {
    const ma = p.analysis!.byMedia[clip.mediaId!];
    if (!ma) continue;
    let lastZoom = -100;
    let alt = false;
    const points = ma.emphasis
      .map((t) => ({ src: t, tl: sourceToTimeline(p, clip.mediaId!, t) }))
      .filter((x) => x.tl != null && x.tl! >= clip.start + 0.4 && x.tl! <= clip.start + clip.duration - dur - 0.2) as { src: number; tl: number }[];
    for (const pt of points) {
      if (pt.tl - lastZoom < ctx.pack.zoom.minIntervalSec) continue;
      lastZoom = pt.tl;
      alt = !alt;
      const peak = 1 + (maxScale - 1) * (alt ? 1 : 0.72);
      const local = pt.tl - clip.start;
      const anchor = faceAnchor(p, clip, pt.src, peak);
      const kf = (path: string, time: number, value: number) =>
        actions.push({ type: 'add_keyframe', clipId: clip.id, path, time: Math.max(0, Math.min(clip.duration, time)), value, easing: 'easeInOut' });
      kf('transform.scale', local - 0.05, 1);
      kf('transform.scale', local + dur * 0.35, peak);
      kf('transform.scale', local + dur * 0.7, peak);
      kf('transform.scale', local + dur, 1);
      if (anchor.x || anchor.y) {
        kf('transform.x', local - 0.05, clip.transform.x);
        kf('transform.x', local + dur * 0.35, anchor.x);
        kf('transform.x', local + dur * 0.7, anchor.x);
        kf('transform.x', local + dur, clip.transform.x);
        kf('transform.y', local - 0.05, clip.transform.y);
        kf('transform.y', local + dur * 0.35, anchor.y);
        kf('transform.y', local + dur * 0.7, anchor.y);
        kf('transform.y', local + dur, clip.transform.y);
      }
      zooms++;
    }
  }
  return {
    actions,
    summary: zooms ? `Added ${zooms} gentle punch-in zooms on emphasized moments (max ${Math.round(maxScale * 100)}%, smooth easing, alternating intensity${Object.values(p.analysis?.byMedia ?? ({} as Record<string, MediaAnalysis>)).some((m) => m.faces.length) ? ', face kept in frame' : ''}).` : 'No emphasis points found (needs analysis/transcript).',
    stats: { zooms, maxScale },
  };
}

export function reframe(ctx: ToolContext, params: { aspect: Aspect }): ToolResult {
  const p = ctx.project;
  const aspect: Aspect = params.aspect ?? '9:16';
  const [w, h] = ASPECT_SIZES[aspect];
  const actions: Action[] = [{ type: 'set_settings', patch: { aspect, width: w, height: h } }];
  let followed = 0;
  for (const clip of p.clips) {
    if (clip.kind !== 'media') continue;
    const asset = getMedia(p, clip.mediaId);
    if (!asset || asset.type !== 'video') continue;
    actions.push({ type: 'set_clip_props', clipId: clip.id, patch: { fit: 'cover' } });
    const ma = p.analysis?.byMedia[clip.mediaId!];
    if (!ma?.faces.length) continue;
    // face-follow keyframes every 0.5s of timeline
    actions.push({ type: 'clear_keyframes', clipId: clip.id, path: 'transform.x' });
    actions.push({ type: 'clear_keyframes', clipId: clip.id, path: 'transform.y' });
    const base = Math.max(w / asset.width, h / asset.height);
    const drawnW = asset.width * base * clip.transform.scale;
    const drawnH = asset.height * base * clip.transform.scale;
    const maxX = Math.max(0, (drawnW - w) / 2);
    const maxY = Math.max(0, (drawnH - h) / 2);
    let last = -10;
    for (let tl = clip.start; tl <= clip.start + clip.duration; tl += 0.5) {
      const src = clip.inPoint + (tl - clip.start) * clip.speed;
      const face = faceAt(p, clip.mediaId!, src);
      if (!face) continue;
      const x = Math.max(-maxX, Math.min(maxX, (0.5 - face.x) * drawnW));
      const y = Math.max(-maxY, Math.min(maxY, (0.5 - face.y) * drawnH));
      if (Math.abs(tl - last) >= 0.45) {
        actions.push({ type: 'add_keyframe', clipId: clip.id, path: 'transform.x', time: tl - clip.start, value: Math.round(x), easing: 'easeInOut' });
        actions.push({ type: 'add_keyframe', clipId: clip.id, path: 'transform.y', time: tl - clip.start, value: Math.round(y), easing: 'easeInOut' });
        last = tl;
      }
    }
    followed++;
  }
  // keep captions in the new safe zone
  for (const c of p.clips) {
    if (c.kind === 'text' && c.text && c.text.role !== 'hook') {
      const y = aspect === '9:16' ? Math.min(c.text.style.y, 0.72) : c.text.style.y;
      actions.push({ type: 'set_text_style', clipId: c.id, patch: { y, maxWidth: aspect === '9:16' ? 0.88 : 0.84 } });
    }
  }
  return {
    actions,
    summary: `Reframed to ${aspect} (${w}x${h}). ${followed ? `${followed} clip${followed === 1 ? '' : 's'} now follow the face with smooth pan keyframes.` : 'No face data — clips are center-cropped.'} Captions moved into the new safe zone.`,
    stats: { aspect, followed },
    warnings: followed ? [] : ['Face tracking data missing; reframe uses center crop. Run analysis first for face-follow.'],
  };
}

export function addTransitions(ctx: ToolContext, params: { style?: string } = {}): ToolResult {
  const p = ctx.project;
  if (!ctx.pack.transitions.enabled) return { actions: [], summary: 'Transitions are disabled by your rules/pack.' };
  const style = (params.style ?? ctx.pack.transitions.style) as NonNullable<Clip['transitionIn']>['type'];
  const dur = ctx.pack.transitions.durationSec;
  const totalDur = Math.max(1, projectDuration(p));
  const maxCount = Math.max(1, Math.round((ctx.pack.transitions.maxPerMinute * totalDur) / 60));
  const actions: Action[] = [];
  let added = 0;
  const videoTracks = p.tracks.filter((t) => t.kind === 'video');
  for (const track of videoTracks) {
    const clips = p.clips.filter((c) => c.trackId === track.id && c.kind === 'media').sort((a, b) => a.start - b.start);
    for (let i = 1; i < clips.length && added < maxCount; i++) {
      const prev = clips[i - 1], cur = clips[i];
      if (Math.abs(prev.start + prev.duration - cur.start) > 0.06) continue;
      if (cur.transitionIn) continue;
      // only at REAL scene changes: same media + a detected scene cut near the boundary, or different media
      const boundarySrc = prev.inPoint + prev.duration * prev.speed;
      const ma = p.analysis?.byMedia[prev.mediaId ?? ''];
      const sameMedia = prev.mediaId === cur.mediaId;
      const nearScene = ma?.scenes.some((s) => Math.abs(s - boundarySrc) < 0.8);
      if (sameMedia && !nearScene) continue;
      if (cur.duration < dur * 2.2 || prev.duration < dur * 2.2) continue;
      actions.push({ type: 'set_transition', clipId: cur.id, edge: 'in', transition: { type: style, duration: dur } });
      added++;
    }
  }
  return {
    actions,
    summary: added ? `Added ${added} ${style} transition${added === 1 ? '' : 's'} (${dur}s) — only at real scene changes, capped at ${ctx.pack.transitions.maxPerMinute}/min.` : 'No qualifying scene changes found (transitions are intentionally restrained).',
    stats: { added },
  };
}

export function snapToBeats(ctx: ToolContext, params: { what?: 'cuts' | 'zooms' } = {}): ToolResult {
  const p = ctx.project;
  const music = Object.values(p.analysis?.byMedia ?? ({} as Record<string, MediaAnalysis>)).find((m) => m.isMusic && m.beats.length > 4);
  if (!music) return { actions: [], summary: 'No analyzed music with a beat grid found. Import music and let analysis finish.', warnings: ['Beat sync needs music analysis.'] };
  const actions: Action[] = [];
  const what = params.what ?? 'zooms';
  // music beats are in music-source time; find the music clip to map to timeline
  const musicClip = p.clips.find((c) => c.mediaId === music.mediaId);
  const beatTl = music.beats
    .map((b) => (musicClip ? musicClip.start + (b - musicClip.inPoint) / musicClip.speed : b))
    .filter((t) => t >= 0 && t <= projectDuration(p));
  if (what === 'zooms') {
    let n = 0;
    for (const clip of speechClips(p)) {
      let last = -10;
      for (const b of beatTl) {
        if (b < clip.start + 0.3 || b > clip.start + clip.duration - 1) continue;
        if (b - last < Math.max(1, ctx.pack.zoom.minIntervalSec * 0.6)) continue;
        last = b;
        const local = b - clip.start;
        const peak = Math.min(ctx.pack.zoom.maxScale, 1.07);
        actions.push({ type: 'add_keyframe', clipId: clip.id, path: 'transform.scale', time: local, value: 1, easing: 'easeOut' });
        actions.push({ type: 'add_keyframe', clipId: clip.id, path: 'transform.scale', time: local + 0.12, value: peak, easing: 'easeOut' });
        actions.push({ type: 'add_keyframe', clipId: clip.id, path: 'transform.scale', time: local + 0.5, value: 1, easing: 'easeInOut' });
        n++;
      }
    }
    return { actions, summary: `Added ${n} beat-synced punch zooms on the ${music.bpm} BPM grid.`, stats: { zooms: n, bpm: music.bpm } };
  }
  // cuts: nudge existing clip boundaries to the nearest beat (within 0.25s)
  let n = 0;
  const videoClips = p.clips.filter((c) => c.kind === 'media' && getMedia(p, c.mediaId)?.type === 'video').sort((a, b) => a.start - b.start);
  for (let i = 1; i < videoClips.length; i++) {
    const cur = videoClips[i];
    const nearest = beatTl.reduce((best, b) => (Math.abs(b - cur.start) < Math.abs(best - cur.start) ? b : best), beatTl[0] ?? 0);
    const delta = nearest - cur.start;
    if (Math.abs(delta) > 0.02 && Math.abs(delta) <= 0.25) {
      actions.push({ type: 'trim_clip', clipId: cur.id, start: nearest });
      n++;
    }
  }
  return { actions, summary: `Snapped ${n} cut points to the ${music.bpm} BPM beat grid (max 250ms nudge).`, stats: { snapped: n } };
}

export function addMotif(ctx: ToolContext, raw: { type: MotifType; start?: number; duration?: number; text?: string; params?: Record<string, number | string> | string }): ToolResult {
  const p = ctx.project;
  const trackId = firstTextTrack(p);
  if (!trackId) return { actions: [], summary: 'No text track for the motif.' };
  const start = raw.start ?? 0;
  const duration = raw.duration ?? 3;
  // The manifest advertises `params` as a string (JSON); models also send a
  // real object sometimes. Accept both.
  let extra: Record<string, number | string> = {};
  if (typeof raw.params === 'string') {
    try { extra = JSON.parse(raw.params) as Record<string, number | string>; }
    catch { return { actions: [], summary: `Could not parse "params" — it must be a JSON object string, e.g. '{"x":0.5}'.`, warnings: ['params must be JSON.'] }; }
  } else if (raw.params && typeof raw.params === 'object') {
    extra = raw.params;
  }
  const merged = { ...MOTIF_DEFAULTS[raw.type], ...extra };
  if (raw.text) {
    if (raw.type === 'lower-third') merged.name = raw.text;
    else if (raw.type === 'burst' || raw.type === 'title-reveal') merged.text = raw.text;
    else if (raw.type === 'count-up') merged.label = raw.text;
    else if (raw.type === 'ring-progress') merged.label = raw.text;
    else merged.title = raw.text;
  }
  return {
    actions: [{ type: 'add_motif', trackId, start, duration, motif: { type: raw.type, params: merged } }],
    summary: `Added a "${raw.type}" motion graphic at ${start.toFixed(1)}s for ${duration}s. All parameters are adjustable in the inspector.`,
  };
}