/**
 * The lint: automatic quality checks after any edit. Every issue carries an
 * auto-fix (actions or a tool call). The AI can loop auto_fix up to 3 times.
 * All checks are computable from the project JSON + analysis (no guessing).
 */
import type { Action } from '../engine/actions';
import type { Clip, MediaAnalysis, Project, StylePack } from '../engine/types';
import { getMedia, projectDuration } from '../engine/types';
import { estimateSpeechMusicBalance } from '../engine/audio';
import { getPack } from '../styles/packs';
import { effectivePack } from '../styles/rules';

export type Severity = 'error' | 'warning' | 'info';

export interface LintIssue {
  id: string;
  code: string;
  severity: Severity;
  message: string;
  time?: number;
  clipId?: string;
  category: 'cuts' | 'audio' | 'captions' | 'visual' | 'pacing';
  fix?: { label: string; actions?: Action[]; tool?: { name: string; params?: Record<string, unknown> } };
}

export interface SubScore { score: number; explanation: string }

export interface LintReport {
  issues: LintIssue[];
  score: number;
  readyToExport: boolean;
  reasons: string[];
  subscores: { pacing: SubScore; audio: SubScore; captions: SubScore; hook: SubScore; retention: SubScore };
  checked: string[];
  at: number;
}

let issueSeq = 0;
const issue = (i: Omit<LintIssue, 'id'>): LintIssue => ({ ...i, id: `li${issueSeq++}` });

export function lintProject(p: Project, packOverride?: StylePack): LintReport {
  const pack = packOverride ?? effectivePack(getPack(p), p.rules);
  const issues: LintIssue[] = [];
  const checked: string[] = [];
  const dur = projectDuration(p);
  const videoTracks = p.tracks.filter((t) => t.kind === 'video' && !t.hidden);
  const bottomTrack = videoTracks[videoTracks.length - 1];

  /* ---- cuts ---- */
  checked.push('mid-word cuts', 'flash frames / 1-2 frame clips', 'black gaps');
  for (const track of videoTracks) {
    const clips = p.clips.filter((c) => c.trackId === track.id && c.kind === 'media').sort((a, b) => a.start - b.start);
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (c.duration < 0.18 && !c.transitionIn && !c.transitionOut) {
        issues.push(issue({
          code: 'flash_clip', severity: 'error', category: 'cuts', clipId: c.id, time: c.start,
          message: `Flash frame: clip at ${c.start.toFixed(2)}s is only ${Math.round(c.duration * 1000)}ms (< 6 frames).`,
          fix: { label: 'Delete flash clip', actions: [{ type: 'remove_clip', clipId: c.id, ripple: true }] },
        }));
      }
      const next = clips[i + 1];
      if (!next) continue;
      const boundary = c.start + c.duration;
      if (Math.abs(next.start - boundary) > 0.06) continue;
      // mid-word check
      if (c.mediaId === next.mediaId) {
        const ma = p.analysis?.byMedia[c.mediaId ?? ''];
        const srcBoundary = c.inPoint + c.duration * c.speed;
        const word = ma?.transcript?.words.find((w) => srcBoundary > w.start + 0.04 && srcBoundary < w.end - 0.04);
        if (word) {
          const newSrcEnd = word.end + 0.02;
          const delta = (newSrcEnd - srcBoundary) / c.speed;
          issues.push(issue({
            code: 'mid_word_cut', severity: 'error', category: 'cuts', clipId: c.id, time: boundary,
            message: `Cut at ${boundary.toFixed(2)}s lands inside the word "${word.word}".`,
            fix: {
              label: 'Move cut to word end',
              actions: [
                { type: 'trim_clip', clipId: c.id, duration: c.duration + delta },
                { type: 'trim_clip', clipId: next.id, start: next.start + delta, inPoint: next.inPoint + delta * next.speed },
              ],
            },
          }));
        }
      }
      // audio jump
      const ratio = Math.max(c.volume, 0.01) / Math.max(next.volume, 0.01);
      const hasFade = c.fades.out > 0.01 || next.fades.in > 0.01;
      if ((ratio > 2.2 || ratio < 0.45) && !hasFade && getMedia(p, c.mediaId)?.hasAudio) {
        issues.push(issue({
          code: 'audio_jump', severity: 'warning', category: 'audio', clipId: next.id, time: boundary,
          message: `Abrupt audio level jump (${Math.abs(Math.round(20 * Math.log10(ratio)))} dB) at ${boundary.toFixed(2)}s with no crossfade.`,
          fix: { label: 'Add micro-crossfades', actions: [{ type: 'set_fades', clipId: c.id, fadeOut: 0.03 }, { type: 'set_fades', clipId: next.id, fadeIn: 0.03 }] },
        }));
      }
    }
    // black gaps on the bottom track
    if (track.id === bottomTrack?.id) {
      let cursor = 0;
      for (const c of clips) {
        if (c.start - cursor > 0.12) {
          issues.push(issue({
            code: 'black_gap', severity: 'warning', category: 'visual', time: cursor,
            message: `Black frames: no video between ${cursor.toFixed(2)}s and ${c.start.toFixed(2)}s.`,
            fix: { label: 'Close the gap', actions: [{ type: 'ripple_delete_range', start: cursor, end: c.start, trackIds: [track.id] }] },
          }));
        }
        cursor = Math.max(cursor, c.start + c.duration);
      }
    }
  }

  /* ---- audio ---- */
  checked.push('clipping', 'music vs speech level', 'dead air over rule');
  for (const c of p.clips) {
    const ma = p.analysis?.byMedia[c.mediaId ?? ''];
    const asset = getMedia(p, c.mediaId);
    if (!ma || !asset || (asset.type !== 'audio' && !asset.hasAudio)) continue;
    if (c.volume * ma.truePeak > 1.0) {
      const safe = Math.round((0.97 / Math.max(0.05, ma.truePeak)) * 1000) / 1000;
      issues.push(issue({
        code: 'clipping', severity: 'error', category: 'audio', clipId: c.id, time: c.start,
        message: `Clipping risk: "${asset.name}" gain ${c.volume} x peak ${ma.truePeak.toFixed(2)} exceeds 0 dBFS.`,
        fix: { label: `Lower gain to ${safe}`, actions: [{ type: 'set_clip_props', clipId: c.id, patch: { volume: safe } }] },
      }));
    }
    if (asset.type === 'video' && ma.transcript?.words.length) {
      const usedStart = c.inPoint, usedEnd = c.inPoint + c.duration * c.speed;
      const long = ma.silences.filter((s) => s.start >= usedStart - 0.1 && s.end <= usedEnd + 0.1 && s.end - s.start > (pack.pacing.deadAirMaxMs + 250) / 1000);
      for (const s of long.slice(0, 6)) {
        issues.push(issue({
          code: 'dead_air', severity: 'warning', category: 'pacing', clipId: c.id, time: c.start + (s.start - c.inPoint) / c.speed,
          message: `Dead air ${(s.end - s.start).toFixed(1)}s at ${s.start.toFixed(1)}s (source) exceeds the ${pack.pacing.deadAirMaxMs}ms rule.`,
          fix: { label: 'Remove dead air', tool: { name: 'remove_dead_air', params: { max_pause_ms: pack.pacing.deadAirMaxMs } } },
        }));
      }
    }
  }
  const balance = estimateSpeechMusicBalance(p);
  for (const pof of balance.musicOverSpeech.slice(0, 5)) {
    issues.push(issue({
      code: 'music_over_speech', severity: 'warning', category: 'audio', time: pof.time,
      message: `Music is louder than speech at ${pof.time.toFixed(1)}s (${pof.musicDb.toFixed(0)} dB vs ${pof.speechDb.toFixed(0)} dB).`,
      fix: { label: 'Re-duck music', tool: { name: 'add_music', params: {} } },
    }));
  }

  /* ---- captions ---- */
  checked.push('caption overlap', 'safe zone', 'mobile readability', 'caption sync');
  const caps = p.clips.filter((c) => c.kind === 'text' && c.text?.role === 'caption').sort((a, b) => a.start - b.start);
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    const st = c.text!.style;
    const next = caps[i + 1];
    if (next && next.trackId === c.trackId && next.start < c.start + c.duration - 0.03) {
      issues.push(issue({
        code: 'caption_overlap', severity: 'error', category: 'captions', clipId: c.id, time: next.start,
        message: `Captions overlap at ${next.start.toFixed(2)}s ("${c.text!.text.slice(0, 24)}…" / "${next.text!.text.slice(0, 24)}…").`,
        fix: { label: 'Trim first cue', actions: [{ type: 'trim_clip', clipId: c.id, duration: Math.max(0.2, next.start - c.start - 0.02) }] },
      }));
    }
    const margin = pack.captions.safeMargin;
    if (st.y > 1 - margin || st.y < margin || st.x < margin || st.x > 1 - margin) {
      const safeY = Math.min(0.86, Math.max(0.14, st.y > 0.5 ? 1 - margin - 0.06 : margin + 0.06));
      issues.push(issue({
        code: 'caption_safe_zone', severity: 'warning', category: 'captions', clipId: c.id, time: c.start,
        message: `Caption outside the safe zone (y=${st.y.toFixed(2)}) — platform UI may cover it.`,
        fix: { label: 'Move into safe zone', actions: [{ type: 'set_text_style', clipId: c.id, patch: { y: safeY, x: 0.5 } }] },
      }));
    }
    if (st.fontSize < 0.032) {
      issues.push(issue({
        code: 'caption_small', severity: 'warning', category: 'captions', clipId: c.id, time: c.start,
        message: `Caption text is ${(st.fontSize * 100).toFixed(1)}% of frame height — too small to read on a phone.`,
        fix: { label: 'Enlarge to 4.5%', actions: [{ type: 'set_text_style', clipId: c.id, patch: { fontSize: 0.045 } }] },
      }));
    }
    // sync: first word should start within 300ms of cue start
    const w0 = c.text!.words?.[0];
    if (w0 && w0.start > 0.35) {
      issues.push(issue({
        code: 'caption_sync', severity: 'warning', category: 'captions', clipId: c.id, time: c.start,
        message: `Caption appears ${(w0.start * 1000).toFixed(0)}ms before its first word — out of sync.`,
        fix: { label: 'Retime cue', actions: [{ type: 'trim_clip', clipId: c.id, start: c.start + w0.start - 0.05 }] },
      }));
    }
  }
  if (pack.captions.enabled && !caps.length && Object.values(p.analysis?.byMedia ?? ({} as Record<string, MediaAnalysis>)).some((m) => (m.transcript?.words.length ?? 0) > 10)) {
    issues.push(issue({ code: 'captions_missing', severity: 'info', category: 'captions', message: 'Transcript exists but no captions. Social videos perform better with captions.', fix: { label: 'Add captions', tool: { name: 'add_captions', params: {} } } }));
  }

  /* ---- visual / pacing ---- */
  checked.push('aspect mismatch', 'static stretches (retention)', 'hook presence');
  for (const c of p.clips) {
    if (c.kind !== 'media') continue;
    const asset = getMedia(p, c.mediaId);
    if (!asset || asset.type !== 'video') continue;
    const mediaAspect = asset.width / asset.height;
    const projAspect = p.settings.width / p.settings.height;
    if (c.fit === 'fill' && Math.abs(mediaAspect - projAspect) > 0.15) {
      issues.push(issue({
        code: 'aspect_mismatch', severity: 'warning', category: 'visual', clipId: c.id, time: c.start,
        message: `"${asset.name}" is stretched (fill mode, ${mediaAspect.toFixed(2)} vs ${projAspect.toFixed(2)} aspect).`,
        fix: { label: 'Use cover fit', actions: [{ type: 'set_clip_props', clipId: c.id, patch: { fit: 'cover' } }] },
      }));
    }
  }
  // static stretches: no cut, no zoom keyframe, no scene change for > maxStaticSec
  if (bottomTrack) {
    const clips = p.clips.filter((c) => c.trackId === bottomTrack.id && c.kind === 'media').sort((a, b) => a.start - b.start);
    const events: number[] = [0];
    for (const c of clips) {
      events.push(c.start);
      for (const k of c.keyframes) if (k.path === 'transform.scale') events.push(c.start + k.time);
      const ma = p.analysis?.byMedia[c.mediaId ?? ''];
      for (const s of ma?.scenes ?? []) {
        const tl = c.start + (s - c.inPoint) / c.speed;
        if (tl > c.start && tl < c.start + c.duration) events.push(tl);
      }
    }
    events.push(dur);
    events.sort((a, b) => a - b);
    for (let i = 0; i < events.length - 1; i++) {
      const span = events[i + 1] - events[i];
      if (span > pack.pacing.maxStaticSec) {
        issues.push(issue({
          code: 'static_stretch', severity: 'info', category: 'pacing', time: events[i],
          message: `No visual change for ${span.toFixed(1)}s (${events[i].toFixed(1)}s → ${events[i + 1].toFixed(1)}s). Viewers may drop off.`,
          fix: { label: 'Add punch-in zooms', tool: { name: 'zoom_on_emphasis', params: {} } },
        }));
      }
    }
  }
  const hasHook = p.clips.some((c) => c.kind === 'text' && c.text?.role === 'hook' && c.start < 1.5);
  if (pack.hook.enabled && dur > 5 && !hasHook) {
    issues.push(issue({ code: 'hook_missing', severity: 'info', category: 'pacing', time: 0, message: 'No hook title in the first seconds. The first 3s decide whether viewers stay.', fix: { label: 'Add hook title', tool: { name: 'add_hook_title', params: {} } } }));
  }

  /* ---- score ---- */
  const catScore = (cat: LintIssue['category'] | 'hook') => {
    const rel = issues.filter((i) => (cat === 'hook' ? i.code === 'hook_missing' : i.category === cat));
    let s = 100;
    for (const i of rel) s -= i.severity === 'error' ? 25 : i.severity === 'warning' ? 10 : 4;
    return Math.max(0, s);
  };
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const infos = issues.filter((i) => i.severity === 'info').length;
  const score = Math.max(0, 100 - errors * 12 - warnings * 5 - infos * 2);
  const reasons: string[] = [];
  if (errors) reasons.push(`${errors} error${errors === 1 ? '' : 's'} must be fixed (flash frames, mid-word cuts, clipping, overlaps).`);
  if (warnings) reasons.push(`${warnings} warning${warnings === 1 ? '' : 's'} reduce polish.`);
  if (!errors && !warnings) reasons.push('No errors or warnings detected.');
  if (score >= 90) reasons.push('Ready for export.');
  else if (score >= 70) reasons.push('Exportable, but fixes would improve retention.');
  else reasons.push('Fix the issues below before exporting.');

  const mk = (s: number, ex: string): SubScore => ({ score: s, explanation: ex });
  return {
    issues, score, readyToExport: errors === 0 && score >= 70, reasons, checked, at: Date.now(),
    subscores: {
      pacing: mk(catScore('pacing'), `${issues.filter((i) => i.category === 'pacing').length} pacing issues; target avg shot ${pack.pacing.avgShotSec}s, max static ${pack.pacing.maxStaticSec}s.`),
      audio: mk(catScore('audio'), `${issues.filter((i) => i.category === 'audio').length} audio issues; target ${pack.audio.targetLoudness} LUFS, music ducked under speech.`),
      captions: mk(catScore('captions'), `${caps.length} cues checked for overlap, safe zone, size and sync.`),
      hook: mk(hasHook || !pack.hook.enabled ? 100 : 55, hasHook ? 'Hook title present in the opening.' : pack.hook.enabled ? 'No hook in the first 3 seconds.' : 'Hook disabled by pack.'),
      retention: mk(catScore('pacing'), `Static stretches over ${pack.pacing.maxStaticSec}s are drop-off risks; ${issues.filter((i) => i.code === 'static_stretch').length} found.`),
    },
  };
}