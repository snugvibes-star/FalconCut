import { describe, it, expect } from 'vitest';
import { resolveEffects, parseCurvePoints, curveLut, IDENTITY_CURVE, defaultTransform, type Clip } from '../engine';

const clipWith = (params: Record<string, number | string>): Clip => ({
  id: 'c1', trackId: 't1', kind: 'adjustment', start: 0, duration: 10,
  inPoint: 0, speed: 1, transform: defaultTransform(), fit: 'cover',
  volume: 1, fades: { in: 0, out: 0 }, keyframes: [],
  effects: [{ id: 'fx', type: 'color', enabled: true, params }],
});

describe('RGB tonal curves', () => {
  it('parses and bakes a compact control-point string into a 256-entry LUT', () => {
    const pts = parseCurvePoints('0,0;64,32;128,160;255,255');
    expect(pts).not.toBeNull();
    const lut = curveLut(pts)!;
    expect(lut.length).toBe(256);
    expect(lut[0]).toBe(0);
    expect(lut[64]).toBe(32);
    expect(lut[128]).toBe(160);
    expect(lut[255]).toBe(255);
  });

  it('rejects malformed curves instead of corrupting the render', () => {
    expect(parseCurvePoints('garbage')).toBeNull();
    expect(parseCurvePoints('10,10;20,20')).toBeNull(); // must span 0..255
    expect(parseCurvePoints('')).toBeNull();
  });

  it('the identity curve is neutral and does not force a CPU pass by itself', () => {
    const lut = curveLut(parseCurvePoints(IDENTITY_CURVE))!;
    expect([0, 64, 128, 192, 255].every((v) => lut[v] === v)).toBe(true);
    const r = resolveEffects(clipWith({ curve: IDENTITY_CURVE }), 0, true);
    expect(r.curves).toBeDefined();
    expect(r.curves![0][100]).toBe(100);
  });

  it('composes a master curve with a per-channel curve', () => {
    const r = resolveEffects(clipWith({
      curve: '0,0;128,64;255,255',
      curve_r: '0,0;128,128;255,128',
    }), 0, true);
    expect(r.needsPixels).toBe(true);
    // master maps 128 -> 64, red channel then maps 64 -> 64 (linear first half)
    expect(r.curves![0][128]).toBe(64);
    // green has no channel curve, so it only sees the master
    expect(r.curves![1][128]).toBe(64);
    expect(r.curves![0][255]).toBe(128); // red channel curve caps highlights
  });
});

describe('six-band HSL adjustments', () => {
  it('only activates the CPU pass when a band is actually adjusted', () => {
    const neutral = resolveEffects(clipWith({ hsl_r_s: 1, hsl_b_h: 0 }), 0, true);
    expect(neutral.hsl).toBeUndefined();
    const warm = resolveEffects(clipWith({ hsl_r_h: 12, hsl_b_s: 1.2 }), 0, true);
    expect(warm.needsPixels).toBe(true);
    expect(warm.hsl?.map((b) => b.center)).toEqual([0, 240]);
  });

  it('evaluates HSL band keyframes at local clip time', () => {
    const c = clipWith({ hsl_r_h: 0 });
    c.keyframes = [
      { id: 'k1', path: 'effects.fx.hsl_r_h', time: 0, value: 60, easing: 'linear' },
      { id: 'k2', path: 'effects.fx.hsl_r_h', time: 2, value: 0, easing: 'linear' },
    ];
    expect(resolveEffects(c, 0, true).hsl![0].h).toBe(60);
    expect(resolveEffects(c, 1, true).hsl![0].h).toBe(30);
    // After the last keyframe the band returns to neutral and is skipped,
    // avoiding a needless CPU pixel pass.
    expect(resolveEffects(c, 3, true).hsl).toBeUndefined();
  });
});
