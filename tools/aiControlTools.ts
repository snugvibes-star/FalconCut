/**
 * AI-controllable editing tools. Every function only produces engine actions —
 * the assistant never mutates the project directly, so all calls stay undoable
 * and previewable through the existing tool pipeline.
 */
import type { Action } from '../engine/actions';
import type { CaptionWord, TextStyle } from '../engine';
import type { ToolContext, ToolResult } from './cutTools';
import { presetTextStyle } from '../src/components/tabs/textPresets';

export const CAPTION_PRESET_IDS = [
  'default', 'tiktok', 'karaoke', 'beast', 'focus', 'mogul',
  'minimal', 'documentary', 'podcast', 'gaming', 'cinematic',
];

function captions(ctx: ToolContext, index?: number) {
  const list = ctx.project.clips
    .filter((c) => c.kind === 'text' && c.text?.role === 'caption' && !ctx.lockedClipIds?.has(c.id))
    .sort((a, b) => a.start - b.start);
  if (index != null && Number.isFinite(index)) {
    const c = list[index];
    return c ? [c] : [];
  }
  return list;
}

const num = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const bool = (v: unknown): boolean | undefined => (v == null ? undefined : Boolean(v));

/** Apply typography, position and animation fields to captions. */
export function setCaptionStyleAdvanced(
  ctx: ToolContext,
  params: {
    captionIndex?: number; presetId?: string; fontFamily?: string; fontSize?: number; fontWeight?: number;
    color?: string; highlightColor?: string; outlineColor?: string; outlineWidth?: number;
    bgColor?: string; bgPadding?: number; x?: number; y?: number; align?: string;
    uppercase?: boolean; revealWords?: boolean; wordSpacing?: number; lineSpacing?: number;
    animation?: string; maxLines?: number; maxWidth?: number;
  },
): ToolResult {
  const targets = captions(ctx, num(params.captionIndex));
  if (!targets.length) return { actions: [], summary: 'No editable captions found to style.' };

  const patch: Partial<TextStyle> = {};
  if (params.presetId && CAPTION_PRESET_IDS.includes(params.presetId)) {
    const base = presetTextStyle(params.presetId as never, 'caption', ctx.project.settings.aspect);
    Object.assign(patch, base);
  }
  const fields: [keyof TextStyle, unknown][] = [
    ['fontFamily', str(params.fontFamily)], ['fontSize', num(params.fontSize)], ['fontWeight', num(params.fontWeight)],
    ['color', str(params.color)], ['highlightColor', str(params.highlightColor)], ['outlineColor', str(params.outlineColor)],
    ['outlineWidth', num(params.outlineWidth)], ['bgColor', str(params.bgColor)], ['bgPadding', num(params.bgPadding)],
    ['x', num(params.x)], ['y', num(params.y)], ['wordSpacing', num(params.wordSpacing)], ['lineSpacing', num(params.lineSpacing)],
    ['maxLines', num(params.maxLines)], ['maxWidth', num(params.maxWidth)],
  ];
  for (const [key, value] of fields) if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  const align = str(params.align);
  if (align === 'left' || align === 'center' || align === 'right') patch.align = align;
  const upper = bool(params.uppercase);
  if (upper !== undefined) patch.uppercase = upper;
  const reveal = bool(params.revealWords);
  if (reveal !== undefined) patch.revealWords = reveal;
  const anim = str(params.animation);
  if (anim) patch.animation = anim as TextStyle['animation'];

  const actions: Action[] = targets.map((c) => ({ type: 'set_text_style', clipId: c.id, patch }));
  return {
    actions,
    summary: `Applied ${params.presetId ?? 'custom'} caption styling to ${targets.length} caption${targets.length === 1 ? '' : 's'}.`,
    stats: { captions: targets.length },
  };
}

/** Configure active-word highlighting, including colors, animation and offset. */
export function setCaptionHighlight(
  ctx: ToolContext,
  params: {
    captionIndex?: number; enabled?: boolean; anim?: string; bgColor?: string; textColor?: string;
    prevColor?: string; nextColor?: string; padding?: number; radius?: number; opacity?: number;
    speed?: number; glow?: number; shadow?: number; offset?: number;
  },
): ToolResult {
  const targets = captions(ctx, num(params.captionIndex));
  if (!targets.length) return { actions: [], summary: 'No editable captions found to highlight.' };
  const changes: Partial<TextStyle['highlight']> = {};
  const enabled = bool(params.enabled);
  if (enabled !== undefined) changes.enabled = enabled;
  const anim = str(params.anim);
  if (anim) changes.anim = anim as TextStyle['highlight']['anim'];
  for (const key of ['bgColor', 'textColor', 'prevColor', 'nextColor'] as const) {
    const value = str(params[key]);
    if (value) changes[key] = value;
  }
  for (const key of ['padding', 'radius', 'opacity', 'speed', 'glow', 'shadow', 'offset'] as const) {
    const value = num(params[key]);
    if (value !== undefined) changes[key] = value;
  }
  const actions: Action[] = targets.map((c) => ({
    type: 'set_text_style',
    clipId: c.id,
    patch: { highlight: { ...(c.text!.style.highlight ?? presetTextStyle('default', 'caption', ctx.project.settings.aspect).highlight), ...changes } },
  }));
  return {
    actions,
    summary: `Updated active-word highlighting on ${targets.length} caption${targets.length === 1 ? '' : 's'}.`,
    stats: { captions: targets.length },
  };
}

/** Configure glow, soft blur, opacity and sharpness. */
export function setCaptionEffects(
  ctx: ToolContext,
  params: {
    captionIndex?: number; glowEnabled?: boolean; glowColor?: string; glowRadius?: number; glowIntensity?: number;
    blurEnabled?: boolean; blurAmount?: number; blurDirection?: string; edgeSoftness?: number;
    backgroundBlur?: number; textOpacity?: number; sharpness?: number;
  },
): ToolResult {
  const targets = captions(ctx, num(params.captionIndex));
  if (!targets.length) return { actions: [], summary: 'No editable captions found to apply effects to.' };
  const actions: Action[] = targets.map((c) => {
    const s = c.text!.style;
    const patch: Partial<TextStyle> = {};
    const ge = bool(params.glowEnabled);
    const be = bool(params.blurEnabled);
    if (ge !== undefined || str(params.glowColor) || num(params.glowRadius) !== undefined || num(params.glowIntensity) !== undefined) {
      patch.glow = {
        enabled: ge ?? s.glow?.enabled ?? false,
        color: str(params.glowColor) ?? s.glow?.color ?? '#22D3EE',
        radius: num(params.glowRadius) ?? s.glow?.radius ?? 0.08,
        intensity: num(params.glowIntensity) ?? s.glow?.intensity ?? 0.5,
      };
    }
    if (be !== undefined || num(params.blurAmount) !== undefined || str(params.blurDirection) || num(params.edgeSoftness) !== undefined) {
      const dir = str(params.blurDirection);
      patch.blur = {
        enabled: be ?? s.blur?.enabled ?? false,
        amount: num(params.blurAmount) ?? s.blur?.amount ?? 0.03,
        direction: dir === 'left' || dir === 'right' || dir === 'up' || dir === 'down' ? dir : (s.blur?.direction ?? 'right'),
        edgeSoftness: num(params.edgeSoftness) ?? s.blur?.edgeSoftness ?? 0.5,
      };
    }
    for (const key of ['backgroundBlur', 'textOpacity', 'sharpness'] as const) {
      const v = num(params[key]);
      if (v !== undefined && key in s) (patch as Record<string, unknown>)[key] = v;
    }
    return { type: 'set_text_style' as const, clipId: c.id, patch };
  });
  return {
    actions,
    summary: `Applied glow/blur/opacity effects to ${targets.length} caption${targets.length === 1 ? '' : 's'}.`,
    stats: { captions: targets.length },
  };
}

/** Edit an individual word's text, timing and style inside a caption. */
export function editCaptionWord(
  ctx: ToolContext,
  params: {
    captionIndex: number; wordIndex: number; text?: string; start?: number; end?: number;
    color?: string; fontWeight?: number; fontStyle?: string; opacity?: number; letterSpacing?: number;
  },
): ToolResult {
  const target = captions(ctx, num(params.captionIndex))[0];
  if (!target) return { actions: [], summary: `No caption at index ${params.captionIndex}.` };
  const words: CaptionWord[] = (target.text!.words ?? []).map((w) => ({ ...w, style: w.style ? { ...w.style } : undefined }));
  const i = num(params.wordIndex);
  if (i == null || i < 0 || i >= words.length) return { actions: [], summary: `Word index ${params.wordIndex} is out of range (${words.length} words).` };
  const w = words[i];
  const text = str(params.text);
  if (text) w.w = text;
  const start = num(params.start), end = num(params.end);
  if (start !== undefined) w.start = Math.max(0, start);
  if (end !== undefined) w.end = Math.max((w.start ?? 0) + 0.01, end);
  const style = { ...(w.style ?? {}) };
  const color = str(params.color);
  if (color) style.color = color;
  const weight = num(params.fontWeight);
  if (weight !== undefined) style.fontWeight = weight;
  const fs = str(params.fontStyle);
  if (fs === 'normal' || fs === 'italic' || fs === 'oblique') style.fontStyle = fs;
  const opacity = num(params.opacity);
  if (opacity !== undefined) style.opacity = Math.max(0, Math.min(1, opacity));
  const ls = num(params.letterSpacing);
  if (ls !== undefined) style.letterSpacing = ls;
  if (Object.keys(style).length) w.style = style;
  return {
    actions: [{ type: 'set_text', clipId: target.id, words }],
    summary: `Edited word ${i + 1} of caption ${params.captionIndex}.`,
    stats: { caption: params.captionIndex, word: i, words: words.length },
  };
}

/** Set clip-level blend, fit, name, volume and fades. */
export function setClipLookAdvanced(
  ctx: ToolContext,
  params: {
    clipId?: string; blendMode?: string; fit?: string; name?: string; label?: string;
    volume?: number; fadeIn?: number; fadeOut?: number; reversed?: boolean;
  },
): ToolResult {
  const clips = ctx.project.clips.filter((c) => !ctx.lockedClipIds?.has(c.id)
    && (!params.clipId || c.id === params.clipId) && (c.kind === 'media' || c.kind === 'text'));
  if (!clips.length) return { actions: [], summary: 'No editable clip matched that request.' };
  const actions: Action[] = [];
  for (const c of clips) {
    const patch: NonNullable<Extract<Action, { type: 'set_clip_props' }>['patch']> = {};
    const blend = str(params.blendMode);
    if (blend) patch.blendMode = blend as typeof patch.blendMode;
    const fit = str(params.fit);
    if (fit === 'cover' || fit === 'contain' || fit === 'fill') patch.fit = fit;
    const name = str(params.name); if (name) patch.name = name;
    const label = str(params.label); if (label) patch.label = label;
    const rev = bool(params.reversed); if (rev !== undefined) patch.reversed = rev;
    const volume = num(params.volume); if (volume !== undefined) patch.volume = Math.max(0, volume);
    if (Object.keys(patch).length) actions.push({ type: 'set_clip_props', clipId: c.id, patch });
    const fi = num(params.fadeIn), fo = num(params.fadeOut);
    if (fi !== undefined || fo !== undefined) actions.push({ type: 'set_fades', clipId: c.id, fadeIn: fi, fadeOut: fo });
  }
  return {
    actions,
    summary: `Updated look and audio properties on ${clips.length} clip${clips.length === 1 ? '' : 's'}.`,
    stats: { clips: clips.length },
  };
}

/** Change project frame rate, aspect, resolution or background color. */
export function setProjectSettingsAI(
  ctx: ToolContext,
  params: { fps?: number; aspect?: string; width?: number; height?: number; background?: string },
): ToolResult {
  const patch: Record<string, unknown> = {};
  const fps = num(params.fps);
  if (fps === 24 || fps === 25 || fps === 30 || fps === 60) patch.fps = fps;
  const aspect = str(params.aspect);
  if (aspect === '16:9' || aspect === '9:16' || aspect === '1:1' || aspect === '4:5') patch.aspect = aspect;
  const width = num(params.width), height = num(params.height);
  if (width !== undefined && width >= 320 && width <= 3840) patch.width = Math.round(width);
  if (height !== undefined && height >= 320 && height <= 3840) patch.height = Math.round(height);
  const background = str(params.background);
  if (background) patch.background = background;
  if (!Object.keys(patch).length) return { actions: [], summary: 'No supported project settings were provided.' };
  return {
    actions: [{ type: 'set_settings', patch }],
    summary: `Updated project settings: ${Object.keys(patch).join(', ')}.`,
    stats: { fields: Object.keys(patch).length },
  };
}
