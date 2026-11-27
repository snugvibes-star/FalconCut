/** Pure timeline navigation math shared by keyboard actions and tests. */

export interface MarkerTime {
  time: number;
}

/**
 * Move a selection by `direction * step`, but never push any clip below 0.
 * The same delta is applied to every selected clip so relative spacing and
 * multi-clip arrangements survive.
 */
export function nudgeDelta(starts: readonly number[], direction: -1 | 1, step: number): number {
  if (!starts.length || !Number.isFinite(step) || step <= 0) return 0;
  const delta = direction * step;
  if (delta >= 0) return delta;
  const first = Math.min(...starts);
  const clamped = Math.max(delta, -Math.max(0, first));
  return clamped === 0 ? 0 : clamped; // normalize -0
}

export interface NudgeClip {
  id: string;
  trackId: string;
  start: number;
  duration: number;
}

/**
 * Cap a nudge so no selected clip slides into an unselected clip on the same
 * track. Overlap hides one of the clips under the other, so a precision nudge
 * stops at the neighbour instead of creating a second invisible stack.
 * Ignores other tracks and clips inside the moving selection.
 */
export function clampNudgeDelta(
  clips: readonly NudgeClip[],
  selectedIds: readonly string[],
  direction: -1 | 1,
  requested: number,
): number {
  if (!selectedIds.length || !Number.isFinite(requested) || requested <= 0) return 0;
  const ids = new Set(selectedIds);
  const selected = clips.filter((c) => ids.has(c.id));
  if (!selected.length) return 0;
  const eps = 1e-6;
  let room = Infinity;
  for (const s of selected) {
    for (const b of clips) {
      if (ids.has(b.id) || b.trackId !== s.trackId) continue;
      if (direction > 0) {
        if (b.start >= s.start + s.duration - eps) {
          room = Math.min(room, b.start - (s.start + s.duration));
        }
      } else if (b.start + b.duration <= s.start + eps) {
        room = Math.min(room, s.start - (b.start + b.duration));
      }
    }
  }
  const allowed = Number.isFinite(room) ? Math.max(0, Math.min(requested, room)) : requested;
  return allowed === 0 ? 0 : direction * allowed;
}

/**
 * Time of the nearest marker strictly before/after `time`. Falls back to the
 * timeline start/end when the playhead is outside the marker range.
 */
export function markerJumpTime(
  markers: readonly MarkerTime[],
  time: number,
  direction: -1 | 1,
  duration: number,
): number {
  const times = markers
    .map((m) => m.time)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const epsilon = 1e-4;
  if (direction > 0) {
    const next = times.find((t) => t > time + epsilon);
    return next ?? Math.max(0, duration);
  }
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] < time - epsilon) return times[i];
  }
  return 0;
}
