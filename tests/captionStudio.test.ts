import { describe, it, expect } from 'vitest';
import { createProject, applyActions, layoutCaption, drawCaption, defaultTextStyle } from '../engine';
import { CAPTION_PRESETS, presetTextStyle, presetActions, evenWords } from '../src/components/tabs/textPresets';

function mockCtx() {
  const state = { globalAlpha: 1 };
  const stack: number[] = [];
  const fills: { w: string; alpha: number }[] = [];
  const rects: number[] = [];
  const ctx: any = {
    canvas: { width: 1080, height: 1920 },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v: number) { state.globalAlpha = v; },
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    lineWidth: 1, lineJoin: '', shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    filter: 'none', letterSpacing: '0em',
    save() { stack.push(state.globalAlpha); },
    restore() { state.globalAlpha = stack.pop() ?? 1; },
    setTransform() {}, scale() {}, translate() {}, rotate() {},
    fillRect() {}, clearRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, rect() {},
    arc() {}, arcTo() {}, moveTo() {}, lineTo() {},
    fill() { rects.push(state.globalAlpha); }, stroke() {},
    measureText(s: string) { return { width: s.length * 24 }; },
    fillText(w: string) { fills.push({ w, alpha: state.globalAlpha }); },
    strokeText() {},
  };
  return { ctx, fills, rects, stack, state };
}

const sampleWords = [
  { w: 'EVERY', start: 0, end: 0.5 },
  { w: 'CONVERSATION', start: 0.5, end: 1.2 },
  { w: 'HAS', start: 1.2, end: 1.6 },
  { w: 'A', start: 1.6, end: 1.8 },
  { w: 'STORY', start: 1.8, end: 2.6 },
];

describe('cinematic caption presets', () => {
  it('ships the six reference presets with distinct highlight behavior', () => {
    expect(CAPTION_PRESETS.map((p) => p.id)).toEqual(['default', 'tiktok', 'karaoke', 'beast', 'focus', 'mogul']);
    for (const p of CAPTION_PRESETS) {
      const s = presetTextStyle(p.id, 'caption', '9:16');
      expect(s.revealWords).toBe(true);
      expect(s.presetId).toBe(p.id);
      expect(s.highlight).toBeTruthy();
      expect(s.y).toBeLessThanOrEqual(0.73); // 9:16 safe zone
    }
    const tiktok = presetTextStyle('tiktok', 'caption', '16:9');
    expect(tiktok.highlight.enabled).toBe(true);
    expect(tiktok.highlight.bgColor).toBe('#FFEB00');
    expect(tiktok.highlight.anim).toBe('slide');
    const karaoke = presetTextStyle('karaoke', 'caption', '16:9');
    expect(karaoke.highlight.anim).toBe('color');
    expect(karaoke.highlight.textColor).toBe('#22D3EE');
    const beast = presetTextStyle('beast', 'caption', '16:9');
    expect(beast.uppercase).toBe(true);
    expect(beast.fontSize).toBeGreaterThan(0.07);
    expect(beast.highlight.bgColor).toBe('#C6F24E');
  });

  it('applies a preset to a clip as one undo step with editable words', () => {
    let p = createProject('Caption studio', '9:16');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'text', id: 'txt' } },
      { type: 'add_text', trackId: 'txt', start: 0, duration: 3, text: 'EVERY CONVERSATION HAS A STORY', role: 'caption', preset: 'clean' },
    ]);
    const clip = p.clips.find((c) => c.kind === 'text')!;
    const actions = presetActions(clip.id, 'focus', 'caption', '9:16', clip.text!.text, clip.duration);
    expect(actions.map((a) => a.type)).toEqual(['set_text_style', 'set_text']);
    const after = applyActions(p, actions);
    const c = after.clips.find((x) => x.id === clip.id)!;
    expect(c.text!.style.presetId).toBe('focus');
    expect(c.text!.style.highlight.bgColor).toBe('#FFD400');
    expect(c.text!.words).toHaveLength(5);
    expect(c.text!.words![4].end).toBeCloseTo(3, 1);
  });
});

describe('word-by-word speech-sync rendering', () => {
  it('reveals only words whose start time has been reached', () => {
    const style = presetTextStyle('tiktok', 'caption', '9:16');
    const { ctx, fills } = mockCtx();
    const layout = layoutCaption(ctx, 'EVERY CONVERSATION HAS A STORY', style, 1080, 1920, 0.7, sampleWords);
    drawCaption(ctx, layout, style, 1080, 1920, 0.7, 3);
    const drawn = fills.map((f) => f.w);
    expect(drawn).toContain('EVERY');
    expect(drawn).toContain('CONVERSATION');
    expect(drawn).not.toContain('STORY');
  });

  it('draws a highlight behind the active word only', () => {
    const style = presetTextStyle('focus', 'caption', '9:16');
    const at = (t: number) => {
      const { ctx, rects, fills } = mockCtx();
      const layout = layoutCaption(ctx, 'EVERY CONVERSATION HAS A STORY', style, 1080, 1920, t, sampleWords);
      drawCaption(ctx, layout, style, 1080, 1920, t, 3);
      return { rects: rects.length, fills: fills.map((f) => f.w) };
    };
    const early = at(0.2);
    const later = at(2.0);
    expect(early.rects).toBeGreaterThan(0); // highlight block painted
    expect(later.rects).toBeGreaterThan(0);
    expect(later.fills).toContain('STORY');
    expect(later.fills).toContain('EVERY'); // spoken words stay visible as the highlight moves forward
  });

  it('holds the highlight through gaps between spoken words', () => {
    const words = [
      { w: 'EVERY', start: 0, end: 0.3 },
      { w: 'STORY', start: 0.6, end: 1.2 },
    ];
    const style = presetTextStyle('focus', 'caption', '9:16');
    const { ctx, rects, fills } = mockCtx();
    const t = 0.45; // between the two words — no word is "active"
    const layout = layoutCaption(ctx, 'EVERY STORY', style, 1080, 1920, t, words);
    drawCaption(ctx, layout, style, 1080, 1920, t, 2);
    expect(rects.length).toBeGreaterThan(0); // highlight stays on the last spoken word
    expect(fills.map((f) => f.w)).toContain('EVERY');
    expect(fills.map((f) => f.w)).not.toContain('STORY');
  });

  it('gives each word its own color override while preserving timing', () => {
    const words = sampleWords.map((w, i) => ({ ...w, style: { color: i === 4 ? '#FF0000' : '#FFFFFF' } }));
    const style = presetTextStyle('default', 'caption', '16:9');
    const { ctx } = mockCtx();
    const layout = layoutCaption(ctx, 'EVERY CONVERSATION HAS A STORY', style, 1920, 1080, 2.0, words);
    expect(layout.lines.some((l) => l.words.some((w) => w.style?.color === '#FF0000'))).toBe(true);
    const stored = defaultTextStyle('clean');
    expect(stored.highlight.enabled).toBe(false);
  });
});
