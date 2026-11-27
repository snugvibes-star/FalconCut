/** Global editor shortcuts. Ignored while typing in a field. Remappable combos
 * come from features/shortcuts (Settings → Shortcuts); a few combos are fixed
 * here and never remapped: the caption-studio Ctrl+Alt set, zone Space
 * (Alt+Space / Ctrl+Space), and the Ctrl+S autosave intercept. Every shortcut
 * maps to the same store actions the buttons use. */
import { useEffect } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { defaultTextStyle, type Action } from '../../engine';
import { matchShortcut } from '../features/shortcuts';
import { runEditorAction } from '../features/editorActions';

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function useKeyboard() {
  useEffect(() => {
    /** Remapped actions live in features/editorActions so the palette and
     * keyboard always run the same implementation. */
    const runAction = runEditorAction;

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
