/**
 * THE tool registry. One manifest for humans (buttons), the chat AI, the
 * in-page API, external agents and the MCP bridge. Descriptions are short
 * and concrete so weak models can use them. Every tool returns a preview
 * (action list + summary) before anything is applied.
 */
import type { Action } from '../engine/actions';
import type { Project } from '../engine/types';
import type { ToolContext, ToolResult } from './cutTools';
export type { ToolContext, ToolResult } from './cutTools';
import { makeContext } from './helpers';
import { listDisabledTools } from '../ai/client';
import { DEFAULT_SHORTCUTS } from '../src/features/shortcuts';
import { removeDeadAir, removeFillers, cutRetakes } from './cutTools';
import { addCaptions, addHookTitle, translateCaptions, restyleCaptions, shiftCaptions, fixCaptionTiming, importCaptions } from './captionTools';
import { zoomOnEmphasis, reframe, addTransitions, snapToBeats, addMotif } from './motionTools';
import { addMusic, balanceAudio, cleanupAudio } from './audioTools';
import { applyColorPreset, addBrollSlots, autoBroll } from './lookTools';
import { autoEdit, autoFix, smartCutdown, abVariants, autoMulticam } from './autoEdit';
import { addText } from './textTools';
import { editTimeline } from './timelineTools';
import { cropRegion, addMarkerTool, duplicateClipTool, reverseClipTool, setClipLookTool, removeSectionTool } from './regionTools';
import { manageTrack } from './trackTools';
import {
  CAPTION_PRESET_IDS, setCaptionStyleAdvanced, setCaptionHighlight, setCaptionEffects,
  editCaptionWord, setClipLookAdvanced, setProjectSettingsAI,
} from './aiControlTools';
import {
  addEffect as addEffectTool, configureEffect, removeEffect as removeEffectTool,
  animateProperty, speedRamp, applyMask, setClipTransition, groupClipsAI,
  timeRangeEdit, addMarkerAI, addNote, labelClips, setBlendMode, setClipFades,
} from './powerTools';

export interface ParamSpec { type: 'string' | 'number' | 'boolean' | 'enum'; desc: string; default?: unknown; enum?: string[]; optional?: boolean }

export type ToolKind = 'edit' | 'app' | 'control';

export interface ToolDef {
  name: string;
  description: string;
  params: Record<string, ParamSpec>;
  example: { input: Record<string, unknown>; why: string };
  roles: string[]; // multi-agent team roles allowed to use this tool
  /** Data-only metadata for AI prompt/manifest. Visible UI labels are derived
   * from the same source, so agents know the words humans use without adding
   * any new buttons. All fields are optional for older tool definitions. */
  label?: string;
  group?: string;
  aliases?: string[];
  kind?: ToolKind;
  requires?: string[];
  run: (ctx: ToolContext, params: any) => Promise<ToolResult> | ToolResult;
}

/** Effect parameters arrive as a compact JSON string so weak models don't
 * have to guess a nested object schema. Invalid JSON is dropped, never guessed. */
function effectParams(v: unknown): Record<string, number | string | boolean> | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, number | string | boolean>;
  if (typeof v !== 'string') return undefined;
  try {
    const parsed = JSON.parse(v) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, number | string | boolean> : undefined;
  } catch { return undefined; }
}

export const TOOLS: ToolDef[] = [
  {
    name: 'add_text',
    description: 'Add a text/title clip to the timeline. Use for "add text", "add a title", labels, quotes. Position it top, center or bottom; choose weight and colour.',
    params: {
      text: { type: 'string', desc: 'The exact words to show.' },
      position: { type: 'enum', desc: 'Where the text sits in the frame.', enum: ['top', 'center', 'bottom'], default: 'center', optional: true },
      bold: { type: 'boolean', desc: 'Bold weight.', default: false, optional: true },
      color: { type: 'string', desc: 'Colour name (white, red, yellow…) or #RRGGBB.', optional: true },
      size: { type: 'number', desc: 'Font size as a fraction of frame height (0.03–0.16).', default: 0.085, optional: true },
      start: { type: 'number', desc: 'Timeline start in seconds.', default: 0, optional: true },
      duration: { type: 'number', desc: 'How long it stays on screen, seconds.', optional: true },
    },
    example: { input: { text: 'Welcome', position: 'top', bold: true }, why: 'Open the video with a bold welcome title.' },
    roles: ['story', 'captions'],
    run: (c, p) => addText(c, p),
  },
  {
    name: 'timeline_edit',
    description: 'Change one clip on the timeline: move it, trim its start or end, split it, delete it, mute/unmute it, or change its speed. Read the TIMELINE block for the exact clip_id.',
    params: {
      clip_id: { type: 'string', desc: 'The clip_id from the TIMELINE block.' },
      operation: { type: 'enum', desc: 'What to do.', enum: ['move', 'trim_start', 'trim_end', 'split', 'delete', 'speed', 'mute', 'unmute'] },
      value: { type: 'number', desc: 'New start / new duration / split time in seconds, or speed multiplier, depending on the operation.', optional: true },
    },
    example: { input: { clip_id: 'clip_abc', operation: 'trim_start', value: 5 }, why: 'Drop the first five seconds of dead time.' },
    roles: ['story', 'motion', 'sound'],
    run: (c, p) => editTimeline(c, p),
  },
  {
    name: 'remove_dead_air',
    description: 'Cut silent pauses longer than max_pause_ms. Keeps breathing room, never cuts mid-word, adds tiny audio crossfades. Use when the video feels slow.',
    params: { max_pause_ms: { type: 'number', desc: 'Cut pauses longer than this many milliseconds.', default: 650, optional: true } },
    example: { input: { max_pause_ms: 600 }, why: 'Tighten a talking-head video without losing natural breaths.' },
    roles: ['story', 'sound'],
    run: (c, p) => removeDeadAir(c, p),
  },
  {
    name: 'remove_fillers',
    description: 'Remove filler words (um, uh, you know, i mean) detected in the transcript. Needs transcription.',
    params: {},
    example: { input: {}, why: 'Clean up hesitant speech.' },
    roles: ['story', 'sound'],
    run: (c) => removeFillers(c),
  },
  {
    name: 'cut_retakes',
    description: 'Delete repeated false starts and keep the last complete take of each repeated phrase. Needs transcription.',
    params: {},
    example: { input: {}, why: 'The speaker restarted a sentence 3 times; keep the best one.' },
    roles: ['story'],
    run: (c) => cutRetakes(c),
  },
  {
    name: 'add_captions',
    description: 'Generate styled captions from the transcript. Styles: clean (subtitles), karaoke (word highlight), bold-keywords, word-pop (one big word at a time). Density tight/balanced/relaxed controls cue length and reading speed; fillers are removed by default. Max 2 lines, safe-zone positioned.',
    params: {
      style: { type: 'enum', desc: 'Caption style.', enum: ['clean', 'karaoke', 'bold-keywords', 'word-pop'], optional: true },
      density: { type: 'enum', desc: 'Text per cue: tight (1 line, ~3s), balanced (2 lines, ~6s), relaxed (longer, ~9s).', enum: ['tight', 'balanced', 'relaxed'], default: 'balanced', optional: true },
      max_chars: { type: 'number', desc: 'Max characters per caption line (12–60). Auto-capped per aspect.', optional: true },
      max_lines: { type: 'number', desc: 'Max lines per cue (1–3). Default 2 (1 for word-pop).', optional: true },
      max_seconds: { type: 'number', desc: 'Max seconds a single cue stays on screen.', optional: true },
      remove_fillers: { type: 'boolean', desc: 'Drop um/uh/hmm from captions.', default: true, optional: true },
      highlight_keywords: { type: 'boolean', desc: 'Colour keywords for karaoke/bold-keywords styles.', default: true, optional: true },
    },
    example: { input: { style: 'karaoke', density: 'tight', remove_fillers: true }, why: 'Social clip where viewers watch without sound.' },
    roles: ['captions'],
    run: (c, p) => addCaptions(c, p),
  },
  {
    name: 'add_hook_title',
    description: 'Big animated title in the first 3 seconds. If text is omitted, it is derived from the transcript opening.',
    params: { text: { type: 'string', desc: 'Hook text, max ~42 chars.', optional: true } },
    example: { input: { text: 'STOP doing this' }, why: 'Grab attention in the first second.' },
    roles: ['captions', 'motion', 'story'],
    run: (c, p) => addHookTitle(c, p),
  },
  {
    name: 'zoom_on_emphasis',
    description: 'Gentle punch-in zooms on emphasized words and sentence starts. Smooth easing, alternating intensity, keeps the face in frame. Respects max-zoom rules.',
    params: {},
    example: { input: {}, why: 'Add visual energy to a static talking head.' },
    roles: ['motion'],
    run: (c) => zoomOnEmphasis(c),
  },
  {
    name: 'reframe',
    description: 'Convert the project to another aspect ratio (9:16, 16:9, 1:1, 4:5) and pan to follow the face. Captions move to the new safe zone.',
    params: { aspect: { type: 'enum', desc: 'Target aspect ratio.', enum: ['9:16', '16:9', '1:1', '4:5'], default: '9:16' } },
    example: { input: { aspect: '9:16' }, why: 'Turn a landscape recording into a TikTok.' },
    roles: ['motion', 'story'],
    run: (c, p) => reframe(c, p),
  },
  {
    name: 'add_music',
    description: 'Add an imported audio file as a music bed and automatically duck it under speech. Import the music file first. Mood only adjusts level.',
    params: {
      mediaId: { type: 'string', desc: 'Media id of the imported music (omit to auto-pick).', optional: true },
      mood: { type: 'enum', desc: 'chill | balanced | energetic', enum: ['chill', 'balanced', 'energetic'], optional: true },
    },
    example: { input: { mood: 'chill' }, why: 'Background music that never fights the voice.' },
    roles: ['sound'],
    run: (c, p) => addMusic(c, p),
  },
  {
    name: 'balance_audio',
    description: 'Normalize speech loudness to the pack target (LUFS), prevent clipping, add a light noise gate and high-pass. Set music to the pack level.',
    params: {},
    example: { input: {}, why: 'Make volume consistent and broadcast-safe.' },
    roles: ['sound'],
    run: (c) => balanceAudio(c),
  },
  {
    name: 'cleanup_audio',
    description: 'Light browser DSP cleanup: noise reduction (downward expansion), de-ess, high-pass. Conservative — not ML voice isolation.',
    params: { denoise: { type: 'boolean', desc: 'Apply noise reduction.', default: true, optional: true }, deess: { type: 'boolean', desc: 'Reduce harsh s sounds.', default: true, optional: true } },
    example: { input: {}, why: 'Room hiss and harsh sibilance on a voice recording.' },
    roles: ['sound'],
    run: (c, p) => cleanupAudio(c, p),
  },
  {
    name: 'apply_color_preset',
    description: 'Apply a color look to all video clips: natural, warm, cool, cinematic, black-white, vibrant.',
    params: { name: { type: 'enum', desc: 'Preset name.', enum: ['natural', 'warm', 'cool', 'cinematic', 'black-white', 'vibrant'], optional: true } },
    example: { input: { name: 'cinematic' }, why: 'Moody look for a quote video.' },
    roles: ['color'],
    run: (c, p) => applyColorPreset(c, p),
  },
  {
    name: 'add_transitions',
    description: 'Add restrained transitions ONLY at real scene changes (detected shot cuts or different media). Never on every cut. Capped per minute by the style pack.',
    params: { style: { type: 'enum', desc: 'Transition style.', enum: ['crossfade', 'dip-black', 'dip-white', 'wipe-left', 'slide-left', 'zoom-in'], optional: true } },
    example: { input: { style: 'crossfade' }, why: 'Smooth shot changes in a vlog.' },
    roles: ['story', 'motion'],
    run: (c, p) => addTransitions(c, p),
  },
  {
    name: 'add_broll_slots',
    description: 'Mark long talking stretches where a cutaway would help (markers + tacks). Does not insert media — fill slots yourself or with auto_broll.',
    params: {},
    example: { input: {}, why: 'Find boring static moments in a 2-minute monologue.' },
    roles: ['story'],
    run: (c) => addBrollSlots(c),
  },
  {
    name: 'auto_broll',
    description: 'Fill b-roll slots by matching transcript keywords to your own media library, or to Pexels stock if the user connected a key.',
    params: { pexelsKey: { type: 'string', desc: "User's Pexels API key (optional).", optional: true }, query: { type: 'string', desc: 'Force a search query.', optional: true } },
    example: { input: {}, why: 'Cover static talking stretches with matching footage.' },
    roles: ['story', 'motion'],
    run: (c, p) => autoBroll(c, p),
  },
  {
    name: 'snap_to_beats',
    description: 'Snap zooms (or cut points) to the analyzed music beat grid. Needs imported, analyzed music.',
    params: { what: { type: 'enum', desc: 'What to sync.', enum: ['zooms', 'cuts'], default: 'zooms', optional: true } },
    example: { input: { what: 'zooms' }, why: 'Punch zooms that hit with the music.' },
    roles: ['motion', 'sound'],
    run: (c, p) => snapToBeats(c, p),
  },
  {
    name: 'add_motif',
    description: 'Add a parameterized motion graphic: title-reveal, lower-third, bar-chart, ring-progress, count-up, burst. Params are editable in the inspector.',
    params: {
      type: { type: 'enum', desc: 'Motif type.', enum: ['title-reveal', 'lower-third', 'bar-chart', 'ring-progress', 'count-up', 'burst'] },
      start: { type: 'number', desc: 'Timeline start seconds.', default: 0, optional: true },
      duration: { type: 'number', desc: 'Duration seconds.', default: 3, optional: true },
      text: { type: 'string', desc: 'Main text/label.', optional: true },
      params: { type: 'string', desc: 'Extra params object (colors, values, x, y, size...).', optional: true },
    },
    example: { input: { type: 'lower-third', start: 2, text: 'Jane Doe', params: { role: 'Founder' } }, why: 'Introduce the speaker professionally.' },
    roles: ['motion', 'captions'],
    run: (c, p) => addMotif(c, p),
  },
  {
    name: 'auto_edit',
    description: 'Run the FULL recommended pipeline for a video type: balance audio, cut dead air/retakes/fillers, captions, zooms, transitions, color, hook, b-roll slots, music if present, then self-fix. One undo step. When an AI model is connected (Settings → AI) the pipeline is planned for the video type; otherwise the built-in rules pipeline runs on-device.',
    params: {
      video_type: { type: 'enum', desc: 'Video type.', enum: ['talking head', 'podcast clip', 'product promo', 'tutorial', 'vlog', 'quote', 'youtube intro'], optional: true },
      aspect: { type: 'enum', desc: 'Also reframe to this aspect.', enum: ['9:16', '16:9', '1:1', '4:5'], optional: true },
    },
    example: { input: { video_type: 'talking head', aspect: '9:16' }, why: 'Make this a viral TikTok in one call.' },
    roles: ['director'],
    run: (c, p) => autoEdit(c, p),
  },
  {
    name: 'auto_fix',
    description: 'Run the quality checker and automatically fix reported issues, up to 3 attempts. Call after editing until the report is clean.',
    params: { max_attempts: { type: 'number', desc: 'Max fix passes (1-3).', default: 3, optional: true } },
    example: { input: {}, why: 'Clean up lint issues after an edit run.' },
    roles: ['qa', 'director'],
    run: (c, p) => autoFix(c, p, (fc, name, params) => runTool(fc.project, name, params, { locked: fc.lockedClipIds, ai: fc.ai })),
  },
  {
    name: 'smart_cutdown',
    description: 'Find 5-10 short-clip candidates in a long video, each with a hook-strength score, title and transcript. Adds chapter markers; open candidates as projects from the Cutdown panel.',
    params: { count: { type: 'number', desc: 'How many candidates (3-10).', default: 6, optional: true } },
    example: { input: { count: 8 }, why: 'Repurpose a podcast into Shorts.' },
    roles: ['story', 'director'],
    run: (c, p) => smartCutdown(c, p),
  },
  {
    name: 'ab_variants',
    description: 'Generate 2-3 alternative edits (different pacing, caption style, hook) as separate versions to compare.',
    params: { variants: { type: 'number', desc: 'Number of variants (2-3).', default: 3, optional: true } },
    example: { input: { variants: 3 }, why: 'Test which style performs better.' },
    roles: ['director'],
    run: (c, p) => abVariants(c, p),
  },
  {
    name: 'auto_multicam',
    description: 'Switch between imported camera angles on speaker turns (pause heuristic). Angle 2 is muted; main audio stays continuous. Needs 2+ angles and a transcript.',
    params: { mediaIds: { type: 'string', desc: 'Comma-separated angle media ids (optional).', optional: true } },
    example: { input: {}, why: 'Two-camera interview, cut to whoever is talking.' },
    roles: ['story'],
    run: (c, p) => autoMulticam(c, p),
  },
  {
    name: 'translate_captions',
    description: 'Translate existing captions into another language using the connected AI key. Creates a separate caption track; originals kept.',
    params: { language: { type: 'string', desc: 'Target language, e.g. Spanish, Hindi, Arabic.' } },
    example: { input: { language: 'Spanish' }, why: 'Reach a Spanish-speaking audience.' },
    roles: ['captions'],
    run: (c, p) => translateCaptions(c, p),
  },
  {
    name: 'restyle_captions',
    description: 'Restyle existing captions without regenerating them: preset, font size, position, uppercase, animation, text/highlight colour or outline width.',
    params: {
      style: { type: 'enum', desc: 'Caption preset.', enum: ['clean', 'karaoke', 'bold-keywords', 'word-pop'], optional: true },
      font_size: { type: 'number', desc: 'Font size as a fraction of frame height (0.02–0.16).', optional: true },
      y: { type: 'number', desc: 'Vertical position 0..1 (0.72 is a 9:16 safe zone).', optional: true },
      x: { type: 'number', desc: 'Horizontal position 0..1.', optional: true },
      uppercase: { type: 'boolean', desc: 'Force uppercase.', optional: true },
      animation: { type: 'enum', desc: 'Entrance animation.', enum: ['none', 'pop', 'fade', 'rise', 'typewriter'], optional: true },
      color: { type: 'string', desc: 'Text colour (#RRGGBB).', optional: true },
      highlight: { type: 'string', desc: 'Highlight colour (#RRGGBB).', optional: true },
      outline_width: { type: 'number', desc: 'Outline width 0..0.5.', optional: true },
    },
    example: { input: { style: 'karaoke', font_size: 0.055, y: 0.72, uppercase: true }, why: 'Make existing captions punchier for a 9:16 cut.' },
    roles: ['captions'],
    run: (c, p) => restyleCaptions(c, p),
  },
  {
    name: 'shift_captions',
    description: 'Shift captions earlier or later in time by a number of seconds. Optionally limit to a time window.',
    params: {
      offset: { type: 'number', desc: 'Seconds to shift (positive = later, negative = earlier).' },
      from: { type: 'number', desc: 'Only captions starting at/after this time.', optional: true },
      to: { type: 'number', desc: 'Only captions starting at/before this time.', optional: true },
    },
    example: { input: { offset: 0.2 }, why: 'Captions appear slightly too early after a cut.' },
    roles: ['captions'],
    run: (c, p) => shiftCaptions(c, p),
  },
  {
    name: 'fix_caption_timing',
    description: 'Split over-long caption cues into readable chunks, preserving word timing where available. Use when a caption sits on screen for many seconds.',
    params: { max_seconds: { type: 'number', desc: 'Maximum cue length in seconds.', default: 6, optional: true } },
    example: { input: { max_seconds: 5 }, why: 'One caption covered a 20-second story beat.' },
    roles: ['captions'],
    run: (c, p) => fixCaptionTiming(c, p),
  },
  {
    name: 'import_captions',
    description: 'Import captions from SRT or WebVTT text as editable caption clips. Replaces existing captions by default; set replace=false to keep them.',
    params: {
      srt: { type: 'string', desc: 'The full SRT / WebVTT file contents.' },
      replace: { type: 'boolean', desc: 'Replace existing captions.', default: true, optional: true },
      offset: { type: 'number', desc: 'Shift every imported cue by this many seconds.', optional: true },
    },
    example: { input: { srt: '1\n00:00:01,000 --> 00:00:04,000\nHello world' }, why: 'Reuse subtitles from another tool.' },
    roles: ['captions'],
    run: (c, p) => importCaptions(c, p),
  },
  {
    name: 'crop_region',
    description: 'Keep only a rectangle of a video/image clip (non-destructive crop), or extract that rectangle as a new independent clip. Coordinates are fractions by default; set unit to "percent" or "pixels".',
    params: {
      clip_id: { type: 'string', desc: 'The clip_id from the TIMELINE block.' },
      x: { type: 'number', desc: 'Left edge of the region.', default: 0, optional: true },
      y: { type: 'number', desc: 'Top edge of the region.', default: 0, optional: true },
      width: { type: 'number', desc: 'Region width (defaults to the rest of the frame).', optional: true },
      height: { type: 'number', desc: 'Region height (defaults to the rest of the frame).', optional: true },
      unit: { type: 'enum', desc: 'Coordinate unit.', enum: ['fraction', 'percent', 'pixels'], default: 'fraction', optional: true },
      extract: { type: 'boolean', desc: 'Create a separate clip from the region instead of cropping in place.', default: false, optional: true },
    },
    example: { input: { clip_id: 'clip_abc', x: 0.25, y: 0.1, width: 0.5, height: 0.8, extract: true }, why: 'Isolate the speaker as its own overlay layer.' },
    roles: ['motion', 'story'],
    run: (c, p) => cropRegion(c, p),
  },
  {
    name: 'add_marker',
    description: 'Add a timeline marker at a time, with an optional label and colour.',
    params: {
      time: { type: 'number', desc: 'Marker time in seconds.' },
      label: { type: 'string', desc: 'Marker label.', optional: true },
      color: { type: 'string', desc: 'Colour name or #RRGGBB.', optional: true },
    },
    example: { input: { time: 12.5, label: 'Hook', color: '#38BDF8' }, why: 'Mark the moment the hook lands.' },
    roles: ['story', 'director'],
    run: (c, p) => addMarkerTool(c, p),
  },
  {
    name: 'duplicate_clip',
    description: 'Duplicate a clip (effects, keyframes and fades included) and place the copy right after it.',
    params: { clip_id: { type: 'string', desc: 'The clip_id from the TIMELINE block.' } },
    example: { input: { clip_id: 'clip_abc' }, why: 'Repeat the best reaction shot.' },
    roles: ['story', 'motion'],
    run: (c, p) => duplicateClipTool(c, p),
  },
  {
    name: 'reverse_clip',
    description: 'Play a clip backwards (video scrubs backward, audio plays a genuinely reversed buffer) or restore normal playback.',
    params: { clip_id: { type: 'string', desc: 'The clip_id from the TIMELINE block.' }, reverse: { type: 'boolean', desc: 'true to reverse, false to restore.', default: true, optional: true } },
    example: { input: { clip_id: 'clip_abc', reverse: true }, why: 'A dramatic rewind effect.' },
    roles: ['motion'],
    run: (c, p) => reverseClipTool(c, p),
  },
  {
    name: 'set_clip_look',
    description: 'Change a clip opacity, add audio/video fades, set a colour label, or set its blend mode (screen, multiply, overlay…).',
    params: {
      clip_id: { type: 'string', desc: 'The clip_id from the TIMELINE block.' },
      opacity: { type: 'number', desc: 'Opacity 0..1.', optional: true },
      fade_in: { type: 'number', desc: 'Fade-in length in seconds.', optional: true },
      fade_out: { type: 'number', desc: 'Fade-out length in seconds.', optional: true },
      label: { type: 'string', desc: 'Colour label (red, amber, green, blue, purple).', optional: true },
      blend_mode: { type: 'string', desc: 'normal, multiply, screen, overlay, darken, lighten, soft-light, difference…', optional: true },
    },
    example: { input: { clip_id: 'clip_abc', opacity: 0.6, fade_in: 0.3, fade_out: 0.3 }, why: 'A soft picture-in-picture overlay.' },
    roles: ['motion', 'color'],
    run: (c, p) => setClipLookTool(c, p),
  },
  {
    name: 'remove_section',
    description: 'Delete a time range from all video/audio tracks and ripple the rest of the timeline closed (markers shift too). Text/caption tracks are left alone.',
    params: { start: { type: 'number', desc: 'Range start in seconds.' }, end: { type: 'number', desc: 'Range end in seconds.' } },
    example: { input: { start: 30, end: 45 }, why: 'Cut the boring middle section out.' },
    roles: ['story', 'director'],
    run: (c, p) => removeSectionTool(c, p),
  },
  {
    name: 'manage_track',
    description: 'Add a video/audio/text track, update its name/mute/solo/lock/visibility/height, duplicate it with every clip on it, or delete it.',
    params: {
      operation: { type: 'enum', desc: 'What to do with the track.', enum: ['add', 'update', 'duplicate', 'delete'] },
      track_id: { type: 'string', desc: 'Existing track id (not needed for add).', optional: true },
      kind: { type: 'enum', desc: 'Track kind for add.', enum: ['video', 'audio', 'text'], optional: true },
      name: { type: 'string', desc: 'Track name.', optional: true },
      index: { type: 'number', desc: 'Insert position for add (0 = top).', optional: true },
      muted: { type: 'boolean', desc: 'Mute the track.', optional: true },
      solo: { type: 'boolean', desc: 'Solo the track.', optional: true },
      locked: { type: 'boolean', desc: 'Lock the track.', optional: true },
      hidden: { type: 'boolean', desc: 'Hide the track from the preview.', optional: true },
      height: { type: 'number', desc: 'Track height in px (32–160).', optional: true },
    },
    example: { input: { operation: 'add', kind: 'video', name: 'B-roll' }, why: 'Give overlays their own lane.' },
    roles: ['story', 'director', 'sound'],
    run: (c, p) => manageTrack(c, p),
  },
  {
    name: 'set_caption_style_advanced',
    description: 'Deep caption typography control: apply one of the caption presets or set font family, size, weight, colors, outline, background, position, alignment, spacing, reveal mode and entrance animation. Targets all captions or one by caption_index.',
    params: {
      caption_index: { type: 'number', desc: 'Zero-based caption index (timeline order). Omit to style all captions.', optional: true },
      preset_id: { type: 'enum', desc: 'Apply a full preset first, then any overrides below.', enum: CAPTION_PRESET_IDS, optional: true },
      font_family: { type: 'string', desc: 'CSS font family name, e.g. Georgia or Impact.', optional: true },
      font_size: { type: 'number', desc: 'Font size as a fraction of frame height (0.02–0.12).', optional: true },
      font_weight: { type: 'number', desc: 'Font weight (300–900).', optional: true },
      color: { type: 'string', desc: 'Text color hex.', optional: true },
      highlight_color: { type: 'string', desc: 'Base highlight/keyword color hex.', optional: true },
      outline_color: { type: 'string', desc: 'Outline color hex.', optional: true },
      outline_width: { type: 'number', desc: 'Subtle outline width fraction of font size.', optional: true },
      bg_color: { type: 'string', desc: 'Block background color or transparent.', optional: true },
      bg_padding: { type: 'number', desc: 'Background padding fraction.', optional: true },
      x: { type: 'number', desc: 'Horizontal anchor 0..1.', optional: true },
      y: { type: 'number', desc: 'Vertical anchor 0..1.', optional: true },
      align: { type: 'enum', desc: 'Text alignment.', enum: ['left', 'center', 'right'], optional: true },
      uppercase: { type: 'boolean', desc: 'Force uppercase.', optional: true },
      reveal_words: { type: 'boolean', desc: 'Reveal words on their own speech timing.', optional: true },
      word_spacing: { type: 'number', desc: 'Word spacing multiplier.', optional: true },
      line_spacing: { type: 'number', desc: 'Line height multiplier.', optional: true },
      animation: { type: 'string', desc: 'Entrance animation name, e.g. pop, fade, blur, glitch.', optional: true },
      max_lines: { type: 'number', desc: 'Maximum lines.', optional: true },
      max_width: { type: 'number', desc: 'Maximum width as fraction of frame.', optional: true },
    },
    example: { input: { preset_id: 'beast', font_size: 0.075, color: '#FFFFFF' }, why: 'Make all captions large, loud and green-highlighted.' },
    roles: ['captions', 'designer'],
    run: (c, p) => setCaptionStyleAdvanced(c, {
      captionIndex: p.caption_index, presetId: p.preset_id, fontFamily: p.font_family, fontSize: p.font_size,
      fontWeight: p.font_weight, color: p.color, highlightColor: p.highlight_color, outlineColor: p.outline_color,
      outlineWidth: p.outline_width, bgColor: p.bg_color, bgPadding: p.bg_padding, x: p.x, y: p.y, align: p.align,
      uppercase: p.uppercase, revealWords: p.reveal_words, wordSpacing: p.word_spacing, lineSpacing: p.line_spacing,
      animation: p.animation, maxLines: p.max_lines, maxWidth: p.max_width,
    }),
  },
  {
    name: 'set_caption_highlight',
    description: 'Configure active-word highlighting: on/off, animation style, highlight colors, previous/next word colors, padding, corner radius, opacity, speed, glow, shadow and timing offset.',
    params: {
      caption_index: { type: 'number', desc: 'Zero-based caption index. Omit for all captions.', optional: true },
      enabled: { type: 'boolean', desc: 'Enable active-word highlighting.', optional: true },
      anim: { type: 'enum', desc: 'Highlight animation.', enum: ['instant', 'slide', 'pop', 'scale', 'fade', 'wipe', 'color', 'bar', 'glitch'], optional: true },
      bg_color: { type: 'string', desc: 'Highlight box color hex.', optional: true },
      text_color: { type: 'string', desc: 'Active word text color hex.', optional: true },
      prev_color: { type: 'string', desc: 'Previously spoken word color hex.', optional: true },
      next_color: { type: 'string', desc: 'Upcoming word color hex.', optional: true },
      padding: { type: 'number', desc: 'Highlight padding fraction of font size.', optional: true },
      radius: { type: 'number', desc: 'Corner radius fraction of font size.', optional: true },
      opacity: { type: 'number', desc: 'Highlight opacity 0..1.', optional: true },
      speed: { type: 'number', desc: 'Highlight transition seconds.', optional: true },
      glow: { type: 'number', desc: 'Highlight glow amount.', optional: true },
      shadow: { type: 'number', desc: 'Highlight shadow amount.', optional: true },
      offset: { type: 'number', desc: 'Shift highlight timing relative to speech, in seconds.', optional: true },
    },
    example: { input: { enabled: true, anim: 'slide', bg_color: '#FFEB00', text_color: '#0B1220', offset: -0.05 }, why: 'TikTok-style moving yellow word highlight.' },
    roles: ['captions', 'designer'],
    run: (c, p) => setCaptionHighlight(c, {
      captionIndex: p.caption_index, enabled: p.enabled, anim: p.anim, bgColor: p.bg_color, textColor: p.text_color,
      prevColor: p.prev_color, nextColor: p.next_color, padding: p.padding, radius: p.radius, opacity: p.opacity,
      speed: p.speed, glow: p.glow, shadow: p.shadow, offset: p.offset,
    }),
  },
  {
    name: 'set_caption_effects',
    description: 'Apply glow, colored soft blur, background blur, text opacity and sharpness to captions. These effects render in preview and export.',
    params: {
      caption_index: { type: 'number', desc: 'Zero-based caption index. Omit for all captions.', optional: true },
      glow_enabled: { type: 'boolean', desc: 'Turn text glow on or off.', optional: true },
      glow_color: { type: 'string', desc: 'Glow color hex.', optional: true },
      glow_radius: { type: 'number', desc: 'Glow radius fraction of font size.', optional: true },
      glow_intensity: { type: 'number', desc: 'Glow intensity multiplier.', optional: true },
      blur_enabled: { type: 'boolean', desc: 'Turn soft text blur on or off.', optional: true },
      blur_amount: { type: 'number', desc: 'Blur amount fraction of font size.', optional: true },
      blur_direction: { type: 'enum', desc: 'Blur direction.', enum: ['left', 'right', 'up', 'down'], optional: true },
      edge_softness: { type: 'number', desc: 'Edge softness 0..1.', optional: true },
      background_blur: { type: 'number', desc: 'Background blur amount 0..1.', optional: true },
      text_opacity: { type: 'number', desc: 'Text opacity 0..1.', optional: true },
      sharpness: { type: 'number', desc: 'Text sharpness 0..1.', optional: true },
    },
    example: { input: { glow_enabled: true, glow_color: '#22D3EE', glow_intensity: 0.8, blur_enabled: true }, why: 'Neon glowing captions with soft edges.' },
    roles: ['captions', 'designer'],
    run: (c, p) => setCaptionEffects(c, {
      captionIndex: p.caption_index, glowEnabled: p.glow_enabled, glowColor: p.glow_color, glowRadius: p.glow_radius,
      glowIntensity: p.glow_intensity, blurEnabled: p.blur_enabled, blurAmount: p.blur_amount,
      blurDirection: p.blur_direction, edgeSoftness: p.edge_softness, backgroundBlur: p.background_blur,
      textOpacity: p.text_opacity, sharpness: p.sharpness,
    }),
  },
  {
    name: 'edit_caption_word',
    description: 'Edit one word inside a caption: its text, individual start/end timing, color, weight, italic style, opacity and letter spacing. Word timings stay editable after AI generation.',
    params: {
      caption_index: { type: 'number', desc: 'Zero-based caption index in timeline order.' },
      word_index: { type: 'number', desc: 'Zero-based word index inside that caption.' },
      text: { type: 'string', desc: 'Replacement word.', optional: true },
      start: { type: 'number', desc: 'Word start time relative to the caption, in seconds.', optional: true },
      end: { type: 'number', desc: 'Word end time relative to the caption, in seconds.', optional: true },
      color: { type: 'string', desc: 'Per-word color hex.', optional: true },
      font_weight: { type: 'number', desc: 'Per-word font weight.', optional: true },
      font_style: { type: 'enum', desc: 'Per-word font style.', enum: ['normal', 'italic', 'oblique'], optional: true },
      opacity: { type: 'number', desc: 'Per-word opacity 0..1.', optional: true },
      letter_spacing: { type: 'number', desc: 'Per-word letter spacing in em.', optional: true },
    },
    example: { input: { caption_index: 0, word_index: 2, color: '#C6F24E', end: 1.4 }, why: 'Make one word green and adjust its timing.' },
    roles: ['captions', 'director'],
    run: (c, p) => editCaptionWord(c, {
      captionIndex: p.caption_index, wordIndex: p.word_index, text: p.text, start: p.start, end: p.end,
      color: p.color, fontWeight: p.font_weight, fontStyle: p.font_style, opacity: p.opacity, letterSpacing: p.letter_spacing,
    }),
  },
  {
    name: 'set_clip_look_advanced',
    description: 'Set clip blend mode, fit, name, color label, volume, audio fades and reverse flag. Omit clip_id to apply to all editable clips.',
    params: {
      clip_id: { type: 'string', desc: 'Exact clip id. Omit to update all media and text clips.', optional: true },
      blend_mode: { type: 'string', desc: 'Canvas blend mode such as normal, screen, multiply, overlay.', optional: true },
      fit: { type: 'enum', desc: 'How source media fits the frame.', enum: ['cover', 'contain', 'fill'], optional: true },
      name: { type: 'string', desc: 'New clip name.', optional: true },
      label: { type: 'string', desc: 'Color label: red, amber, green, blue, purple or pink.', optional: true },
      volume: { type: 'number', desc: 'Linear volume gain.', optional: true },
      fade_in: { type: 'number', desc: 'Audio/video fade in seconds.', optional: true },
      fade_out: { type: 'number', desc: 'Audio/video fade out seconds.', optional: true },
      reversed: { type: 'boolean', desc: 'Play the clip backwards.', optional: true },
    },
    example: { input: { blend_mode: 'screen', volume: 0.5, fade_in: 0.3 }, why: 'Blend an overlay and soften its audio.' },
    roles: ['director', 'sound', 'designer'],
    run: (c, p) => setClipLookAdvanced(c, {
      clipId: p.clip_id, blendMode: p.blend_mode, fit: p.fit, name: p.name, label: p.label,
      volume: p.volume, fadeIn: p.fade_in, fadeOut: p.fade_out, reversed: p.reversed,
    }),
  },
  {
    name: 'set_project_settings_ai',
    description: 'Change project frame rate, aspect ratio, custom resolution or background color. All changes are one undo step and affect preview and export.',
    params: {
      fps: { type: 'enum', desc: 'Frames per second.', enum: ['24', '25', '30', '60'], optional: true },
      aspect: { type: 'enum', desc: 'Frame aspect ratio.', enum: ['16:9', '9:16', '1:1', '4:5'], optional: true },
      width: { type: 'number', desc: 'Custom frame width in pixels (320–3840).', optional: true },
      height: { type: 'number', desc: 'Custom frame height in pixels (320–3840).', optional: true },
      background: { type: 'string', desc: 'Background color hex.', optional: true },
    },
    example: { input: { fps: 60, aspect: '9:16' }, why: 'Deliver smooth vertical video.' },
    roles: ['director', 'story'],
    run: (c, p) => setProjectSettingsAI(c, { fps: p.fps, aspect: p.aspect, width: p.width, height: p.height, background: p.background }),
  },

  // ---- Power editing tools (fine-grained AI control) ----
  {
    name: 'add_effect',
    description: 'Add a visual or audio effect to clips: color, blur, sharpen, vignette, glow, pixelate, noise, rgbSplit, chromaKey, negate, normalize, eq, gate, deess, denoise, compressor, limiter, echo, pan, lut. Set enabled and params.',
    params: {
      clip_id: { type: 'string', desc: 'Clip id from the TIMELINE block. Omit to apply to all editable clips.', optional: true },
      type: { type: 'enum', desc: 'Effect type.', enum: ['color','blur','sharpen','vignette','glow','pixelate','noise','rgbSplit','chromaKey','negate','normalize','eq','gate','deess','denoise','compressor','limiter','echo','pan','lut'] },
      params: { type: 'string', desc: 'Optional effect parameters as JSON, e.g. {"amount":0.5}.', optional: true },
      enabled: { type: 'boolean', desc: 'Enable the effect.', default: true, optional: true },
    },
    example: { input: { type: 'glow' }, why: 'Add a soft glow to every clip.' },
    roles: ['motion', 'color', 'director'],
    run: (c, p) => addEffectTool(c, { ...p, params: effectParams(p.params) }),
  },
  {
    name: 'configure_effect',
    description: 'Change the parameters or enabled state of an existing effect on a clip. Give an effect type or an exact effect id (at least one is required).',
    params: {
      clip_id: { type: 'string', desc: 'Clip id.', optional: true },
      effect_type: { type: 'string', desc: 'Effect type to match (e.g. glow, blur).', optional: true },
      effect_id: { type: 'string', desc: 'Exact effect id (wins over type).', optional: true },
      params: { type: 'string', desc: 'New effect parameters as JSON, e.g. {"amount":0.3}.', optional: true },
      enabled: { type: 'boolean', desc: 'Enable or disable.', optional: true },
    },
    example: { input: { effect_type: 'blur', enabled: false }, why: 'Disable the blur effect.' },
    roles: ['motion', 'color'],
    run: (c, p) => configureEffect(c, { ...p, params: effectParams(p.params) }),
  },
  {
    name: 'remove_effect',
    description: 'Remove an effect from clips by type or id.',
    params: {
      clip_id: { type: 'string', desc: 'Clip id.', optional: true },
      effect_type: { type: 'string', desc: 'Effect type to remove.', optional: true },
      effect_id: { type: 'string', desc: 'Exact effect id.', optional: true },
    },
    example: { input: { effect_type: 'vignette' }, why: 'Remove all vignettes.' },
    roles: ['motion', 'color'],
    run: (c, p) => removeEffectTool(c, p),
  },
  {
    name: 'animate_property',
    description: 'Animate a clip property between two values using keyframes: scale, x, y, rotation, opacity. Use for slow zooms, pans, fades and spins.',
    params: {
      clip_id: { type: 'string', desc: 'Clip id.', optional: true },
      property: { type: 'enum', desc: 'Property to animate.', enum: ['scale','x','y','rotation','skewX','skewY','opacity','volume'], default: 'scale' },
      from: { type: 'number', desc: 'Starting value (e.g. 1 for scale, 0 for opacity).' },
      to: { type: 'number', desc: 'Ending value (e.g. 1.2 for a slow zoom).' },
      start_time: { type: 'number', desc: 'Start time within the clip.', optional: true },
      end_time: { type: 'number', desc: 'End time within the clip.', optional: true },
      easing: { type: 'enum', desc: 'Easing curve.', enum: ['linear','ease-in','ease-out','ease-in-out','bezier'], default: 'ease-in-out', optional: true },
    },
    example: { input: { property: 'scale', from: 1, to: 1.15, easing: 'ease-in-out' }, why: 'Slow cinematic zoom across the clip.' },
    roles: ['motion', 'director'],
    run: (c, p) => animateProperty(c, { ...p, property: p.property, startTime: p.start_time, endTime: p.end_time }),
  },
  {
    name: 'speed_ramp',
    description: 'Apply a multi-point speed ramp to a clip: slow motion, fast-forward, or a curve between speeds.',
    params: {
      clip_id: { type: 'string', desc: 'Clip id.' },
      points: { type: 'string', desc: 'Speed points as JSON: [{"time":0,"speed":1},{"time":2,"speed":0.5}]. Times are clip-local seconds; speed multiplier 0.1–8.' },
    },
    example: { input: { clip_id: 'clip_1', points: '[{"time":0,"speed":1},{"time":1,"speed":0.4}]' }, why: 'Slow-mo the second half.' },
    roles: ['motion', 'story'],
    run: (c, p) => {
      let parsed: any = p.points;
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return { actions: [], summary: 'Speed points must be valid JSON.' }; } }
      return speedRamp(c, { ...p, points: parsed });
    },
  },
  {
    name: 'apply_mask',
    description: 'Apply a rect, ellipse or polygon mask to clips with feathering and optional invert. Use for cropping, vignettes and cutouts.',
    params: {
      clip_id: { type: 'string', desc: 'Clip id.', optional: true },
      shape: { type: 'enum', desc: 'Mask shape.', enum: ['rect','ellipse','polygon'], default: 'rect' },
      feather: { type: 'number', desc: 'Edge feather 0–0.25.', optional: true },
      invert: { type: 'boolean', desc: 'Invert the mask.', optional: true },
      x: { type: 'number', desc: 'Left position 0–1.', optional: true },
      y: { type: 'number', desc: 'Top position 0–1.', optional: true },
      width: { type: 'number', desc: 'Width 0–1.', optional: true },
      height: { type: 'number', desc: 'Height 0–1.', optional: true },
    },
    example: { input: { shape: 'ellipse', feather: 0.1 }, why: 'Circular vignette-style mask.' },
    roles: ['motion', 'color'],
    run: (c, p) => applyMask(c, p),
  },
  {
    name: 'set_clip_transition',
    description: 'Set a transition on a clip edge. Use crossfade, dip-black, dip-white, wipe-left, slide-left, zoom-in, push, spin, glitch, light-leak, film, cinematic or a blend-* type.',
    params: {
      clip_id: { type: 'string', desc: 'Clip id.' },
      edge: { type: 'enum', desc: 'Which edge.', enum: ['in','out'], default: 'in' },
      type: { type: 'enum', desc: 'Transition type.', enum: ['crossfade','dip-black','dip-white','wipe-left','slide-left','zoom-in','blend-multiply','blend-screen','blend-overlay','push','spin','glitch','light-leak','film','cinematic'], default: 'crossfade' },
      duration: { type: 'number', desc: 'Duration in seconds (0.05–2, at most half the clip).', optional: true },
    },
    example: { input: { clip_id: 'clip_1', edge: 'in', type: 'crossfade', duration: 0.5 }, why: 'Fade in the clip.' },
    roles: ['motion', 'story'],
    run: (c, p) => setClipTransition(c, p),
  },
  {
    name: 'group_clips',
    description: 'Group several clips so they move together, or ungroup them.',
    params: {
      clip_ids: { type: 'string', desc: 'Comma-separated clip ids to group or ungroup.' },
      ungroup: { type: 'boolean', desc: 'Ungroup instead of group.', optional: true },
    },
    example: { input: { clip_ids: 'clip_1,clip_2' }, why: 'Move these two clips together.' },
    roles: ['story', 'director'],
    run: (c, p) => groupClipsAI(c, { clipIds: typeof p.clip_ids === 'string' ? p.clip_ids.split(',').map((s: string) => s.trim()).filter(Boolean) : p.clip_ids, ungroup: p.ungroup }),
  },
  {
    name: 'time_range_edit',
    description: 'Insert a gap at a time, or ripple-delete a time range across tracks.',
    params: {
      operation: { type: 'enum', desc: 'gap or delete.', enum: ['gap','delete'], default: 'delete' },
      start: { type: 'number', desc: 'Start time in seconds.' },
      end: { type: 'number', desc: 'End time in seconds (for delete).', optional: true },
      duration: { type: 'number', desc: 'Gap duration (for gap).', optional: true },
    },
    example: { input: { operation: 'delete', start: 5, end: 8 }, why: 'Remove seconds 5 to 8.' },
    roles: ['story'],
    run: (c, p) => timeRangeEdit(c, p),
  },
  {
    name: 'add_marker_advanced',
    description: 'Add a labeled marker with a color and kind (user, scene, broll, beat, chapter, retake) at a time.',
    params: {
      time: { type: 'number', desc: 'Time in seconds.' },
      label: { type: 'string', desc: 'Marker label.' },
      color: { type: 'string', desc: 'Hex color.', optional: true },
      kind: { type: 'enum', desc: 'Marker kind.', enum: ['user','scene','broll','beat','chapter','retake'], optional: true },
    },
    example: { input: { time: 12, label: 'Hook', kind: 'chapter' }, why: 'Mark the hook moment.' },
    roles: ['story', 'director'],
    run: (c, p) => addMarkerAI(c, p),
  },
  {
    name: 'add_review_note',
    description: 'Add a review note (tack) at a time — for feedback and to-dos on the timeline.',
    params: {
      time: { type: 'number', desc: 'Time in seconds.' },
      text: { type: 'string', desc: 'Note text.' },
    },
    example: { input: { time: 30, text: 'Add b-roll here' }, why: 'Leave a note for the editor.' },
    roles: ['story', 'director'],
    run: (c, p) => addNote(c, p),
  },
  {
    name: 'label_clips',
    description: 'Assign a color label to clips for visual organization.',
    params: {
      clip_ids: { type: 'string', desc: 'Comma-separated clip ids. Omit to label all.', optional: true },
      label: { type: 'string', desc: 'Label name (e.g. select, broll, review).' },
    },
    example: { input: { label: 'broll' }, why: 'Mark all clips as b-roll.' },
    roles: ['story'],
    run: (c, p) => labelClips(c, { clipIds: typeof p.clip_ids === 'string' ? p.clip_ids.split(',').map((s: string) => s.trim()).filter(Boolean) : p.clip_ids, label: p.label }),
  },
  {
    name: 'set_blend_mode',
    description: 'Set a canvas blend mode on clips: multiply, screen, overlay, darken, lighten, color-dodge, and more.',
    params: {
      clip_id: { type: 'string', desc: 'Clip id.', optional: true },
      mode: { type: 'enum', desc: 'Blend mode.', enum: ['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity'] },
    },
    example: { input: { mode: 'screen' }, why: 'Screen blend for a light overlay.' },
    roles: ['color', 'motion'],
    run: (c, p) => setBlendMode(c, p),
  },
  {
    name: 'set_clip_fades',
    description: 'Set audio/video fade-in and fade-out durations on clips.',
    params: {
      clip_id: { type: 'string', desc: 'Clip id.', optional: true },
      fade_in: { type: 'number', desc: 'Fade-in seconds.', optional: true },
      fade_out: { type: 'number', desc: 'Fade-out seconds.', optional: true },
    },
    example: { input: { fade_in: 0.5, fade_out: 0.5 }, why: 'Smooth audio in and out.' },
    roles: ['sound', 'story'],
    run: (c, p) => setClipFades(c, { ...p, fadeIn: p.fade_in, fadeOut: p.fade_out }),
  },
  {
    name: 'ui_action',
    description: 'Run a visible editor command by its human label or id: undo, redo, copy, paste, play/pause, nudge, zoom, go to start/end, open the command palette or export dialog. Control actions take effect immediately and do NOT create a project edit; report them as UI actions, not video edits.',
    params: {
      action: {
        type: 'enum',
        desc: 'Shortcut id or human command label from uiCommandCatalog().',
        enum: [...DEFAULT_SHORTCUTS.map((s) => s.id), 'export'],
      },
    },
    example: { input: { action: 'undo' }, why: 'Undo the last edit, exactly like the toolbar button.' },
    roles: ['story', 'sound', 'captions', 'review'],
    label: 'Editor command',
    group: 'Interface',
    aliases: ['undo', 'redo', 'copy', 'paste', 'play', 'pause', 'zoom', 'go to start', 'command palette', 'open export'],
    kind: 'control',
    requires: [],
    run: async (_c, p) => {
      const { runEditorAction } = await import('../src/features/editorActions');
      const ok = runEditorAction(String(p.action));
      return {
        actions: [],
        summary: ok ? `Ran editor command: ${p.action}` : `Unknown or unavailable editor command: ${p.action}`,
        warnings: ok ? [] : ['Use uiCommandCatalog() to choose a valid command id.'],
      };
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** Human-readable name for a tool's machine identifier, for UI surfaces
 * (command palette, tool runner) — e.g. "remove_dead_air" → "Remove dead air".
 * Small acronyms and already-capitalized words are preserved. */
export function toolLabel(name: string): string {
  return name
    .split('_')
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : '')
    .join(' ')
    .replace(/\bAi\b/g, 'AI').replace(/\bSrt\b/g, 'SRT').replace(/\bSfx\b/g, 'SFX');
}

/** Words a human says in the UI but an agent would never guess from the
 * snake_case tool id. These are prompt metadata only — no visible UI changes. */
const TOOL_ALIASES: Record<string, string[]> = {
  add_text: ['add title', 'add a title', 'text clip', 'heading'],
  timeline_edit: ['split', 'trim', 'move clip', 'delete clip', 'speed', 'mute'],
  crop_region: ['crop', 'extract area', 'region crop', 'reframe crop'],
  add_captions: ['generate captions', 'auto captions', 'subtitles'],
  import_captions: ['import srt', 'import vtt', 'upload subtitles'],
  auto_edit: ['one click edit', 'professional edit', 'auto edit'],
  auto_fix: ['fix video', 'self fix', 'quality fix'],
  freeze_frame: ['freeze frame', 'still from playhead', 'snapshot frame'],
  add_marker: ['add marker', 'mark chapter', 'bookmark'],
  set_transition: ['transition', 'crossfade', 'wipe'],
  balance_audio: ['normalize audio', 'loudness', 'level audio'],
  cleanup_audio: ['noise reduction', 'de-ess', 'clean audio'],
  export_video: ['export', 'render video', 'download mp4'],
  analyze_media: ['analyze', 'transcribe', 'detect silences'],
  ui_action: ['undo', 'redo', 'copy', 'paste', 'play', 'pause', 'zoom', 'go to start', 'command palette', 'open export'],
};

const GROUP_RULES: [RegExp, string][] = [
  [/caption|subtitle|transcript/i, 'Captions'],
  [/audio|sound|music|voice/i, 'Audio'],
  [/color|grade|look|lut/i, 'Color & look'],
  [/transition|motion|zoom|broll|reframe|motif/i, 'Motion'],
  [/crop|marker|note|track|clip|keyframe|effect|speed|section|duplicate|reverse/i, 'Editing'],
  [/project|style|rule|ai|auto|variant/i, 'Automation'],
];

export interface ToolMeta {
  label: string;
  group: string;
  aliases: string[];
  kind: ToolKind;
  requires: string[];
}

/** One place that supplies human words to models and external agents. */
export function toolMeta(t: ToolDef): ToolMeta {
  const fallbackLabel = toolLabel(t.name);
  return {
    label: t.label ?? fallbackLabel,
    group: t.group ?? GROUP_RULES.find(([re]) => re.test(t.name))?.[1] ?? 'Editing',
    aliases: t.aliases ?? TOOL_ALIASES[t.name] ?? [],
    kind: t.kind ?? 'edit',
    requires: t.requires ?? [],
  };
}

/** Every visible editor command, labelled, for agents that need to drive the
 * UI rather than only the edit engine (Claude/Codex/Hermes/OpenCode). */
export function uiCommandCatalog(): { id: string; label: string; group: string; combo: string }[] {
  return DEFAULT_SHORTCUTS.map((s) => ({ id: s.id, label: s.label, group: s.group, combo: s.combo }));
}

/** Filter out actions that touch human-locked clips (co-editing priority). */
export function filterLocked(actions: Action[], locked?: Set<string>): { actions: Action[]; skipped: number } {
  if (!locked?.size) return { actions, skipped: 0 };
  let skipped = 0;
  const out = actions.filter((a) => {
    if ('clipId' in a && typeof (a as any).clipId === 'string' && locked.has((a as any).clipId)) { skipped++; return false; }
    return true;
  });
  return { actions: out, skipped };
}

/** Run a tool in PREVIEW mode: returns actions + summary, changes nothing. */
export async function runTool(project: Project, name: string, params: Record<string, unknown> = {}, opts: { locked?: Set<string>; ai?: ToolContext['ai'] } = {}): Promise<ToolResult> {
  const def = TOOL_MAP.get(name);
  if (!def) throw new Error(`Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}`);
  const ctx = makeContext(project, opts.locked, opts.ai);
  const result = await def.run(ctx, params ?? {});
  const { actions, skipped } = filterLocked(result.actions, opts.locked);
  if (skipped) {
    result.warnings = [...(result.warnings ?? []), `${skipped} change${skipped === 1 ? '' : 's'} skipped: clip${skipped === 1 ? ' is' : 's are'} locked by the human editor.`];
  }
  return { ...result, actions };
}

/** Compact manifest for AI prompts / tools.json / llms.txt. Tools the user
 * switched off in AI Control Center are not advertised to models or agents. */
export function toolManifest() {
  const disabled = new Set(listDisabledTools());
  return TOOLS.filter((t) => !disabled.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    params: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, { type: v.type, description: v.desc, ...(v.default !== undefined ? { default: v.default } : {}), ...(v.enum ? { enum: v.enum } : {}), ...(v.optional ? { optional: true } : {}) }])),
    example: t.example,
    ...toolMeta(t),
  }));
}

export function toolsPromptText(): string {
  const disabled = new Set(listDisabledTools());
  return TOOLS.filter((t) => !disabled.has(t.name)).map((t) => {
    const ps = Object.entries(t.params).map(([k, v]) => `${k}${v.optional ? '?' : ''}: ${v.type}${v.enum ? ` (${v.enum.slice(0, 12).join('|')}${v.enum.length > 12 ? '|…' : ''})` : ''} — ${v.desc}`).join('; ');
    const meta = toolMeta(t);
    const words = [`human label "${meta.label}"`, `group ${meta.group}`, `kind ${meta.kind}`];
    if (meta.aliases.length) words.push(`also called ${meta.aliases.map((a) => `"${a}"`).join(', ')}`);
    if (meta.requires.length) words.push(`needs ${meta.requires.join(', ')}`);
    return `- ${t.name}(${ps || 'no params'}) [${words.join('; ')}]: ${t.description} Example: ${JSON.stringify(t.example.input)}`;
  }).join('\n') + '\n\nVISIBLE EDITOR COMMANDS — use ui_action with the id when the user says the label (these are UI controls, not project edits):\n'
    + uiCommandCatalog().map((c) => `- ${c.id}: "${c.label}" [${c.group}] (${c.combo})`).join('\n');
}