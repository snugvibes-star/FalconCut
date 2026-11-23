import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Flag, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import type { Action, Marker } from '../../engine';

/** Right-panel marker navigator: seek, rename, recolor, retype and delete
 * markers. Every edit is a real undoable engine action (update_marker). */

const KINDS: Marker['kind'][] = ['user', 'scene', 'broll', 'beat', 'chapter', 'retake'];

function fmt(t: number, fps: number): string {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const f = Math.floor((total % 1) * (fps || 30));
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

export function MarkersPanel() {
  const markers = useStore((s) => s.project.markers);
  const fps = useStore((s) => s.project.settings.fps);
  const playhead = useStore((s) => s.playhead);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** Native color pickers fire onChange continuously while dragging — buffer
   * the value and commit a single undo step when the interaction ends. */
  const [colorDraft, setColorDraft] = useState<Record<string, string>>({});

  const sorted = useMemo(() => [...markers].sort((a, b) => a.time - b.time), [markers]);
  const toast = useUI((s) => s.toast);

  const commit = (actions: Action[], label: string) => useStore.getState().commit(actions, label);

  const seek = (t: number) => {
    const s = useStore.getState();
    s.pause();
    s.setPlayhead(t);
  };

  const step = (dir: 1 | -1) => {
    if (!sorted.length) { toast('No markers yet — add one with M', 'info'); return; }
    const t = useStore.getState().playhead;
    const after = sorted.find((m) => dir === 1 ? m.time > t + 1e-6 : m.time < t - 1e-6);
    const target = after ?? (dir === 1 ? sorted[0] : sorted[sorted.length - 1]); // wrap around
    seek(target.time);
    if (!after) toast(`Wrapped to the ${dir === 1 ? 'first' : 'last'} marker`);
  };

  const addHere = () => {
    const s = useStore.getState();
    commit([{ type: 'add_marker', marker: { time: s.playhead, label: `M${s.project.markers.length + 1}`, color: '#38BDF8' } }], 'Add marker');
  };

  const saveLabel = (m: Marker) => {
    setEditingId(null);
    const label = draft.trim();
    if (label && label !== m.label) commit([{ type: 'update_marker', markerId: m.id, patch: { label } }], 'Rename marker');
  };

  const saveColor = (m: Marker) => {
    const color = colorDraft[m.id];
    if (!color || color === m.color) return;
    commit([{ type: 'update_marker', markerId: m.id, patch: { color } }], 'Recolor marker');
    setColorDraft((d) => { const { [m.id]: _drop, ...rest } = d; return rest; });
  };

  return (
    <div className="p-3 space-y-3" aria-label="Marker navigator">
      <div className="flex items-center gap-2">
        <span className="label mb-0">Markers</span>
        <span className="text-[10px] font-mono text-paper-faint">{sorted.length}</span>
        <div className="flex-1" />
        <button className="icon-btn" title="Previous marker" aria-label="Previous marker" onClick={() => step(-1)} disabled={!sorted.length}>
          <ChevronUp size={15} />
        </button>
        <button className="icon-btn" title="Next marker" aria-label="Next marker" onClick={() => step(1)} disabled={!sorted.length}>
          <ChevronDown size={15} />
        </button>
        <button className="icon-btn text-signal" title="Add marker at playhead (M)" aria-label="Add marker at playhead" onClick={addHere}>
          <Plus size={15} />
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-paper-dim">
        Click a time to jump there. Markers show on the ruler and drive zone looping (Shift+M).
      </p>

      {!sorted.length ? (
        <div className="rounded-xl border border-dashed border-line-bright px-3 py-6 text-center text-paper-faint text-[11px]">
          <Flag size={20} className="mx-auto mb-2 opacity-50" />
          No markers yet — press <kbd className="font-mono text-paper-dim">M</kbd> or the + button at the playhead.
        </div>
      ) : (
        <ul className="space-y-1">
          {sorted.map((m) => {
            const editing = editingId === m.id;
            const near = Math.abs(m.time - playhead) < 0.05;
            return (
              <li key={m.id} className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors ${near ? 'border-signal/60 bg-signal/10' : 'border-line bg-ink-850 hover:border-line-bright'}`}>
                <input
                  type="color"
                  value={colorDraft[m.id] ?? m.color}
                  aria-label={`Color for ${m.label}`}
                  title="Marker color"
                  className="!w-5 !h-5 shrink-0"
                  onChange={(e) => setColorDraft((d) => ({ ...d, [m.id]: e.target.value }))}
                  onBlur={() => saveColor(m)}
                  onPointerUp={() => saveColor(m)}
                />
                <button
                  className="shrink-0 rounded px-1 py-0.5 font-mono text-[10px] tabular-nums text-paper-dim hover:text-signal focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal"
                  title={`Jump to ${fmt(m.time, fps)}`}
                  onClick={() => seek(m.time)}
                >
                  {fmt(m.time, fps)}
                </button>
                {editing ? (
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded bg-ink-800 px-1 py-0.5 text-[11px] text-paper focus:outline-none focus:ring-1 focus:ring-signal"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => saveLabel(m)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveLabel(m);
                      if (e.key === 'Escape') setEditingId(null);
                      e.stopPropagation();
                    }}
                    aria-label="Marker label"
                  />
                ) : (
                  <button
                    className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-[11px] text-paper hover:bg-ink-800 focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal"
                    title={`${m.label} — click to rename`}
                    onClick={() => { setEditingId(m.id); setDraft(m.label); }}
                  >
                    {m.label}
                  </button>
                )}
                <select
                  className="shrink-0 rounded border border-line bg-ink-800 px-1 py-0.5 text-[10px] text-paper-dim focus:outline-none focus:border-signal"
                  value={m.kind}
                  aria-label={`Kind for ${m.label}`}
                  title="Marker kind"
                  onChange={(e) => commit([{ type: 'update_marker', markerId: m.id, patch: { kind: e.target.value as Marker['kind'] } }], 'Change marker kind')}
                >
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <button
                  className="icon-btn p-1 shrink-0 hover:text-heat"
                  title="Delete marker"
                  aria-label={`Delete marker ${m.label}`}
                  onClick={() => commit([{ type: 'remove_marker', markerId: m.id }], 'Delete marker')}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
