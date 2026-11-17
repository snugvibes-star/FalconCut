/**
 * Caption + title tools. Professional defaults: max 2 lines, safe zones per
 * aspect, readable sizes, outlines, karaoke timing from word timestamps.
 */
import type { Action } from '../engine/actions';
import type { CaptionStyleId, MediaAnalysis, TextStyle, CaptionWord } from '../engine/types';
import { defaultTextStyle, getMedia, projectDuration } from '../engine/types';
import { buildCues, markKeywords } from '../engine/captions';
import type { ToolContext, ToolResult } from './cutTools';
import { firstTextTrack, sourceToTimeline, speechClips } from './helpers';

const SAFE_Y: Record<string, number> = { '9:16': 0.72, '16:9': 0.82, '1:1': 0.8, '4:5': 0.78 };

export function addCaptions(ctx: ToolContext, params: { style?: CaptionStyleId } = {}): ToolResult {
  const p = ctx.project;
  if (!ctx.pack.captions.enabled) return { actions: [], summary: 'Captions are disabled by your rules/pack.', warnings: ['Rule "no captions" is active.'] };
  const trackId = firstTextTrack(p);
  if (!trackId) return { actions: [], summary: 'No text track available.', warnings: ['Add a text track first.'] };
  const styleId = params.style ?? ctx.pack.captions.style;
  const actions: Action[] = [];
  // idempotent: remove previous auto captions
  for (const c of p.clips) if (c.kind === 'text' && c.text?.role === 'caption') actions.push({ type: 'remove_clip', clipId: c.id });

  const baseStyle: Partial<TextStyle> = {
    preset: styleId,
    color: ctx.pack.captions.color,
    highlightColor: ctx.pack.captions.highlightColor,
    fontSize: styleId === 'word-pop' ? Math.max(ctx.pack.captions.fontSize, 0.07) : ctx.pack.captions.fontSize,
    y: styleId === 'word-pop' ? 0.5 : Math.min(ctx.pack.captions.y, SAFE_Y[p.settings.aspect] ?? 0.8),
    maxLines: 2,
    maxWidth: p.settings.aspect === '9:16' ? 0.88 : 0.84,
  };
  let cues = 0;
  const spoken = speechClips(p);
  const sources = spoken.length ? spoken.map((c) => ({ clip: c, ma: p.analysis!.byMedia[c.mediaId!] })) : [];
  for (const { clip, ma } of sources) {
    if (!ma?.transcript?.words.length) continue;
    const built = buildCues(ma.transcript.words, ctx.pack.captions.maxCharsPerLine, 2);
    for (const cue of built) {
      // transcript times are asset-relative; sourceToTimeline already
      // compensates for inPoint — adding it again shifted cues after head-trims
      const tlStart = sourceToTimeline(p, clip.mediaId!, cue.start);
      const tlEnd = sourceToTimeline(p, clip.mediaId!, cue.end);
      if (tlStart == null || tlEnd == null || tlEnd - tlStart < 0.15) continue;
      const words: CaptionWord[] = markKeywords(cue.words.map((w) => ({
        w: w.w,
        start: Math.max(0, (sourceToTimeline(p, clip.mediaId!, cue.start + w.start) ?? tlStart) - tlStart),
        end: Math.max(0.05, (sourceToTimeline(p, clip.mediaId!, cue.start + w.end) ?? tlEnd) - tlStart),
        filler: w.filler,
      })));
      actions.push({
        type: 'add_text', trackId, start: tlStart, duration: tlEnd - tlStart,
        text: cue.text, preset: styleId, style: baseStyle, words, role: 'caption',
      });
      cues++;
    }
  }
  return {
    actions,
    summary: cues ? `Added ${cues} caption cues (${styleId} style), max 2 lines, positioned in the ${p.settings.aspect} safe zone with outline + shadow for mobile readability.` : 'No transcript available for captions.',
    stats: { cues, style: styleId },
    warnings: cues ? [] : ['Captions need a transcript. Enable transcription in the Analysis panel, then run again.'],
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
        payload
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