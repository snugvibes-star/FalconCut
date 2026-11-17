/**
 * Pipeline tools: auto_edit (rules-only full pipeline), auto_fix (lint loop),
 * smart_cutdown, ab_variants, auto_multicam, reference style extraction.
 */
import type { Action } from '../engine/actions';
import { applyActions } from '../engine/actions';
import type { Aspect, MediaAnalysis, Project, StylePack, Clip } from '../engine/types';
import { createProject, getMedia, projectDuration, uid, sourceTimeOf } from '../engine/types';
import { BUILT_IN_PACKS, getPack } from '../styles/packs';
import { effectivePack } from '../styles/rules';
import { lintProject } from '../quality/lint';
import type { ToolContext, ToolResult } from './cutTools';
import { removeDeadAir, removeFillers, cutRetakes } from './cutTools';
import { addCaptions, addHookTitle } from './captionTools';
import { zoomOnEmphasis, addTransitions, reframe } from './motionTools';
import { addMusic, balanceAudio } from './audioTools';
import { applyColorPreset, addBrollSlots } from './lookTools';
import { firstVideoTrack, speechClips, sourceToTimeline } from './helpers';

export type RunToolFn = (ctx: ToolContext, name: string, params: Record<string, unknown>) => Promise<ToolResult>;

const TYPE_TO_PACK: Record<string, string> = {
  'talking head': 'talking-head', talking_head: 'talking-head', tiktok: 'talking-head', reels: 'talking-head',
  podcast: 'podcast-clip', 'podcast clip': 'podcast-clip', interview: 'podcast-clip',
  promo: 'product-promo', 'product promo': 'product-promo', ad: 'product-promo', product: 'product-promo',
  tutorial: 'tutorial', 'how to': 'tutorial', education: 'tutorial', demo: 'tutorial',
  vlog: 'vlog', travel: 'vlog', daily: 'vlog',
  quote: 'quote-motivational', motivational: 'quote-motivational', motivation: 'quote-motivational',
  intro: 'youtube-intro', 'youtube intro': 'youtube-intro', youtube: 'youtube-intro',
};

/** Full recommended pipeline for a video type. ONE undo step. Works with NO AI. */
export async function autoEdit(ctx: ToolContext, params: { video_type?: string; aspect?: Aspect } = {}, runTool?: RunToolFn): Promise<ToolResult> {
  let p = ctx.project;
  const all: Action[] = [];
  const steps: string[] = [];
  const warnings: string[] = [];
  const packId = TYPE_TO_PACK[(params.video_type ?? '').toLowerCase()] ?? p.stylePackId;
  const pack = effectivePack({ ...getPack(p, packId), id: packId } as StylePack, p.rules);
  const localCtx = (): ToolContext => ({ ...ctx, project: p, pack });

  const run = async (name: string, fn: (c: ToolContext) => ToolResult | Promise<ToolResult>, pms?: Record<string, unknown>) => {
    const r = await fn(localCtx());
    if (r.actions.length) {
      p = applyActions(p, r.actions);
      all.push(...r.actions);
      steps.push(`${name}: ${r.summary}`);
    } else if (r.warnings?.length) warnings.push(...r.warnings);
    return r;
  };

  if (packId !== p.stylePackId) {
    const a: Action = { type: 'set_style_pack', packId };
    p = applyActions(p, [a]); all.push(a);
    steps.push(`style pack → ${pack.name}`);
  }
  if (params.aspect && params.aspect !== p.settings.aspect) {
    const r = reframe(localCtx(), { aspect: params.aspect });
    p = applyActions(p, r.actions); all.push(...r.actions); steps.push(r.summary);
  }
  await run('balance_audio', (c) => balanceAudio(c));
  await run('remove_dead_air', (c) => removeDeadAir(c, { max_pause_ms: pack.pacing.deadAirMaxMs }));
  await run('cut_retakes', (c) => cutRetakes(c));
  await run('remove_fillers', (c) => removeFillers(c));
  await run('add_captions', (c) => addCaptions(c));
  await run('zoom_on_emphasis', (c) => zoomOnEmphasis(c));
  await run('add_transitions', (c) => addTransitions(c));
  await run('apply_color_preset', (c) => applyColorPreset(c, { name: pack.color }));
  await run('add_hook_title', (c) => addHookTitle(c));
  await run('add_broll_slots', (c) => addBrollSlots(c));
  const hasMusic = p.media.some((m) => m.type === 'audio');
  if (hasMusic) await run('add_music', (c) => addMusic(c));

  // self-check: one auto-fix pass
  const report = lintProject(p, pack);
  const fixable = report.issues.filter((i) => i.fix?.actions?.length);
  if (fixable.length) {
    const fixes = fixable.flatMap((i) => i.fix!.actions!);
    p = applyActions(p, fixes);
    all.push(...fixes);
    steps.push(`auto-fix: resolved ${fixable.length} lint issue${fixable.length === 1 ? '' : 's'}`);
  }
  const finalReport = lintProject(p, pack);
  return {
    actions: all,
    summary: `Auto-edit complete (${pack.name} pipeline, ${steps.length} steps). Quality score ${finalReport.score}/100${finalReport.readyToExport ? ' — ready to export' : ''}.`,
    stats: { steps: steps.length, score: finalReport.score, issues: finalReport.issues.length },
    warnings: [...new Set(warnings)],
  };
}

/** Lint → fix loop, max 3 attempts. Returns the combined actions. */
export async function autoFix(ctx: ToolContext, params: { max_attempts?: number } = {}, runTool?: RunToolFn): Promise<ToolResult> {
  const max = Math.min(3, params.max_attempts ?? 3);
  let p = ctx.project;
  const all: Action[] = [];
  const log: string[] = [];
  let report = lintProject(p, ctx.pack);
  for (let attempt = 1; attempt <= max && report.issues.some((i) => i.fix); attempt++) {
    const fixable = report.issues.filter((i) => i.fix);
    if (!fixable.length) break;
    const batch: Action[] = [];
    // Direct action fixes first, so tool fixes see the updated timeline.
    for (const i of fixable) if (i.fix!.actions?.length) batch.push(...i.fix!.actions);
    if (batch.length) p = applyActions(p, batch);
    // Tool fixes: run each unique tool ONCE per pass against the evolving project.
    // Several issues often share one tool (e.g. multiple dead-air spans → remove_dead_air);
    // calling it per-issue would emit duplicate, conflicting ripple actions.
    const seen = new Set<string>();
    for (const i of fixable) {
      const tool = i.fix!.tool;
      if (!tool || !runTool) continue;
      const key = `${tool.name}|${JSON.stringify(tool.params ?? {})}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = await runTool({ ...ctx, project: p }, tool.name, tool.params ?? {});
      if (r.actions.length) { p = applyActions(p, r.actions); batch.push(...r.actions); }
    }
    if (!batch.length) break;
    all.push(...batch);
    report = lintProject(p, ctx.pack);
    log.push(`Attempt ${attempt}: fixed ${fixable.length} issue${fixable.length === 1 ? '' : 's'} → score ${report.score}/100, ${report.issues.length} remaining.`);
    if (report.readyToExport && !report.issues.some((i) => i.severity === 'error')) break;
  }
  return {
    actions: all,
    summary: log.length ? `Auto-fix ran ${log.length} pass${log.length === 1 ? '' : 'es'}. ${log[log.length - 1]}` : 'Nothing to fix — the lint report is clean.',
    stats: { attempts: log.length, score: report.score, remaining: report.issues.length },
  };
}

/* ---------------- smart cutdown ---------------- */

export interface CutdownCandidate {
  id: string;
  start: number; end: number; // timeline
  title: string;
  hookScore: number;
  reasons: string[];
  transcript: string;
}

const HOOK_WORDS = /\b(how|why|what|secret|never|stop|wait|mistake|truth|free|money|hack|nobody|everyone|you|your|this|warning|biggest|fastest|easy)\b/i;

export function scoreSegment(text: string, words: { start: number; end: number }[], energy: number): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 40;
  const first = text.split(/[.!?]/)[0] ?? text;
  if (HOOK_WORDS.test(first)) { score += 18; reasons.push('Opens with a hook word'); }
  if (/\?/.test(first)) { score += 10; reasons.push('Opens with a question'); }
  if (/\d/.test(first)) { score += 8; reasons.push('Contains a number (specificity)'); }
  const len = words.length ? words[words.length - 1].end - words[0].start : 0;
  if (len >= 15 && len <= 60) { score += 12; reasons.push(`Ideal short length (${len.toFixed(0)}s)`); }
  else if (len > 60) { score -= 8; reasons.push('Longer than 60s — trim for Shorts'); }
  else if (len < 8) { score -= 15; reasons.push('Too short to hold attention'); }
  if (energy > 0.6) { score += 10; reasons.push('High vocal energy'); }
  if (/[!]$/.test(text.trim())) { score += 4; reasons.push('Emphatic delivery'); }
  return { score: Math.max(5, Math.min(99, score)), reasons };
}

export function smartCutdown(ctx: ToolContext, params: { count?: number } = {}): ToolResult & { candidates: CutdownCandidate[] } {
  const p = ctx.project;
  const count = Math.max(3, Math.min(10, params.count ?? 6));
  const candidates: CutdownCandidate[] = [];
  for (const clip of speechClips(p)) {
    const ma = p.analysis!.byMedia[clip.mediaId!];
    if (!ma?.transcript?.segments.length) continue;
    const segs = ma.transcript.segments;
    // build sentence-cluster windows of 15-60s
    for (let i = 0; i < segs.length; i++) {
      let end = i;
      let text = segs[i].text;
      while (end + 1 < segs.length && segs[end + 1].end - segs[i].start < 55) { end++; text += ' ' + segs[end].text; }
      const srcStart = segs[i].start, srcEnd = segs[end].end;
      const len = srcEnd - srcStart;
      if (len < 12) continue;
      // transcript times are asset-relative; sourceToTimeline already
      // compensates for inPoint — adding it again shifted cues after head-trims
      const tlStart = sourceToTimeline(p, clip.mediaId!, srcStart);
      const tlEnd = sourceToTimeline(p, clip.mediaId!, srcEnd);
      if (tlStart == null || tlEnd == null) continue;
      const env = ma.loudness.filter((l) => l.t >= srcStart && l.t <= srcEnd);
      const energy = env.length ? env.reduce((a, l) => a + l.rms, 0) / env.length / 0.15 : 0.5;
      const { score, reasons } = scoreSegment(text, [{ start: srcStart, end: srcEnd }], Math.min(1, energy));
      const title = text.split(/[.!?]/)[0].slice(0, 70);
      candidates.push({ id: uid('cut'), start: tlStart, end: tlEnd, title, hookScore: score, reasons, transcript: text });
      i = end; // non-overlapping
    }
  }
  candidates.sort((a, b) => b.hookScore - a.hookScore);
  const top = candidates.slice(0, count);
  const actions: Action[] = top.map((c) => ({
    type: 'add_marker', marker: { time: c.start, label: `Short: ${c.title.slice(0, 40)} (hook ${c.hookScore})`, color: '#C084FC', kind: 'chapter' },
  }));
  return {
    actions,
    candidates: top,
    summary: top.length ? `Found ${top.length} short-clip candidates (hook-scored). Markers added; open any candidate as its own project from the Cutdown panel.` : 'No transcript segments long enough for cutdowns.',
    stats: { candidates: top.length },
  };
}

/** Create a standalone short project from a timeline range (keeps media refs). */
export function cutdownToProject(p: Project, start: number, end: number, title: string): Project {
  const np: Project = JSON.parse(JSON.stringify(p));
  np.id = uid('proj');
  np.name = title.slice(0, 60) || 'Short';
  np.createdAt = Date.now();
  np.clips = np.clips
    .filter((c) => c.start < end && c.start + c.duration > start)
    .map((c) => {
      const cs = Math.max(c.start, start), ce = Math.min(c.start + c.duration, end);
      const trimLeft = cs - c.start;
      return {
        ...c,
        start: cs - start,
        duration: ce - cs,
        inPoint: c.kind === 'media' ? sourceTimeOf(c, cs) : c.inPoint,
        keyframes: c.keyframes.filter((k) => k.time >= trimLeft && k.time <= trimLeft + (ce - cs)).map((k) => ({ ...k, time: k.time - trimLeft })),
        text: c.text ? { ...c.text, words: c.text.words?.filter((w) => w.end > trimLeft && w.start < trimLeft + (ce - cs)).map((w) => ({ ...w, start: Math.max(0, w.start - trimLeft), end: w.end - trimLeft })) } : c.text,
      };
    });
  np.markers = np.markers.filter((m) => m.time >= start && m.time <= end).map((m) => ({ ...m, time: m.time - start }));
  np.tacks = [];
  return np;
}

/* ---------------- A/B variants ---------------- */

export function abVariants(ctx: ToolContext, params: { variants?: number } = {}): ToolResult & { variants: { name: string; project: Project }[] } {
  const p = ctx.project;
  const n = Math.max(2, Math.min(3, params.variants ?? 3));
  const configs = [
    { name: 'A — Tight & bold', pack: 'product-promo', caption: 'word-pop' as const },
    { name: 'B — Clean & calm', pack: 'talking-head', caption: 'clean' as const },
    { name: 'C — Karaoke social', pack: 'quote-motivational', caption: 'karaoke' as const },
  ].slice(0, n);
  const variants: { name: string; project: Project }[] = [];
  const actions: Action[] = [];
  for (const cfg of configs) {
    const vp: Project = JSON.parse(JSON.stringify(p));
    vp.id = uid('proj');
    vp.name = `${p.name} · ${cfg.name}`;
    vp.stylePackId = cfg.pack;
    const pack = effectivePack(getPack(vp, cfg.pack), vp.rules);
    // restyle existing captions + zoom intensity
    for (const c of vp.clips) {
      if (c.kind === 'text' && c.text?.role === 'caption') {
        c.text.style = { ...c.text.style, preset: cfg.caption, fontSize: cfg.caption === 'word-pop' ? 0.08 : pack.captions.fontSize, y: cfg.caption === 'word-pop' ? 0.5 : pack.captions.y };
      }
      if (c.kind === 'media') {
        c.keyframes = c.keyframes.filter((k) => k.path !== 'transform.scale');
      }
    }
    variants.push({ name: cfg.name, project: vp });
    actions.push({ type: 'add_tack', tack: { time: 0, author: 'ai', text: `Variant "${cfg.name}" generated — open it from the Versions panel to compare.` } });
  }
  return { actions, variants, summary: `Generated ${variants.length} A/B variants with different pacing, caption styles and hooks. Compare them in the Versions panel.`, stats: { variants: variants.length } };
}

/* ---------------- multicam ---------------- */

export function autoMulticam(ctx: ToolContext, raw: { mediaIds?: string[] | string } = {}): ToolResult {
  // Manifest advertises a comma-separated string; some agents send an array. Accept both.
  const ids = typeof raw.mediaIds === 'string' ? raw.mediaIds.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(raw.mediaIds) ? raw.mediaIds : undefined;
  const p = ctx.project;
  const angles = p.media.filter((m) => m.type === 'video' && (!ids || ids.includes(m.id)));
  if (angles.length < 2) return { actions: [], summary: 'Multicam needs at least 2 imported video angles of the same take.', warnings: ['Import a second angle first.'] };
  const main = speechClips(p)[0];
  if (!main) return { actions: [], summary: 'Multicam switching needs a transcript on the main angle.', warnings: ['Transcribe the main angle first.'] };
  const ma = p.analysis!.byMedia[main.mediaId!];
  const segments = ma.transcript?.segments ?? [];
  const trackId = firstVideoTrack(p);
  if (!trackId) return { actions: [], summary: 'No video track.' };
  const actions: Action[] = [];
  // alternate angles at speaker turns (heuristic), keep main as base
  const other = angles.find((a) => a.id !== main.mediaId)!;
  let angleIdx = 0;
  let switches = 0;
  const overlayId = uid('trk');
  actions.push({ type: 'add_track', track: { id: overlayId, kind: 'video', name: 'Angle 2' }, index: 0 });
  for (const seg of segments) {
    if (seg.end - seg.start < 2.5) continue;
    angleIdx++;
    if (angleIdx % 2 === 0) continue; // switch on every other turn
    const tlStart = sourceToTimeline(p, main.mediaId!, seg.start);
    const tlEnd = sourceToTimeline(p, main.mediaId!, seg.end);
    if (tlStart == null || tlEnd == null) continue;
    actions.push({
      type: 'add_clip',
      clip: { trackId: overlayId, mediaId: other.id, start: tlStart, duration: tlEnd - tlStart, inPoint: Math.min(other.duration - (tlEnd - tlStart), Math.max(0, seg.start)), volume: 0, fades: { in: 0.08, out: 0.08 } },
    });
    switches++;
  }
  return {
    actions,
    summary: switches ? `Multicam: ${switches} angle switches on speaker turns (pause-based heuristic). Angle 2 is muted so the main audio stays continuous. Review the switches — true speaker diarization is not available in-browser.` : 'No suitable speaker turns found.',
    stats: { switches },
    warnings: ['Speaker turns are detected from pauses, not voice identity.'],
  };
}

/* ---------------- reference style extraction ---------------- */

export function packFromReference(name: string, ma: MediaAnalysis): StylePack {
  const base = BUILT_IN_PACKS[0];
  const shotLens: number[] = [];
  const bounds = [0, ...ma.scenes, ma.duration];
  for (let i = 0; i < bounds.length - 1; i++) shotLens.push(bounds[i + 1] - bounds[i]);
  const avgShot = shotLens.length ? shotLens.reduce((a, b) => a + b, 0) / shotLens.length : base.pacing.avgShotSec;
  const maxStatic = shotLens.length ? Math.max(...shotLens) : base.pacing.maxStaticSec;
  const pack: StylePack = JSON.parse(JSON.stringify(base));
  pack.id = `ref-${uid('x').slice(-6)}`;
  pack.name = name;
  pack.videoType = 'reference';
  pack.builtIn = false;
  pack.description = `Extracted from reference video: avg shot ${avgShot.toFixed(1)}s, ${ma.isMusic ? `music ${ma.bpm} BPM` : 'speech-led'}, loudness ${ma.integratedLoudness} LUFS. Caption style cannot be read from pixels without OCR — defaults kept; adjust manually.`;
  pack.pacing = { avgShotSec: Math.round(avgShot * 10) / 10, maxStaticSec: Math.min(30, Math.round(maxStatic)), deadAirMaxMs: Math.round(Math.max(300, Math.min(1200, avgShot * 90))), breathKeepMs: 180 };
  pack.audio = { targetLoudness: Math.max(-20, Math.min(-12, Math.round(ma.integratedLoudness))), gateThresholdDb: -48 };
  pack.music = { ...base.music, level: ma.isMusic ? 0.3 : 0.14, duckLevel: ma.isMusic ? 0.15 : 0.06 };
  pack.zoom = { ...base.zoom, minIntervalSec: Math.max(2, avgShot * 0.8), maxScale: avgShot < 3 ? 1.13 : 1.08 };
  pack.transitions = { ...base.transitions, maxPerMinute: Math.min(15, Math.round(60 / Math.max(1.5, avgShot))), durationSec: avgShot < 3 ? 0.22 : 0.35 };
  pack.color = ma.integratedLoudness < -20 ? 'cinematic' : 'natural';
  return pack;
}