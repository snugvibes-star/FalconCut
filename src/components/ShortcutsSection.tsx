import { useEffect, useState, useSyncExternalStore } from 'react';
import { RotateCcw, Search, Keyboard } from 'lucide-react';
import {
  DEFAULT_SHORTCUTS, SHORTCUT_GROUPS, comboFromEvent, formatCombo,
  getShortcutsVersion, isCustomized, resetShortcut, setShortcut,
  shortcutCombo, subscribeShortcuts,
} from '../features/shortcuts';
import { useUI } from '../state/ui';

/** Settings → Shortcuts: click a combo to capture a new one, with conflict
 * detection and per-action / all-action reset. Reads and writes the same
 * registry the keyboard hook and command palette use. */
export function ShortcutsSection() {
  const toast = useUI((s) => s.toast);
  const [query, setQuery] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  // Re-render when resetShortcut/setShortcut changes the module-level registry
  // so the displayed chips never lag the live bindings.
  const version = useSyncExternalStore(subscribeShortcuts, getShortcutsVersion);

  // Capture mode: swallow the next real key combo so it never reaches the editor.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      const combo = comboFromEvent(e);
      if (!combo) return; // modifier-only — keep listening
      const res = setShortcut(capturing, combo);
      if (res.ok) toast(`${DEFAULT_SHORTCUTS.find((d) => d.id === capturing)?.label} → ${formatCombo(combo).join(' + ')}`, 'success');
      else toast(res.error, 'error');
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, toast]);

  const q = query.trim().toLowerCase();
  const groups = SHORTCUT_GROUPS.map((group) => ({
    group,
    items: DEFAULT_SHORTCUTS.filter((d) =>
      d.group === group && (!q || `${d.label} ${shortcutCombo(d.id)}`.toLowerCase().includes(q))),
  })).filter((g) => g.items.length > 0);

  const anyCustom = DEFAULT_SHORTCUTS.some((d) => isCustomized(d.id));

  return (
    <section className="space-y-3" aria-label="Keyboard shortcuts" data-shortcuts-version={version}>
      <div>
        <h2 className="label">Keyboard shortcuts</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-paper-dim">
          Click a shortcut, then press the new keys. Conflicts are rejected; Escape cancels.
          Caption editing keeps its fixed Ctrl+Alt combos. Changes apply immediately and persist on this device.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-paper-faint pointer-events-none" />
          <input
            className="field pl-7 py-1.5 text-xs"
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn-solid text-xs py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
          disabled={!anyCustom}
          onClick={() => { resetShortcut(); toast('All shortcuts reset to defaults', 'success'); }}
        >
          <RotateCcw size={13} /> Reset all
        </button>
      </div>

      {capturing && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-signal/60 bg-signal/10 px-3 py-2 text-xs text-signal">
          <Keyboard size={14} className="shrink-0 animate-pulse" />
          <span>
            Press keys for <strong className="font-semibold">{DEFAULT_SHORTCUTS.find((d) => d.id === capturing)?.label}</strong> — Esc cancels.
          </span>
        </div>
      )}

      <div className="max-h-[46vh] space-y-3 overflow-y-auto panel bg-ink-850 p-3">
        {!groups.length && <p className="text-xs text-paper-dim">No shortcuts match “{query}”.</p>}
        {groups.map(({ group, items }) => (
          <div key={group}>
            <h3 className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wide text-paper-dim">{group}</h3>
            <ul className="space-y-0.5">
              {items.map((def) => {
                const combo = shortcutCombo(def.id);
                const custom = isCustomized(def.id);
                const active = capturing === def.id;
                return (
                  <li key={def.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-ink-800/60">
                    <span className="min-w-0 flex-1 text-xs text-paper truncate" title={def.label}>{def.label}</span>
                    <button
                      type="button"
                      onClick={() => setCapturing(active ? null : def.id)}
                      aria-label={`Rebind ${def.label}, currently ${formatCombo(combo).join(' ')}`}
                      className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${
                        active ? 'border-signal bg-signal/15 text-signal'
                          : custom ? 'border-signal/50 bg-ink-700 text-signal'
                          : 'border-line bg-ink-800 text-paper-dim hover:border-line-bright hover:text-paper'
                      }`}
                    >
                      {active ? 'press keys…' : formatCombo(combo).join(' + ')}
                    </button>
                    <button
                      type="button"
                      className="icon-btn p-1 shrink-0"
                      disabled={!custom}
                      title={custom ? 'Reset to default' : 'At its default'}
                      aria-label={`Reset ${def.label} to default`}
                      onClick={() => { resetShortcut(def.id); toast(`${def.label} reset to ${formatCombo(shortcutCombo(def.id)).join(' + ')}`); }}
                    >
                      <RotateCcw size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
