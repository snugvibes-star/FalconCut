import { describe, it, expect } from 'vitest';
import {
  applyAction, applyActions, buildTrackActions, createProject, downscaleGrey,
  localTimeAtSource, matchTemplate, resolveMatch, rgbaToGrey, sourceToProjectPoint,
  templateFromGrey, validateActions,
  type MediaAsset,
} from '../engine';

const W = 160, H = 90;
const greyFrame = (patchX?: number, patchY?: number) => {
  const rgba = new Uint8ClampedArray(W * H * 4);
  if (patchX != null && patchY != null) {
    for (let y = patchY; y < patchY + 16; y++) {
      for (let x = patchX; x < patchX + 16; x++) {
        const p = (y * W + x) * 4;
        // Textured patch: a uniform block has zero variance and no NCC signal.
        const v = (x + y) % 2 === 0 ? 204 : 51;
        rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
        rgba[p + 3] = 255;
      }
    }
  }
  return rgba;
};

describe('single-point patch tracking', () => {
  it('finds a shifted synthetic patch with NCC', () => {
    const first = rgbaToGrey(greyFrame(40, 30), W, H);
    // RGBA downscaling path stays pure too (2x source frame).
    const big = new Uint8ClampedArray(W * 2 * H * 2 * 4);
    for (let y = 15; y < 23; y++) for (let x = 20; x < 28; x++) {
      const p = (y * W * 2 + x) * 4;
      big[p] = big[p + 1] = big[p + 2] = (x + y) % 2 === 0 ? 204 : 51; big[p + 3] = 255;
    }
    const down = downscaleGrey(big, W * 2, H * 2, W);
    expect(down.width).toBe(W);
    expect(down.height).toBe(H);

    const seed = { t: 0, x: 48 / W, y: 38 / H, w: 16 / W, h: 16 / H };
    const template = templateFromGrey(first, seed);
    expect(template.norm).toBeGreaterThan(0);
    const second = rgbaToGrey(greyFrame(52, 36), W, H); // +12 px, +6 px
    const match = matchTemplate(second, template, { x: seed.x, y: seed.y }, 24);
    expect(match.score).toBeGreaterThan(0.8);
    expect(match.x * W).toBeCloseTo(60, 0); // center 52 + 8
    expect(match.y * H).toBeCloseTo(44, 0); // center 36 + 8
    expect(match.margin).toBeGreaterThan(0.05);
  });

  it('holds the previous position on low confidence or an ambiguous margin', () => {
    const prev = { x: 0.4, y: 0.6 };
    const weak = resolveMatch(prev, { x: 0.9, y: 0.1, score: 0.4, margin: 0.3 });
    expect(weak.accepted).toBe(false);
    expect(weak.x).toBe(prev.x);
    expect(weak.y).toBe(prev.y);
    const ambiguous = resolveMatch(prev, { x: 0.9, y: 0.1, score: 0.95, margin: 0.02 });
    expect(ambiguous.accepted).toBe(false);
    expect(ambiguous.x).toBe(prev.x);
    const good = resolveMatch(prev, { x: 0.5, y: 0.55, score: 0.9, margin: 0.2 });
    expect(good.accepted).toBe(true);
    expect(good.x).toBe(0.5);
    expect(good.y).toBe(0.55);
  });

  it('maps normalized source coords through cover/contain/fill geometry', () => {
    const clip = { fit: 'cover' as const, transform: {
      x: 0, y: 0, scale: 1, rotation: 0, skewX: 0, skewY: 0, opacity: 1,
      cropL: 0, cropR: 0, cropT: 0, cropB: 0,
    } };
    const project = { width: 1920, height: 1080 };
    expect(sourceToProjectPoint(0.75, 0.5, clip, { width: 1920, height: 1080 }, project)).toEqual({ x: 1440, y: 540 });
    const contained = sourceToProjectPoint(0.75, 0.5, { ...clip, fit: 'contain' }, { width: 1920, height: 1080 }, { width: 1080, height: 1920 });
    expect(contained.x).toBeCloseTo(810, 0); // 540 + (0.75 - 0.5) * 1080
    const filled = sourceToProjectPoint(0.25, 0.5, { ...clip, fit: 'fill' }, { width: 1000, height: 1000 }, project);
    expect(filled.x).toBeCloseTo(480, 0);
  });

  it('builds actions that validate and produce editable keyframes', () => {
    let p = createProject('Track test', '16:9');
    const asset: MediaAsset = {
      id: 'm1', name: 'clip.mp4', type: 'video', duration: 10, width: 1920, height: 1080,
      hasAudio: false, source: 'demo',
    };
    p = applyAction(p, { type: 'add_media', asset });
    p = applyAction(p, { type: 'add_clip', clip: { trackId: p.tracks[0].id, mediaId: 'm1', start: 1, duration: 4, inPoint: 2 } });
    const clip = p.clips[0];
    const seed = { t: 2, x: 0.5, y: 0.5, w: 0.12, h: 0.12 };
    const samples = [
      { t: 2, x: 0.5, y: 0.5 },
      { t: 2.5, x: 0.53, y: 0.52 },
      { t: 3, x: 0.57, y: 0.54 },
    ];
    const actions = buildTrackActions(p, clip, seed, samples, {
      sourceSize: { width: 1920, height: 1080 }, newClipId: 'tracked_sticker',
    });
    expect(validateActions(p, actions)).toEqual([]);
    const next = applyActions(p, actions);
    expect(next.clips.find((c) => c.id === clip.id)?.tracking?.samples).toHaveLength(3);
    const sticker = next.clips.find((c) => c.id === 'tracked_sticker');
    expect(sticker?.drawing?.strokes[0].tool).toBe('sticker');
    expect(sticker?.drawing?.strokes[0].char).toBe('📍');
    expect(sticker?.start).toBe(clip.start);
    expect(sticker?.duration).toBe(clip.duration);
    expect(sticker?.keyframes.filter((k) => k.path === 'transform.x')).toHaveLength(3);
    expect(sticker?.keyframes.some((k) => k.value !== 0)).toBe(true);
    // Keyframe times are clip-local on the target: the seed is at local 0.
    expect(sticker?.keyframes.some((k) => Math.abs(k.time - 0.5) < 1e-6)).toBe(true);
    expect(localTimeAtSource(clip, 3)).toBeCloseTo(1, 3);
  });
});
