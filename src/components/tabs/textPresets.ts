/** Shared building blocks for adding titles/captions with a real preset,
 * effect and transition. Everything is committed as engine actions, so the
 * result is part of the rendered video (no sidecar download needed) and is
 * one undo step. */
import {
  applyActions, defaultTextStyle, uid,
  type Action, type CaptionStyleId, type CaptionWord, type Project, type TextStyle, type Transition,
} from '../../../engine';

export type TextRole = 'title' | 'caption' | 'hook';
export type TextEffect = 'none' | 'shadow' | 'halo' | 'pop' | 'rise' | 'fade' | 'typewriter' | 'glow' | 'blur' | 'gradient' | 'glass' | 'reflection';

export type TextTransition = 'none' | 'in' | 'out' | 'both' | 'slide-left' | 'slide-right' | 'wipe';

interface TextEffectDef { id: TextEffect; label: string; hint: string; params?: Record<string, string | number | boolean> }
export const TEXT_EFFECTS: TextEffectDef[] = [
  { id: 'none', label: 'None', hint: 'Plain text' },
  { id: 'shadow', label: 'Shadow', hint: 'Soft black drop shadow' },
  { id: 'halo', label: 'Halo', hint: 'Coloured outline glow', params: { radius: 0.12, color: '#C6F24E' } },
  { id: 'pop', label: 'Pop', hint: 'Spring-in animation' },
  { id: 'rise', label: 'Rise', hint: 'Rise into place' },
  { id: 'fade', label: 'Fade', hint: 'Soft fade in/out' },
  { id: 'typewriter', label: 'Type', hint: 'Typewriter reveal' },
  { id: 'glow', label: 'Glow', hint: 'Colored outer glow', params: { color: '#00FFFF', radius: 0.08, intensity: 0.5 } },
  { id: 'blur', label: 'Blur', hint: 'Soft text blur', params: { amount: 0.03, direction: 'right', edgeSoftness: 0.5, color: '#00FFFF' } },
  { id: 'gradient', label: 'Gradient', hint: 'Color gradient fill', params: { color: '#FF3B30' } },
  { id: 'glass', label: 'Glass', hint: 'Glass text effect', params: { color: '#FFFFFF', radius: 0.05 } },
  { id: 'reflection', label: 'Reflection', hint: 'Text reflection', params: { color: '#FFFFFF', strength: 0.3 } },
];

export const TEXT_TRANSITIONS: { id: TextTransition; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'No clip transition' },
  { id: 'in', label: 'Fade in', hint: 'Fade the clip in over 0.4s' },
  { id: 'out', label: 'Fade out', hint: 'Fade the clip out over 0.4s' },
  { id: 'both', label: 'In & out', hint: 'Fade both edges' },
  { id: 'slide-left', label: 'Slide Left', hint: 'Slide the clip left' },
  { id: 'slide-right', label: 'Slide Right', hint: 'Slide the clip right' },
  { id: 'wipe', label: 'Wipe', hint: 'Wipe transition' },
];

export type CinematicPresetId = 'default' | 'tiktok' | 'karaoke' | 'beast' | 'focus' | 'mogul';

export interface CaptionPreset {
  id: CinematicPresetId;
  label: string;
  styleId: CaptionStyleId;
  effect: TextEffect;
  transition: TextTransition;
  /** Full style overrides applied on top of defaultTextStyle(styleId). */
  style: Partial<TextStyle>;
}

/** The six caption styles from the reference, reproduced as real, editable
 * engine styles. Every field below is persisted in TextStyle and rendered by
 * drawCaption using each CaptionWord's own start/end times. */
export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: 'default', label: 'Default', styleId: 'clean', effect: 'shadow', transition: 'both',
    style: {
      presetId: 'default', revealWords: true, color: '#FFFFFF', fontSize: 0.046, fontWeight: 800,
      uppercase: false, shadow: true, outlineWidth: 0.03, bgColor: 'transparent',
      highlight: { enabled: false, anim: 'instant', bgColor: '#000000', textColor: '#FFFFFF', padding: 0.18, radius: 0.1, opacity: 0.9, speed: 0.12, glow: 0, shadow: 0 },
    },
  },
  {
    id: 'tiktok', label: 'TikTok', styleId: 'clean', effect: 'shadow', transition: 'both',
    style: {
      presetId: 'tiktok', revealWords: true, color: '#FFFFFF', fontSize: 0.052, fontWeight: 900,
      uppercase: false, shadow: true, outlineWidth: 0.045, bgColor: 'transparent',
      highlight: { enabled: true, anim: 'slide', bgColor: '#FFEB00', textColor: '#0B1220', padding: 0.12, radius: 0.06, opacity: 1, speed: 0.16, glow: 0.05, shadow: 0 },
    },
  },
  {
    id: 'karaoke', label: 'Karaoke', styleId: 'karaoke', effect: 'halo', transition: 'both',
    style: {
      presetId: 'karaoke', revealWords: true, color: '#FFFFFF', fontSize: 0.05, fontWeight: 800,
      uppercase: false, shadow: true, outlineWidth: 0.03, bgColor: 'transparent',
      highlightColor: '#22D3EE',
      highlight: { enabled: true, anim: 'color', bgColor: 'rgba(0,0,0,0)', textColor: '#22D3EE', padding: 0, radius: 0, opacity: 0, speed: 0.18, glow: 0, shadow: 0 },
    },
  },
  {
    id: 'beast', label: 'Beast', styleId: 'word-pop', effect: 'pop', transition: 'both',
    style: {
      presetId: 'beast', revealWords: true, color: '#FFFFFF', fontSize: 0.075, fontWeight: 900,
      uppercase: true, shadow: true, outlineWidth: 0.045, bgColor: 'transparent',
      letterSpacing: 0.01,
      highlight: { enabled: true, anim: 'pop', bgColor: '#C6F24E', textColor: '#0B1220', padding: 0.14, radius: 0.06, opacity: 1, speed: 0.14, glow: 0.04, shadow: 0 },
    },
  },
  {
    id: 'focus', label: 'Focus', styleId: 'clean', effect: 'shadow', transition: 'both',
    style: {
      presetId: 'focus', revealWords: true, color: '#FFFFFF', fontSize: 0.05, fontWeight: 800,
      uppercase: false, shadow: true, outlineWidth: 0.03, bgColor: 'transparent',
      highlight: { enabled: true, anim: 'instant', bgColor: '#FFD400', textColor: '#0B1220', padding: 0.2, radius: 0.08, opacity: 1, speed: 0.1, glow: 0.06, shadow: 0.04 },
    },
  },
  {
    id: 'mogul', label: 'Mogul', styleId: 'bold-keywords', effect: 'halo', transition: 'both',
    style: {
      presetId: 'mogul', revealWords: true, color: '#FFFFFF', fontSize: 0.056, fontWeight: 900,
      uppercase: false, shadow: true, outlineWidth: 0.03, bgColor: 'transparent',
      highlightColor: '#22D3EE',
      highlight: { enabled: true, anim: 'slide', bgColor: '#22D3EE', textColor: '#06121F', padding: 0.14, radius: 0.07, opacity: 0.95, speed: 0.2, glow: 0.08, shadow: 0 },
    },
  },
];

/** Build the complete TextStyle for a cinematic preset and aspect. */
export function presetTextStyle(presetId: CinematicPresetId, role: TextRole, aspect: string): TextStyle {
  const preset = CAPTION_PRESETS.find((p) => p.id === presetId) ?? CAPTION_PRESETS[0];
  const base = defaultTextStyle(preset.styleId);
  if (role === 'title') {
    base.y = 0.26;
    base.fontSize = Math.max(0.072, base.fontSize);
    base.animation = 'pop';
    base.bgColor = 'transparent';
  } else {
    base.y = Math.min(base.y, SAFE_Y[aspect] ?? 0.8);
  }
  const style: TextStyle = { ...base, ...preset.style };
  // Deep-merge nested highlight/glow/blur so card overrides are complete.
  style.highlight = { ...base.highlight, ...(preset.style.highlight ?? {}) };
  style.glow = { ...base.glow, ...(preset.style.glow ?? {}) };
  style.blur = { ...base.blur, ...(preset.style.blur ?? {}) };
  return style;
}

/** Evenly distribute a caption's words across its duration when no transcript
 * timing exists yet. The words remain independently editable afterwards. */
export function evenWords(text: string, duration: number): CaptionWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const step = Math.max(0.05, duration / parts.length);
  return parts.map((w, i) => ({ w, start: i * step, end: (i + 1) * step }));
}

/** Actions that re-skin an existing text clip with one of the six presets. */
export function presetActions(
  clipId: string, presetId: CinematicPresetId, role: TextRole, aspect: string,
  text?: string, duration?: number, existingWordCount = 0,
): Action[] {
  const style = presetTextStyle(presetId, role, aspect);
  const actions: Action[] = [{ type: 'set_text_style', clipId, patch: style }];
  // Existing speech timing is precious — only synthesise even timing when the
  // caption has no words yet (manually typed captions).
  if (!existingWordCount && text && duration != null) {
    actions.push({ type: 'set_text', clipId, words: evenWords(text, duration) });
  }
  return actions;
}

const SAFE_Y: Record<string, number> = { '9:16': 0.72, '4:5': 0.76, '1:1': 0.78, '16:9': 0.82 };

/** Full style for a new text clip. Titles sit high and large; captions use
 * the aspect safe zone so nothing is cropped on 9:16. */
export function textStyleFor(
  preset: CaptionStyleId,
  effect: TextEffect,
  role: TextRole,
  aspect: string,
): TextStyle {
  const s = defaultTextStyle(preset);
  if (role === 'title') {
    s.y = 0.26;
    s.fontSize = Math.max(0.072, s.fontSize);
    s.maxLines = 2;
    s.animation = 'pop';
    s.bgColor = 'transparent';
  } else {
    s.y = Math.min(s.y, SAFE_Y[aspect] ?? 0.8);
  }
  const p = TEXT_EFFECTS.find((x) => x.id === effect)?.params ?? {};
  switch (effect) {
    case 'shadow':
      s.shadow = true;
      break;
    case 'halo':
      s.shadow = false;
      s.outlineWidth = Math.max(0.045, s.outlineWidth);
      s.outlineColor = s.highlightColor;
      break;
    case 'pop':
      s.animation = 'pop';
      break;
    case 'rise':
      s.animation = 'rise';
      break;
    case 'fade':
      s.animation = 'fade';
      break;
    case 'typewriter':
      s.animation = 'typewriter';
      break;
    case 'glow':
      s.shadow = false;
      s.highlightColor = String(p.color ?? s.highlightColor);
      s.outlineWidth = Math.min(0.06, Number(p.radius ?? 0.08) * 0.6);
      s.animation = 'pop';
      break;
    case 'blur':
      s.shadow = false;
      s.shadowColor = String(p.color ?? s.color);
      s.shadowBlur = Number(p.amount ?? 0.03) * s.fontSize;
      s.shadowOffsetX = p.direction === 'left' ? -Number(p.amount ?? 0.03) * s.fontSize : 0;
      s.shadowOffsetY = p.direction === 'up' ? Number(p.amount ?? 0.03) * s.fontSize : 0;
      break;
    case 'gradient':
      s.shadow = false;
      s.highlightColor = String(p.color ?? s.highlightColor);
      s.bgColor = String(p.color ?? s.color);
      break;
    case 'glass':
      s.shadow = false;
      s.highlightColor = String(p.color ?? s.highlightColor);
      s.bgColor = 'rgba(255,255,255,0.2)';
      s.bgPadding = 0.2;
      break;
    case 'reflection':
      s.shadow = false;
      s.highlightColor = String(p.color ?? s.highlightColor);
      s.bgColor = 'rgba(255,255,255,0.1)';
      s.bgPadding = 0.1;
      s.animation = 'fade';
      break;
    default:
      break;
  }
  return s;
}

const transitionFor = (which: 'in' | 'out'): Transition => ({ type: 'crossfade', duration: 0.4 });

/** Style patch for applying an effect to an existing text clip. */
export function effectPatch(preset: CaptionStyleId, effect: TextEffect, role: TextRole, aspect: string): Partial<TextStyle> {
  const full = textStyleFor(preset, effect, role, aspect);
  const patch: Partial<TextStyle> = {
    animation: full.animation,
    shadow: full.shadow,
    outlineWidth: full.outlineWidth,
    outlineColor: full.outlineColor,
  };
  if (effect === 'none') {
    // Don't force position/size on an existing clip — only neutralise the look.
    patch.animation = 'none';
  }
  return patch;
}

export interface StyledTextParams {
  start: number;
  duration: number;
  text: string;
  role: TextRole;
  preset: CaptionStyleId;
  effect: TextEffect;
  transition: TextTransition;
  trackId?: string;
  /** Visual preset (Default/TikTok/Karaoke/Beast/Focus/Mogul). */
  presetId?: CinematicPresetId;
  /** Per-word timing + style overrides (clip-local seconds). */
  words?: CaptionWord[];
}

/** Build add_text (+ optional track, + transitions) in ONE undo step.
 * The new clip id is derived the same way the engine derives it, so the
 * transition actions can target it without a second commit. */
export function buildStyledText(project: Project, params: StyledTextParams): { actions: Action[]; clipId: string } {
  const trackId = params.trackId
    ?? project.tracks.find((t) => t.kind === 'text' && !t.locked)?.id
    ?? project.tracks.find((t) => t.kind === 'text')?.id
    ?? uid('trk');
  const actions: Action[] = [];
  if (!project.tracks.some((t) => t.id === trackId)) {
    actions.push({ type: 'add_track', track: { id: trackId, kind: 'text', name: 'Text' } });
  }
  actions.push({
    type: 'add_text',
    trackId,
    start: params.start,
    duration: params.duration,
    text: params.text,
    role: params.role,
    preset: params.preset,
    words: params.words,
    style: params.presetId
      ? presetTextStyle(params.presetId, params.role, project.settings.aspect)
      : textStyleFor(params.preset, params.effect, params.role, project.settings.aspect),
  });

  // Determine the deterministic clip id the engine will assign to add_text.
  const probe = applyActions(project, actions);
  const clipId = probe.clips.find((c) => !project.clips.some((old) => old.id === c.id))?.id ?? '';
  if (clipId) {
    if (params.transition === 'in' || params.transition === 'both') {
      actions.push({ type: 'set_transition', clipId, edge: 'in', transition: transitionFor('in') });
    }
    if (params.transition === 'out' || params.transition === 'both') {
      actions.push({ type: 'set_transition', clipId, edge: 'out', transition: transitionFor('out') });
    }
  }
  return { actions, clipId };
}

/** Transition actions for an existing clip ('none' removes both edges). */
export function transitionActions(clipId: string, transition: TextTransition): Action[] {
  const out: Action[] = [];
  const inOn = transition === 'in' || transition === 'both';
  const outOn = transition === 'out' || transition === 'both';
  out.push({ type: 'set_transition', clipId, edge: 'in', transition: inOn ? transitionFor('in') : undefined });
  out.push({ type: 'set_transition', clipId, edge: 'out', transition: outOn ? transitionFor('out') : undefined });
  return out;
}
