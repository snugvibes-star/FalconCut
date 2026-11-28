/**
 * One executor for every remappable editor action.
 *
 * The keyboard hook and the command palette both call this, so a shortcut and
 * its palette entry can never drift into two different implementations. All
 * mutations still route through the normal store commit path (one undo step).
 */
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { activeClips, projectDuration } from '../../engine';
import { toggleMarkerLoop } from './zoneLoop';
import { copySelection, cutSelection, duplicateSelection, pasteClipboard } from './clipClipboard';
import { markerJumpTime, clampNudgeDelta, nudgeDelta } from './timelineNav';

/** J/K/L shuttle: repeated presses within the window climb a ladder. */
const JKL_WINDOW = 700;
const BACK_STEPS = [1, 2, 4, 8];
const FWD_RATES = [1, 1.5, 2];

interface ShuttleState {
  /** -1 backward, 0 idle, 1 forward */
  dir: -1 | 0 | 1;
  /** ladder index; -1 = reset */
  step: number;
  at: number;
  /** true when the current preview rate was set by the L ladder (K resets it) */
  ladderRate: boolean;
}

const shuttle: ShuttleState = { dir: 0, step: -1, at: 0, ladderRate: false };

/** Run a remappable action; returns false when the id is unknown. */
export function runEditorAction(id: string): boolean {
  const s = useStore.getState();
  const ui = useUI.getState();
  const st = shuttle;
  const now = Date.now();
  switch (id) {
    // ---- Playback ----
    case 'playPause': s.togglePlay(); return true;
    case 'shuttleBack': {
      if (st.dir !== -1 || now - st.at > JKL_WINDOW) st.step = -1;
      st.dir = -1; st.at = now;
      st.step = Math.min(BACK_STEPS.length - 1, st.step + 1);
      const secs = BACK_STEPS[st.step];
      s.pause();
      s.setPlayhead(Math.max(0, s.playhead - secs));
      if (secs > 1) ui.toast(`Shuttle back ${secs}s`, 'info');
      return true;
    }
    case 'shuttleStop': {
      s.pause();
      if (st.ladderRate) ui.setPreviewRate(1);
      shuttle.dir = 0; shuttle.step = -1; shuttle.at = 0; shuttle.ladderRate = false;
      return true;
    }
    case 'shuttleFwd': {
      const fresh = st.dir !== 1 || now - st.at > JKL_WINDOW;
      if (fresh) { st.dir = 1; st.step = -1; }
      st.at = now;
      st.step = Math.min(FWD_RATES.length - 1, st.step + 1);
      const target = FWD_RATES[st.step];
      // Only ever raise the rate — a manually chosen preview rate survives.
      if (target > useUI.getState().previewRate) {
        ui.setPreviewRate(target);
        st.ladderRate = target !== 1;
      }
      if (!s.playing) s.play();
      else if (target > 1) ui.toast(`Preview ${target}×`, 'info');
      return true;
    }
    case 'zoneIn': {
      const z = s.zone ?? { in: 0, out: projectDuration(s.project), loop: false };
      s.setZone({ ...z, in: Math.min(s.playhead, z.out - 0.05) });
      ui.toast(`Zone in at ${s.playhead.toFixed(2)}s — playback stops at out (Alt+Space loops)`);
      return true;
    }
    case 'zoneOut': {
      const z = s.zone ?? { in: 0, out: projectDuration(s.project), loop: false };
      s.setZone({ ...z, out: Math.max(s.playhead, z.in + 0.05) });
      ui.toast(`Zone out at ${s.playhead.toFixed(2)}s — Ctrl+Space plays the zone`);
      return true;
    }
    case 'markerLoop': toggleMarkerLoop(); return true;

    // ---- Editing ----
    case 'addEdit': {
      const t = s.playhead;
      const targets = s.project.clips.filter((c) => t > c.start + 0.05 && t < c.start + c.duration - 0.05);
      if (targets.length) {
        s.commit(targets.map((c) => ({ type: 'split_clip' as const, clipId: c.id, time: t })), 'Add edit at playhead');
        ui.toast(`Split ${targets.length} clip${targets.length > 1 ? 's' : ''} at playhead`);
      } else ui.toast('Move the playhead inside a clip to split', 'info');
      return true;
    }
    case 'razor':
    case 'split': {
      const t = s.playhead;
      const target = s.selection.length
        ? s.project.clips.find((c) => c.id === s.selection[0] && t > c.start + 0.05 && t < c.start + c.duration - 0.05)
        : activeClips(s.project, t).find((c) => c.kind === 'media' && t > c.start + 0.05 && t < c.start + c.duration - 0.05);
      if (target) { s.commit([{ type: 'split_clip', clipId: target.id, time: t }], 'Split clip'); ui.toast('Split at playhead'); }
      else ui.toast('Move the playhead inside a clip to split', 'info');
      return true;
    }
    case 'lift': {
      if (!s.selection.length) { ui.toast('Select a clip to lift it', 'info'); return true; }
      s.commit(s.selection.map((id) => ({ type: 'remove_clip', clipId: id, ripple: false })), 'Lift clips');
      s.select([]);
      return true;
    }
    case 'extract': {
      if (!s.selection.length) { ui.toast('Select a clip to extract it', 'info'); return true; }
      s.commit(s.selection.map((id) => ({ type: 'remove_clip', clipId: id, ripple: true })), 'Extract clips');
      s.select([]);
      return true;
    }
    case 'zoneLift':
    case 'zoneExtract': {
      const z = s.zone;
      if (!z || z.out <= z.in + 0.05) { ui.toast('Mark an I/O zone first (I / O)', 'info'); return true; }
      const type = id === 'zoneLift' ? 'lift_range' : 'ripple_delete_range';
      s.commit([{ type, start: z.in, end: z.out }] as any, id === 'zoneLift' ? 'Lift zone' : 'Extract zone');
      ui.toast(id === 'zoneLift' ? 'Zone lifted — gap left' : 'Zone extracted — gap closed', 'success');
      return true;
    }
    case 'group': {
      if (s.selection.length < 2) { ui.toast('Select two or more clips to group them', 'info'); return true; }
      s.commit([{ type: 'group_clips', clipIds: s.selection.slice() }], 'Group clips');
      ui.toast(`Grouped ${s.selection.length} clips`, 'success');
      return true;
    }
    case 'ungroup': {
      const groups = new Set(s.selection.map((id) => s.project.clips.find((c) => c.id === id)?.groupId).filter(Boolean) as string[]);
      if (!groups.size) { ui.toast('Select a grouped clip to ungroup it', 'info'); return true; }
      s.commit([...groups].map((groupId) => ({ type: 'ungroup', groupId })), 'Ungroup clips');
      ui.toast('Clips ungrouped', 'success');
      return true;
    }
    case 'toggleSnap': {
      const next = !ui.snap;
      ui.setSnap(next);
      ui.toast(next ? 'Snapping on' : 'Snapping off — hold Alt while dragging to bypass it either way');
      return true;
    }
    case 'nudgeBack':
    case 'nudgeFwd': {
      const selected = s.project.clips.filter((c) => s.selection.includes(c.id));
      if (!selected.length) {
        ui.toast('Select a clip to nudge it', 'info');
        return true;
      }
      // Moving only the unlocked half of a selection would silently tear a
      // group apart, so refuse until the user unlocks all of it.
      if (selected.some((c) => c.locked)) {
        ui.toast('Locked clips in the selection — unlock them to nudge the group', 'info');
        return true;
      }
      const step = 1 / (s.project.settings.fps || 30);
      const dir: -1 | 1 = id === 'nudgeFwd' ? 1 : -1;
      const desired = nudgeDelta(selected.map((c) => c.start), dir, step);
      if (Math.abs(desired) < 1e-9) {
        ui.toast('Selection is already at the start of the timeline', 'info');
        return true;
      }
      const delta = clampNudgeDelta(s.project.clips, s.selection, dir, Math.abs(desired));
      if (Math.abs(delta) < 1e-9) {
        ui.toast('A neighboring clip is in the way — close the gap there first', 'info');
        return true;
      }
      // Coalesce repeated frame nudges into one undo step: one gesture, one Ctrl+Z.
      const key = `nudge:${selected.map((c) => c.id).sort().join(',')}`;
      s.commit(
        selected.map((c) => ({ type: 'move_clip' as const, clipId: c.id, start: c.start + delta })),
        'Nudge clips',
        'human',
        key,
      );
      return true;
    }

    // ---- Clipboard / history ----
    case 'undo': s.undo(); return true;
    case 'redo':
    case 'redoAlt': s.redo(); return true;
    case 'selectAll': s.select(s.project.clips.map((c) => c.id)); return true;
    case 'copy': {
      const n = copySelection();
      ui.toast(n ? `${n} clip${n > 1 ? 's' : ''} copied — Ctrl+V pastes at the playhead` : 'Select a clip to copy', n ? 'success' : 'info');
      return true;
    }
    case 'cut': {
      const n = cutSelection();
      ui.toast(n ? `${n} clip${n > 1 ? 's' : ''} cut — Ctrl+V pastes at the playhead` : 'Select a clip to cut', n ? 'success' : 'info');
      return true;
    }
    case 'paste': {
      const n = pasteClipboard(s.playhead);
      ui.toast(n ? `Pasted ${n} clip${n > 1 ? 's' : ''} at the playhead` : 'Clipboard is empty — copy a clip first', n ? 'success' : 'info');
      return true;
    }
    case 'duplicate': {
      const n = duplicateSelection();
      ui.toast(n ? `Duplicated ${n} clip${n > 1 ? 's' : ''}` : 'Select a clip to duplicate', n ? 'success' : 'info');
      return true;
    }

    // ---- Markers & notes ----
    case 'addMarker':
      s.commit([{ type: 'add_marker', marker: { time: s.playhead, label: `M${s.project.markers.length + 1}`, color: '#4C9AFF' } }], 'Add marker');
      return true;
    case 'addTack':
      s.commit([{ type: 'add_tack', tack: { time: s.playhead, text: 'Note', author: 'user' } }], 'Add tack');
      ui.setRightTab('notes');
      return true;
    case 'prevMarker':
    case 'nextMarker': {
      if (!s.project.markers.length) {
        ui.toast('No markers yet — press M to add one', 'info');
        return true;
      }
      const t = markerJumpTime(
        s.project.markers,
        s.playhead,
        id === 'nextMarker' ? 1 : -1,
        projectDuration(s.project),
      );
      s.pause();
      s.setPlayhead(t);
      return true;
    }

    // ---- View ----
    case 'selectTool': ui.setDrawTool('select'); return true;
    case 'zoomToSelection': window.dispatchEvent(new CustomEvent('falconcut:zoom-to-selection')); return true;
    case 'zoomIn': s.setZoom(s.zoom * 1.2); return true;
    case 'zoomOut': s.setZoom(s.zoom / 1.2); return true;
    case 'goStart': s.setPlayhead(0); return true;
    case 'goEnd': s.setPlayhead(projectDuration(s.project)); return true;
    case 'palette': ui.toggle('palette'); return true;

    // ---- App ----
    case 'export': ui.open('export'); return true;
    default: return false;
  }
}
