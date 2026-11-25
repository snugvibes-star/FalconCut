/**
 * Caption + title tools. Professional defaults: max 2 lines, safe zones per
 * aspect, readable sizes, outlines, karaoke timing from word timestamps.
 *
 * Caption generation is density-aware (tight / balanced / relaxed), removes
 * hesitation sounds by default, caps cue length and reading speed, and keeps
 * every spoken word on screen. Import / restyle / shift / timing-repair tools
 * round out the caption workflow.
 */
import type { Action } from '../engine/actions';
import type { CaptionStyleId, CaptionWord, MediaAnalysis, TextStyle } from '../engine/types';
import { defaultTextStyle, projectDuration } from '../engine/types';
import { buildCues, markKeywords, parseSRT } from '../engine/captions';
import type { ToolContext, ToolResult } from './cutTools';
import { firstTextTrack, sourceToTimeline, speechClips } from './helpers';

const SAFE_Y: Record<string, number> = { '9:16': 0.72, '16:9': 0.82, '1:1': 0.8, '4:5': 0.78 };

export type CaptionDensity = 'tight' | 'balanced' | 'relaxed';

interface DensityPreset { chars: number; lines: number; maxCueSec: number; cps: number }

const DENSITY: Record<CaptionDensity, DensityPreset> = {
  // Bite-size social captions: 1 line, ~3s, fast reading.
  tight: { chars: 20, lines: 1, maxCueSec: 3.2, cps: 22 },
  // Standard subtitles: 2 lines, ~6s.
  balanced: { chars: 34, lines: 2, maxCueSec: 6.5, cps: 18 },
  // Documentary / interview: longer, calmer cues.
  relaxed: { chars: 44, lines: 2, maxCueSec: 9, cps: 15 },
};

/** Width cap per aspect so two lines always fit the frame at the chosen size. */
function aspectCharCap(aspect: string): number {
  if (aspect === '9:16') return 20;
  if (aspect === '4:5') return 24;
  if (aspect === '1:1') return 28;
  return 40;
}

export interface AddCaptionsParams {
  style?: CaptionStyleId;
  /** How much text per cue. Default 'balanced'. */
  density?: CaptionDensity;
  max_chars?: number;
  max_lines?: number;
  max_seconds?: number;
  /** Drop um / uh / hmm from the caption text. Default true. */
  remove_fillers?: boolean;
  /** Colour keywords (bold-keywords / karaoke). Default true. */
  highlight_keywords?: boolean;
}

export function addCaptions(ctx: ToolContext, params: AddCaptionsParams = {}): ToolResult {
  const p = ctx.project;
  if (!ctx.pack.captions.enabled) return { actions: [], summary: 'Captions are disabled by your rules/pack.', warnings: ['Rule "no captions" is active.'] };
  const trackId = firstTextTrack(p);
  if (!trackId) return { actions: [], summary: 'No text track available.', warnings: ['Add a text track first.'] };
  const styleId = params.style ?? ctx.pack.captions.style;
  const density = DENSITY[params.density ?? 'balanced'] ?? DENSITY.balanced;
  const maxLines = Math.max(1, Math.min(3, params.max_lines ?? (styleId === 'word-pop' ? 1 : density.lines)));
  const maxChars = Math.max(
    12,
    Math.min(params.max_chars ?? Math.min(density.chars, ctx.pack.captions.maxCharsPerLine), aspectCharCap(p.settings.aspect)),
  );
  const maxCueSec = Math.max(1.5, Math.min(20, params.max_seconds ?? density.maxCueSec));
  const removeFillers = params.remove_fillers !== false;
  const highlight = params.highlight_keywords !== false;

  const spoken = speechClips(p);
  const sources = spoken
    .map((c) => ({ clip: c, ma: p.analysis?.byMedia[c.mediaId!] }))
    .filter((s): s is { clip: (typeof spoken)[number]; ma: MediaAnalysis } => !!s.ma?.transcript?.words.length);
  if (!sources.length) {
    // Never delete existing captions when there is nothing to replace them
    // with — a failed run must not destroy work.
    return {
      actions: [],
      summary: 'No transcript available for captions.',
      warnings: ['Captions need a transcript. Enable transcription in the Analysis panel, then run again.'],
    };
  }

  const actions: Action[] = [];
  // idempotent: remove previous auto captions
  for (const c of p.clips) if (c.kind === 'text' && c.text?.role === 'caption') actions.push({ type: 'remove_clip', clipId: c.id });

  const baseStyle: Partial<TextStyle> = {
    preset: styleId,
    color: ctx.pack.captions.color,
    highlightColor: ctx.pack.captions.highlightColor,
    fontSize: styleId === 'word-pop' ? Math.max(ctx.pack.captions.fontSize, 0.07) : ctx.pack.captions.fontSize,
    y: styleId === 'word-pop' ? 0.5 : Math.min(ctx.pack.captions.y, SAFE_Y[p.settings.aspect] ?? 0.8),
    maxLines,
    maxWidth: p.settings.aspect === '9:16' ? 0.88 : 0.84,
  };
  let cues = 0;
  let droppedFillers = 0;
  for (const { clip, ma } of sources) {
    const built = buildCues(ma.transcript!.words, maxChars, maxLines, 0.7, {
      maxCueSec,
      targetCps: density.cps,
      sentenceBreak: true,
      removeFillers,
    });
    for (const cue of built) {
      // transcript times are asset-relative; sourceToTimeline already
      // compensates for inPoint — adding it again shifted cues after head-trims
      const tlStart = sourceToTimeline(p, clip.mediaId!, cue.start);
      const tlEnd = sourceToTimeline(p, clip.mediaId!, cue.end);
      if (tlStart == null || tlEnd == null || tlEnd - tlStart < 0.15) continue;
      let words: CaptionWord[] = cue.words.map((w) => ({
        w: w.w,
        start: Math.max(0, (sourceToTimeline(p, clip.mediaId!, cue.start + w.start) ?? tlStart) - tlStart),
        end: Math.max(0.05, (sourceToTimeline(p, clip.mediaId!, cue.start + w.end) ?? tlEnd) - tlStart),
        filler: w.filler,
        timingEstimated: w.timingEstimated,
      }));
      if (highlight) words = markKeywords(words);
      actions.push({
        type: 'add_text', trackId, start: tlStart, duration: tlEnd - tlStart,
        text: cue.text, preset: styleId, style: baseStyle, words, role: 'caption',
      });
      cues++;
    }
    const removed = ma.transcript!.words.filter((w) => /^(uh|uhh|uhm|um|umm|erm|er|ah|ahh|eh|hmm|hm|mm|mhm)$/i.test(w.word.trim())).length;
    if (removeFillers) droppedFillers += removed;
  }
  const bits = [
    `${cues} cue${cues === 1 ? '' : 's'}`,
    `${styleId} style`,
    `${params.density ?? 'balanced'} density`,
    `≤${maxChars} chars/line`,
    `≤${maxLines} line${maxLines === 1 ? '' : 's'}`,
    `≤${maxCueSec.toFixed(1)}s`,
    `${p.settings.aspect} safe zone`,
  ];
  if (removeFillers && droppedFillers) bits.push(`${droppedFillers} filler${droppedFillers === 1 ? '' : 's'} removed`);
  return {
    actions,
    summary: cues
      ? `Added ${bits.join(' · ')} with outline + shadow for mobile readability.`
      : 'No transcript available for captions.',
    stats: { cues, style: styleId, maxChars, maxLines, maxCueSec, fillersRemoved: droppedFillers },
    warnings: cues ? [] : ['Captions need a transcript. Enable transcription in the Analysis panel, then run again.'],
  };
}

/** Restyle every caption (or just one style facet) without regenerating text. */
export function restyleCaptions(
  ctx: ToolContext,
  params: { style?: CaptionStyleId; font_size?: number; y?: number; x?: number; uppercase?: boolean; animation?: TextStyle['animation']; color?: string; highlight?: string; outline_width?: number } = {},
): ToolResult {
  const caps = ctx.project.clips.filter((c) => c.kind === 'text' && c.text?.role === 'caption');
  if (!caps.length) return { actions: [], summary: 'No captions to restyle. Generate captions first.' };
  const patch: Partial<TextStyle> = {};
  if (params.style) Object.assign(patch, defaultTextStyle(params.style));
  if (params.font_size !== undefined) patch.fontSize = Math.max(0.02, Math.min(0.16, Number(params.font_size)));
  if (params.y !== undefined) patch.y = Math.max(0.05, Math.min(0.95, Number(params.y)));
  if (params.x !== undefined) patch.x = Math.max(0.05, Math.min(0.95, Number(params.x)));
  if (params.uppercase !== undefined) patch.uppercase = !!params.uppercase;
  if (params.animation !== undefined) patch.animation = params.animation;
  if (params.color) patch.color = params.color;
  if (params.highlight) patch.highlightColor = params.highlight;
  if (params.outline_width !== undefined) patch.outlineWidth = Math.max(0, Math.min(0.5, Number(params.outline_width)));
  if (!Object.keys(patch).length) return { actions: [], summary: 'Nothing to change — pass style, font_size, y, uppercase, animation or colours.' };
  return {
    actions: caps.map((c) => ({ type: 'set_text_style' as const, clipId: c.id, patch })),
    summary: `Restyled ${caps.length} caption clip${caps.length === 1 ? '' : 's'}${params.style ? ` to “${params.style}”` : ''}.`,
    stats: { captions: caps.length },
  };
}

/** Shift captions in time (positive = later). Optionally only a time window. */
export function shiftCaptions(
  ctx: ToolContext,
  params: { offset: number; from?: number; to?: number },
): ToolResult {
  const offset = Number(params.offset);
  if (!Number.isFinite(offset) || offset === 0) return { actions: [], summary: 'shift_captions needs a non-zero offset in seconds.' };
  const from = Number.isFinite(Number(params.from)) ? Number(params.from) : -Infinity;
  const to = Number.isFinite(Number(params.to)) ? Number(params.to) : Infinity;
  const caps = ctx.project.clips.filter((c) => c.kind === 'text' && c.text?.role === 'caption' && c.start + c.duration >= from && c.start <= to);
  if (!caps.length) return { actions: [], summary: 'No captions in that time range.' };
  const actions: Action[] = caps.map((c) => ({ type: 'move_clip', clipId: c.id, start: Math.max(0, c.start + offset) }));
  return {
    actions,
    summary: `Shifted ${caps.length} caption clip${caps.length === 1 ? '' : 's'} ${offset > 0 ? 'later' : 'earlier'} by ${Math.abs(offset).toFixed(2)}s.`,
    stats: { captions: caps.length, offset },
  };
}

/**
 * Repair caption timing: split every caption longer than max_seconds into
 * readable chunks (word timings preserved), so no cue sits on screen for 20s.
 */
export function fixCaptionTiming(ctx: ToolContext, params: { max_seconds?: number } = {}): ToolResult {
  const maxSec = Math.max(1.5, Math.min(30, Number(params.max_seconds ?? 6)));
  const caps = ctx.project.clips.filter((c) => c.kind === 'text' && c.text?.role === 'caption');
  const actions: Action[] = [];
  let splitCount = 0;
  for (const c of caps) {
    if (c.duration <= maxSec + 0.05) continue;
    const style = c.text!.style;
    const role = c.text!.role;
    const trackId = c.trackId;
    const words = c.text!.words ?? [];
    const chunks: { text: string; start: number; duration: number; words?: CaptionWord[] }[] = [];
    if (words.length >= 2) {
      let cur: CaptionWord[] = [];
      const push = () => {
        if (!cur.length) return;
        const first = cur[0].start;
        const last = cur[cur.length - 1].end;
        chunks.push({
          text: cur.map((w) => w.w).join(' '),
          start: c.start + first,
          duration: Math.max(0.2, last - first),
          words: cur.map((w) => ({ ...w, start: Math.max(0, w.start - first), end: Math.max(0.05, w.end - first) })),
        });
        cur = [];
      };
      for (const w of words) {
        if (cur.length && w.end - cur[0].start > maxSec) push();
        cur.push(w);
      }
      push();
    } else {
      const parts = c.text!.text.split(/\s+/).filter(Boolean);
      const n = Math.max(2, Math.ceil(c.duration / maxSec));
      const per = Math.ceil(parts.length / n);
      const dur = c.duration / n;
      for (let i = 0; i < n; i++) {
        const text = parts.slice(i * per, (i + 1) * per).join(' ');
        if (!text) continue;
        chunks.push({ text, start: c.start + i * dur, duration: Math.min(dur, c.start + c.duration - (c.start + i * dur)) });
      }
    }
    if (chunks.length < 2) continue;
    actions.push({ type: 'remove_clip', clipId: c.id });
    for (const chunk of chunks) {
      actions.push({
        type: 'add_text', trackId, start: chunk.start, duration: chunk.duration,
        text: chunk.text, preset: style.preset, style, words: chunk.words, role,
      });
    }
    splitCount++;
  }
  return {
    actions,
    summary: splitCount
      ? `Split ${splitCount} over-long caption clip${splitCount === 1 ? '' : 's'} into cues of ≤${maxSec.toFixed(1)}s.`
      : `Every caption is already ≤${maxSec.toFixed(1)}s.`,
    stats: { split: splitCount, maxSeconds: maxSec },
  };
}

/** Import SRT / WebVTT captions as editable caption clips. */
export function importCaptions(
  ctx: ToolContext,
  params: { srt: string; replace?: boolean; offset?: number },
): ToolResult {
  const cues = parseSRT(String(params.srt ?? ''));
  if (!cues.length) return { actions: [], summary: 'No cues found. Paste a valid SRT or WebVTT file.', warnings: ['Expected lines like “00:00:01,000 --> 00:00:04,000”.'] };
  const p = ctx.project;
  const trackId = firstTextTrack(p);
  if (!trackId) return { actions: [], summary: 'No text track available.', warnings: ['Add a text track first.'] };
  const offset = Number.isFinite(Number(params.offset)) ? Number(params.offset) : 0;
  const style: Partial<TextStyle> = {
    preset: ctx.pack.captions.style,
    color: ctx.pack.captions.color,
    highlightColor: ctx.pack.captions.highlightColor,
    fontSize: ctx.pack.captions.fontSize,
    y: Math.min(ctx.pack.captions.y, SAFE_Y[p.settings.aspect] ?? 0.8),
    maxLines: 2,
    maxWidth: p.settings.aspect === '9:16' ? 0.88 : 0.84,
  };
  const actions: Action[] = [];
  if (params.replace !== false) {
    for (const c of p.clips) if (c.kind === 'text' && c.text?.role === 'caption') actions.push({ type: 'remove_clip', clipId: c.id });
  }
  for (const cue of cues) {
    actions.push({
      type: 'add_text', trackId, start: Math.max(0, cue.start + offset), duration: Math.max(0.2, cue.end - cue.start),
      text: cue.text, preset: style.preset, style, role: 'caption',
    });
  }
  return {
    actions,
    summary: `Imported ${cues.length} caption cue${cues.length === 1 ? '' : 's'} from subtitles${offset ? ` (offset ${offset > 0 ? '+' : ''}${offset}s)` : ''}.`,
    stats: { cues: cues.length },
  };
}

export function addHookTitle(ctx: ToolContext, params: { text?: string } = {}): ToolResult {
  const p = ctx.project;
  if (!ctx.pack.hook.enabled) return { actions: [], summary: 'Hook titles are disabled by the active pack.' };
  const trackId = firstTextTrack(p);
  if (!trackId) return { actions: [], summary: 'No text track available.' };
  const dur = Math.min(ctx.pack.hook.maxSec, Math.max(1.2, projectDuration(p)));
  let text = params.text?.trim();
  if (!text) {
    // derive from transcript: first sentence, else keywords
    for (const c of speechClips(p)) {
      const ma = p.analysis!.byMedia[c.mediaId!];
      const seg = ma?.transcript?.segments[0];
      if (seg) { text = seg.text.replace(/[.!?]+$/, ''); break; }
    }
    if (!text) {
      const kws = Object.values(p.analysis?.byMedia ?? ({} as Record<string, MediaAnalysis>)).flatMap((m) => m.keywords).slice(0, 3);
      text = kws.length ? kws.join(' ').toUpperCase() : 'WATCH THIS';
    }
    if (text.length > 42) text = text.slice(0, 42).replace(/\s+\S*$/, '') + '…';
  }
  const actions: Action[] = [];
  for (const c of p.clips) if (c.kind === 'text' && c.text?.role === 'hook') actions.push({ type: 'remove_clip', clipId: c.id });
  const y = p.settings.aspect === '9:16' ? 0.24 : 0.22;
  actions.push({
    type: 'add_text', trackId, start: 0, duration: dur, text, role: 'hook', preset: 'clean',
    style: {
      ...defaultTextStyle('clean'),
      fontSize: ctx.pack.hook.fontSize, fontWeight: 800, color: '#FFFFFF',
      highlightColor: ctx.pack.captions.highlightColor, bgColor: 'transparent',
      outlineWidth: 0.12, y, x: 0.5, animation: 'pop', uppercase: true, maxLines: 2, maxWidth: 0.9,
      shadow: true,
    },
  });
  return { actions, summary: `Added an animated hook title "${text}" for the first ${dur.toFixed(1)}s (pop-in, safe-zone positioned).`, stats: { durationSec: dur } };
}

export async function translateCaptions(ctx: ToolContext, params: { language: string }): Promise<ToolResult> {
  const p = ctx.project;
  if (!ctx.ai) return { actions: [], summary: 'Translation needs an AI key (Settings → AI).', warnings: ['No AI endpoint configured.'] };
  const caps = p.clips.filter((c) => c.kind === 'text' && c.text?.role === 'caption');
  if (!caps.length) return { actions: [], summary: 'No captions to translate. Run add_captions first.' };
  const trackId = firstTextTrack(p);
  const actions: Action[] = [];
  const batchSize = 25;
  let translated = 0;
  for (let i = 0; i < caps.length; i += batchSize) {
    const batch = caps.slice(i, i + batchSize);
    const payload = batch.map((c, k) => `${k}: ${c.text!.text}`).join('\n');
    let reply: string;
    try {
      reply = await ctx.ai(
        `Translate each numbered caption line into ${params.language}. Keep the same numbering. Return ONLY the numbered lines, nothing else. Keep them short and natural for social video.`,
        payload,
        'translate',
      );
    } catch (e) {
      return { actions, summary: `Translation stopped: ${(e as Error).message}`, warnings: ['AI request failed.'] };
    }
    const lines = reply.split('\n').map((l) => l.match(/^\s*(\d+)\s*[:.]\s*(.*)$/)).filter(Boolean) as RegExpMatchArray[];
    for (const m of lines) {
      const idx = parseInt(m[1]);
      const clip = batch[idx];
      if (!clip || !m[2]) continue;
      actions.push({
        type: 'add_text', trackId, start: clip.start, duration: clip.duration, text: m[2].trim(),
        preset: clip.text!.style.preset, role: 'caption',
        style: { ...clip.text!.style, fontFamily: /arabic|hebrew|urdu/i.test(params.language) ? 'Inter Variable' : clip.text!.style.fontFamily },
        words: undefined,
      });
      translated++;
    }
  }
  // put translations on a new track so originals stay
  if (actions.length) {
    const newTrackId = `trk_${params.language.replace(/\W/g, '').toLowerCase()}`;
    actions.unshift({ type: 'add_track', track: { id: newTrackId, kind: 'text', name: `Captions (${params.language})` } });
    for (const a of actions) if (a.type === 'add_text') a.trackId = newTrackId;
  }
  return { actions, summary: `Translated ${translated} captions into ${params.language} on a separate track (originals kept). Karaoke word timing is not preserved for translations.`, stats: { translated } };
}
