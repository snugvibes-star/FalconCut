/** Shared helpers for high-level tools: source<->timeline mapping, safe cutting. */
import type { Action } from '../engine/actions';
import { applyAction } from '../engine/actions';
import type { Clip, MediaAnalysis, Project, StylePack, TranscriptWord } from '../engine/types';
import { getMedia } from '../engine/types';
import { effectivePack } from '../styles/rules';
import { getPack } from '../styles/packs';

export interface ToolContext {
  project: Project;
  pack: StylePack;
  lockedClipIds?: Set<string>;
  ai?: (system: string, user: string) => Promise<string>;
}

export function makeContext(project: Project, locked?: Set<string>, ai?: ToolContext['ai']): ToolContext {
  return { project, pack: effectivePack(getPack(project), project.rules), lockedClipIds: locked, ai };
}

/** Media clips that carry speech (video with audio + transcript). */
export function speechClips(p: Project): Clip[] {
  return p.clips.filter((c) => {
    if (c.kind !== 'media') return false;
    const a = getMedia(p, c.mediaId);
    const ma = p.analysis?.byMedia[c.mediaId ?? ''];
    // A completed transcript is stronger evidence of speech than the asset's
    // hasAudio flag, which is often wrong for demuxed/unknown video formats.
    return a?.type === 'video' && !!ma?.transcript?.words.length;
  });
}

export function mainSpeech(p: Project): { clip: Clip; ma: MediaAnalysis } | null {
  const clips = speechClips(p).sort((a, b) => a.start - b.start);
  for (const clip of clips) {
    const ma = p.analysis!.byMedia[clip.mediaId!];
    if (ma) return { clip, ma };
  }
  return null;
}

export function allAnalysis(p: Project): MediaAnalysis[] {
  return Object.values(p.analysis?.byMedia ?? {});
}

/** Map a source time of a media asset to timeline time (first matching clip). */
export function sourceToTimeline(p: Project, mediaId: string, srcT: number): number | null {
  for (const c of p.clips) {
    if (c.mediaId !== mediaId || c.kind !== 'media') continue;
    const used = c.duration * c.speed;
    if (srcT >= c.inPoint - 1e-6 && srcT <= c.inPoint + used + 1e-6) {
      return c.start + (srcT - c.inPoint) / c.speed;
    }
  }
  return null;
}

export function timelineToSource(p: Project, mediaId: string, tlT: number): number | null {
  for (const c of p.clips) {
    if (c.mediaId !== mediaId || c.kind !== 'media') continue;
    if (tlT >= c.start - 1e-6 && tlT <= c.start + c.duration + 1e-6) {
      return c.inPoint + (tlT - c.start) * c.speed;
    }
  }
  return null;
}

/** Words of a media that fall inside a source range. */
export function wordsInRange(words: TranscriptWord[], start: number, end: number): TranscriptWord[] {
  return words.filter((w) => w.end > start && w.start < end);
}

export interface CutRange { start: number; end: number }

/**
 * Convert source-time ranges to merged timeline ranges, then emit
 * ripple_delete_range actions (descending order) + tiny crossfades at cuts.
 * Never cuts mid-word: caller clamps ranges to word boundaries first.
 */
export function cutSourceRanges(p: Project, mediaId: string, ranges: CutRange[], crossfadeMs = 18): { actions: Action[]; removedSec: number; cuts: number } {
  const tl: CutRange[] = [];
  for (const r of ranges) {
    const s = sourceToTimeline(p, mediaId, r.start);
    const e = sourceToTimeline(p, mediaId, r.end);
    if (s == null || e == null || e - s < 0.05) continue;
    tl.push({ start: s, end: e });
  }
  tl.sort((a, b) => a.start - b.start);
  const merged: CutRange[] = [];
  for (const r of tl) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 0.03) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const actions: Action[] = [];
  let removed = 0;
  const cutPoints: number[] = [];
  for (let i = merged.length - 1; i >= 0; i--) {
    const r = merged[i];
    removed += r.end - r.start;
    actions.push({ type: 'ripple_delete_range', start: r.start, end: r.end, shiftMarkers: true });
    cutPoints.push(r.start);
  }
  // crossfades: after all deletions, find clips touching cut points in the FINAL doc
  let final = p;
  for (const a of actions) final = applyAction(final, a);
  const fade = crossfadeMs / 1000;
  for (const cp of cutPoints) {
    for (const c of final.clips) {
      if (c.kind !== 'media') continue;
      if (Math.abs(c.start - cp) < 0.06 && c.fades.in < fade) actions.push({ type: 'set_fades', clipId: c.id, fadeIn: fade });
      if (Math.abs(c.start + c.duration - cp) < 0.06 && c.fades.out < fade) actions.push({ type: 'set_fades', clipId: c.id, fadeOut: fade });
    }
  }
  return { actions, removedSec: removed, cuts: merged.length };
}

/** Clamp a silence range so it never touches a word, keeping breathing room. */
export function clampToWords(range: CutRange, words: TranscriptWord[], breathSec: number): CutRange | null {
  let { start, end } = range;
  const before = words.filter((w) => w.end <= start + 0.05).pop();
  const after = words.find((w) => w.start >= end - 0.05);
  if (before) start = Math.max(start, before.end + 0.03);
  if (after) end = Math.min(end, after.start - 0.03);
  // keep breathing room attached to the words, not the cut
  start += 0; end -= 0;
  if (before) start = Math.max(range.start, before.end + breathSec * 0.4);
  if (after) end = Math.min(range.end, after.start - breathSec * 0.4);
  if (end - start < 0.12) return null;
  return { start, end };
}

export function fmtSec(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`;
}

export function firstTextTrack(p: Project): string | undefined {
  return p.tracks.find((t) => t.kind === 'text' && !t.locked)?.id ?? p.tracks.find((t) => t.kind === 'text')?.id;
}

export function firstAudioTrack(p: Project): string | undefined {
  return p.tracks.find((t) => t.kind === 'audio' && !t.locked)?.id ?? p.tracks.find((t) => t.kind === 'audio')?.id;
}

export function firstVideoTrack(p: Project): string | undefined {
  return [...p.tracks].reverse().find((t) => t.kind === 'video' && !t.locked)?.id ?? p.tracks.find((t) => t.kind === 'video')?.id;
}