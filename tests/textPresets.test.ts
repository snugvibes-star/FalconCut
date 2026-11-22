import { describe, it, expect } from 'vitest';
import { createProject, applyActions, renderFrame } from '../engine';
import { validateActions } from '../engine/actions';
import { buildStyledText, effectPatch, transitionActions } from '../src/components/tabs/textPresets';

describe('styled title/caption creation', () => {
  it('builds one undo step with a text track, preset style and transitions', () => {
    const p = createProject('Text test', '9:16');
    const { actions, clipId } = buildStyledText(p, {
      start: 1, duration: 3, text: 'Hello', role: 'caption',
      preset: 'karaoke', effect: 'halo', transition: 'both',
    });
    expect(validateActions(p, actions)).toEqual([]);
    expect(actions.map((a) => a.type)).toEqual(['add_text', 'set_transition', 'set_transition']);
    const after = applyActions(p, actions);
    const clip = after.clips.find((c) => c.id === clipId)!;
    expect(clip).toBeTruthy();
    expect(clip.text?.style.preset).toBe('karaoke');
    expect(clip.text?.style.y).toBeLessThanOrEqual(0.73); // 9:16 safe zone
    expect(clip.text?.style.outlineColor).toBe(clip.text?.style.highlightColor); // halo
    expect(clip.transitionIn?.type).toBe('crossfade');
    expect(clip.transitionOut?.type).toBe('crossfade');
    expect(after.clips.filter((c) => c.kind === 'text')).toHaveLength(1);
  });

  it('reuses an existing text track and removes transitions on request', () => {
    let p = createProject('Text test', '16:9');
    p = applyActions(p, [{ type: 'add_track', track: { kind: 'text', id: 'txt' } }]);
    const { actions } = buildStyledText(p, {
      start: 0, duration: 2, text: 'Title', role: 'title',
      preset: 'bold-keywords', effect: 'typewriter', transition: 'none', trackId: 'txt',
    });
    expect(actions.map((a) => a.type)).toEqual(['add_text']);
    const after = applyActions(p, actions);
    const clip = after.clips.find((c) => c.kind === 'text')!;
    expect(clip.text?.style.y).toBe(0.26);
    expect(clip.text?.style.animation).toBe('typewriter');
    const reset = transitionActions(clip.id, 'none');
    expect(applyActions(after, reset).clips.find((c) => c.id === clip.id)?.transitionIn).toBeUndefined();
  });

  it('effectPatch maps effects onto real style fields', () => {
    expect(effectPatch('clean', 'pop', 'caption', '16:9').animation).toBe('pop');
    expect(effectPatch('clean', 'shadow', 'caption', '16:9').shadow).toBe(true);
    expect(effectPatch('clean', 'none', 'caption', '16:9').animation).toBe('none');
  });

  it('fades text clips in and out through clip transitions', () => {
    let p = createProject('Fade test', '16:9');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'text', id: 'txt' } },
      { type: 'add_text', trackId: 'txt', start: 0, duration: 4, text: 'fade me', role: 'caption', preset: 'clean' },
    ]);
    const clip = p.clips.find((c) => c.kind === 'text')!;
    p = applyActions(p, [
      { type: 'set_transition', clipId: clip.id, edge: 'in', transition: { type: 'crossfade', duration: 1 } },
      { type: 'set_transition', clipId: clip.id, edge: 'out', transition: { type: 'crossfade', duration: 1 } },
    ]);
    const alphas: number[] = [];
    const ctx = {
      canvas: { width: 1920, height: 1080 },
      globalAlpha: 1, fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
      lineWidth: 1, lineJoin: '', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, filter: 'none',
      save() {}, restore() {}, setTransform() {}, scale() {}, translate() {}, rotate() {},
      fillRect() {}, clearRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, rect() {}, clip() {},
      arc() {}, arcTo() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {},
      measureText(s: string) { return { width: s.length * 20 }; },
      fillText() { alphas.push(ctx.globalAlpha); }, strokeText() {},
    };
    const alphaAt = (t: number) => {
      ctx.globalAlpha = 1;
      alphas.length = 0;
      renderFrame(p, t, ctx as never, null);
      return alphas[0] ?? 0;
    };
    const fadeIn = alphaAt(0.1);
    const middle = alphaAt(2);
    const fadeOut = alphaAt(3.9);
    expect(fadeIn).toBeLessThan(0.2);
    expect(middle).toBeCloseTo(1, 1);
    expect(fadeOut).toBeLessThan(0.2);
  });
});
