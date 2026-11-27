import { describe, it, expect } from 'vitest';
import { resolveFreeStart, type PlacementClip } from '../src/features/timelinePlacement';

const clip = (id: string, trackId: string, start: number, duration: number): PlacementClip => ({
  id, trackId, start, duration,
});

describe('timeline placement: free-gap resolver', () => {
  it('keeps the requested time on an empty track', () => {
    expect(resolveFreeStart([], 'v1', 7.5, 2)).toBe(7.5);
  });

  it('clamps a negative request to the timeline start', () => {
    expect(resolveFreeStart([], 'v1', -3, 2)).toBe(0);
    expect(resolveFreeStart([], 'v1', Number.NaN, 2)).toBe(0);
  });

  it('keeps a request that already fits a real gap', () => {
    const clips = [clip('a', 'v1', 0, 2), clip('b', 'v1', 6, 2)];
    expect(resolveFreeStart(clips, 'v1', 3, 2)).toBe(3);
  });

  it('slides a request left into the closest gap instead of overlapping', () => {
    const clips = [clip('a', 'v1', 0, 2), clip('b', 'v1', 6, 2)];
    // 4.5 would overlap b (6); the nearest legal start is 4.
    expect(resolveFreeStart(clips, 'v1', 4.5, 2)).toBe(4);
  });

  it('slides a request right when the left gap is too small', () => {
    const clips = [clip('a', 'v1', 0, 5), clip('b', 'v1', 7, 2)];
    // Wanted 1 overlaps a; the only gap that fits is 5–7.
    expect(resolveFreeStart(clips, 'v1', 1, 2)).toBeCloseTo(5);
  });

  it('appends after the last clip when nothing fits', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('b', 'v1', 4, 4)];
    expect(resolveFreeStart(clips, 'v1', 1, 3)).toBe(8);
  });

  it('ignores the clip being moved and other tracks', () => {
    const clips = [
      clip('a', 'v1', 0, 2),
      clip('moving', 'v1', 3, 2),
      clip('other', 'v2', 0, 10),
    ];
    // `moving` itself must not block its own destination on v1.
    expect(resolveFreeStart(clips, 'v1', 3, 2, 'moving')).toBe(3);
    // v2 has a full-length clip, so the same request must append.
    expect(resolveFreeStart(clips, 'v2', 3, 2)).toBe(10);
  });

  it('handles unsorted clips and touching edges', () => {
    const clips = [clip('b', 'v1', 6, 2), clip('a', 'v1', 0, 2)];
    expect(resolveFreeStart(clips, 'v1', 2, 4)).toBe(2);
  });
});
