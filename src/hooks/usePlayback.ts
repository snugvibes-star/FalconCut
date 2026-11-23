/**
 * Preview playback engine. One rAF clock advances the playhead; the media
 * pool keeps video elements in sync for frames, and a Web Audio graph (built
 * from the SAME engine used by export) plays the mixed audio. Seeking pauses
 * first, so the audio graph and clock never fight.
 *
 * Robustness:
 * - Buffers that finish decoding AFTER play starts (large files, slow decode)
 *   trigger a graph rebuild at the current playhead instead of staying silent.
 * - A 250 ms interval clock backs up rAF, so playback keeps advancing when the
 *   browser throttles rAF (occluded / unfocused window) — video elements are
 *   re-synced against the same clock, so audio and picture stay in step.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { buildAudioGraph, activeClips, projectDuration, getMedia, trackAudible, type AudioGraphHandle, type Clip, type MediaAsset } from '../../engine';

function activeWithAssets(project: ReturnType<typeof useStore.getState>['project'], t: number) {
  const out: { clip: Clip; asset: MediaAsset }[] = [];
  for (const clip of activeClips(project, t)) {
    const asset = getMedia(project, clip.mediaId);
    if (asset) out.push({ clip, asset });
  }
  return out;
}

export function usePlayback() {
  const ctxRef = useRef<AudioContext | null>(null);
  const graphRef = useRef<AudioGraphHandle | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const rebuildTimer = useRef<number | null>(null);
  /** Audio-clock anchor: playhead = startAt + (ctx.currentTime - when).
   * rAF (and setInterval) are throttled in background windows, but the audio
   * clock keeps running — anchoring to it keeps picture and sound in step
   * instead of drifting at ~0.3× speed when the window is occluded. */
  const anchorRef = useRef<{ startAt: number; when: number } | null>(null);

  useEffect(() => {
    const stopAudio = () => {
      if (rebuildTimer.current) { clearTimeout(rebuildTimer.current); rebuildTimer.current = null; }
      graphRef.current?.stop();
      graphRef.current = null;
      anchorRef.current = null;
    };

    const startAudio = (at: number) => {
      const s = useStore.getState();
      let ctx = ctxRef.current;
      if (!ctx) { ctx = new AudioContext(); ctxRef.current = ctx; }
      if (ctx.state === 'suspended') void ctx.resume();
      stopAudio();
      const buffers = new Map<string, AudioBuffer>();
      for (const m of s.project.media) {
        const b = s.pool.getBuffer(m.id);
        if (b) buffers.set(m.id, b);
      }
      try {
        const when = ctx.currentTime + 0.03;
        graphRef.current = buildAudioGraph(s.project, ctx, ctx.destination, buffers, {
          startAt: at, when, previewRate: useUI.getState().previewRate,
        });
        anchorRef.current = { startAt: at, when };
      } catch { /* audio unavailable for this container; preview stays silent */ }
      // Element-audio fallback: codecs the browser cannot decode (e.g. AC3 in
      // MP4) never produce a buffer, so the graph has no source for them.
      // Unmute the video element so its own audio plays; clip volume is
      // applied approximately (fades/EQ do not affect element audio).
      for (const clip of s.project.clips) {
        const track = s.project.tracks.find((t) => t.id === clip.trackId);
        const asset = getMedia(s.project, clip.mediaId);
        if (!trackAudible(s.project, track) || !asset || asset.type !== 'video') continue;
        const el = s.pool.elementFor(asset.id);
        if (el && s.pool.decodeFailedFor(asset.id)) {
          el.muted = false;
          el.volume = Math.max(0, Math.min(1, clip.volume ?? 1));
        }
      }
    };

    /** Rebuild the audio graph once late-decoded buffers arrive, so a clip
     * never stays silent just because decoding finished after play started. */
    const scheduleRebuild = () => {
      if (!useStore.getState().playing) return;
      if (rebuildTimer.current) clearTimeout(rebuildTimer.current);
      rebuildTimer.current = window.setTimeout(() => {
        rebuildTimer.current = null;
        if (!useStore.getState().playing) return;
        startAudio(useStore.getState().playhead);
      }, 200);
    };

    /** Playhead from the audio clock when anchored, else dt accumulation. */
    const clockTime = (): number => {
      const a = anchorRef.current;
      const ctx = ctxRef.current;
      if (a && ctx && ctx.state === 'running') {
        return a.startAt + Math.max(0, ctx.currentTime - a.when) * useUI.getState().previewRate;
      }
      return -1;
    };

    /** Stop or loop when the playhead reaches the zone's out point (or the
     * project end). Loop restarts the audio graph at zone.in — pause() then
     * play() reuses the normal subscribe paths so picture+sound stay in step. */
    const endAtZoneOrEnd = (s: ReturnType<typeof useStore.getState>, t: number) => {
      const dur = projectDuration(s.project);
      const z = s.zone;
      const stopT = z ? Math.min(z.out, dur) : dur;
      if (t < stopT) return false;
      if (z && z.loop && z.out < dur - 0.01 && stopT > z.in + 0.05) {
        s.pause();
        s.setPlayhead(z.in, { fromPlayback: true });
        s.play();
        return true;
      }
      s.setPlayhead(stopT, { fromPlayback: true });
      s.pool.syncPlayback(activeWithAssets(s.project, stopT), stopT, false, useUI.getState().previewRate);
      s.pause();
      return true;
    };

    const tick = (_now: number) => {
      const s = useStore.getState();
      if (!s.playing) return;
      lastRef.current = performance.now();
      const dur = projectDuration(s.project);
      const clock = clockTime();
      const t = clock >= 0 ? clock : s.playhead + 0.016;
      if (endAtZoneOrEnd(s, t)) return;
      if (t > s.playhead) s.setPlayhead(t, { fromPlayback: true });
      s.pool.syncPlayback(activeWithAssets(s.project, t), t, true, useUI.getState().previewRate);
      rafRef.current = requestAnimationFrame(tick);
    };

    /** Fallback clock: when rAF is throttled (window occluded), rAF stops
     * firing but real time passes — the audio-clock anchor keeps advancing
     * exactly; without an anchor (undecodable audio) we advance by the
     * measured gap instead of freezing the playhead. */
    const fallback = window.setInterval(() => {
      const s = useStore.getState();
      if (!s.playing) return;
      const gap = (performance.now() - lastRef.current) / 1000;
      const clock = clockTime();
      if (clock >= 0) {
        if (gap < 0.3) return; // rAF tick is handling it
        lastRef.current = performance.now();
        if (endAtZoneOrEnd(s, clock)) return;
        s.setPlayhead(clock, { fromPlayback: true });
        s.pool.syncPlayback(activeWithAssets(s.project, clock), clock, true, useUI.getState().previewRate);
        return;
      }
      if (gap < 0.3) return; // rAF is healthy
      lastRef.current = performance.now();
      const t = s.playhead + Math.min(0.3, gap);
      if (endAtZoneOrEnd(s, t)) return;
      s.setPlayhead(t, { fromPlayback: true });
      s.pool.syncPlayback(activeWithAssets(s.project, t), t, true, useUI.getState().previewRate);
    }, 250);

    let prevPlaying = useStore.getState().playing;
    let prevProject = useStore.getState().project;
    /** Rebuild the audio graph when the project changes mid-playback (undo,
     * speed/volume/mute edits) — otherwise the playing audio ignores them
     * until the user stops and replays. Debounced; skips no-op changes. */
    let lastSig = '';
    const audioSig = (s: ReturnType<typeof useStore.getState>): string => {
      const parts: string[] = [];
      for (const c of s.project.clips) {
        const track = s.project.tracks.find((t) => t.id === c.trackId);
        // Every field the audio graph reads must be here: fades, keyframes,
        // speed ramps, DSP effects and pitch settings all change live sound.
        parts.push(JSON.stringify([
          c.id, c.start, c.duration, c.volume, c.speed, c.mediaId, c.inPoint,
          c.fades, c.speedPoints, c.preservePitch, c.reversed,
          c.keyframes.map((k) => [k.path, k.time, k.value]),
          c.effects.map((e) => [e.id, e.type, e.enabled, e.params]),
          track ? (trackAudible(s.project, track) ? 0 : 1) : 2,
        ]));
      }
      return parts.join('|');
    };
    const unsub = useStore.subscribe((s) => {
      if (s.playing === prevPlaying) {
        // Same playing state but a new project object → maybe audio-affecting edit.
        if (s.playing && s.project !== prevProject) {
          const sig = audioSig(s);
          if (sig !== lastSig) {
            lastSig = sig;
            scheduleRebuild();
          }
        }
        prevProject = s.project;
        return;
      }
      prevPlaying = s.playing;
      prevProject = s.project;
      if (s.playing) {
        lastSig = audioSig(s);
        startAudio(s.playhead);
        lastRef.current = performance.now();
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stopAudio();
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        s.pool.pauseAll();
        s.pool.muteAllElements();
        s.pool.syncPlayback(activeWithAssets(s.project, s.playhead), s.playhead, false, useUI.getState().previewRate);
      }
    });

    // Late audio decodes (register/analyze can finish after play started).
    useStore.getState().pool.onBufferReady = scheduleRebuild;

    // Preview rate changes rebuild the audio graph at the new rate. Export is
    // unaffected because it never reads UI state.
    const unsubUI = useUI.subscribe((ui, prev) => {
      if (ui.previewRate !== prev.previewRate && useStore.getState().playing) {
        startAudio(useStore.getState().playhead);
      }
    });

    return () => {
      unsub();
      unsubUI();
      useStore.getState().pool.onBufferReady = null;
      window.clearInterval(fallback);
      stopAudio();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);
}
