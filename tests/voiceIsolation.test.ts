import { describe, it, expect, beforeAll } from 'vitest';
import { isolateVoice } from '../analysis/voiceIsolation';

/* Minimal AudioBuffer stand-ins: Node has no Web Audio, but isolateVoice only
 * needs getChannelData/copyToChannel/createBuffer from its output context. */
class FakeBuffer {
  channels: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(ch: number) { return this.channels[ch]; }
  copyToChannel(data: Float32Array, ch: number) { this.channels[ch].set(data); }
}
class FakeOfflineCtx {
  constructor(_ch: number, _len: number, public sampleRate: number) {}
  createBuffer(ch: number, len: number, sr: number) { return new FakeBuffer(ch, len, sr); }
}
beforeAll(() => { (globalThis as any).OfflineAudioContext = FakeOfflineCtx; });

const rms = (d: Float32Array) => Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);

describe('DSP voice isolation', () => {
  it('suppresses a stationary noise floor and keeps a louder tone', () => {
    const sr = 48000, len = sr * 2;
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const noise = Math.sin(i * 12.9898) * 0.0001 + 0.012; // quasi-random small AC + DC offset
      data[i] = (i < sr ? noise : Math.sin((2 * Math.PI * 440 * i) / sr) * 0.4 + noise);
    }
    const input = {
      numberOfChannels: 1, length: len, sampleRate: sr,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
    const out = isolateVoice(input, { reduction: 0.9, noiseWindow: 0.8 });
    const outData = out.getChannelData(0);
    const noiseBefore = rms(data.subarray(0, sr / 2));
    const noiseAfter = rms(outData.subarray(0, sr / 2));
    const toneAfter = rms(outData.subarray(sr, sr + sr / 2));
    expect(noiseAfter).toBeLessThan(noiseBefore * 0.6);
    expect(toneAfter).toBeGreaterThan(0.15);
  });

  it('is deterministic (same input → same output)', () => {
    const len = 48000;
    const data = Float32Array.from({ length: len }, (_, i) => Math.sin(i * 0.7) * 0.02);
    const input = { numberOfChannels: 1, length: len, sampleRate: 48000, getChannelData: () => data } as unknown as AudioBuffer;
    const a = isolateVoice(input).getChannelData(0);
    const b = isolateVoice(input).getChannelData(0);
    expect(Array.from(a.slice(0, 200))).toEqual(Array.from(b.slice(0, 200)));
  });
});
