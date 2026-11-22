/** Global editor shortcuts. Ignored while typing in a field. Every shortcut
 * maps to the same store actions the buttons use. */
import { useEffect } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { activeClips, projectDuration } from '../../engine';
import { toggleMarkerLoop } from '../features/zoneLoop';
import { copySelection, cutSelection, duplicateSelection, pasteClipboard } from '../features/clipClipboard';

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const ui = useUI.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
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

      if (mod && e.key.toLowerCase() === 'k') {
        // Premiere Ctrl+K: Add Edit — split every clip crossing the playhead.
        e.preventDefault();
        const t = s.playhead;
        const targets = s.project.clips.filter((c) => t > c.start + 0.05 && t < c.start + c.duration - 0.05);
        if (targets.length) {
          s.commit(targets.map((c) => ({ type: 'split_clip' as const, clipId: c.id, time: t })), 'Add edit at playhead');
          ui.toast(`Split ${targets.length} clip${targets.length > 1 ? 's' : ''} at playhead`);
        } else ui.toast('Move the playhead inside a clip to split', 'info');
        return;
      }
      if (mod && e.key === '/') { e.preventDefault(); ui.toggle('palette'); return; }
      if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); ui.open('export'); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); ui.toast('Project autosaves continuously', 'info'); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); s.select(s.project.clips.map((c) => c.id)); return; }
      if (!mod && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('falconcut:zoom-to-selection'));
        return;
      }

      // ---- clipboard: copy / cut / paste / duplicate -------------------------
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const n = copySelection();
        ui.toast(n ? `${n} clip${n > 1 ? 's' : ''} copied — Ctrl+V pastes at the playhead` : 'Select a clip to copy', n ? 'success' : 'info');
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        const n = cutSelection();
        ui.toast(n ? `${n} clip${n > 1 ? 's' : ''} cut — Ctrl+V pastes at the playhead` : 'Select a clip to cut', n ? 'success' : 'info');
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const n = pasteClipboard(s.playhead);
        ui.toast(n ? `Pasted ${n} clip${n > 1 ? 's' : ''} at the playhead` : 'Clipboard is empty — copy a clip first', n ? 'success' : 'info');
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const n = duplicateSelection();
        ui.toast(n ? `Duplicated ${n} clip${n > 1 ? 's' : ''}` : 'Select a clip to duplicate', n ? 'success' : 'info');
        return;
      }

      switch (e.key) {
        case ' ': {
          e.preventDefault();
          const z = s.zone;
          if (e.altKey && z) {
            // Alt+Space: toggle zone looping (starts playback inside the zone).
            const loop = !z.loop;
            s.setZone({ ...z, loop });
            if (loop) {
              if (s.playhead < z.in || s.playhead >= z.out) s.setPlayhead(z.in);
              if (!s.playing) s.play();
              ui.toast(loop ? 'Looping zone (Esc clears)' : 'Zone loop off');
            } else ui.toast('Zone loop off');
            break;
          }
          if (mod && z) {
            // Ctrl+Space: play the zone once from its in point.
            if (s.playhead < z.in || s.playhead >= z.out) s.setPlayhead(z.in);
            if (!s.playing) s.play();
            break;
          }
          s.togglePlay();
          break;
        }
        case 'v':
        case 'V':
          // Premiere V: selection tool on the preview overlay.
          e.preventDefault(); ui.setDrawTool('select'); break;
        case 'c':
        case 'C':
          // Premiere C: razor — split the clip under the playhead.
          e.preventDefault();
          {
            const t = s.playhead;
            const target = s.selection.length
              ? s.project.clips.find((cl) => cl.id === s.selection[0] && t > cl.start + 0.05 && t < cl.start + cl.duration - 0.05)
              : activeClips(s.project, t).find((cl) => cl.kind === 'media' && t > cl.start + 0.05 && t < cl.start + cl.duration - 0.05);
            if (target) { s.commit([{ type: 'split_clip', clipId: target.id, time: t }], 'Split clip'); ui.toast('Split at playhead'); }
            else ui.toast('Move the playhead inside a clip to split', 'info');
          }
          break;
        case 'z':
        case 'Z':
          // Premiere Z: lift — remove the selection leaving a gap.
          if (mod) break;
          if (!s.selection.length) { ui.toast('Select a clip to lift it', 'info'); break; }
          e.preventDefault();
          s.commit(s.selection.map((id) => ({ type: 'remove_clip', clipId: id, ripple: false })), 'Lift clips');
          s.select([]);
          break;
        case 'X':
          // Premiere Shift+X: extract — remove the selection rippling the gap.
          if (mod) break;
          if (!s.selection.length) { ui.toast('Select a clip to extract it', 'info'); break; }
          e.preventDefault();
          s.commit(s.selection.map((id) => ({ type: 'remove_clip', clipId: id, ripple: true })), 'Extract clips');
          s.select([]);
          break;
        case 'i':
        case 'I': {
          e.preventDefault();
          const z = s.zone ?? { in: 0, out: projectDuration(s.project), loop: false };
          s.setZone({ ...z, in: Math.min(s.playhead, z.out - 0.05) });
          ui.toast(`Zone in at ${s.playhead.toFixed(2)}s — playback stops at out (Alt+Space loops)`);
          break;
        }
        case 'o':
        case 'O': {
          e.preventDefault();
          const z = s.zone ?? { in: 0, out: projectDuration(s.project), loop: false };
          s.setZone({ ...z, out: Math.max(s.playhead, z.in + 0.05) });
          ui.toast(`Zone out at ${s.playhead.toFixed(2)}s — Ctrl+Space plays the zone`);
          break;
        }
        case 'j':
        case 'J':
          // J/K/L shuttle: J nudges the playhead back 1s (and pauses).
          e.preventDefault(); s.pause(); s.setPlayhead(s.playhead - 1); break;
        case 'k':
        case 'K':
          e.preventDefault(); s.pause(); break;
        case 'l':
        case 'L':
          e.preventDefault(); if (!s.playing) s.togglePlay(); break;
        case 'Delete':
        case 'Backspace': {
          if (!s.selection.length) break;
          e.preventDefault();
          s.commit(s.selection.map((id) => ({ type: 'remove_clip', clipId: id, ripple: true })), 'Delete clips');
          s.select([]);
          break;
        }
        case 's':
        case 'S': {
          if (mod) break;
          e.preventDefault();
          const t = s.playhead;
          const target = s.selection.length
            ? s.project.clips.find((c) => c.id === s.selection[0] && t > c.start + 0.05 && t < c.start + c.duration - 0.05)
            : activeClips(s.project, t).find((c) => c.kind === 'media' && t > c.start + 0.05 && t < c.start + c.duration - 0.05);
          if (target) { s.commit([{ type: 'split_clip', clipId: target.id, time: t }], 'Split clip'); ui.toast('Split at playhead'); }
          else ui.toast('Move the playhead inside a clip to split', 'info');
          break;
        }
        case 'n':
        case 'N': {
          // N: toggle magnetic snapping (persisted).
          e.preventDefault();
          const next = !ui.snap;
          ui.setSnap(next);
          ui.toast(next ? 'Snapping on' : 'Snapping off — hold Alt while dragging to bypass it either way');
          break;
        }
        case 'm':
        case 'M':
          if (e.shiftKey) {
            // Shift+M: loop between the nearest markers (real playback zone).
            e.preventDefault();
            toggleMarkerLoop();
            break;
          }
          e.preventDefault();
          s.commit([{ type: 'add_marker', marker: { time: s.playhead, label: 'Marker', kind: 'user', color: '#38BDF8' } }], 'Add marker');
          break;
        case 't':
        case 'T':
          e.preventDefault();
          s.commit([{ type: 'add_tack', tack: { time: s.playhead, text: 'Note', author: 'user' } }], 'Add tack');
          ui.setRightTab('notes');
          break;
        case 'ArrowLeft':
          e.preventDefault(); s.setPlayhead(s.playhead - (e.shiftKey ? 1 / (s.project.settings.fps || 30) : 0.1)); break;
        case 'ArrowRight':
          e.preventDefault(); s.setPlayhead(s.playhead + (e.shiftKey ? 1 / (s.project.settings.fps || 30) : 0.1)); break;
        case 'Home':
          e.preventDefault(); s.setPlayhead(0); break;
        case 'End':
          e.preventDefault(); s.setPlayhead(projectDuration(s.project)); break;
        case '+':
        case '=':
          e.preventDefault(); s.setZoom(s.zoom * 1.2); break;
        case '-':
        case '_':
          e.preventDefault(); s.setZoom(s.zoom / 1.2); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}