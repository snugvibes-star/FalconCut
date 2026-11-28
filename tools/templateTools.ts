/**
 * Template library. A template is data (id/name/category/aspect/description)
 * plus a builder function that only calls EXISTING engine tools. Nothing here
 * invents a new editing primitive: every card resolves to real Action[] that
 * the caller commits as ONE undo step through the normal store path.
 *
 * Two kinds of templates:
 *  - built-in recipes: sequences of runTool() calls, applied in order so later
 *    tools see the timeline produced by earlier ones;
 *  - user recipes: "save selection as template" serialises ONLY editing
 *    metadata (text style, effects, keyframes, transform, fades, transitions)
 *    to localStorage. No media, blobs or media ids are ever stored.
 */
import type { Action } from '../engine/actions';
import { applyActions } from '../engine/actions';
import type {
  Aspect, BlendMode, CaptionWord, Clip, Easing, EffectType, Fades,
  Project, TextStyle, Transition, Transform,
} from '../engine/types';
import { runTool } from './registry';

export type TemplateCategory = 'Social' | 'YouTube' | 'Product' | 'Slideshow' | 'Podcast' | 'Travel' | 'Music' | 'Saved';

export interface TemplateStep {
  /** Name of an existing tool in tools/registry.ts. */
  tool: string;
  /** snake_case params, exactly as the registry's tool manifest describes. */
  params: Record<string, unknown>;
}

export interface TemplateBuild {
  actions: Action[];
  summary: string;
  warnings: string[];
  /** Number of existing tools consulted while preparing this edit. */
  toolCalls: number;
}

export type TemplateBuilder = (project: Project, targetIds?: string[]) => Promise<TemplateBuild>;

export interface Template {
  source: 'builtin' | 'saved';
  id: string;
  name: string;
  category: TemplateCategory;
  aspect: Aspect;
  description: string;
  build: TemplateBuilder;
  steps?: readonly TemplateStep[];
}

/** Run existing tools in sequence against the evolving project so each step's
 * actions are valid for the timeline they will actually be committed to. */
export function toolBuilder(steps: readonly TemplateStep[]): TemplateBuilder {
  return async (project) => {
    let working = project;
    const actions: Action[] = [];
    const notes: string[] = [];
    const warnings = new Set<string>();
    for (const step of steps) {
      const result = await runTool(working, step.tool, step.params);
      if (result.actions.length) {
        actions.push(...result.actions);
        working = applyActions(working, result.actions);
        notes.push(result.summary);
      }
      for (const w of result.warnings ?? []) warnings.add(w);
    }
    return {
      actions,
      summary: notes.join(' ') || 'Nothing to apply — add clips or analyse the media first.',
      warnings: [...warnings],
      toolCalls: steps.length,
    };
  };
}

function defineTemplate(meta: {
  id: string; name: string; category: TemplateCategory; aspect: Aspect;
  description: string; steps: readonly TemplateStep[];
}): Template {
  return { source: 'builtin', ...meta, build: toolBuilder(meta.steps) };
}

/** 30 concrete, reusable edit recipes. Every `steps` entry is a real tool. */
export const BUILTIN_TEMPLATES: readonly Template[] = [
  // ---------------- Social: TikTok / Reels / Shorts ----------------
  defineTemplate({
    id: 'tiktok-hook', name: 'TikTok Hook', category: 'Social', aspect: '9:16',
    description: 'Vertical hook: dead air out, tight word-pop captions, punchy opening title.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'remove_dead_air', params: { max_pause_ms: 550 } },
      { tool: 'add_captions', params: { style: 'word-pop', density: 'tight', remove_fillers: true } },
      { tool: 'add_hook_title', params: {} },
    ],
  }),
  defineTemplate({
    id: 'tiktok-storytime', name: 'TikTok Storytime', category: 'Social', aspect: '9:16',
    description: 'Talking-head story with filler cuts, emphasis zooms and karaoke captions.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'remove_fillers', params: {} },
      { tool: 'zoom_on_emphasis', params: {} },
      { tool: 'add_captions', params: { style: 'karaoke', density: 'tight' } },
      { tool: 'add_motif', params: { type: 'title-reveal', start: 0, duration: 2 } },
    ],
  }),
  defineTemplate({
    id: 'reels-loop', name: 'Reels Music Loop', category: 'Social', aspect: '9:16',
    description: 'Beat-friendly reel: crossfades at real scene changes and balanced karaoke captions.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'snap_to_beats', params: { what: 'zooms' } },
      { tool: 'add_transitions', params: { style: 'crossfade' } },
      { tool: 'add_captions', params: { style: 'karaoke', density: 'balanced' } },
    ],
  }),
  defineTemplate({
    id: 'shorts-fast', name: 'YouTube Shorts', category: 'Social', aspect: '9:16',
    description: 'Fast vertical cut: retakes and pauses removed, punch-ins, one-word captions.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'remove_dead_air', params: { max_pause_ms: 500 } },
      { tool: 'cut_retakes', params: {} },
      { tool: 'zoom_on_emphasis', params: {} },
      { tool: 'add_captions', params: { style: 'word-pop', density: 'tight' } },
    ],
  }),
  defineTemplate({
    id: 'vertical-talking-head', name: 'Vertical Talking Head', category: 'Social', aspect: '9:16',
    description: 'Clean voice, gentle zooms, bold-keyword captions in the vertical safe zone.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'balance_audio', params: {} },
      { tool: 'cleanup_audio', params: { denoise: true, deess: true } },
      { tool: 'zoom_on_emphasis', params: {} },
      { tool: 'add_captions', params: { style: 'bold-keywords', density: 'balanced' } },
    ],
  }),
  defineTemplate({
    id: 'pov-vlog', name: 'POV Vlog', category: 'Social', aspect: '9:16',
    description: 'Casual first-person vlog with wipe transitions, vibrant look and a lower third.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'add_transitions', params: { style: 'wipe-left' } },
      { tool: 'apply_color_preset', params: { name: 'vibrant' } },
      { tool: 'add_motif', params: { type: 'lower-third', start: 0.5, duration: 3 } },
    ],
  }),
  defineTemplate({
    id: 'dance-clip', name: 'Dance / Beat Clip', category: 'Social', aspect: '9:16',
    description: 'Cuts nudged to the analysed beat grid with a vignette and minimal captions.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'snap_to_beats', params: { what: 'cuts' } },
      { tool: 'add_effect', params: { type: 'vignette', params: '{"amount":0.25}' } },
      { tool: 'add_captions', params: { style: 'clean', density: 'tight' } },
    ],
  }),

  // ---------------- YouTube ----------------
  defineTemplate({
    id: 'youtube-intro', name: 'YouTube Intro', category: 'YouTube', aspect: '16:9',
    description: 'Punchy channel opener: full intro pipeline plus a title reveal.',
    steps: [
      { tool: 'auto_edit', params: { video_type: 'youtube intro', aspect: '16:9' } },
      { tool: 'add_motif', params: { type: 'title-reveal', start: 0, duration: 2.5 } },
    ],
  }),
  defineTemplate({
    id: 'channel-trailer', name: 'Channel Trailer', category: 'YouTube', aspect: '16:9',
    description: 'Highlight-reel pacing with a lower third for the channel name.',
    steps: [
      { tool: 'auto_edit', params: { video_type: 'youtube intro' } },
      { tool: 'add_motif', params: { type: 'lower-third', start: 1, duration: 4 } },
    ],
  }),
  defineTemplate({
    id: 'tutorial', name: 'Tutorial', category: 'YouTube', aspect: '16:9',
    description: 'Step-by-step pacing, clear captions, longer shot holds and clean audio.',
    steps: [
      { tool: 'auto_edit', params: { video_type: 'tutorial', aspect: '16:9' } },
    ],
  }),
  defineTemplate({
    id: 'explainer', name: 'Explainer', category: 'YouTube', aspect: '16:9',
    description: 'Calm explainer with a chart graphic laid over the narration.',
    steps: [
      { tool: 'auto_edit', params: { video_type: 'tutorial' } },
      { tool: 'add_motif', params: { type: 'bar-chart', start: 1, duration: 4 } },
    ],
  }),
  defineTemplate({
    id: 'reaction', name: 'Reaction Cut', category: 'YouTube', aspect: '16:9',
    description: 'Tight reaction edit with zoom-in transitions and keyword captions.',
    steps: [
      { tool: 'remove_dead_air', params: { max_pause_ms: 600 } },
      { tool: 'zoom_on_emphasis', params: {} },
      { tool: 'add_transitions', params: { style: 'zoom-in' } },
      { tool: 'add_captions', params: { style: 'bold-keywords', density: 'balanced' } },
    ],
  }),
  defineTemplate({
    id: 'gaming-highlight', name: 'Gaming Highlight', category: 'YouTube', aspect: '16:9',
    description: 'High-energy montage: quick cuts, punch-ins, vibrant look and a burst graphic.',
    steps: [
      { tool: 'remove_dead_air', params: { max_pause_ms: 450 } },
      { tool: 'zoom_on_emphasis', params: {} },
      { tool: 'apply_color_preset', params: { name: 'vibrant' } },
      { tool: 'add_motif', params: { type: 'burst', start: 0.5, duration: 2 } },
    ],
  }),

  // ---------------- Product ----------------
  defineTemplate({
    id: 'product-ad', name: 'Product Ad', category: 'Product', aspect: '16:9',
    description: 'Full product promo pipeline: music ducking, dip transitions and a lower third.',
    steps: [
      { tool: 'auto_edit', params: { video_type: 'product promo' } },
      { tool: 'add_motif', params: { type: 'lower-third', start: 1, duration: 3 } },
    ],
  }),
  defineTemplate({
    id: 'product-teaser', name: 'Product Teaser', category: 'Product', aspect: '16:9',
    description: 'Moody teaser: cinematic grade, dip-to-black cuts and a title card.',
    steps: [
      { tool: 'balance_audio', params: {} },
      { tool: 'add_transitions', params: { style: 'dip-black' } },
      { tool: 'apply_color_preset', params: { name: 'cinematic' } },
      { tool: 'add_motif', params: { type: 'title-reveal', start: 0, duration: 3 } },
    ],
  }),
  defineTemplate({
    id: 'unboxing', name: 'Unboxing', category: 'Product', aspect: '16:9',
    description: 'Friendly unboxing: soft crossfades, small zooms and clean captions.',
    steps: [
      { tool: 'remove_dead_air', params: { max_pause_ms: 650 } },
      { tool: 'add_transitions', params: { style: 'crossfade' } },
      { tool: 'zoom_on_emphasis', params: {} },
      { tool: 'add_captions', params: { style: 'clean', density: 'balanced' } },
    ],
  }),
  defineTemplate({
    id: 'before-after', name: 'Before / After', category: 'Product', aspect: '16:9',
    description: 'Side-by-side reveal with wipe transitions and a labelled lower third.',
    steps: [
      { tool: 'set_project_settings_ai', params: { aspect: '16:9' } },
      { tool: 'add_transitions', params: { style: 'wipe-left' } },
      { tool: 'add_motif', params: { type: 'lower-third', start: 0, duration: 3, params: { role: 'Before / After' } } },
    ],
  }),

  // ---------------- Slideshow ----------------
  defineTemplate({
    id: 'photo-slideshow', name: 'Photo Slideshow', category: 'Slideshow', aspect: '16:9',
    description: 'Calm photo pacing: crossfades, soft fades, warm grade and relaxed captions.',
    steps: [
      { tool: 'add_transitions', params: { style: 'crossfade' } },
      { tool: 'set_clip_fades', params: { fade_in: 0.3, fade_out: 0.3 } },
      { tool: 'apply_color_preset', params: { name: 'warm' } },
      { tool: 'add_captions', params: { style: 'clean', density: 'relaxed' } },
    ],
  }),
  defineTemplate({
    id: 'quote-card', name: 'Quote Card', category: 'Slideshow', aspect: '1:1',
    description: 'Minimal monochrome look with a slow zoom and a typographic title reveal.',
    steps: [
      { tool: 'set_project_settings_ai', params: { aspect: '1:1' } },
      { tool: 'apply_color_preset', params: { name: 'black-white' } },
      { tool: 'add_motif', params: { type: 'title-reveal', start: 0, duration: 4 } },
    ],
  }),
  defineTemplate({
    id: 'memory-reel', name: 'Memory Reel', category: 'Slideshow', aspect: '9:16',
    description: 'Vertical photo memory reel: white dips, warm grade and gentle captions.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'add_transitions', params: { style: 'dip-white' } },
      { tool: 'apply_color_preset', params: { name: 'warm' } },
      { tool: 'add_captions', params: { style: 'clean', density: 'relaxed' } },
    ],
  }),
  defineTemplate({
    id: 'portfolio-reel', name: 'Portfolio Reel', category: 'Slideshow', aspect: '4:5',
    description: 'Feed-ready portfolio look: slide transitions, cool grade and a lower third.',
    steps: [
      { tool: 'reframe', params: { aspect: '4:5' } },
      { tool: 'add_transitions', params: { style: 'slide-left' } },
      { tool: 'apply_color_preset', params: { name: 'cool' } },
      { tool: 'add_motif', params: { type: 'lower-third', start: 0.5, duration: 3 } },
    ],
  }),

  // ---------------- Podcast ----------------
  defineTemplate({
    id: 'podcast-clip', name: 'Podcast Clip', category: 'Podcast', aspect: '16:9',
    description: 'Full podcast pipeline: balance, retake and filler cuts, captions and punch-ins.',
    steps: [
      { tool: 'auto_edit', params: { video_type: 'podcast clip' } },
    ],
  }),
  defineTemplate({
    id: 'podcast-highlight', name: 'Podcast Highlight', category: 'Podcast', aspect: '9:16',
    description: 'Short shareable moment: filler cuts, punch-ins and karaoke captions.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'remove_fillers', params: {} },
      { tool: 'cut_retakes', params: {} },
      { tool: 'zoom_on_emphasis', params: {} },
      { tool: 'add_captions', params: { style: 'karaoke', density: 'balanced' } },
    ],
  }),
  defineTemplate({
    id: 'interview', name: 'Interview', category: 'Podcast', aspect: '16:9',
    description: 'Respectful interview pacing: level audio, trimmed fillers and a guest lower third.',
    steps: [
      { tool: 'balance_audio', params: {} },
      { tool: 'remove_fillers', params: {} },
      { tool: 'add_transitions', params: { style: 'crossfade' } },
      { tool: 'add_motif', params: { type: 'lower-third', start: 1, duration: 4 } },
    ],
  }),

  // ---------------- Travel ----------------
  defineTemplate({
    id: 'travel-vlog', name: 'Travel Vlog', category: 'Travel', aspect: '16:9',
    description: 'Full vlog pipeline: dead-air removal, zooms, captions and natural colour.',
    steps: [
      { tool: 'auto_edit', params: { video_type: 'vlog' } },
    ],
  }),
  defineTemplate({
    id: 'travel-reel', name: 'Travel Reel', category: 'Travel', aspect: '9:16',
    description: 'Vertical travel montage cut to the beat with vibrant colour and light captions.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'snap_to_beats', params: { what: 'cuts' } },
      { tool: 'add_transitions', params: { style: 'zoom-in' } },
      { tool: 'apply_color_preset', params: { name: 'vibrant' } },
      { tool: 'add_captions', params: { style: 'clean', density: 'tight' } },
    ],
  }),
  defineTemplate({
    id: 'city-tour', name: 'City Tour', category: 'Travel', aspect: '16:9',
    description: 'Guided walk with slide cuts, cinematic grade and a location lower third.',
    steps: [
      { tool: 'add_transitions', params: { style: 'slide-left' } },
      { tool: 'apply_color_preset', params: { name: 'cinematic' } },
      { tool: 'add_motif', params: { type: 'lower-third', start: 1, duration: 4 } },
    ],
  }),

  // ---------------- Music ----------------
  defineTemplate({
    id: 'music-video', name: 'Music Video', category: 'Music', aspect: '16:9',
    description: 'Beat-synced cuts, glow, zoom transitions and a punchy colour grade.',
    steps: [
      { tool: 'snap_to_beats', params: { what: 'cuts' } },
      { tool: 'apply_color_preset', params: { name: 'vibrant' } },
      { tool: 'add_effect', params: { type: 'glow', params: '{"amount":0.3}' } },
      { tool: 'add_transitions', params: { style: 'zoom-in' } },
    ],
  }),
  defineTemplate({
    id: 'lyric-video', name: 'Lyric Video', category: 'Music', aspect: '9:16',
    description: 'Vertical lyric treatment: beat zooms, karaoke captions and a title reveal.',
    steps: [
      { tool: 'reframe', params: { aspect: '9:16' } },
      { tool: 'snap_to_beats', params: { what: 'zooms' } },
      { tool: 'add_captions', params: { style: 'karaoke', density: 'balanced' } },
      { tool: 'add_motif', params: { type: 'title-reveal', start: 0, duration: 3 } },
    ],
  }),
  defineTemplate({
    id: 'beat-montage', name: 'Beat-Sync Montage', category: 'Music', aspect: '16:9',
    description: 'Rapid montage: beat cuts, emphasis punch-ins, crossfades and a cool grade.',
    steps: [
      { tool: 'snap_to_beats', params: { what: 'cuts' } },
      { tool: 'zoom_on_emphasis', params: {} },
      { tool: 'add_transitions', params: { style: 'crossfade' } },
      { tool: 'apply_color_preset', params: { name: 'cool' } },
    ],
  }),
];

export function buildTemplateActions(project: Project, template: Template, targetIds?: string[]): Promise<TemplateBuild> {
  return template.build(project, targetIds);
}

/* -------------------- "Save selection as template" -------------------- */

export interface SavedTextRecipe {
  text: string;
  words?: CaptionWord[];
  role: 'caption' | 'title' | 'hook';
  style: TextStyle;
}

export interface SavedClipRecipe {
  kind: Clip['kind'];
  /** Position relative to the first selected clip, for ordering/labels only. */
  relativeStart: number;
  duration: number;
  text?: SavedTextRecipe;
  transform: Transform;
  fit: Clip['fit'];
  volume: number;
  fades: Fades;
  effects: { type: EffectType; enabled: boolean; params: Record<string, number | string | boolean> }[];
  keyframes: { path: string; time: number; value: number; easing: Easing }[];
  props: { label?: string; blendMode?: BlendMode; reversed?: boolean; preservePitch?: boolean };
  transitions: { in?: Transition; out?: Transition };
}

export interface SavedTemplateData {
  source: 'saved';
  id: string;
  name: string;
  category: 'Saved';
  aspect: Aspect;
  description: string;
  createdAt: number;
  clipRecipes: SavedClipRecipe[];
}

const STORAGE_KEY = 'cutflow.template.recipes.v1';
const MAX_SAVED = 50;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch { return null; }
}

function isSavedTemplateData(value: unknown): value is SavedTemplateData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SavedTemplateData>;
  return typeof v.id === 'string' && typeof v.name === 'string' && Array.isArray(v.clipRecipes);
}

export function loadSavedTemplateData(): SavedTemplateData[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter(isSavedTemplateData).slice(0, MAX_SAVED) : [];
  } catch { return []; }
}

function persist(list: SavedTemplateData[]): SavedTemplateData[] {
  const next = list.slice(0, MAX_SAVED);
  const s = storage();
  if (s) { try { s.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode / quota */ } }
  return next;
}

export function addSavedTemplate(data: SavedTemplateData): SavedTemplateData[] {
  return persist([data, ...loadSavedTemplateData().filter((t) => t.id !== data.id)]);
}

export function removeSavedTemplate(id: string): SavedTemplateData[] {
  return persist(loadSavedTemplateData().filter((t) => t.id !== id));
}

/** Serialise ONLY the selected clips' editing recipe — never media or blobs. */
export function captureSelection(project: Project, ids: string[], name: string): SavedTemplateData | null {
  const clips = ids
    .map((id) => project.clips.find((c) => c.id === id))
    .filter((c): c is Clip => !!c)
    .sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId));
  if (!clips.length) return null;
  const origin = clips[0].start;
  const clipRecipes: SavedClipRecipe[] = clips.map((c) => ({
    kind: c.kind,
    relativeStart: Math.max(0, c.start - origin),
    duration: c.duration,
    text: c.text ? {
      text: c.text.text,
      words: c.text.words,
      role: c.text.role,
      style: c.text.style,
    } : undefined,
    transform: { ...c.transform },
    fit: c.fit,
    volume: c.volume,
    fades: { ...c.fades },
    effects: c.effects.map((e) => ({ type: e.type, enabled: e.enabled, params: { ...e.params } })),
    keyframes: c.keyframes.map((k) => ({ path: k.path, time: k.time, value: k.value, easing: k.easing })),
    props: {
      label: c.label, blendMode: c.blendMode, reversed: c.reversed, preservePitch: c.preservePitch,
    },
    transitions: { in: c.transitionIn, out: c.transitionOut },
  }));
  return {
    source: 'saved',
    id: `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim().slice(0, 60) || `My look ${new Date().toLocaleDateString()}`,
    category: 'Saved',
    aspect: project.settings.aspect,
    description: `Saved editing recipe from ${clips.length} selected clip${clips.length === 1 ? '' : 's'}: text styles, effects, keyframes, transforms, fades and transitions. No media is stored.`,
    createdAt: Date.now(),
    clipRecipes,
  };
}

/** Replay a saved recipe onto the current targets (selection, or first media
 * clips). Missing recipe fields are ignored so old storage entries stay safe. */
export function buildSavedActions(data: SavedTemplateData, project: Project, targetIds?: string[]): TemplateBuild {
  const recipes = data.clipRecipes ?? [];
  const pool = targetIds?.length
    ? targetIds
    : project.clips.filter((c) => c.kind === 'media').map((c) => c.id);
  const actions: Action[] = [];
  let applied = 0;
  const max = Math.min(recipes.length, pool.length);
  for (let i = 0; i < max; i++) {
    const clip = project.clips.find((c) => c.id === pool[i]);
    const r = recipes[i];
    if (!clip || !r) continue;
    if (clip.text && r.text) {
      actions.push({ type: 'set_text', clipId: clip.id, text: r.text.text, words: r.text.words });
      actions.push({ type: 'set_text_style', clipId: clip.id, patch: r.text.style });
    }
    if (r.transform) actions.push({ type: 'set_transform', clipId: clip.id, patch: r.transform });
    const patch: Partial<Pick<Clip, 'fit' | 'volume' | 'label' | 'blendMode' | 'reversed' | 'preservePitch'>> = {};
    if (r.fit !== undefined) patch.fit = r.fit;
    if (r.volume !== undefined) patch.volume = r.volume;
    if (r.props?.label !== undefined) patch.label = r.props.label;
    if (r.props?.blendMode !== undefined) patch.blendMode = r.props.blendMode;
    if (r.props?.reversed !== undefined) patch.reversed = r.props.reversed;
    if (r.props?.preservePitch !== undefined) patch.preservePitch = r.props.preservePitch;
    if (Object.keys(patch).length) actions.push({ type: 'set_clip_props', clipId: clip.id, patch });
    if (r.fades) actions.push({ type: 'set_fades', clipId: clip.id, fadeIn: r.fades.in, fadeOut: r.fades.out });
    for (const e of clip.effects) actions.push({ type: 'remove_effect', clipId: clip.id, effectId: e.id });
    for (const e of r.effects ?? []) {
      actions.push({ type: 'add_effect', clipId: clip.id, effect: { type: e.type, enabled: e.enabled !== false, params: e.params ?? {} } });
    }
    const patched = new Set<string>();
    for (const k of r.keyframes ?? []) {
      if (!patched.has(k.path)) { actions.push({ type: 'clear_keyframes', clipId: clip.id, path: k.path }); patched.add(k.path); }
      actions.push({ type: 'add_keyframe', clipId: clip.id, path: k.path, time: Math.max(0, k.time), value: k.value, easing: k.easing });
    }
    if (r.transitions?.in !== undefined) actions.push({ type: 'set_transition', clipId: clip.id, edge: 'in', transition: r.transitions.in });
    if (r.transitions?.out !== undefined) actions.push({ type: 'set_transition', clipId: clip.id, edge: 'out', transition: r.transitions.out });
    applied++;
  }
  const warnings: string[] = [];
  if (applied < recipes.length) warnings.push(`Matched ${applied} of ${recipes.length} recipe slots to the selected clips.`);
  return {
    actions,
    summary: `Applied saved recipe "${data.name}" to ${applied} clip${applied === 1 ? '' : 's'} — editing only, no media imported.`,
    warnings,
    toolCalls: 0,
  };
}

export function savedTemplateBuilder(data: SavedTemplateData): TemplateBuilder {
  return async (project, targetIds) => buildSavedActions(data, project, targetIds);
}

export function toTemplate(data: SavedTemplateData): Template {
  return {
    source: 'saved', id: data.id, name: data.name, category: 'Saved',
    aspect: data.aspect, description: data.description,
    build: savedTemplateBuilder(data),
  };
}

export function listTemplates(): Template[] {
  return [...BUILTIN_TEMPLATES, ...loadSavedTemplateData().map(toTemplate)];
}
