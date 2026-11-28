/**
 * Power editing tools the AI can call: fine-grained control over effects,
 * keyframes, speed ramps, masks, transitions, groups, markers, speed curves,
 * and multi-clip batch operations. Every function emits engine actions only —
 * no direct project mutation — so all calls stay undoable, previewable and
 * share the single human+AI commit path.
 */
import type { Action } from '../engine/actions';
import {
  BLEND_MODES, TRANSITION_TYPES, type Effect, type Easing, type Marker, type Transition, type TransitionType,
} from '../engine';
import type { ToolContext } from './helpers';
import type { ToolResult } from './cutTools';

const num = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const bool = (v: unknown): boolean | undefined => (v == null ? undefined : Boolean(v));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Only properties the renderer actually evaluates. Rejecting arbitrary paths
 * keeps the model from writing keyframes nothing will ever read. */
const ANIMATABLE = new Set([
  'transform.x', 'transform.y', 'transform.scale', 'transform.rotation',
  'transform.skewX', 'transform.skewY', 'transform.opacity', 'volume',
]);
const MARKER_KINDS: Marker['kind'][] = ['user', 'scene', 'broll', 'beat', 'chapter', 'retake'];

/** Friendly names models commonly emit → the engine's real transition ids. */
const TRANSITION_ALIASES: Record<string, TransitionType> = {
  fade: 'crossfade', cross: 'crossfade', xfade: 'crossfade', dissolve: 'crossfade',
  black: 'dip-black', white: 'dip-white', wipe: 'wipe-left', slide: 'slide-left',
  zoom: 'zoom-in', push: 'push', spin: 'spin', glitch: 'glitch',
};

const EASINGS: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack', 'easeOutExpo'];
/** Map user-friendly easing names to the engine's camelCase values. */
const EASING_MAP: Record<string, Easing> = {
  linear: 'linear', 'ease-in': 'easeIn', easeIn: 'easeIn',
  'ease-out': 'easeOut', easeOut: 'easeOut',
  'ease-in-out': 'easeInOut', easeInOut: 'easeInOut',
  bezier: 'easeInOut', 'ease-out-back': 'easeOutBack', easeOutBack: 'easeOutBack',
  'ease-out-expo': 'easeOutExpo', easeOutExpo: 'easeOutExpo',
};
const EFFECT_TYPES: Effect['type'][] = [
  'color', 'blur', 'sharpen', 'vignette', 'chromaKey', 'negate', 'normalize', 'lut',
  'eq', 'gain', 'gate', 'deess', 'denoise', 'compressor', 'limiter', 'echo', 'pan',
  'pixelate', 'noise', 'rgbSplit', 'glow',
];

function editable(ctx: ToolContext, id?: string) {
  return ctx.project.clips.filter((c) => !ctx.lockedClipIds?.has(c.id) && (!id || c.id === id));
}

/** Add a visual/audio effect to one or more clips. */
export function addEffect(ctx: ToolContext, params: {
  clipId?: string; type?: string; params?: Record<string, number | string | boolean>; enabled?: boolean;
}): ToolResult {
  const targets = editable(ctx, str(params.clipId));
  if (!targets.length) return { actions: [], summary: 'No editable clip matched that request.' };
  const type = str(params.type);
  if (!type || !EFFECT_TYPES.includes(type as Effect['type'])) {
    return { actions: [], summary: `Unknown effect type "${type ?? ''}". Available: ${EFFECT_TYPES.join(', ')}.` };
  }
  const enabled = bool(params.enabled) ?? true;
  const actions: Action[] = targets.map((c) => ({
    type: 'add_effect', clipId: c.id,
    effect: { type: type as Effect['type'], enabled, params: { ...(params.params ?? {}) } },
  }));
  return {
    actions,
    summary: `Added ${type} effect to ${targets.length} clip${targets.length === 1 ? '' : 's'}.`,
    stats: { clips: targets.length, effect: type },
  };
}

/** Tweak an existing effect's parameters or enabled state by effect type. */
export function configureEffect(ctx: ToolContext, params: {
  clipId?: string; effectType?: string; effectId?: string; params?: Record<string, number | string | boolean>; enabled?: boolean;
}): ToolResult {
  const targets = editable(ctx, str(params.clipId));
  const actions: Action[] = [];
  const effectType = str(params.effectType);
  const effectId = str(params.effectId);
  if (!effectId && !effectType) {
    return { actions: [], summary: 'Say which effect to change: give an effect type (e.g. blur) or an exact effect id.' };
  }
  if (effectType && !EFFECT_TYPES.includes(effectType as Effect['type'])) {
    return { actions: [], summary: `Unknown effect type "${effectType}". Available: ${EFFECT_TYPES.join(', ')}.` };
  }
  for (const c of targets) {
    for (const eff of c.effects ?? []) {
      if (effectId ? eff.id === effectId : effectType ? eff.type === effectType : true) {
        actions.push({ type: 'set_effect', clipId: c.id, effectId: eff.id, params: params.params, enabled: bool(params.enabled) });
      }
    }
  }
  if (!actions.length) return { actions: [], summary: 'No matching effect found on the selected clips.' };
  return { actions, summary: `Configured ${actions.length} effect${actions.length === 1 ? '' : 's'}.`, stats: { effects: actions.length } };
}

/** Remove an effect by type or id. */
export function removeEffect(ctx: ToolContext, params: { clipId?: string; effectType?: string; effectId?: string }): ToolResult {
  const targets = editable(ctx, str(params.clipId));
  const actions: Action[] = [];
  const effectType = str(params.effectType), effectId = str(params.effectId);
  for (const c of targets) {
    for (const eff of c.effects ?? []) {
      if (effectId ? eff.id === effectId : effectType ? eff.type === effectType : false) {
        actions.push({ type: 'remove_effect', clipId: c.id, effectId: eff.id });
      }
    }
  }
  if (!actions.length) return { actions: [], summary: 'No matching effect found to remove.' };
  return { actions, summary: `Removed ${actions.length} effect${actions.length === 1 ? '' : 's'}.`, stats: { effects: actions.length } };
}

/** Animate a clip property with keyframes (e.g. a slow zoom, a pan, a fade). */
export function animateProperty(ctx: ToolContext, params: {
  clipId?: string; property?: string; from?: number; to?: number;
  startTime?: number; endTime?: number; easing?: string;
}): ToolResult {
  const targets = editable(ctx, str(params.clipId));
  if (!targets.length) return { actions: [], summary: 'No editable clip matched that request.' };
  const property = str(params.property) ?? 'scale';
  const path = property.startsWith('transform.') ? property : `transform.${property}`;
  if (!ANIMATABLE.has(path)) {
    return { actions: [], summary: `Cannot animate "${property}". Animate x, y, scale, rotation, skewX, skewY, opacity or volume.` };
  }
  const from = num(params.from), to = num(params.to);
  if (from === undefined || to === undefined) return { actions: [], summary: 'Both "from" and "to" values are required.' };
  const easingKey = str(params.easing) ?? 'ease-in-out';
  const useEasing: Easing = EASING_MAP[easingKey] ?? 'easeInOut';
  const actions: Action[] = [];
  for (const c of targets) {
    const s = num(params.startTime) ?? 0;
    const e = num(params.endTime) ?? c.duration;
    const st = Math.max(0, Math.min(s, c.duration - 0.05));
    const en = Math.max(st + 0.05, Math.min(e, c.duration));
    actions.push({ type: 'add_keyframe', clipId: c.id, path, time: st, value: from, easing: useEasing });
    actions.push({ type: 'add_keyframe', clipId: c.id, path, time: en, value: to, easing: useEasing });
  }
  return {
    actions,
    summary: `Animated ${path} on ${targets.length} clip${targets.length === 1 ? '' : 's'} (${from} → ${to}).`,
    stats: { clips: targets.length, property: path },
  };
}

/** Set a speed ramp with multiple keyframes (fast-in, slow-mo, etc.). */
export function speedRamp(ctx: ToolContext, params: {
  clipId?: string; points?: { time: number; speed: number }[];
}): ToolResult {
  const targets = editable(ctx, str(params.clipId));
  if (!targets.length) return { actions: [], summary: 'No editable clip matched that request.' };
  const raw = Array.isArray(params.points) ? params.points : [];
  if (raw.length < 2) return { actions: [], summary: 'A speed ramp needs at least two points.' };
  const actions: Action[] = [];
  let pointCount = 0;
  for (const c of targets) {
    // Filter first, then sort/deduplicate — the renderer assumes ordered,
    // strictly increasing clip-local times and speeds within 0.1–8.
    const seen = new Set<number>();
    const points = raw
      .map((p) => ({ t: num((p as { time?: unknown })?.time), speed: num((p as { speed?: unknown })?.speed) }))
      .filter((p): p is { t: number; speed: number } => p.t !== undefined && p.speed !== undefined)
      .map((p) => ({ t: clamp(p.t, 0, c.duration), speed: clamp(p.speed, 0.1, 8) }))
      .sort((a, b) => a.t - b.t)
      .filter((p) => {
        if (seen.has(p.t)) return false;
        seen.add(p.t);
        return true;
      });
    if (points.length < 2) continue;
    pointCount = Math.max(pointCount, points.length);
    actions.push({ type: 'set_speed_ramp', clipId: c.id, points });
  }
  if (!actions.length) return { actions: [], summary: 'That ramp needs at least two distinct, valid time points per clip.' };
  return {
    actions,
    summary: `Applied a ${pointCount}-point speed ramp to ${actions.length} clip${actions.length === 1 ? '' : 's'}.`,
    stats: { clips: actions.length, points: pointCount },
  };
}

/** Apply a mask shape to clips (rect/ellipse/polygon). */
export function applyMask(ctx: ToolContext, params: {
  clipId?: string; shape?: string; feather?: number; invert?: boolean;
  x?: number; y?: number; width?: number; height?: number;
}): ToolResult {
  const targets = editable(ctx, str(params.clipId));
  if (!targets.length) return { actions: [], summary: 'No editable clip matched that request.' };
  const shape = str(params.shape) ?? 'rect';
  if (!['rect', 'ellipse', 'polygon'].includes(shape)) return { actions: [], summary: `Unknown mask shape "${shape}". Use rect, ellipse or polygon.` };
  const x = clamp(num(params.x) ?? 0.2, 0, 1), y = clamp(num(params.y) ?? 0.2, 0, 1);
  const w = clamp(num(params.width) ?? 0.6, 0.01, 1), h = clamp(num(params.height) ?? 0.6, 0.01, 1);
  const feather = clamp(num(params.feather) ?? 0.05, 0, 0.25);
  const actions: Action[] = targets.map((c) => ({
    type: 'set_clip_props', clipId: c.id,
    patch: {
      mask: {
        shape: shape as 'rect' | 'ellipse' | 'polygon',
        x, y, w, h, feather,
        invert: bool(params.invert) ?? false,
        points: shape === 'polygon' ? [
          { x, y }, { x: Math.min(1, x + w), y },
          { x: Math.min(1, x + w), y: Math.min(1, y + h) }, { x, y: Math.min(1, y + h) },
        ] : undefined,
      },
    },
  }));
  return { actions, summary: `Applied a ${shape} mask to ${targets.length} clip${targets.length === 1 ? '' : 's'}.`, stats: { clips: targets.length, shape } };
}

/** Set a transition on a clip edge. */
export function setClipTransition(ctx: ToolContext, params: {
  clipId?: string; edge?: string; type?: string; duration?: number;
}): ToolResult {
  const targets = editable(ctx, str(params.clipId));
  if (!targets.length) return { actions: [], summary: 'No editable clip matched that request.' };
  const edge = str(params.edge) === 'out' ? 'out' : 'in';
  const requested = str(params.type) ?? 'crossfade';
  const type = TRANSITION_ALIASES[requested.toLowerCase()] ?? (TRANSITION_TYPES.includes(requested as TransitionType) ? requested as TransitionType : undefined);
  if (!type) {
    return { actions: [], summary: `Unknown transition "${requested}". Available: ${TRANSITION_TYPES.join(', ')}.` };
  }
  const actions: Action[] = targets.map((c) => {
    const transition: Transition = { type, duration: clamp(num(params.duration) ?? 0.4, 0.05, Math.max(0.05, Math.min(2, c.duration))) };
    return { type: 'set_transition', clipId: c.id, edge, transition };
  });
  return { actions, summary: `Set a ${type} transition (${edge}) on ${actions.length} clip${actions.length === 1 ? '' : 's'}.`, stats: { clips: actions.length, type } };
}

/** Group or ungroup clips. */
export function groupClipsAI(ctx: ToolContext, params: { clipIds?: string[]; ungroup?: boolean }): ToolResult {
  if (params.ungroup) {
    const groupIds = new Set(params.clipIds?.map((id) => ctx.project.clips.find((c) => c.id === id)?.groupId).filter(Boolean) as string[] ?? []);
    if (!groupIds.size) return { actions: [], summary: 'None of those clips are grouped.' };
    return {
      actions: [...groupIds].map((groupId) => ({ type: 'ungroup', groupId })),
      summary: `Ungrouped ${groupIds.size} group${groupIds.size === 1 ? '' : 's'}.`,
    };
  }
  const ids = (params.clipIds ?? []).filter((id) => !ctx.lockedClipIds?.has(id) && ctx.project.clips.some((c) => c.id === id));
  if (ids.length < 2) return { actions: [], summary: 'Select at least two clips to group.' };
  return { actions: [{ type: 'group_clips', clipIds: ids }], summary: `Grouped ${ids.length} clips.`, stats: { clips: ids.length } };
}

/** Insert a gap or ripple-delete a time range. */
export function timeRangeEdit(ctx: ToolContext, params: {
  operation?: string; start?: number; end?: number; duration?: number; trackIds?: string[];
}): ToolResult {
  const op = str(params.operation) ?? 'delete';
  const start = num(params.start), end = num(params.end), duration = num(params.duration);
  if (start === undefined) return { actions: [], summary: 'A start time is required.' };
  if (op === 'gap') {
    const d = clamp(duration ?? (end !== undefined ? end - start : 1), 0.05, 3600);
    return { actions: [{ type: 'insert_gap', time: Math.max(0, start), duration: d, trackIds: params.trackIds }], summary: `Inserted a ${d.toFixed(2)}s gap at ${start.toFixed(2)}s.` };
  }
  if (end === undefined || end <= start) return { actions: [], summary: 'A valid end time after start is required.' };
  return {
    actions: [{ type: 'ripple_delete_range', start, end, trackIds: params.trackIds, shiftMarkers: true }],
    summary: `Deleted ${(end - start).toFixed(2)}s from ${start.toFixed(2)}s to ${end.toFixed(2)}s.`,
  };
}

/** Add a labeled marker (chapter, b-roll, beat, etc.) at a time. */
export function addMarkerAI(ctx: ToolContext, params: {
  time?: number; label?: string; color?: string; kind?: string;
}): ToolResult {
  const time = num(params.time) ?? 0;
  const label = str(params.label) ?? `M${ctx.project.markers.length + 1}`;
  const requestedKind = str(params.kind)?.toLowerCase().replace(/[-\s]/g, '') ?? 'user';
  const kind: Marker['kind'] = (['scene', 'broll', 'beat', 'chapter', 'retake', 'user'].includes(requestedKind)
    ? requestedKind : 'user') as Marker['kind'];
  const color = str(params.color) ?? '#38BDF8';
  const actions: Action[] = [{
    type: 'add_marker',
    marker: {
      time: Math.max(0, time), label,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#38BDF8',
      kind,
    },
  }];
  return { actions, summary: `Added marker "${label}" at ${time.toFixed(2)}s.`, stats: { time } };
}

/** Add a review note (tack) at a time. */
export function addNote(ctx: ToolContext, params: { time?: number; text?: string }): ToolResult {
  const time = num(params.time) ?? 0;
  const text = str(params.text);
  if (!text) return { actions: [], summary: 'Note text is required.' };
  return {
    actions: [{ type: 'add_tack', tack: { time: Math.max(0, time), text, author: 'ai' } }],
    summary: `Added note "${text.slice(0, 40)}" at ${time.toFixed(2)}s.`,
  };
}

/** Set label colors on clips for visual organization. */
export function labelClips(ctx: ToolContext, params: { clipIds?: string[]; label?: string }): ToolResult {
  const label = str(params.label) ?? 'select';
  const ids = (params.clipIds ?? []).filter((id) => !ctx.lockedClipIds?.has(id));
  const targets = ids.length ? ids.map((id) => ctx.project.clips.find((c) => c.id === id)).filter(Boolean) : editable(ctx);
  if (!targets.length) return { actions: [], summary: 'No editable clip matched that request.' };
  const actions: Action[] = targets.map((c) => ({ type: 'set_clip_props', clipId: c!.id, patch: { label } }));
  return { actions, summary: `Labeled ${targets.length} clip${targets.length === 1 ? '' : 's'} as "${label}".`, stats: { clips: targets.length } };
}

/** Set clip blend mode. */
export function setBlendMode(ctx: ToolContext, params: { clipId?: string; mode?: string }): ToolResult {
  const targets = editable(ctx, str(params.clipId));
  if (!targets.length) return { actions: [], summary: 'No editable clip matched that request.' };
  const mode = str(params.mode);
  if (!mode || !BLEND_MODES.includes(mode as typeof BLEND_MODES[number])) {
    return { actions: [], summary: `Unknown blend mode. Available: ${BLEND_MODES.join(', ')}.` };
  }
  const actions: Action[] = targets.map((c) => ({ type: 'set_clip_props', clipId: c.id, patch: { blendMode: mode as typeof BLEND_MODES[number] } }));
  return { actions, summary: `Set ${mode} blend on ${targets.length} clip${targets.length === 1 ? '' : 's'}.`, stats: { clips: targets.length } };
}

/** Set fades on clips. */
export function setClipFades(ctx: ToolContext, params: { clipId?: string; fadeIn?: number; fadeOut?: number }): ToolResult {
  const targets = editable(ctx, str(params.clipId));
  if (!targets.length) return { actions: [], summary: 'No editable clip matched that request.' };
  const actions: Action[] = targets.map((c) => {
    const max = c.duration / 2;
    const fi = num(params.fadeIn);
    const fo = num(params.fadeOut);
    return {
      type: 'set_fades', clipId: c.id,
      fadeIn: fi === undefined ? undefined : clamp(fi, 0, max),
      fadeOut: fo === undefined ? undefined : clamp(fo, 0, max),
    };
  });
  return { actions, summary: `Set fades on ${targets.length} clip${targets.length === 1 ? '' : 's'}.`, stats: { clips: targets.length } };
}
