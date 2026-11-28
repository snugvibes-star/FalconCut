import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  createProject, applyActions, buildAudioGraph, audioBufferKey,
  probeAudioTracks, decodeMp4AudioTrack, AudioTrackDecodeError,
  type MediaAsset,
} from '../engine';

/* Node has no Web Audio. buildAudioGraph only needs gain/source nodes and an
 * AudioParam-shaped object for the paths exercised here (no DSP effects). */
class Param {
  value = 0;
  setValueAtTime() { /* no-op */ }
  linearRampToValueAtTime() { /* no-op */ }
}
class Node {
  connect() { return this; }
  disconnect() { /* no-op */ }
}
class FakeCtx {
  sources: any[] = [];
  gains: any[] = [];
  createGain() { const n = new Node() as any; n.gain = new Param(); this.gains.push(n); return n; }
  createBufferSource() {
    const n = new Node() as any;
    n.buffer = null;
    n.playbackRate = new Param();
    n.start = (...args: unknown[]) => { n.started = args; };
    n.stop = () => { /* no-op */ };
    this.sources.push(n);
    return n;
  }
}

const buffer = (): AudioBuffer => ({
  duration: 4, length: 4 * 48000, numberOfChannels: 1, sampleRate: 48000,
  getChannelData: () => new Float32Array(4 * 48000),
}) as unknown as AudioBuffer;

const asset: MediaAsset = {
  id: 'movie', name: 'dubbed.mp4', type: 'video', duration: 8,
  width: 640, height: 360, hasAudio: true, source: 'file',
  audioTracks: [
    { id: 2, index: 1, codec: 'mp4a.40.2', language: 'eng', channels: 1, sampleRate: 48000 },
    { id: 3, index: 2, codec: 'mp4a.40.2', language: 'hin', channels: 1, sampleRate: 48000 },
  ],
};

function projectWithTrack(trackId?: number) {
  let p = createProject('Audio tracks', '16:9');
  p = applyActions(p, [
    { type: 'add_media', asset },
    { type: 'add_clip', clip: { trackId: p.tracks[0].id, mediaId: 'movie', start: 0, duration: 4, inPoint: 0, audioTrackId: trackId } },
  ]);
  return p;
}

describe('per-clip audio track selection', () => {
  it('keys default and selected-track buffers separately', () => {
    expect(audioBufferKey('movie')).toBe('movie');
    expect(audioBufferKey('movie', 3)).toBe('movie#3');
  });

  it('plays the explicitly selected language track', () => {
    const ctx = new FakeCtx();
    const selected = buffer();
    const graph = buildAudioGraph(
      projectWithTrack(3), ctx as any, new Node() as any,
      new Map([['movie#3', selected]]),
      { startAt: 0, when: 0 },
    );
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].buffer).toBe(selected);
    graph.stop();
  });

  it('never silently substitutes the default mix for a missing selected track', () => {
    const ctx = new FakeCtx();
    const graph = buildAudioGraph(
      projectWithTrack(3), ctx as any, new Node() as any,
      new Map([['movie', buffer()]]),
      { startAt: 0, when: 0 },
    );
    expect(ctx.sources).toHaveLength(0);
    graph.stop();
  });

  it('applies a real track gain in the shared audio graph', () => {
    let p = createProject('Gain', '16:9');
    const trackId = p.tracks.find((t) => t.kind === 'video')!.id;
    p = applyActions(p, [
      { type: 'add_media', asset: asset },
      { type: 'set_track', trackId, patch: { volume: 0.5 } },
      { type: 'add_clip', clip: { trackId, mediaId: 'movie', start: 0, duration: 4, inPoint: 0 } },
    ]);
    const ctx = new FakeCtx();
    buildAudioGraph(p, ctx as any, new Node() as any, new Map([['movie', buffer()]]), { startAt: 0, when: 0 });
    // master, clip gain, track gain — a track gain node must carry 0.5.
    expect(ctx.gains.some((g) => Math.abs(g.gain.value - 0.5) < 1e-9)).toBe(true);
  });

  it('older clips with no selection still use the whole-file buffer', () => {
    const ctx = new FakeCtx();
    const def = buffer();
    const graph = buildAudioGraph(
      projectWithTrack(), ctx as any, new Node() as any,
      new Map([['movie', def]]),
      { startAt: 0, when: 0 },
    );
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].buffer).toBe(def);
    graph.stop();
  });
});

const QA_FILE = 'C:/Users/Nexus Computer/AppData/Local/Temp/opencode/falconcut-qa/test-multiaudio.mp4';

describe('MP4 audio track probing', () => {
  it('lists every audio track from the header without reading media data', async () => {
    if (!existsSync(QA_FILE)) return; // QA asset is not shipped with the repo
    const blob = new Blob([readFileSync(QA_FILE)], { type: 'video/mp4' });
    const tracks = await probeAudioTracks(blob, 'test-multiaudio.mp4');
    expect(tracks).toHaveLength(2);
    expect(tracks!.map((t) => t.id)).toEqual([2, 3]);
    expect(tracks!.some((t) => /hin/i.test(t.language))).toBe(true);
    expect(tracks!.every((t) => t.codec.startsWith('mp4a'))).toBe(true);
  });

  it('reports undecodable tracks honestly when WebCodecs is unavailable', async () => {
    if (typeof (globalThis as any).AudioDecoder !== 'undefined') return;
    await expect(decodeMp4AudioTrack(new Blob([new Uint8Array(0)]), 3))
      .rejects.toBeInstanceOf(AudioTrackDecodeError);
  });
});
