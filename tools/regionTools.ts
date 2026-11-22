/**
 * Assistant tools for region extraction and common clip/timeline operations.
 * Every tool returns a preview action list; applying is one undo step.
 */
import { defaultTransform, uid, type Action, type BlendMode } from '../engine';
import type { ToolContext, ToolResult } from './cutTools';

const findClip = (ctx: ToolContext, rawId: string) => {
  const id = String(rawId ?? '').trim();
  const p = ctx.project;
  return p.clips.find((c) => c.id === id) ?? p.clips.find((c) => c.id.toLowerCase() === id.toLowerCase());
};

const nameOf = (ctx: ToolContext, id: string) => {
  const c = ctx.project.clips.find((x) => x.id === id);
  return c ? (c.name || c.text?.text || c.id) : id;
};

/**
 * Crop a clip to a rectangle (or extract that rectangle as a new clip).
 * Coordinates are fractions (0-1), percentages, or source pixels.
 */
export interface CropRegionParams {
  clip_id: string;
  x?: number; y?: number; width?: number; height?: number;
  unit?: 'fraction' | 'percent' | 'pixels';
  extract?: boolean;
}

export function cropRegion(ctx: ToolContext, params: CropRegionParams): ToolResult {
  const clip = findClip(ctx, params.clip_id);
  if (!clip) return { actions: [], summary: `No clip with id "${params.clip_id}".`, warnings: ['Read the TIMELINE block and use the exact clip_id.'] };
  if (clip.kind !== 'media' || !clip.mediaId) return { actions: [], summary: `"${nameOf(ctx, clip.id)}" is not a video/image clip.`, warnings: ['Region crop works on video and image clips.'] };

  const asset = ctx.project.media.find((m) => m.id === clip.mediaId);
  const sw = asset?.width || ctx.project.settings.width;
  const sh = asset?.height || ctx.project.settings.height;
  const unit = params.unit === 'pixels' ? 'pixels' : params.unit === 'percent' ? 'percent' : 'fraction';
  const toFrac = (v: number, full: number) => (unit === 'fraction' ? v : unit === 'percent' ? v / 100 : v / full);

  const x = Math.min(Math.max(toFrac(Number(params.x ?? 0), sw), 0), 1);
  const y = Math.min(Math.max(toFrac(Number(params.y ?? 0), sh), 0), 1);
  let w = params.width === undefined ? 1 - x : toFrac(Number(params.width), sw);
  let h = params.height === undefined ? 1 - y : toFrac(Number(params.height), sh);
  w = Math.min(Math.max(w, 0.02), 1 - x);
  h = Math.min(Math.max(h, 0.02), 1 - y);

  const crop = {
    cropL: +x.toFixed(5),
    cropR: +(1 - x - w).toFixed(5),
    cropT: +y.toFixed(5),
    cropB: +(1 - y - h).toFixed(5),
  };
  const label = nameOf(ctx, clip.id);

  if (params.extract) {
    const p = ctx.project;
    const start = clip.start, duration = clip.duration, inPoint = clip.inPoint;
    const end = start + duration;
    const free = (tid: string) => !p.clips.some((c) => c.trackId === tid && c.start < end && start < c.start + c.duration);
    const videoTracks = p.tracks.filter((t) => t.kind === 'video' && !t.locked);
    let trackId = videoTracks.find((t) => free(t.id))?.id;
    const actions: Action[] = [];
    if (!trackId) {
      trackId = uid('trk');
      actions.push({ type: 'add_track', track: { id: trackId, kind: 'video', name: `V${p.tracks.filter((t) => t.kind === 'video').length + 1}` }, index: 0 });
    }
    actions.push({
      type: 'add_clip',
      clip: {
        trackId, mediaId: clip.mediaId, start, duration, inPoint, fit: 'fill',
        name: `${label} · region`, transform: { ...defaultTransform(), ...crop },
      },
    });
    return { actions, summary: `Extracted the region from "${label}" as a new clip.`, stats: { crop: `x${Math.round(x * 100)}% y${Math.round(y * 100)}% w${Math.round(w * 100)}% h${Math.round(h * 100)}%` } };
  }

  return {
    actions: [{ type: 'set_transform', clipId: clip.id, patch: crop }],
    summary: `Cropped "${label}" to the selected region (non-destructive).`,
    stats: { crop: `x${Math.round(x * 100)}% y${Math.round(y * 100)}% w${Math.round(w * 100)}% h${Math.round(h * 100)}%` },
  };
}

/** Add a marker at a time (optionally labelled/coloured). */
export function addMarkerTool(ctx: ToolContext, params: { time: number; label?: string; color?: string }): ToolResult {
  const t = Number(params.time);
  if (!Number.isFinite(t) || t < 0) return { actions: [], summary: 'add_marker needs a time in seconds (0 or more).' };
  const n = ctx.project.markers.length + 1;
  return {
    actions: [{ type: 'add_marker', marker: { time: t, label: String(params.label ?? `M${n}`), color: String(params.color ?? '#4C9AFF') } }],
    summary: `Added marker "${params.label ?? `M${n}`}" at ${t.toFixed(2)}s.`,
  };
}

/** Duplicate a clip (effects, keyframes and fades included) after itself. */
export function duplicateClipTool(ctx: ToolContext, params: { clip_id: string }): ToolResult {
  const clip = findClip(ctx, params.clip_id);
  if (!clip) return { actions: [], summary: `No clip with id "${params.clip_id}".`, warnings: ['Read the TIMELINE block and use the exact clip_id.'] };
  const copy = JSON.parse(JSON.stringify(clip)) as Record<string, unknown> & { trackId: string; start: number; duration: number };
  copy.id = undefined;
  copy.start = clip.start + clip.duration;
  copy.keyframes = (clip.keyframes as { id: string }[]).map((k) => ({ ...k, id: undefined }));
  copy.effects = (clip.effects as { id: string }[]).map((e) => ({ ...e, id: undefined }));
  return {
    actions: [{ type: 'add_clip', clip: copy as never }],
    summary: `Duplicated "${nameOf(ctx, clip.id)}".`,
  };
}

/** Reverse a clip (video scrubs backward; audio plays a reversed buffer). */
export function reverseClipTool(ctx: ToolContext, params: { clip_id: string; reverse?: boolean }): ToolResult {
  const clip = findClip(ctx, params.clip_id);
  if (!clip) return { actions: [], summary: `No clip with id "${params.clip_id}".`, warnings: ['Read the TIMELINE block and use the exact clip_id.'] };
  const reverse = params.reverse !== false;
  return {
    actions: [{ type: 'set_clip_props', clipId: clip.id, patch: { reversed: reverse } }],
    summary: reverse ? `Reversed "${nameOf(ctx, clip.id)}".` : `Returned "${nameOf(ctx, clip.id)}" to normal playback.`,
  };
}

/** Set opacity, fades, label and blend mode on a clip. */
export function setClipLookTool(
  ctx: ToolContext,
  params: { clip_id: string; opacity?: number; fade_in?: number; fade_out?: number; label?: string; blend_mode?: string },
): ToolResult {
  const clip = findClip(ctx, params.clip_id);
  if (!clip) return { actions: [], summary: `No clip with id "${params.clip_id}".`, warnings: ['Read the TIMELINE block and use the exact clip_id.'] };
  const actions: Action[] = [];
  const bits: string[] = [];
  if (params.opacity !== undefined) {
    const o = Math.min(Math.max(Number(params.opacity), 0), 1);
    actions.push({ type: 'set_transform', clipId: clip.id, patch: { opacity: o } });
    bits.push(`opacity ${Math.round(o * 100)}%`);
  }
  if (params.fade_in !== undefined || params.fade_out !== undefined) {
    actions.push({
      type: 'set_fades', clipId: clip.id,
      fadeIn: params.fade_in === undefined ? clip.fades.in : Math.max(0, Number(params.fade_in)),
      fadeOut: params.fade_out === undefined ? clip.fades.out : Math.max(0, Number(params.fade_out)),
    });
    bits.push('fades');
  }
  if (params.label !== undefined || params.blend_mode !== undefined) {
    const patch: Record<string, unknown> = {};
    if (params.label !== undefined) patch.label = String(params.label);
    if (params.blend_mode !== undefined) {
      const bm = String(params.blend_mode) as BlendMode;
      if (!['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].includes(bm)) {
        return { actions: [], summary: `Unknown blend mode "${params.blend_mode}".` };
      }
      patch.blendMode = bm;
    }
    actions.push({ type: 'set_clip_props', clipId: clip.id, patch: patch as never });
    bits.push('look');
  }
  if (!actions.length) return { actions: [], summary: 'Nothing to change — pass opacity, fade_in, fade_out, label or blend_mode.' };
  return { actions, summary: `Updated "${nameOf(ctx, clip.id)}": ${bits.join(', ')}.` };
}

/** Delete a time range and ripple the rest (all non-text tracks). */
export function removeSectionTool(ctx: ToolContext, params: { start: number; end: number }): ToolResult {
  const a = Number(params.start), b = Number(params.end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return { actions: [], summary: 'remove_section needs a start and a later end time.' };
  const trackIds = ctx.project.tracks.filter((t) => t.kind !== 'text').map((t) => t.id);
  return {
    actions: [{ type: 'ripple_delete_range', start: Math.max(0, a), end: b, trackIds, shiftMarkers: true }],
    summary: `Removed ${(b - a).toFixed(2)}s from ${Math.max(0, a).toFixed(2)}s and rippled the timeline.`,
  };
}
