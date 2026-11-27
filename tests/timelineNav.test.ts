import { describe, it, expect } from 'vitest';
import { clampNudgeDelta, markerJumpTime, nudgeDelta } from '../src/features/timelineNav';

describe('timeline navigation: nudgeDelta', () => {
  it('moves the whole selection by one step', () => {
    expect(nudgeDelta([2, 5], 1, 0.1)).toBeCloseTo(0.1);
    expect(nudgeDelta([2, 5], -1, 0.1)).toBeCloseTo(-0.1);
  });

  it('never pushes the earliest clip below zero', () => {
    // 0.05s of room, a 0.1s step: clamp to -0.05 so the selection just touches 0.
    expect(nudgeDelta([0.05, 4], -1, 0.1)).toBeCloseTo(-0.05);
    expect(nudgeDelta([0, 4], -1, 0.1)).toBe(0);
  });

  it('returns zero for an empty selection or invalid step', () => {
    expect(nudgeDelta([], 1, 0.1)).toBe(0);
    expect(nudgeDelta([2], 1, 0)).toBe(0);
    expect(nudgeDelta([2], 1, Number.NaN)).toBe(0);
  });
});

describe('timeline navigation: collision-safe nudges', () => {
  const a = { id: 'a', trackId: 'v1', start: 0, duration: 1 };
  const b = { id: 'b', trackId: 'v1', start: 2, duration: 1 };

  it('stops a nudge at the next clip on the same track', () => {
    // 0.5s of free space between a (ends 1) and b (starts 2).
    expect(clampNudgeDelta([a, b], ['a'], 1, 0.5)).toBeCloseTo(0.5);
    expect(clampNudgeDelta([a, b], ['a'], 1, 1)).toBeCloseTo(1);
    // A one-second request is capped to the 1s gap, not pushed into b.
    expect(clampNudgeDelta([a, b], ['a'], 1, 2)).toBeCloseTo(1);
  });

  it('stops a backward nudge at the previous clip', () => {
    expect(clampNudgeDelta([a, b], ['b'], -1, 0.25)).toBeCloseTo(-0.25);
    expect(clampNudgeDelta([a, b], ['b'], -1, 2)).toBeCloseTo(-1);
    // a ends at 1, b starts at 2 → one second of room.
    expect(clampNudgeDelta([a, b], ['b'], -1, 4)).toBeCloseTo(-1);
  });

  it('moves the whole selection only as far as its tightest member allows', () => {
    const c = { id: 'c', trackId: 'v1', start: 6, duration: 1 };
    // Moving [a, c] forward: a has 1s of room before b; c has none before 7? c ends 7, nothing after.
    expect(clampNudgeDelta([a, b, c], ['a', 'c'], 1, 2)).toBeCloseTo(1);
  });

  it('ignores clips on other tracks and inside the selection', () => {
    const other = { id: 'o', trackId: 'v2', start: 1, duration: 1 };
    expect(clampNudgeDelta([a, b, other], ['a'], 1, 0.5)).toBeCloseTo(0.5);
    // b is selected too, so it must not block a.
    expect(clampNudgeDelta([a, b], ['a', 'b'], 1, 0.5)).toBeCloseTo(0.5);
  });

  it('returns the full request when the track is clear', () => {
    expect(clampNudgeDelta([a], ['a'], 1, 0.2)).toBeCloseTo(0.2);
    expect(clampNudgeDelta([a], ['a'], -1, 0.2)).toBeCloseTo(-0.2);
  });

  it('returns zero for empty or invalid input', () => {
    expect(clampNudgeDelta([a], [], 1, 0.2)).toBe(0);
    expect(clampNudgeDelta([a], ['a'], 1, 0)).toBe(0);
    expect(clampNudgeDelta([a], ['a'], 1, Number.NaN)).toBe(0);
    expect(clampNudgeDelta([a], ['missing'], 1, 0.2)).toBe(0);
  });
});

describe('timeline navigation: marker jumps', () => {
  const markers = [{ time: 1 }, { time: 5 }, { time: 9 }];

  it('jumps to the next and previous marker', () => {
    expect(markerJumpTime(markers, 3, 1, 20)).toBe(5);
    expect(markerJumpTime(markers, 3, -1, 20)).toBe(1);
  });

  it('skips a marker the playhead is already sitting on', () => {
    expect(markerJumpTime(markers, 5, 1, 20)).toBe(9);
    expect(markerJumpTime(markers, 5, -1, 20)).toBe(1);
  });

  it('falls back to the timeline edges outside the marker range', () => {
    expect(markerJumpTime(markers, 12, 1, 20)).toBe(20);
    expect(markerJumpTime(markers, 0, -1, 20)).toBe(0);
  });

  it('returns the timeline start/end when there are no markers', () => {
    expect(markerJumpTime([], 4, 1, 20)).toBe(20);
    expect(markerJumpTime([], 4, -1, 20)).toBe(0);
  });

  it('sorts unsorted marker input', () => {
    expect(markerJumpTime([{ time: 9 }, { time: 1 }, { time: 5 }], 3, 1, 20)).toBe(5);
  });

  it('ignores non-finite marker times', () => {
    expect(markerJumpTime([{ time: 1 }, { time: Number.NaN }, { time: 9 }], 3, 1, 20)).toBe(9);
  });
});
