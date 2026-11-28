/**
 * Shared audio graph builder. Preview (AudioContext) and export
 * (OfflineAudioContext) use the SAME function, so they sound identical.
 * Handles: volume keyframes, equal-power fades, ducking (baked keyframes),
 * EQ, light de-ess, noise gate / downward-expansion denoise from analysis.
 */
import type { Clip, Project, Track } from './types';
import { getMedia, avgSpeed, sourceTimeOf } from './types';
import { clipVolumeAt } from './render';
import { audioBufferKey } from './audioTracks';

/**
 * Is this track's audio audible right now?
 * Muted tracks are always silent. Solo wins over mute-by-other: when at least
 * one track of a kind is soloed, only the soloed tracks of that kind play.
 * Text tracks never carry audio.
 */
export function trackAudible(p: Project, track: Track | undefined): boolean {
  if (!track || track.kind === 'text') return false;
  if (track.muted) return false;
  const soloed = p.tracks.filter((t) => t.kind === track.kind && t.solo);
  if (!soloed.length) return true;
  // Plain solo is exclusive; Shift+click marks tracks additive so several
  // tracks of the same kind can be heard together (Kdenlive mixer).
  const additive = soloed.some((t) => t.soloMode === 'additive');
  return additive ? soloed.some((t) => t.id === track.id) : !!track.solo;
}

export interface AudioGraphHandle {
  stop(): void;
  sources: AudioBufferSourceNode[];
  master: GainNode;
}

export interface AudioGraphOpts {
  startAt: number; // timeline time to begin
  when: number; // context time at which startAt plays
  endAt?: number; // timeline end (default: project end)
  /** Preview-only speed multiplier. Export never passes this option. */
  previewRate?: number;
}

function fadeFactor(clip: Clip, localT: number): number {
  let f = 1;
  if (clip.fades.in > 0 && localT < clip.fades.in) f *= Math.sqrt(Math.max(0, localT / clip.fades.in));
  if (clip.fades.out > 0 && localT > clip.duration - clip.fades.out) f *= Math.sqrt(Math.max(0, (clip.duration - localT) / clip.fades.out));
  return f;
}

/** Gate/denoise gain from the analyzed loudness envelope (10 Hz). */
function envelopeGate(p: Project, clip: Clip, sourceT: number): number {
  const gate = clip.effects.find((e) => e.enabled && (e.type === 'gate' || e.type === 'denoise'));
  if (!gate) return 1;
  const ma = p.analysis?.byMedia[clip.mediaId ?? ''];
  if (!ma || !ma.loudness.length) return 1;
  const idx = Math.max(0, Math.min(ma.loudness.length - 1, Math.round(sourceT * 10)));
  const rms = ma.loudness[idx].rms;
  const db = rms > 0 ? 20 * Math.log10(rms) : -100;
  const thr = typeof gate.params.thresholdDb === 'number' ? gate.params.thresholdDb : -45;
  if (db >= thr) return 1;
  const floor = gate.type === 'denoise' ? 0.18 : 0.0;
  const soft = 6; // dB soft knee
  if (db >= thr - soft) return floor + (1 - floor) * ((db - (thr - soft)) / soft);
  return floor;
}

export function buildAudioGraph(
  p: Project,
  ctx: BaseAudioContext,
  dest: AudioNode,
  buffers: Map<string, AudioBuffer>,
  opts: AudioGraphOpts
): AudioGraphHandle {
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(dest);
  const sources: AudioBufferSourceNode[] = [];
  let projectEnd = 0;
  for (const c of p.clips) projectEnd = Math.max(projectEnd, c.start + c.duration);
  const startAt = opts.startAt;
  const endAt = opts.endAt ?? projectEnd;
  const trackGain = new Map<string, GainNode>();

  for (const clip of p.clips) {
    const track = p.tracks.find((t) => t.id === clip.trackId);
    if (!track || !trackAudible(p, track)) continue;
    const asset = getMedia(p, clip.mediaId);
    if (!asset) continue;
    // Per-clip track choice: the same source can use Hindi in one clip and
    // English in another. Never silently fall back to the default mix when a
    // track was explicitly chosen — that would play the wrong language.
    const buffer = clip.mediaId
      ? buffers.get(audioBufferKey(clip.mediaId, clip.audioTrackId))
      : undefined;
    // Buffer presence is ground truth. The hasAudio flag comes from best-effort
    // probing and is often false for videos that DO have audio tracks (Chromium
    // reports 0 decoded audio bytes until an element plays) — trusting it here
    // silently muted such videos. A decoded buffer for a silent video simply
    // plays silence, which is harmless; skipping a real buffer is not.
    if (!buffer) continue;
    const clipEnd = clip.start + clip.duration;
    if (clipEnd <= startAt + 1e-4 || clip.start >= endAt - 1e-4) continue;

    const from = Math.max(clip.start, startAt);
    const to = Math.min(clipEnd, endAt);
    const offsetInClip = from - clip.start;
    // Under a speed ramp a constant-rate source can only follow the ramp's
    // AVERAGE speed — edges line up, some drift inside (documented honestly).
    const effSpeed = avgSpeed(clip);
    // Reversed clips play a genuinely REVERSED copy of the buffer (index 0 =
    // original end). In that copy, timeline-forward = sample-forward, and the
    // clip "starts" at its source END anchor: inPoint + consumed.
    let playBuffer = buffer;
    let bufferOffset: number;
    if (clip.reversed) {
      playBuffer = reversedBuffer(buffer);
      const endPos = clip.inPoint + avgSpeed(clip) * clip.duration;
      const s0 = endPos - offsetInClip * effSpeed; // source position at `from`
      bufferOffset = Math.max(0, Math.min(playBuffer.duration - 0.01, playBuffer.duration - s0));
    } else {
      bufferOffset = Math.min(buffer.duration - 0.01, clip.inPoint + offsetInClip * effSpeed);
    }
    const playDur = Math.min((to - from) * effSpeed, buffer.duration - bufferOffset);
    if (playDur <= 0.01) continue;
    const when = opts.when + (from - startAt);
    const rate = Math.max(0.1, Math.min(8, opts.previewRate ?? 1));

    const src = ctx.createBufferSource();
    src.buffer = playBuffer;
    src.playbackRate.value = Math.max(0.1, Math.min(8, effSpeed * rate));
    // Web Audio pitch preservation: when enabled, stretching stays at the
    // original pitch instead of raising/lowering voices with the speed.
    try {
      (src as AudioBufferSourceNode & { preservesPitch?: boolean }).preservesPitch = clip.preservePitch ?? false;
    } catch { /* not supported in this browser */ }

    let node: AudioNode = src;
    for (const e of clip.effects) {
      if (!e.enabled) continue;
      if (e.type === 'eq') {
        const hp = typeof e.params.highpass === 'number' ? e.params.highpass : 0;
        if (hp > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
        const lp = typeof e.params.lowpass === 'number' ? e.params.lowpass : 0;
        if (lp > 0) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
        const g = typeof e.params.gain === 'number' ? e.params.gain : 0;
        if (g !== 0) { const f = ctx.createBiquadFilter(); f.type = 'peaking'; f.frequency.value = 1000; f.gain.value = g; node.connect(f); node = f; }
      } else if (e.type === 'deess') {
        const f = ctx.createBiquadFilter();
        f.type = 'highshelf'; f.frequency.value = 6200;
        f.gain.value = typeof e.params.reduction === 'number' ? -Math.abs(e.params.reduction) : -4;
        node.connect(f); node = f;
      } else if (e.type === 'denoise') {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = typeof e.params.lowpass === 'number' ? e.params.lowpass : 13000;
        node.connect(f); node = f;
      } else if (e.type === 'compressor') {
        // Kdenlive `avfilter.acompressor` — native Web Audio dynamics compressor.
        const c = ctx.createDynamicsCompressor();
        c.threshold.value = typeof e.params.thresholdDb === 'number' ? e.params.thresholdDb : -24;
        c.ratio.value = typeof e.params.ratio === 'number' ? Math.max(1, e.params.ratio) : 4;
        c.knee.value = 12; c.attack.value = 0.01; c.release.value = 0.25;
        node.connect(c); node = c;
      } else if (e.type === 'limiter') {
        // Kdenlive `avfilter.alimiter` / `limiter` — hard ceiling via brick-wall compressor.
        const c = ctx.createDynamicsCompressor();
        c.threshold.value = typeof e.params.ceilingDb === 'number' ? e.params.ceilingDb : -1;
        c.ratio.value = 20; c.knee.value = 0; c.attack.value = 0.003; c.release.value = 0.1;
        node.connect(c); node = c;
      } else if (e.type === 'echo') {
        // Kdenlive `avfilter.aecho` — delay + feedback + wet mix (dry always passes).
        const delayMs = typeof e.params.delayMs === 'number' ? e.params.delayMs : 250;
        const fb = typeof e.params.feedback === 'number' ? e.params.feedback : 0.3;
        const mix = typeof e.params.mix === 'number' ? e.params.mix : 0.35;
        const delay = ctx.createDelay(2);
        delay.delayTime.value = Math.max(0.005, Math.min(2, delayMs / 1000));
        const fbGain = ctx.createGain();
        fbGain.gain.value = Math.max(0, Math.min(0.9, fb));
        const wet = ctx.createGain(); wet.gain.value = Math.max(0, Math.min(1, mix));
        node.connect(delay); delay.connect(fbGain); fbGain.connect(delay);
        delay.connect(wet);
        const sum = ctx.createGain();
        node.connect(sum); wet.connect(sum); node = sum;
      } else if (e.type === 'pan') {
        // Kdenlive `panner` / `audiobalance` — stereo pan -1 (L) .. 1 (R).
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, typeof e.params.pan === 'number' ? e.params.pan : 0));
        node.connect(panner); node = panner;
      }
    }

    const gain = ctx.createGain();
    node.connect(gain);
    let tg = trackGain.get(track.id);
    if (!tg) { tg = ctx.createGain(); tg.gain.value = 1; tg.connect(master); trackGain.set(track.id, tg); }
    gain.connect(tg);

    // schedule gain automation at 50 Hz (covers fades, ducking, keyframes, gate)
    const steps = Math.max(2, Math.ceil((to - from) * 50));
    const hasEnvGate = clip.effects.some((e) => e.enabled && (e.type === 'gate' || e.type === 'denoise'));
    gain.gain.setValueAtTime(0.0001, when);
    for (let i = 0; i <= steps; i++) {
      const tl = from + ((to - from) * i) / steps;
      const localT = tl - clip.start;
      const sourceT = sourceTimeOf(clip, tl);
      let v = clipVolumeAt(clip, localT) * fadeFactor(clip, localT);
      if (hasEnvGate) v *= envelopeGate(p, clip, sourceT);
      // Automation is in context (wall-clock) time. Preview rate shortens the
      // wall-clock duration of a timeline span, so divide by it to keep fades
      // and keyframes aligned with the picture; export rate is always 1.
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, v), when + (tl - from) / rate);
    }
    try {
      src.start(when, bufferOffset, playDur);
      sources.push(src);
    } catch { /* buffer offset out of range — skip */ }
  }

  return {
    sources,
    master,
    stop() {
      for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } }
      try { master.disconnect(); } catch { /* noop */ }
    },
  };
}

/** Cache of genuinely reversed AudioBuffers (weak: freed with the original).
 * Reversing is O(samples) — done once per buffer, not per playback. */
const reversedBufCache = new WeakMap<AudioBuffer, AudioBuffer>();

function reversedBuffer(original: AudioBuffer): AudioBuffer {
  const cached = reversedBufCache.get(original);
  if (cached) return cached;
  const out = new AudioBuffer({
    length: original.length,
    sampleRate: original.sampleRate,
    numberOfChannels: original.numberOfChannels,
  });
  for (let ch = 0; ch < original.numberOfChannels; ch++) {
    const src = original.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  reversedBufCache.set(original, out);
  return out;
}

/** Rough integrated loudness of the mixed timeline, for lint (uses analysis envelopes). */export function estimateSpeechMusicBalance(p: Project): { musicOverSpeech: { time: number; musicDb: number; speechDb: number }[] } {
  const out: { time: number; musicDb: number; speechDb: number }[] = [];
  const audioTracks = p.tracks.filter((t) => t.kind === 'audio' && trackAudible(p, t));
  const musicClips = p.clips.filter((c) => audioTracks.some((t) => t.id === c.trackId) && getMedia(p, c.mediaId)?.type === 'audio');
  const speechClips = p.clips.filter((c) => {
    const a = getMedia(p, c.mediaId);
    return a?.type === 'video' && a.hasAudio && trackAudible(p, p.tracks.find((t) => t.id === c.trackId));
  });
  for (const mc of musicClips) {
    for (let tl = mc.start; tl < mc.start + mc.duration; tl += 0.5) {
      const localT = tl - mc.start;
      const mv = clipVolumeAt(mc, localT) * fadeFactor(mc, localT);
      const overlapping = speechClips.filter((sc) => tl >= sc.start && tl < sc.start + sc.duration);
      if (!overlapping.length) continue;
      const sv = Math.max(...overlapping.map((sc) => clipVolumeAt(sc, tl - sc.start) * fadeFactor(sc, tl - sc.start)));
      const musicDb = 20 * Math.log10(Math.max(1e-4, mv));
      const speechDb = 20 * Math.log10(Math.max(1e-4, sv));
      if (musicDb > speechDb - 8) out.push({ time: tl, musicDb, speechDb });
    }
  }
  return { musicOverSpeech: out };
}