/**
 * Audio tools: add_music (auto-ducking under speech), balance_audio
 * (loudness normalization + gate), cleanup_audio (browser DSP chain).
 */
import type { Action } from '../engine/actions';
import type { Clip } from '../engine/types';
import { getMedia, projectDuration, uid } from '../engine/types';
import type { ToolContext, ToolResult } from './cutTools';
import { firstAudioTrack, speechClips, sourceToTimeline } from './helpers';

export function addMusic(ctx: ToolContext, params: { mediaId?: string; mood?: 'chill' | 'balanced' | 'energetic' } = {}): ToolResult {
  const p = ctx.project;
  const candidates = p.media.filter((m) => m.type === 'audio');
  const asset = params.mediaId ? candidates.find((m) => m.id === params.mediaId) : candidates.find((m) => !p.clips.some((c) => c.mediaId === m.id)) ?? candidates[0];
  if (!asset) {
    return { actions: [], summary: 'No music imported yet. Import an audio file into the media library first, then run add_music.', warnings: ['The editor cannot fetch files by itself — import music via the Media panel (or connect a stock API key).'] };
  }
  const trackId = firstAudioTrack(p);
  if (!trackId) return { actions: [], summary: 'No audio track available.' };
  const warnings: string[] = [];
  const moodMul = params.mood === 'chill' ? 0.75 : params.mood === 'energetic' ? 1.25 : 1;
  const level = Math.min(0.6, ctx.pack.music.level * moodMul);
  const duck = Math.min(level * 0.6, ctx.pack.music.duckLevel * moodMul);
  const total = projectDuration(p);
  const actions: Action[] = [];
  // remove previous music clips on audio tracks (idempotent)
  for (const c of p.clips) {
    if (c.trackId === trackId && getMedia(p, c.mediaId)?.type === 'audio') actions.push({ type: 'remove_clip', clipId: c.id });
  }
  // lay music across the timeline, looping if shorter
  const musicClips: { id: string; start: number; duration: number }[] = [];
  let t = 0;
  while (t < total - 0.1) {
    const dur = Math.min(asset.duration, total - t);
    // Guard against unprobeable audio (asset.duration === 0): without this the
    // loop never advances and hangs the tab. Also cap repeats like Kdenlive.
    if (dur < 0.05) { warnings.push(`"${asset.name}" has no readable duration — skipped (convert to WAV or AAC first).`); break; }
    if (musicClips.length >= 64) { warnings.push('Music loop capped at 64 repeats.'); break; }
    const id = uid('clip');
    actions.push({ type: 'add_clip', clip: { id, trackId, mediaId: asset.id, start: t, duration: dur, inPoint: 0, volume: level, fades: { in: 0.4, out: 0 } } });
    musicClips.push({ id, start: t, duration: dur });
    t += dur;
  }
  if (musicClips.length) {
    const last = musicClips[musicClips.length - 1];
    actions.push({ type: 'set_fades', clipId: last.id, fadeOut: Math.min(1.2, last.duration / 2) });
  }
  // ducking keyframes from speech activity
  const attack = ctx.pack.music.duckAttackMs / 1000;
  const release = ctx.pack.music.duckReleaseMs / 1000;
  let duckPoints = 0;
  const speechRegions: { start: number; end: number }[] = [];
  for (const sc of speechClips(p)) {
    const ma = p.analysis!.byMedia[sc.mediaId!];
    if (!ma) continue;
    const words = ma.transcript?.words;
    if (words?.length) {
      // speech = word spans merged with small gaps
      let rs = words[0].start, re = words[0].end;
      for (const w of words.slice(1)) {
        if (w.start - re < 0.9) re = w.end;
        else { speechRegions.push({ start: rs, end: re }); rs = w.start; re = w.end; }
      }
      speechRegions.push({ start: rs, end: re });
    } else {
      for (const s of ma.silences) speechRegions.push({ start: s.end, end: s.end }); // placeholder, replaced below
      speechRegions.length = 0;
      // use inverse of silences
      let cursor = 0;
      for (const s of [...ma.silences].sort((a, b) => a.start - b.start)) {
        if (s.start > cursor + 0.3) speechRegions.push({ start: cursor, end: s.start });
        cursor = s.end;
      }
      if (cursor < ma.duration - 0.3) speechRegions.push({ start: cursor, end: ma.duration });
    }
    // map to timeline — transcript times are asset-relative; sourceToTimeline
    // already compensates for the clip's inPoint, so add nothing here.
    for (const r of speechRegions) {
      const ts = sourceToTimeline(p, sc.mediaId!, r.start);
      const te = sourceToTimeline(p, sc.mediaId!, r.end);
      if (ts != null && te != null) { r.start = ts; r.end = te; }
      else { r.start = -1; r.end = -1; }
    }
  }
  const regions = speechRegions.filter((r) => r.start >= 0).sort((a, b) => a.start - b.start);
  for (const mc of musicClips) {
    const mcEnd = mc.start + mc.duration;
    const kf = (time: number, value: number) => {
      actions.push({ type: 'add_keyframe', clipId: mc.id, path: 'volume', time: Math.max(0, Math.min(mc.duration, time - mc.start)), value, easing: 'easeInOut' });
      duckPoints++;
    };
    kf(mc.start, level);
    for (const r of regions) {
      if (r.end < mc.start || r.start > mcEnd) continue;
      const down = Math.max(mc.start + 0.05, r.start - attack);
      const up = Math.min(mcEnd - 0.05, r.end + release);
      if (down > mc.start + 0.05) kf(down - 0.02, level);
      kf(down + attack * 0.9, duck);
      if (up - down > attack + 0.1) kf(Math.max(down + attack, up - release * 0.8), duck);
      kf(up, level);
    }
    kf(mcEnd - 0.02, level);
  }
  return {
    actions,
    summary: `Added "${asset.name}" as a music bed at ${Math.round(level * 100)}% (${params.mood ?? 'balanced'} mood), auto-ducked to ${Math.round(duck * 100)}% under speech with ${Math.round(attack * 1000)}ms attack / ${Math.round(release * 1000)}ms release.${musicClips.length > 1 ? ` Looped ${musicClips.length}x to cover the timeline.` : ''}`,
    stats: { level, duckLevel: duck, duckPoints, loops: musicClips.length },
    warnings: warnings.length ? warnings : undefined,
  };
}

export function balanceAudio(ctx: ToolContext): ToolResult {
  const p = ctx.project;
  const target = ctx.pack.audio.targetLoudness;
  const actions: Action[] = [];
  const warnings: string[] = [];
  let normalized = 0;
  for (const clip of p.clips) {
    if (clip.kind !== 'media') continue;
    const asset = getMedia(p, clip.mediaId);
    const ma = p.analysis?.byMedia[clip.mediaId ?? ''];
    if (!asset || !ma || (asset.type !== 'audio' && !asset.hasAudio)) continue;
    if (asset.type === 'audio') {
      // music: normalize relative to its own loudness, then apply pack level
      const gain = Math.pow(10, (target - ma.integratedLoudness) / 20);
      const vol = Math.max(0.02, Math.min(1, ctx.pack.music.level * gain));
      actions.push({ type: 'set_clip_props', clipId: clip.id, patch: { volume: Math.round(vol * 1000) / 1000 } });
      continue;
    }
    let gain = Math.pow(10, (target - ma.integratedLoudness) / 20);
    gain = Math.max(0.15, Math.min(6, gain));
    if (gain * ma.truePeak > 0.97) {
      gain = 0.97 / Math.max(0.05, ma.truePeak);
      warnings.push(`${asset.name}: gain limited to avoid clipping (true peak ${ma.truePeak.toFixed(2)}).`);
    }
    actions.push({ type: 'set_clip_props', clipId: clip.id, patch: { volume: Math.round(gain * 1000) / 1000 } });
    // light noise gate + high-pass cleanup (idempotent: replace existing)
    for (const e of clip.effects) if (e.type === 'gate' || e.type === 'eq') actions.push({ type: 'remove_effect', clipId: clip.id, effectId: e.id });
    actions.push({ type: 'add_effect', clipId: clip.id, effect: { type: 'eq', params: { highpass: 80 } } });
    actions.push({ type: 'add_effect', clipId: clip.id, effect: { type: 'gate', params: { thresholdDb: ctx.pack.audio.gateThresholdDb } } });
    normalized++;
  }
  return {
    actions,
    summary: normalized ? `Normalized ${normalized} clip${normalized === 1 ? '' : 's'} to ${target} LUFS (K-weighted measurement), added 80Hz high-pass + light noise gate. Music set to pack level.` : 'No analyzed audio clips found.',
    stats: { normalized, targetLufs: target },
    warnings,
  };
}

export function cleanupAudio(ctx: ToolContext, params: { denoise?: boolean; deess?: boolean; degate?: boolean } = {}): ToolResult {
  const p = ctx.project;
  const actions: Action[] = [];
  let n = 0;
  for (const clip of speechClips(p)) {
    for (const e of clip.effects) if (['denoise', 'deess', 'gate'].includes(e.type)) actions.push({ type: 'remove_effect', clipId: clip.id, effectId: e.id });
    if (params.denoise !== false) actions.push({ type: 'add_effect', clipId: clip.id, effect: { type: 'denoise', params: { thresholdDb: ctx.pack.audio.gateThresholdDb + 4, lowpass: 13000 } } });
    if (params.deess !== false) actions.push({ type: 'add_effect', clipId: clip.id, effect: { type: 'deess', params: { reduction: 4 } } });
    actions.push({ type: 'add_effect', clipId: clip.id, effect: { type: 'eq', params: { highpass: 90 } } });
    n++;
  }
  return {
    actions,
    summary: n ? `Applied browser DSP cleanup to ${n} speech clip${n === 1 ? '' : 's'}: downward-expansion noise reduction, light de-ess (6.2kHz shelf), 90Hz high-pass. This is conservative DSP — not ML source separation.` : 'No speech clips found.',
    stats: { clips: n },
    warnings: ['Heavy noise removal / voice isolation (ML) is not reliable in-browser yet; this chain is a light, safe cleanup.'],
  };
}