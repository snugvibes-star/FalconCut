import type { Easing } from './types';

export const easings: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  easeOutExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

export function ease(name: Easing, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return (easings[name] ?? easings.linear)(clamped);
}

/** Interpolate a keyframed numeric property at clip-local time. */
export function evalKeyframes(
  kfs: { time: number; value: number; easing: Easing }[],
  t: number,
  base: number
): number {
  if (!kfs.length) return base;
  const sorted = [...kfs].sort((a, b) => a.time - b.time);
  if (t <= sorted[0].time) return sorted[0].value;
  if (t >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const f = span <= 0 ? 1 : ease(b.easing, (t - a.time) / span);
      return a.value + (b.value - a.value) * f;
    }
  }
  return base;
}