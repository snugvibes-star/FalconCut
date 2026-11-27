/** Collision-safe timeline placement.
 *
 * Same-track overlap makes clips invisibly stack under each other: the later
 * clip swallows clicks and the earlier one becomes unreachable. Every path
 * that inserts media (drag/drop, double-click, palette) uses this one helper
 * so the behaviour cannot drift. */

export interface PlacementClip {
  id: string;
  trackId: string;
  start: number;
  duration: number;
}

/**
 * Nearest non-overlapping start for a clip of `dur` seconds on `trackId`,
 * ignoring `ignoreId`. The search considers every real gap and clamps the
 * requested time into the closest one; if no gap fits, the clip is appended
 * after the last clip on that track.
 */
export function resolveFreeStart(
  clips: readonly PlacementClip[],
  trackId: string,
  wanted: number,
  dur: number,
  ignoreId?: string,
): number {
  const others = clips
    .filter((c) => c.trackId === trackId && c.id !== ignoreId)
    .sort((a, b) => a.start - b.start);
  const gaps: { lo: number; hi: number }[] = [];
  let prevEnd = 0;
  for (const o of others) {
    if (o.start - prevEnd >= dur - 1e-6) {
      gaps.push({ lo: prevEnd, hi: Math.max(prevEnd, o.start - dur) });
    }
    prevEnd = Math.max(prevEnd, o.start + o.duration);
  }
  gaps.push({ lo: prevEnd, hi: Infinity });

  const safeWanted = Math.max(0, Number.isFinite(wanted) ? wanted : 0);
  let best = safeWanted;
  let bestD = Infinity;
  for (const g of gaps) {
    const c = Math.min(Math.max(safeWanted, g.lo), g.hi);
    const d = Math.abs(c - safeWanted);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = c;
    }
  }
  return Math.max(0, best);
}
