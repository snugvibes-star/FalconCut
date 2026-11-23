/** Single source of truth for editor keyboard shortcuts: default combos, user
 * remapping (persisted to localStorage), combo formatting, and event matching.
 * The keyboard hook, the Settings shortcut editor and the command-palette
 * cheatsheet all read from here, so they can never drift apart.
 *
 * Combo format: modifiers in Ctrl+Alt+Shift order plus one key, e.g.
 * "Ctrl+Shift+G", "Space", "ArrowLeft". Single letters are always uppercase.
 * Ctrl+Alt combos are reserved for the caption studio and cannot be rebound. */

export interface ShortcutDef {
  id: string;
  label: string;
  group: string;
  /** Default combo; user overrides live separately. */
  combo: string;
}

export const SHORTCUT_GROUPS = [
  'Playback',
  'Editing',
  'Clipboard',
  'Markers & notes',
  'View',
  'App',
] as const;

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // ---- Playback ----
  { id: 'playPause', group: 'Playback', label: 'Play / pause', combo: 'Space' },
  { id: 'shuttleBack', group: 'Playback', label: 'Shuttle backward (repeat to jump further)', combo: 'J' },
  { id: 'shuttleStop', group: 'Playback', label: 'Pause and reset shuttle speed', combo: 'K' },
  { id: 'shuttleFwd', group: 'Playback', label: 'Play (repeat to speed up preview)', combo: 'L' },
  { id: 'zoneIn', group: 'Playback', label: 'Mark zone in point', combo: 'I' },
  { id: 'zoneOut', group: 'Playback', label: 'Mark zone out point', combo: 'O' },
  { id: 'markerLoop', group: 'Playback', label: 'Loop between markers', combo: 'Shift+M' },

  // ---- Editing ----
  { id: 'addEdit', group: 'Editing', label: 'Add edit — split ALL clips at playhead', combo: 'Ctrl+K' },
  { id: 'razor', group: 'Editing', label: 'Razor — split the clip under the playhead', combo: 'C' },
  { id: 'split', group: 'Editing', label: 'Split selection at playhead', combo: 'S' },
  { id: 'lift', group: 'Editing', label: 'Lift — remove selection leaving a gap', combo: 'Z' },
  { id: 'extract', group: 'Editing', label: 'Extract — remove selection and close the gap', combo: 'Shift+X' },
  { id: 'group', group: 'Editing', label: 'Group clips', combo: 'Ctrl+G' },
  { id: 'ungroup', group: 'Editing', label: 'Ungroup clips', combo: 'Ctrl+Shift+G' },
  { id: 'toggleSnap', group: 'Editing', label: 'Toggle magnetic snapping', combo: 'N' },

  // ---- Clipboard / history ----
  { id: 'undo', group: 'Clipboard', label: 'Undo', combo: 'Ctrl+Z' },
  { id: 'redo', group: 'Clipboard', label: 'Redo', combo: 'Ctrl+Y' },
  { id: 'redoAlt', group: 'Clipboard', label: 'Redo (alternate)', combo: 'Ctrl+Shift+Z' },
  { id: 'selectAll', group: 'Clipboard', label: 'Select all clips', combo: 'Ctrl+A' },
  { id: 'copy', group: 'Clipboard', label: 'Copy selection', combo: 'Ctrl+C' },
  { id: 'cut', group: 'Clipboard', label: 'Cut selection', combo: 'Ctrl+X' },
  { id: 'paste', group: 'Clipboard', label: 'Paste at playhead', combo: 'Ctrl+V' },
  { id: 'duplicate', group: 'Clipboard', label: 'Duplicate selection', combo: 'Ctrl+D' },

  // ---- Markers & notes ----
  { id: 'addMarker', group: 'Markers & notes', label: 'Add marker at playhead', combo: 'M' },
  { id: 'addTack', group: 'Markers & notes', label: 'Add a note at playhead', combo: 'T' },

  // ---- View ----
  { id: 'zoomToSelection', group: 'View', label: 'Zoom to selection', combo: 'Shift+Z' },
  { id: 'selectTool', group: 'View', label: 'Selection tool (preview overlay)', combo: 'V' },
  { id: 'zoomIn', group: 'View', label: 'Zoom in', combo: '=' },
  { id: 'zoomOut', group: 'View', label: 'Zoom out', combo: '-' },
  { id: 'goStart', group: 'View', label: 'Go to start', combo: 'Home' },
  { id: 'goEnd', group: 'View', label: 'Go to end', combo: 'End' },
  { id: 'palette', group: 'View', label: 'Command palette', combo: 'Ctrl+/' },

  // ---- App ----
  { id: 'export', group: 'App', label: 'Open export', combo: 'Ctrl+E' },
];

export const SHORTCUT_IDS = new Set(DEFAULT_SHORTCUTS.map((d) => d.id));

const OVERRIDES_KEY = 'cutflow.shortcuts';
const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;

/** Combos the global key handler owns unconditionally — accepting these would
 * create a binding that silently never fires. */
const RESERVED_COMBOS = new Set([
  'Escape', 'Delete', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Ctrl+S',
  'Alt+Space', 'Ctrl+Space', 'Shift+Space', // zone playback + the Space→playPause rewrite
]);

/** User overrides (id → combo). Rebuilt into combo → id on every change. */
let overrides: Record<string, string> = {};
let byCombo = new Map<string, string>();

/** Change notification so React views (Settings → Shortcuts) re-render after
 * a reset/rebind instead of showing stale chips. */
type ShortcutListener = () => void;
const listeners = new Set<ShortcutListener>();
let version = 0;
export function subscribeShortcuts(fn: ShortcutListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function getShortcutsVersion(): number { return version; }

function sanitizeCombo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 1) return null;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!key || (MODIFIERS as readonly string[]).includes(key)) return null;
  if (mods.some((m) => !(MODIFIERS as readonly string[]).includes(m))) return null;
  if (mods.length !== new Set(mods).size) return null;
  // Keep a stable modifier order so stored combos always match event combos.
  const ordered = [...MODIFIERS.filter((m) => mods.includes(m as string)), key];
  return ordered.join('+');
}

function rebuild() {
  byCombo = new Map();
  for (const def of DEFAULT_SHORTCUTS) {
    const combo = overrides[def.id] ?? def.combo;
    if (!byCombo.has(combo)) byCombo.set(combo, def.id); // first wins
  }
  version++;
  for (const fn of listeners) fn();
}

function loadOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? '{}') as Record<string, unknown>;
    // Pass 1: sanitize stored overrides and drop reserved/fixed combos.
    const candidates: Record<string, string> = {};
    for (const def of DEFAULT_SHORTCUTS) {
      const combo = sanitizeCombo(raw[def.id]);
      if (combo && !RESERVED_COMBOS.has(combo) && !combo.startsWith('Ctrl+Alt+')) {
        candidates[def.id] = combo;
      }
    }
    // Pass 2: validate against *resolved* combos, not defaults. A combo that
    // was freed by another action's remap is legal (e.g. undo→Ctrl+T,
    // redo→Ctrl+Z) and must survive a reload. Genuine collisions drop the
    // later override, matching setShortcut's first-wins behavior.
    const resolved = new Map<string, string>();
    const clean: Record<string, string> = {};
    for (const def of DEFAULT_SHORTCUTS) {
      const combo = candidates[def.id] ?? def.combo;
      if (resolved.has(combo)) continue;
      resolved.set(combo, def.id);
      if (candidates[def.id]) clean[def.id] = combo;
    }
    overrides = clean;
  } catch {
    overrides = {};
  }
  rebuild();
}

if (typeof localStorage !== 'undefined') loadOverrides();

/** Resolved combo for an action id (user override or default). */
export function shortcutCombo(id: string): string {
  const def = DEFAULT_SHORTCUTS.find((d) => d.id === id);
  return overrides[id] ?? def?.combo ?? '';
}

/** True when the user has changed this shortcut from its default. */
export function isCustomized(id: string): boolean {
  return overrides[id] !== undefined;
}

export type SetShortcutResult = { ok: true } | { ok: false; error: string };

/** Rebind an action to a combo. Rejects conflicts with any resolved combo. */
export function setShortcut(id: string, combo: string): SetShortcutResult {
  if (!SHORTCUT_IDS.has(id)) return { ok: false, error: 'Unknown shortcut.' };
  const clean = sanitizeCombo(combo);
  if (!clean) return { ok: false, error: 'Press a modifier plus a key (or a single letter / Space).' };
  if (clean.includes('Ctrl+Alt') || clean.includes('Alt+Ctrl')) {
    return { ok: false, error: 'Ctrl+Alt combos are reserved for caption editing.' };
  }
  if (RESERVED_COMBOS.has(clean)) {
    return { ok: false, error: `${formatCombo(clean).join(' + ')} is reserved by the editor.` };
  }
  const holder = byCombo.get(clean);
  if (holder && holder !== id) {
    const def = DEFAULT_SHORTCUTS.find((d) => d.id === holder);
    return { ok: false, error: `"${formatCombo(clean)}" is already used by ${def?.label ?? holder}.` };
  }
  const def = DEFAULT_SHORTCUTS.find((d) => d.id === id)!;
  if (clean === def.combo) delete overrides[id];
  else overrides[id] = clean;
  persist();
  rebuild();
  return { ok: true };
}

/** Restore one shortcut (or all when id is omitted) to its default. */
export function resetShortcut(id?: string) {
  if (id) delete overrides[id];
  else overrides = {};
  persist();
  rebuild();
}

function persist() {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  } catch { /* private mode / quota — remap lives for this session only */ }
}

/** Normalize a keyboard event into a combo string, or null for modifier-only keys. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  let key = e.key;
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;
  if (key === ' ') key = 'Space';
  let shift = e.shiftKey;
  // US layout: "+" is Shift+=" and "_" is Shift+-. Treat them as plain = / -
  // so the zoom defaults match what the user physically presses.
  if (key === '+') { key = '='; shift = false; }
  else if (key === '_') { key = '-'; shift = false; }
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (shift) mods.push('Shift');
  if (key.length === 1 && /[a-z]/i.test(key)) key = key.toUpperCase();
  return [...mods, key].join('+');
}

/** Action id bound to this event's combo, or null. */
export function matchShortcut(e: KeyboardEvent): string | null {
  let combo = comboFromEvent(e);
  if (!combo) return null;
  if (combo === 'Shift+Space') combo = 'Space'; // Shift must not hide play/pause
  return byCombo.get(combo) ?? null;
}

/** Human-readable combo: "Ctrl", "Shift", "G" (render as kbd chips). */
export function formatCombo(combo: string): string[] {
  return combo.split('+');
}
