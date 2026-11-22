/** Shared building blocks for adding titles/captions with a real preset,
 * effect and transition. Everything is committed as engine actions, so the
 * result is part of the rendered video (no sidecar download needed) and is
 * one undo step. */
import {
  applyActions, defaultTextStyle, uid,
  type Action, type CaptionStyleId, type Project, type TextStyle, type Transition,
} from '../../../engine';

export type TextRole = 'title' | 'caption' | 'hook';
export type TextEffect = 'none' | 'shadow' | 'halo' | 'pop' | 'rise' | 'fade' | 'typewriter';
export type TextTransition = 'none' | 'in' | 'out' | 'both';

export const TEXT_EFFECTS: { id: TextEffect; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Plain text' },
  { id: 'shadow', label: 'Shadow', hint: 'Soft black drop shadow' },
  { id: 'halo', label: 'Halo', hint: 'Coloured outline glow' },
  { id: 'pop', label: 'Pop', hint: 'Spring-in animation' },
  { id: 'rise', label: 'Rise', hint: 'Rise into place' },
  { id: 'fade', label: 'Fade', hint: 'Soft fade in/out' },
  { id: 'typewriter', label: 'Type', hint: 'Typewriter reveal' },
];

export const TEXT_TRANSITIONS: { id: TextTransition; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'No clip transition' },
  { id: 'in', label: 'Fade in', hint: 'Fade the clip in over 0.4s' },
  { id: 'out', label: 'Fade out', hint: 'Fade the clip out over 0.4s' },
  { id: 'both', label: 'In & out', hint: 'Fade both edges' },
];

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
  switch (effect) {
    case 'shadow':
      s.shadow = true;
      break;
    case 'halo':
      s.shadow = false;
      s.outlineWidth = Math.max(0.12, s.outlineWidth);
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
    style: textStyleFor(params.preset, params.effect, params.role, project.settings.aspect),
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
