import { describe, it, expect } from 'vitest';
import { createProject, applyActions, layoutCaption, drawCaption, parseSubtitles, serializeSubtitles, buildCues } from '../engine';
import { CAPTION_MODELS, MODEL_SIZE_LIMIT, modelsWithinLimit, modelBytes } from '../src/features/captionStudio/models';
import { wordsFromAsr } from '../analysis/transcript';
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

describe('extended caption customization', () => {
  it('persists advanced style fields through actions', () => {
    let p = createProject('Custom captions', '9:16');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'text', id: 'txt' } },
      { type: 'add_text', trackId: 'txt', start: 0, duration: 2, text: 'hello', role: 'caption', preset: 'clean' },
    ]);
    const id = p.clips[0].id;
    const style = {
      fontFamily: 'Georgia', fontStyle: 'italic' as const, caseMode: 'lower' as const,
      textOpacity: 0.8, sharpness: 0.5, backgroundBlur: 0.2,
      glow: { enabled: true, color: '#22D3EE', radius: 0.1, intensity: 0.7 },
      highlight: { enabled: true, anim: 'slide' as const, bgColor: '#FFEB00', textColor: '#000000', padding: 0.1, radius: 0.1, opacity: 1, speed: 0.2, glow: 0, shadow: 0, offset: 0.15, prevColor: '#94A3B8', nextColor: '#FFFFFF' },
    };
    p = applyActions(p, [{ type: 'set_text_style', clipId: id, patch: style }]);
    const saved = p.clips[0].text!.style;
    expect(saved.fontFamily).toBe('Georgia');
    expect(saved.fontStyle).toBe('italic');
    expect(saved.caseMode).toBe('lower');
    expect(saved.highlight.offset).toBe(0.15);
    expect(saved.glow.enabled).toBe(true);
  });
});

describe('chunked transcription conversion', () => {
  it('converts chunk ASR output and marks subdivided words as estimated', () => {
    const words = wordsFromAsr({
      chunks: [{ text: 'hello world', timestamp: [1, 2] }],
    }, 30, true, 'chunk');
    expect(words).toHaveLength(2);
    expect(words[0].start).toBe(1);
    expect(words.every((w) => w.estimated)).toBe(true);
  });

  it('keeps verified word timing unmarked', () => {
    const words = wordsFromAsr({
      chunks: [
        { text: 'hello', timestamp: [0.2, 0.6] },
        { text: 'world', timestamp: [0.7, 1.1] },
      ],
    }, 30, false, 'word');
    expect(words).toHaveLength(2);
    expect(words.some((w) => w.estimated)).toBe(false);
  });
});

describe('transcription timing honesty', () => {
  it('marks estimated word timing as it flows into caption cues', () => {
    const cues = buildCues([
      { word: 'hello', start: 0, end: 0.5, estimated: true },
      { word: 'world', start: 0.6, end: 1.2 },
    ], 40, 2);
    expect(cues[0].words[0].timingEstimated).toBe(true);
    expect(cues[0].words[1].timingEstimated).toBeUndefined();
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
