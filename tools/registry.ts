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

export interface ParamSpec { type: 'string' | 'number' | 'boolean' | 'enum'; desc: string; default?: unknown; enum?: string[]; optional?: boolean }

export interface ToolDef {
  name: string;
  description: string;
  params: Record<string, ParamSpec>;
  example: { input: Record<string, unknown>; why: string };
  roles: string[]; // multi-agent team roles allowed to use this tool
  run: (ctx: ToolContext, params: any) => Promise<ToolResult> | ToolResult;
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
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

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

/** Compact manifest for AI prompts / tools.json / llms.txt. */
export function toolManifest() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    params: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, { type: v.type, description: v.desc, ...(v.default !== undefined ? { default: v.default } : {}), ...(v.enum ? { enum: v.enum } : {}), ...(v.optional ? { optional: true } : {}) }])),
    example: t.example,
  }));
}

export function toolsPromptText(): string {
  return TOOLS.map((t) => {
    const ps = Object.entries(t.params).map(([k, v]) => `${k}${v.optional ? '?' : ''}: ${v.type}${v.enum ? ` (${v.enum.join('|')})` : ''} — ${v.desc}`).join('; ');
    return `- ${t.name}(${ps || 'no params'}): ${t.description} Example: ${JSON.stringify(t.example.input)}`;
  }).join('\n');
}