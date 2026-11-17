/**
 * Marker-based zone loop. Toggles a looping playback zone between the nearest
 * markers around the playhead (or to the timeline end / start when only one
 * side exists). Backed by the store's real playback zone — the media pool and
 * audio graph actually stop/loop at the zone edges (see usePlayback).
 */
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { projectDuration } from '../../engine';

export function toggleMarkerLoop(): void {
  const s = useStore.getState();
  const ui = useUI.getState();
  const z = s.zone;
  // Off when a marker-loop zone is active (or any looping zone).
  if (z?.loop) { s.setZone(null); ui.toast('Loop off', 'info'); return; }
  const times = s.project.markers.map((m) => m.time).sort((a, b) => a - b);
  const t = s.playhead;
  const below = [...times].reverse().find((x) => x <= t + 0.001);
  const above = times.find((x) => x >= t - 0.001);
  let inT: number;
  let outT: number;
  if (below != null && above != null && below < above) { inT = below; outT = above; }
  else if (below != null) { inT = below; outT = Math.max(below + 0.5, projectDuration(s.project)); }
  else if (above != null) { inT = 0; outT = Math.max(0.5, above); }
  else { inT = 0; outT = projectDuration(s.project); }
  if (outT - inT < 0.2) { ui.toast('Add markers around a section to loop it (press M)', 'info'); return; }
  s.setZone({ in: inT, out: outT, loop: true });
  ui.toast(`Looping ${inT.toFixed(1)}s – ${outT.toFixed(1)}s`, 'info');
}
