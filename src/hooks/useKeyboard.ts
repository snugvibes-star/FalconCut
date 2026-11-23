/** Global editor shortcuts. Ignored while typing in a field. Remappable combos
 * come from features/shortcuts (Settings → Shortcuts); a few combos are fixed
 * here and never remapped: the caption-studio Ctrl+Alt set, zone Space
 * (Alt+Space / Ctrl+Space), and the Ctrl+S autosave intercept. Every shortcut
 * maps to the same store actions the buttons use. */
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { activeClips, projectDuration, defaultTextStyle, type Action } from '../../engine';
import { toggleMarkerLoop } from '../features/zoneLoop';
import { copySelection, cutSelection, duplicateSelection, pasteClipboard } from '../features/clipClipboard';
import { matchShortcut } from '../features/shortcuts';

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

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

export function useKeyboard() {
  const shuttle = useRef<ShuttleState>({ dir: 0, step: -1, at: 0, ladderRate: false });

  useEffect(() => {
    /** Run a remapped action; returns false when the id is unknown. */
    const runAction = (id: string): boolean => {
      const s = useStore.getState();
      const ui = useUI.getState();
      const st = shuttle.current;
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
          shuttle.current = { dir: 0, step: -1, at: 0, ladderRate: false };
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
    };

    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const ui = useUI.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
        // Let a focused input own Escape (dialogs have their own listener).
        if (isTyping(e.target)) return;
        const open = (Object.keys(ui.dialogs) as (keyof typeof ui.dialogs)[]).find((d) => ui.dialogs[d]);
        if (open) { ui.close(open); e.preventDefault(); return; }
        if (s.selection.length) { s.select([]); e.preventDefault(); return; }
        if (s.zone) { s.setZone(null); e.preventDefault(); return; }
        return;
      }
      // e.target can be window/document for synthetic events — only elements
      // have .closest(); guard so a stray target can't crash the handler.
      const targetEl = e.target instanceof Element ? e.target : null;
      if (isTyping(e.target) || targetEl?.closest('dialog, [role="dialog"]') || Object.values(ui.dialogs).some(Boolean)) return;
      if (targetEl?.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;

      // ---- fixed combos: caption studio (Ctrl+Alt…) ------------------------
      if (mod && e.altKey) {
        const captionClips = s.project.clips.filter((c) => c.kind === 'text' && c.text?.role === 'caption');
        const selectedCaptions = captionClips.filter((c) => s.selection.includes(c.id));
        const k = e.key.toLowerCase();
        if (k === 'c') {
          e.preventDefault();
          const trackId = s.project.tracks.find((t) => t.kind === 'text' && !t.locked)?.id;
          if (!trackId) { ui.toast('No text track', 'info'); return; }
          const text = 'New caption';
          const words = text.split(/\s+/).map((w, i, a) => ({ w, start: i * 2 / a.length, end: (i + 1) * 2 / a.length }));
          s.commit([{ type: 'add_text', trackId, start: s.playhead, duration: 2, text, role: 'caption', preset: 'clean', style: defaultTextStyle('clean'), words }], 'Add caption (shortcut)');
          ui.toast('Caption added at playhead', 'success');
          return;
        }
        if (k === 'd' && selectedCaptions.length) {
          e.preventDefault();
          const actions: Action[] = selectedCaptions.map((c) => ({
            type: 'add_text', trackId: c.trackId, start: c.start + c.duration, duration: c.duration,
            text: c.text!.text, role: 'caption', preset: c.text!.style.preset,
            style: { ...c.text!.style }, words: c.text!.words?.map((w) => ({ ...w })),
          }));
          s.commit(actions, 'Duplicate caption (shortcut)');
          return;
        }
        if (k === 's' && selectedCaptions.length) {
          e.preventDefault();
          const t = s.playhead;
          s.commit(selectedCaptions.map((c) => ({
            type: 'split_clip' as const, clipId: c.id,
            time: t > c.start && t < c.start + c.duration ? t : c.start + c.duration / 2,
          })), 'Split caption (shortcut)');
          return;
        }
        if (e.key === 'Backspace' && selectedCaptions.length) {
          e.preventDefault();
          s.commit(selectedCaptions.map((c) => ({ type: 'remove_clip' as const, clipId: c.id, ripple: false })), 'Delete caption (shortcut)');
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          if (!selectedCaptions.length) return;
          e.preventDefault();
          const dt = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1);
          s.commit(selectedCaptions.map((c) => ({ type: 'move_clip' as const, clipId: c.id, start: Math.max(0, c.start + dt) })), 'Nudge caption (shortcut)');
          return;
        }
      }

      // ---- fixed combos: autosave intercept + zone Space -------------------
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        s.snapshot('Manual save', 'manual');
        ui.toast('Checkpoint saved — restore it any time in Versions', 'success');
        return;
      }
      if (e.key === ' ' && (e.altKey || mod)) {
        const z = s.zone;
        if (e.altKey && z) {
          // Alt+Space: toggle zone looping (starts playback inside the zone).
          e.preventDefault();
          const loop = !z.loop;
          s.setZone({ ...z, loop });
          if (loop) {
            if (s.playhead < z.in || s.playhead >= z.out) s.setPlayhead(z.in);
            if (!s.playing) s.play();
            ui.toast(loop ? 'Looping zone (Esc clears)' : 'Zone loop off');
          } else ui.toast('Zone loop off');
          return;
        }
        if (mod && z) {
          // Ctrl+Space: play the zone once from its in point.
          e.preventDefault();
          if (s.playhead < z.in || s.playhead >= z.out) s.setPlayhead(z.in);
          if (!s.playing) s.play();
          return;
        }
        // No zone: same as plain Space (legacy fall-through).
        e.preventDefault();
        s.togglePlay();
        return;
      }

      // ---- remappable shortcuts (Settings → Shortcuts) ---------------------
      const actionId = matchShortcut(e);
      if (actionId) {
        e.preventDefault();
        runAction(actionId);
        return;
      }

      // ---- fixed keys that stay unremapped --------------------------------
      switch (e.key) {
        case 'Delete':
        case 'Backspace': {
          if (!s.selection.length) break;
          e.preventDefault();
          s.commit(s.selection.map((id) => ({ type: 'remove_clip', clipId: id, ripple: true })), 'Delete clips');
          s.select([]);
          break;
        }
        case 'ArrowLeft':
          e.preventDefault(); s.setPlayhead(s.playhead - (e.shiftKey ? 1 / (s.project.settings.fps || 30) : 0.1)); break;
        case 'ArrowRight':
          e.preventDefault(); s.setPlayhead(s.playhead + (e.shiftKey ? 1 / (s.project.settings.fps || 30) : 0.1)); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
