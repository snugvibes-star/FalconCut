import { describe, it, expect, beforeAll, vi } from 'vitest';
import { applyAction } from '../engine/actions';
import { createProject } from '../engine/types';
import type { MediaAsset, Project } from '../engine/types';
import { streamProjectWAV } from '../exporter/artifacts';

/* The streaming exporter renders through buildAudioGraph. We stub just that
 * graph builder so a fake OfflineAudioContext can fill each window with a
 * deterministic, timeline-position-dependent signal. */
const state = vi.hoisted(() => ({
  graphCalls: [] as { ctx: unknown; opts: { startAt: number; when: number; endAt?: number } }[],
  stops: 0,
}));

vi.mock('../engine/audio', () => ({
  buildAudioGraph: (_p: unknown, ctx: any, _dest: any, _buffers: any, opts: any) => {
    state.graphCalls.push({ ctx, opts });
    return { sources: [], master: ctx.createGain(), stop() { state.stops++; } };
  },
}));

const SR = 8000;
const DURATION = 121; // two windows: one full 120 s chunk plus a 1 s tail
const TOTAL_FRAMES = DURATION * SR;

class FakeBuffer {
  channels: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(ch: number) { return this.channels[ch]; }
}

class FakeOfflineCtx {
  static all: FakeOfflineCtx[] = [];
  destination = {};
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    FakeOfflineCtx.all.push(this);
  }
  createBuffer(ch: number, len: number, sr: number) { return new FakeBuffer(ch, len, sr); }
  createGain() {
    return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
  }
  async decodeAudioData(_data: ArrayBuffer) { return new FakeBuffer(1, 1, this.sampleRate); }
  async startRendering(): Promise<AudioBuffer> {
    const call = state.graphCalls.find((c) => c.ctx === this);
    const startFrame = Math.round((call?.opts.startAt ?? 0) * this.sampleRate);
    const out = new FakeBuffer(this.numberOfChannels, this.length, this.sampleRate);
    for (let ch = 0; ch < this.numberOfChannels; ch++) {
      const d = out.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = marker(startFrame + i, ch);
    }
    return out as unknown as AudioBuffer;
  }
}

beforeAll(() => { (globalThis as any).OfflineAudioContext = FakeOfflineCtx; });

/** Unique per timeline sample and channel, so a repeated/offset preroll shows up. */
const marker = (frame: number, ch: number) => ((frame % 200) - 100) / 200 + ch * 0.25;
const pcm16 = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767));

function testProject(): Project {
  let p = createProject('Streaming WAV', '16:9');
  p.settings.sampleRate = SR;
  const asset: MediaAsset = {
    id: 'gen', name: 'silent', type: 'generator', duration: DURATION,
    width: 640, height: 360, hasAudio: false,
    generator: { kind: 'solid', colors: ['#000000'], speed: 1, seed: 1 }, source: 'demo',
  };
  p = applyAction(p, { type: 'add_media', asset });
  p = applyAction(p, {
    type: 'add_clip',
    clip: { trackId: p.tracks[0].id, mediaId: 'gen', start: 0, duration: DURATION, inPoint: 0 },
  });
  return p;
}

let wav: Blob;
const progress: [number, string][] = [];

beforeAll(async () => {
  state.graphCalls.length = 0;
  FakeOfflineCtx.all.length = 0;
  progress.length = 0;
  wav = await streamProjectWAV(testProject(), async () => undefined, (f, m) => { progress.push([f, m]); });
});

describe('streamProjectWAV', () => {
  it('writes a valid 44-byte stereo PCM16 header with correct total sizes', async () => {
    const buf = await wav.arrayBuffer();
    const view = new DataView(buf);
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf, o, n));
    expect(wav.type).toBe('audio/wav');
    expect(wav.size).toBe(44 + TOTAL_FRAMES * 4);
    expect(str(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + TOTAL_FRAMES * 4);
    expect(str(8, 4)).toBe('WAVE');
    expect(str(12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // stereo
    expect(view.getUint32(24, true)).toBe(SR);
    expect(view.getUint32(28, true)).toBe(SR * 4);
    expect(view.getUint16(32, true)).toBe(4); // blockAlign (2 bytes, per RIFF spec)
    expect(view.getUint16(34, true)).toBe(16);
    expect(str(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(TOTAL_FRAMES * 4);
    expect(view.getUint32(4, true)).toBe(wav.size - 8);
    expect(view.getUint32(40, true)).toBe(wav.size - 44);
  });

  it('renders bounded windows with preroll and concatenates PCM in timeline order', async () => {
    const renderCtxs = FakeOfflineCtx.all.filter((c) => c.numberOfChannels === 2);
    expect(renderCtxs).toHaveLength(2);
    expect(state.graphCalls.map((c) => c.opts)).toEqual([
      { startAt: 0, when: 0, endAt: 120 },
      { startAt: 117.5, when: 0, endAt: 121 },
    ]);
    expect(renderCtxs.map((c) => c.length)).toEqual([120 * SR, Math.ceil(3.5 * SR)]);
    expect(state.stops).toBeGreaterThanOrEqual(2);

    const view = new DataView(await wav.arrayBuffer());
    let mismatches = 0;
    let firstMismatch = -1;
    for (let f = 0; f < TOTAL_FRAMES; f++) {
      const l = view.getInt16(44 + f * 4, true);
      const r = view.getInt16(44 + f * 4 + 2, true);
      if (l !== pcm16(marker(f, 0)) || r !== pcm16(marker(f, 1))) {
        mismatches++;
        if (firstMismatch < 0) firstMismatch = f;
      }
    }
    expect({ mismatches, firstMismatch }).toEqual({ mismatches: 0, firstMismatch: -1 });
  });

  it('emits monotonic progress with messages and a final fraction of 1', () => {
    expect(progress.length).toBeGreaterThanOrEqual(4);
    expect(progress[0][0]).toBe(0);
    expect(progress[progress.length - 1]).toEqual([1, 'Audio ready.']);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i][0]).toBeGreaterThanOrEqual(progress[i - 1][0]);
      expect(progress[i][0]).toBeLessThanOrEqual(1);
    }
    expect(progress.every(([, m]) => typeof m === 'string' && m.length > 0)).toBe(true);
    expect(progress.some(([f]) => f > 0.9 && f < 1)).toBe(true);
  });

  it('honours AbortSignal before and during rendering', async () => {
    const before = new AbortController();
    before.abort();
    await expect(streamProjectWAV(testProject(), async () => undefined, undefined, before.signal))
      .rejects.toMatchObject({ name: 'AbortError' });

    const during = new AbortController();
    await expect(streamProjectWAV(testProject(), async () => undefined, (f) => {
      if (f > 0.9 && f < 1) during.abort(); // after the first window
    }, during.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
