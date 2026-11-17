import { useState } from 'react';
import { TOOLS } from '../../tools/registry';
import { ToolRunner } from './ToolRunner';

const GROUPS: { title: string; names: string[] }[] = [
  { title: 'Clean up', names: ['remove_dead_air', 'remove_fillers', 'cut_retakes', 'cleanup_audio'] },
  { title: 'Captions & text', names: ['add_captions', 'add_hook_title', 'translate_captions'] },
  { title: 'Motion & framing', names: ['zoom_on_emphasis', 'reframe', 'add_transitions', 'snap_to_beats', 'add_motif'] },
  { title: 'Sound & look', names: ['add_music', 'balance_audio', 'apply_color_preset', 'add_broll_slots', 'auto_broll'] },
  { title: 'Automatic', names: ['auto_edit', 'auto_fix', 'smart_cutdown', 'ab_variants', 'auto_multicam'] },
];

export function ToolsTab() {
  const [selected, setSelected] = useState<string | null>(null);
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  const grouped = new Set(GROUPS.flatMap((g) => g.names));
  const rest = TOOLS.filter((t) => !grouped.has(t.name));

  return (
    <div className="p-2.5 space-y-3">
      <p className="text-[11px] text-paper-faint px-0.5">One call, professional defaults. Preview before applying — each run is a single undo step.</p>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="label px-0.5">{g.title}</div>
          <div className="space-y-1">
            {g.names.map((n) => {
              const t = byName.get(n);
              if (!t) return null;
              return (
                <button key={n} onClick={() => setSelected(n)} className="w-full text-left p-2 rounded-lg bg-ink-850 hover:bg-ink-800 border border-line hover:border-line-bright transition-colors">
                  <div className="font-mono text-xs text-signal">{t.name}</div>
                  <div className="text-[11px] text-paper-dim mt-0.5 line-clamp-2">{t.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {rest.length > 0 && (
        <div>
          <div className="label px-0.5">More</div>
          <div className="space-y-1">
            {rest.map((t) => (
              <button key={t.name} onClick={() => setSelected(t.name)} className="w-full text-left p-2 rounded-lg bg-ink-850 hover:bg-ink-800 border border-line">
                <div className="font-mono text-xs text-signal">{t.name}</div>
                <div className="text-[11px] text-paper-dim mt-0.5 line-clamp-2">{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {selected && <ToolRunner toolName={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}