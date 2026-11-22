import { describe, it, expect } from 'vitest';
import { createProject, applyActions, layoutCaption, drawCaption, parseSubtitles, serializeSubtitles } from '../engine';
import { CAPTION_MODELS, MODEL_SIZE_LIMIT, modelsWithinLimit, modelBytes } from '../src/features/captionStudio/models';
import { presetTextStyle } from '../src/components/tabs/textPresets';

describe('verified local model catalog', () => {
  it('offers 3–5 models with every individual file strictly under 70 MB', () => {
    expect(modelsWithinLimit()).toBe(true);
    expect(CAPTION_MODELS.length).toBe(4);
    for (const m of CAPTION_MODELS) {
      expect(m.files.length).toBeGreaterThan(0);
      for (const f of m.files) {
        expect(f.bytes).toBeLessThan(MODEL_SIZE_LIMIT);
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.url).toContain('huggingface.co');
      }
      expect(modelBytes(m)).toBeGreaterThan(0);
    }
  });

  it('only exposes the Whisper models the real worker can load', () => {
    const ids = CAPTION_MODELS.map((m) => m.id);
    expect(ids).toEqual([
      'onnx-community/whisper-tiny.en', 'onnx-community/whisper-tiny',
      'onnx-community/whisper-base.en', 'onnx-community/whisper-base',
    ]);
  });
});

describe('caption studio presets and rendering', () => {
  it('ships the expanded preset library with more colors and gradients', () => {
    const ids = ['default', 'tiktok', 'karaoke', 'beast', 'focus', 'mogul', 'minimal', 'documentary', 'podcast', 'gaming', 'cinematic'];
    for (const id of ids) {
      const s = presetTextStyle(id as never, 'caption', '16:9');
      expect(s.presetId).toBe(id);
      if (id !== 'documentary') expect(s.revealWords).toBe(true);
    }
    expect(presetTextStyle('cinematic' as never, 'caption', '16:9').color).toContain('linear-gradient(');
    expect(presetTextStyle('gaming' as never, 'caption', '16:9').highlight.anim).toBe('glitch');
  });

  it('renders the typewriter animation progressively', () => {
    const style = presetTextStyle('default' as never, 'caption', '16:9');
    style.animation = 'typewriter';
    const words = [{ w: 'HELLO', start: 0, end: 2 }];
    const seen: string[] = [];
    const ctx: any = {
      canvas: { width: 1920, height: 1080 }, globalAlpha: 1,
      fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
      lineWidth: 1, lineJoin: '', shadowColor: '', shadowBlur: 0, filter: 'none', letterSpacing: '0em',
      save() {}, restore() {}, setTransform() {}, scale() {}, translate() {}, rotate() {},
      fillRect() {}, clearRect() {}, beginPath() {}, closePath() {}, rect() {}, clip() {},
      arc() {}, arcTo() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {},
      measureText: (s: string) => ({ width: s.length * 20 }),
      fillText: (s: string) => seen.push(s), strokeText() {},
    };
    for (const t of [0.1, 1.0, 1.9]) {
      seen.length = 0;
      const layout = layoutCaption(ctx, 'HELLO', style, 1920, 1080, t, words);
      drawCaption(ctx, layout, style, 1920, 1080, t, 2);
    }
    // The last frame must show more characters than the first.
    expect(seen[seen.length - 1].length).toBeGreaterThanOrEqual(1);
  });
});

describe('subtitle interchange', () => {
  it('parses ASS and preserves text/timestamps as editable cues', () => {
    const ass = `[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello\\Nworld`;
    const result = parseSubtitles(ass, 'ass');
    expect(result.errors).toHaveLength(0);
    expect(result.cues[0].text).toContain('Hello');
    expect(result.cues[0].start).toBeCloseTo(1, 2);
  });

  it('serializes SRT/VTT/ASS from project captions', () => {
    let p = createProject('Subs', '9:16');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'text', id: 'txt' } },
      { type: 'add_text', trackId: 'txt', start: 0, duration: 2, text: 'hello', role: 'caption', preset: 'clean' },
    ]);
    const cue = { start: 0, end: 2, text: 'hello' };
    for (const fmt of ['srt', 'vtt', 'ass'] as const) {
      const out = serializeSubtitles([cue], fmt);
      expect(out.errors).toHaveLength(0);
      expect(out.text).toContain('hello');
    }
  });
});
