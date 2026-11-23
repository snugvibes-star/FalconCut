import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory localStorage so persistence can be asserted in Node.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
});

type Mods = { ctrl?: boolean; alt?: boolean; shift?: boolean };
const ev = (key: string, m: Mods = {}) =>
  ({ key, ctrlKey: !!m.ctrl, altKey: !!m.alt, shiftKey: !!m.shift, metaKey: false }) as unknown as KeyboardEvent;

async function fresh() {
  vi.resetModules();
  return await import('../src/features/shortcuts');
}

describe('shortcuts: combo normalization', () => {
  it('builds combos from events', async () => {
    const sc = await fresh();
    expect(sc.comboFromEvent(ev('z', { ctrl: true }))).toBe('Ctrl+Z');
    expect(sc.comboFromEvent(ev('X', { shift: true }))).toBe('Shift+X');
    expect(sc.comboFromEvent(ev(' '))).toBe('Space');
    expect(sc.comboFromEvent(ev('c'))).toBe('C');
    expect(sc.comboFromEvent(ev('k', { ctrl: true, alt: true }))).toBe('Ctrl+Alt+K');
    // layout aliases: + is Shift+= and _ is Shift+-
    expect(sc.comboFromEvent(ev('+', { shift: true }))).toBe('=');
    expect(sc.comboFromEvent(ev('_', { shift: true }))).toBe('-');
    // modifier-only keys are not combos
    expect(sc.comboFromEvent(ev('Control', { ctrl: true }))).toBeNull();
    expect(sc.comboFromEvent(ev('Shift', { shift: true }))).toBeNull();
  });

  it('formats combos into display chips', async () => {
    const sc = await fresh();
    expect(sc.formatCombo('Ctrl+Shift+G')).toEqual(['Ctrl', 'Shift', 'G']);
    expect(sc.formatCombo('Space')).toEqual(['Space']);
  });
});

describe('shortcuts: default bindings', () => {
  it('matches the shipped defaults', async () => {
    const sc = await fresh();
    expect(sc.matchShortcut(ev('k', { ctrl: true }))).toBe('addEdit');
    expect(sc.matchShortcut(ev(' '))).toBe('playPause');
    expect(sc.matchShortcut(ev(' ', { shift: true }))).toBe('playPause');
    expect(sc.matchShortcut(ev('c'))).toBe('razor');
    expect(sc.matchShortcut(ev('s'))).toBe('split');
    expect(sc.matchShortcut(ev('z'))).toBe('lift');
    expect(sc.matchShortcut(ev('X', { shift: true }))).toBe('extract');
    expect(sc.matchShortcut(ev('m', { shift: true }))).toBe('markerLoop');
    expect(sc.matchShortcut(ev('z', { shift: true }))).toBe('zoomToSelection');
    expect(sc.matchShortcut(ev('z', { ctrl: true, shift: true }))).toBe('redoAlt');
    expect(sc.matchShortcut(ev('z', { ctrl: true }))).toBe('undo');
    expect(sc.matchShortcut(ev('v'))).toBe('selectTool');
    // unmapped keys stay free
    expect(sc.matchShortcut(ev('q'))).toBeNull();
    expect(sc.matchShortcut(ev('Delete'))).toBeNull();
    // caption-studio combos are reserved, never matched
    expect(sc.matchShortcut(ev('c', { ctrl: true, alt: true }))).toBeNull();
  });
});

describe('shortcuts: remapping', () => {
  beforeEach(() => { mem.clear(); });

  it('rebinds an action and rejects conflicts', async () => {
    const sc = await fresh();
    const ok = sc.setShortcut('razor', 'B');
    expect(ok.ok).toBe(true);
    expect(sc.matchShortcut(ev('b'))).toBe('razor');
    expect(sc.matchShortcut(ev('c'))).toBeNull();

    // 'S' is taken by the split action
    const conflict = sc.setShortcut('lift', 'S');
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error).toContain('already used');
    expect(sc.matchShortcut(ev('s'))).toBe('split');

    // Ctrl+Alt is reserved for captions
    const reserved = sc.setShortcut('razor', 'Ctrl+Alt+R');
    expect(reserved.ok).toBe(false);
    if (!reserved.ok) expect(reserved.error).toContain('reserved');
  });

  it('reset restores defaults; reset-all clears everything', async () => {
    const sc = await fresh();
    sc.setShortcut('razor', 'B');
    sc.setShortcut('addMarker', 'P');
    expect(sc.isCustomized('razor')).toBe(true);
    sc.resetShortcut('razor');
    expect(sc.matchShortcut(ev('c'))).toBe('razor');
    expect(sc.isCustomized('addMarker')).toBe(true);
    sc.resetShortcut();
    expect(sc.isCustomized('addMarker')).toBe(false);
    expect(sc.matchShortcut(ev('m'))).toBe('addMarker');
  });

  it('persists overrides across a reload', async () => {
    const a = await fresh();
    a.setShortcut('razor', 'B');
    expect(mem.has('cutflow.shortcuts')).toBe(true);
    const b = await fresh(); // same storage, new module instance
    expect(b.matchShortcut(ev('b'))).toBe('razor');
    expect(b.shortcutCombo('razor')).toBe('B');
    expect(b.shortcutCombo('split')).toBe('S');
  });

  it('rebinding back to the default removes the override', async () => {
    const sc = await fresh();
    sc.setShortcut('razor', 'B');
    sc.setShortcut('razor', 'C');
    expect(sc.isCustomized('razor')).toBe(false);
    expect(JSON.parse(mem.get('cutflow.shortcuts') ?? '{}')).toEqual({});
  });

  it('keeps remaps that reuse a freed default across a reload', async () => {
    const a = await fresh();
    expect(a.setShortcut('undo', 'Ctrl+T').ok).toBe(true);
    expect(a.setShortcut('redo', 'Ctrl+Z').ok).toBe(true); // Ctrl+Z was undo's default
    const b = await fresh();
    expect(b.matchShortcut(ev('z', { ctrl: true }))).toBe('redo');
    expect(b.shortcutCombo('undo')).toBe('Ctrl+T');
    expect(b.shortcutCombo('redo')).toBe('Ctrl+Z');
  });

  it('rejects combos owned by fixed global handlers', async () => {
    const sc = await fresh();
    for (const combo of ['Escape', 'Delete', 'Backspace', 'ArrowLeft', 'Ctrl+S', 'Alt+Space', 'Ctrl+Space', 'Shift+Space']) {
      const res = sc.setShortcut('playPause', combo);
      expect(res.ok, combo).toBe(false);
    }
  });

  it('notifies subscribers after a reset so the UI refreshes', async () => {
    const sc = await fresh();
    let calls = 0;
    const unsub = sc.subscribeShortcuts(() => { calls++; });
    sc.setShortcut('razor', 'B');
    sc.resetShortcut('razor');
    sc.resetShortcut();
    expect(calls).toBe(3);
    expect(sc.getShortcutsVersion()).toBeGreaterThanOrEqual(3);
    unsub();
  });
});
