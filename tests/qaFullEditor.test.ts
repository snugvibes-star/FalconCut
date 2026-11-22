import { describe, it, expect, beforeAll } from 'vitest';
import {
  createProject, applyActions, validateActions, TRANSITION_TYPES,
  renderFrame, type MediaAsset,
} from '../engine';

function fixture() {
  let p = createProject('QA', '16:9');
  const asset: MediaAsset = {
    id: 'vid', name: 'clip.mp4', type: 'video', duration: 20, width: 1920, height: 1080, hasAudio: true, source: 'file',
  };
  p = applyActions(p, [
    { type: 'add_media', asset },
    { type: 'add_clip', clip: { trackId: p.tracks[0].id, mediaId: 'vid', start: 0, duration: 20, inPoint: 0 } },
    { type: 'add_clip', clip: { trackId: p.tracks[1].id, start: 1, duration: 3, text: { text: 'hello', style: {} as never, role: 'caption' } } },
  ]);
  return p;
}

beforeAll(() => {
  class FakeOffscreen {
    width: number; height: number; ctx: any;
    constructor(w: number, h: number) { this.width = w; this.height = h; this.ctx = fakeCtxFor(w, h); }
    getContext() { return this.ctx; }
  }
  (globalThis as any).OffscreenCanvas = FakeOffscreen;
});

function fakeCtxFor(w: number, h: number) {
  const grad = { addColorStop() {} };
  return {
    canvas: { width: w, height: h },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    lineWidth: 1, lineJoin: '', shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    filter: 'none', letterSpacing: '0em',
    save() {}, restore() {}, setTransform() {}, scale() {}, translate() {}, rotate() {}, transform() {},
    fillRect() {}, clearRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, rect() {}, clip() {},
    arc() {}, arcTo() {}, ellipse() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {},
    drawImage() {}, createLinearGradient: () => grad, createRadialGradient: () => grad,
    measureText: (s: string) => ({ width: s.length * 12 }), fillText() {}, strokeText() {},
    getImageData: (_x: number, _y: number, iw: number, ih: number) => ({ data: new Uint8ClampedArray(iw * ih * 4), width: iw, height: ih }),
    putImageData() {},
  } as any;
}

function fakeCtx() { return fakeCtxFor(320, 180); }

describe('full editor QA', () => {
  it('keeps multi-track editing actions valid', () => {
    let p = fixture();
    const [media, text] = p.clips;
    const actions = [
      { type: 'move_clip' as const, clipId: media.id, start: 0.5 },
      { type: 'split_clip' as const, clipId: media.id, time: 5 },
      { type: 'trim_clip' as const, clipId: text.id, start: 2, duration: 2 },
      { type: 'add_track' as const, track: { kind: 'text' as const, name: 'Extra' } },
    ];
    expect(validateActions(p, actions)).toEqual([]);
    p = applyActions(p, actions);
    expect(p.clips.length).toBeGreaterThan(2);
    expect(p.tracks.length).toBe(4);
  });

  it('applies every transition type without validation errors', () => {
    const p = fixture();
    const id = p.clips[0].id;
    for (const type of TRANSITION_TYPES) {
      expect(validateActions(p, [{ type: 'set_transition', clipId: id, edge: 'in', transition: { type, duration: 0.3 } }])).toEqual([]);
    }
  });

  it('applies every effect type without validation errors', () => {
    const p = fixture();
    const id = p.clips[0].id;
    const types = ['color', 'blur', 'sharpen', 'vignette', 'chromaKey', 'negate', 'normalize', 'pixelate', 'noise', 'rgbSplit', 'glow'] as const;
    for (const type of types) {
      expect(validateActions(p, [{ type: 'add_effect', clipId: id, effect: { type, enabled: true, params: type === 'chromaKey' ? { color: '#00FF00' } : {} } }])).toEqual([]);
    }
  });

  it('supports speed, ramps, keyframes, mask and pitch settings together', () => {
    let p = fixture();
    const id = p.clips[0].id;
    p = applyActions(p, [
      { type: 'set_speed', clipId: id, speed: 1.5 },
      { type: 'set_speed_ramp', clipId: id, points: [{ t: 0, speed: 1 }, { t: 5, speed: 2 }] },
      { type: 'add_keyframe', clipId: id, path: 'transform.scale', time: 1, value: 1 },
      { type: 'set_clip_props', clipId: id, patch: { preservePitch: true, mask: { shape: 'ellipse', x: 0.1, y: 0.1, w: 0.8, h: 0.8 } } },
    ]);
    const kf = p.clips.find((c) => c.id === id)!.keyframes[0];
    p = applyActions(p, [{ type: 'update_keyframe', clipId: id, keyframeId: kf.id, time: 2, value: 1.4 }]);
    const clip = p.clips.find((c) => c.id === id)!;
    expect(clip.preservePitch).toBe(true);
    expect(clip.mask?.shape).toBe('ellipse');
    expect(clip.keyframes[0].time).toBe(2);
    expect(clip.speedPoints?.length).toBe(2);
  });

  it('renders a frame with masks, adjustments and all new transition types', () => {
    let p = fixture();
    const id = p.clips[0].id;
    p = applyActions(p, [
      { type: 'set_transition', clipId: id, edge: 'in', transition: { type: 'spin', duration: 0.5 } },
      { type: 'set_transition', clipId: id, edge: 'out', transition: { type: 'glitch', duration: 0.5 } },
      { type: 'add_effect', clipId: id, effect: { type: 'pixelate', enabled: true, params: { amount: 4 } } },
      { type: 'set_clip_props', clipId: id, patch: { mask: { shape: 'rect', x: 0.1, y: 0.1, w: 0.8, h: 0.8 } } },
      { type: 'add_clip', clip: { trackId: p.tracks[0].id, start: 2, duration: 5, kind: 'adjustment', effects: [{ id: 'adj', type: 'color', enabled: true, params: { brightness: 1.2 } }] } },
    ]);
    expect(() => renderFrame(p, 0.2, fakeCtx(), null)).not.toThrow();
    expect(() => renderFrame(p, 19.8, fakeCtx(), null)).not.toThrow();
    expect(() => renderFrame(p, 3, fakeCtx(), null)).not.toThrow();
  });

  it('round-trips the full project document through JSON', () => {
    let p = fixture();
    const id = p.clips[0].id;
    p = applyActions(p, [
      { type: 'set_speed_ramp', clipId: id, points: [{ t: 0, speed: 1 }, { t: 2, speed: 0.5 }] },
      { type: 'set_clip_props', clipId: id, patch: { preservePitch: true, mask: { shape: 'rect', x: 0, y: 0, w: 1, h: 1 } } },
      { type: 'set_transition', clipId: id, edge: 'in', transition: { type: 'light-leak', duration: 0.4 } },
    ]);
    const copy = JSON.parse(JSON.stringify(p)) as typeof p;
    expect(copy.clips.find((c) => c.id === id)?.speedPoints).toHaveLength(2);
    expect(copy.clips.find((c) => c.id === id)?.mask?.shape).toBe('rect');
    expect(copy.clips.find((c) => c.id === id)?.transitionIn?.type).toBe('light-leak');
  });
});
