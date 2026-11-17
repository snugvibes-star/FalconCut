/**
 * Cut tools: remove_dead_air, remove_fillers, cut_retakes.
 * They never cut mid-word, keep breathing room, and add tiny audio
 * crossfades so cuts are pop-free. All cuts ripple the whole timeline.
 */
import type { Action } from '../engine/actions';
import type { CutRange, ToolContext } from './helpers';
import { allAnalysis, clampToWords, cutSourceRanges, fmtSec, speechClips } from './helpers';
import { getMedia } from '../engine/types';

export type { ToolContext } from './helpers';

export interface ToolResult {
  actions: Action[];
  summary: string;
  stats?: Record<string, number | string>;
  warnings?: string[];
}

export function removeDeadAir(ctx: ToolContext, params: { max_pause_ms?: number } = {}): ToolResult {
  const p = ctx.project;
  const maxPause = (params.max_pause_ms ?? ctx.pack.pacing.deadAirMaxMs) / 1000;
  const breath = ctx.pack.pacing.breathKeepMs / 1000;
  const warnings: string[] = [];
  const actions: Action[] = [];
  let removed = 0, cuts = 0;
  const speech = speechClips(p);
  if (!speech.length) {
    // fall back to any analyzed media with silences
    for (const ma of allAnalysis(p)) {
      if (!ma.silences.length) continue;
      const ranges: CutRange[] = [];
      for (const s of ma.silences) {
        if (s.end - s.start < maxPause) continue;
        const words = ma.transcript?.words ?? [];
        const clamped = words.length ? clampToWords(s, words, breath) : { start: s.start + breath * 0.5, end: s.end - breath * 0.5 };
        if (clamped && clamped.end - clamped.start >= 0.15) ranges.push(clamped);
      }
      const r = cutSourceRanges(p, ma.mediaId, ranges);
      actions.push(...r.actions); removed += r.removedSec; cuts += r.cuts;
    }
  } else {
    const done = new Set<string>();
    for (const clip of speech) {
      const ma = p.analysis!.byMedia[clip.mediaId!];
      if (!ma || done.has(ma.mediaId)) continue;
      done.add(ma.mediaId);
      const words = ma.transcript?.words ?? [];
      const ranges: CutRange[] = [];
      for (const s of ma.silences) {
        if (s.end - s.start < maxPause) continue;
        // only cut inside the region this clip actually uses
        const usedStart = clip.inPoint, usedEnd = clip.inPoint + clip.duration * clip.speed;
        if (s.end < usedStart || s.start > usedEnd) continue;
        const clamped = clampToWords({ start: Math.max(s.start, usedStart), end: Math.min(s.end, usedEnd) }, words, breath);
        if (clamped) ranges.push(clamped);
      }
      const r = cutSourceRanges(p, ma.mediaId, ranges);
      actions.push(...r.actions); removed += r.removedSec; cuts += r.cuts;
    }
  }
  if (!actions.length) warnings.push('No dead air above the threshold was found (or analysis is still running).');
  return {
    actions,
    summary: removed > 0 ? `Removed ${fmtSec(removed)} of dead air across ${cuts} cut${cuts === 1 ? '' : 's'}, keeping ${Math.round(breath * 1000)}ms breathing room and adding ${18}ms audio crossfades.` : 'Nothing to remove.',
    stats: { removedSec: Math.round(removed * 10) / 10, cuts, maxPauseMs: maxPause * 1000 },
    warnings,
  };
}

export function removeFillers(ctx: ToolContext): ToolResult {
  const p = ctx.project;
  const actions: Action[] = [];
  let count = 0, removed = 0;
  const done = new Set<string>();
  for (const ma of allAnalysis(p)) {
    if (!ma.fillers.length || done.has(ma.mediaId)) continue;
    done.add(ma.mediaId);
    const ranges: CutRange[] = ma.fillers.map((f) => ({ start: Math.max(0, f.start - 0.02), end: f.end + 0.02 }));
    const r = cutSourceRanges(p, ma.mediaId, ranges, 14);
    actions.push(...r.actions); count += ma.fillers.length; removed += r.removedSec;
  }
  return {
    actions,
    summary: count ? `Removed ${count} filler word${count === 1 ? '' : 's'} (${fmtSec(removed)}). Cuts stay on word boundaries with micro-crossfades.` : 'No filler words detected (needs a transcript).',
    stats: { fillers: count, removedSec: Math.round(removed * 10) / 10 },
    warnings: count ? [] : ['Filler detection needs transcription. Enable it in the Analysis panel.'],
  };
}

export function cutRetakes(ctx: ToolContext): ToolResult {
  const p = ctx.project;
  const actions: Action[] = [];
  let groups = 0, removed = 0;
  const tacks: Action[] = [];
  const done = new Set<string>();
  for (const ma of allAnalysis(p)) {
    if (!ma.retakes.length || done.has(ma.mediaId)) continue;
    done.add(ma.mediaId);
    for (const g of ma.retakes) {
      const best = g.attempts[g.bestIndex];
      if (!best || g.end - g.start < 0.3) continue;
      const r = cutSourceRanges(p, ma.mediaId, [{ start: g.start, end: best.start }], 16);
      actions.push(...r.actions);
      removed += r.removedSec; groups++;
      tacks.push({ type: 'add_tack', tack: { time: Math.max(0, g.start - removed), author: 'ai', text: `Kept the best take: "${best.text.slice(0, 80)}" (attempt ${g.bestIndex + 1} of ${g.attempts.length}).` } });
    }
  }
  return {
    actions: [...actions, ...tacks],
    summary: groups ? `Cut ${groups} retake/false-start group${groups === 1 ? '' : 's'} (${fmtSec(removed)}), keeping the last complete take each time. Tacks note what was kept.` : 'No retakes detected (needs a transcript).',
    stats: { groups, removedSec: Math.round(removed * 10) / 10 },
    warnings: groups ? [] : ['Retake detection needs transcription.'],
  };
}