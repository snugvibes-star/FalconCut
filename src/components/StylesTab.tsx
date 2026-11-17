import { useState } from 'react';
import { Check, Trash2, Plus, Ban } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { BUILT_IN_PACKS } from '../../styles/packs';
import { effectivePack, parseNote } from '../../styles/rules';
import type { Action } from '../../engine';

export function StylesTab() {
  const project = useStore((s) => s.project);
  const ui = useUI();
  const [note, setNote] = useState('');
  const packs = [...BUILT_IN_PACKS, ...project.customPacks];
  const active = effectivePack(packs.find((p) => p.id === project.stylePackId) ?? packs[0], project.rules);
  const parsed = note.trim() ? parseNote(note) : [];

  const addRules = () => {
    if (!parsed.length) { ui.toast('Write a note like "captions always yellow" or "no zoom"', 'info'); return; }
    const actions: Action[] = parsed.map((r) => ({ type: 'add_rule', rule: { ...r, origin: 'user', enabled: true } }));
    useStore.getState().commit(actions, 'Save editing rule');
    setNote('');
    ui.toast(`Saved ${parsed.length} rule${parsed.length === 1 ? '' : 's'}`, 'success');
  };

  return (
    <div className="p-2.5 space-y-4">
      <div>
        <div className="label px-0.5">Style pack</div>
        <div className="space-y-1">
          {packs.map((p) => {
            const isActive = p.id === project.stylePackId;
            return (
              <button key={p.id} onClick={() => useStore.getState().commit([{ type: 'set_style_pack', packId: p.id }], `Style: ${p.name}`)}
                className={`w-full text-left p-2 rounded-lg border transition-colors ${isActive ? 'bg-signal/10 border-signal/40' : 'bg-ink-850 border-line hover:border-line-bright'}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-medium ${isActive ? 'text-signal' : 'text-paper'}`}>{p.name}</span>
                  {isActive && <Check size={12} className="text-signal" />}
                  {!p.builtIn && <span className="chip bg-mind/15 text-mind ml-auto">custom</span>}
                </div>
                <div className="text-[11px] text-paper-dim mt-0.5">{p.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {active.donts.length > 0 && (
        <div className="panel p-2.5 bg-ink-850">
          <div className="flex items-center gap-1.5 text-[11px] text-heat-amber font-medium mb-1"><Ban size={12} /> This pack avoids</div>
          <ul className="text-[11px] text-paper-dim space-y-0.5 list-disc pl-4">
            {active.donts.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}

      <div>
        <div className="label px-0.5">Saved rules</div>
        {project.rules.length === 0 ? (
          <p className="text-[11px] text-paper-faint px-0.5">No rules yet. Add a plain-words note below — it becomes a permanent editing rule the AI follows.</p>
        ) : (
          <div className="space-y-1">
            {project.rules.map((r) => (
              <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg bg-ink-850 border border-line">
                <input type="checkbox" checked={r.enabled} onChange={(e) => useStore.getState().commit([{ type: 'set_rule', ruleId: r.id, patch: { enabled: e.target.checked } }], 'Toggle rule')} className="accent-signal w-3.5 h-3.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className={`text-xs truncate ${r.enabled ? 'text-paper' : 'text-paper-faint line-through'}`}>{r.text}</div>
                  <div className="text-[10px] text-paper-faint">{r.kind}{r.origin === 'learned' ? ' · learned' : ''}</div>
                </div>
                <button className="icon-btn hover:text-heat" onClick={() => useStore.getState().commit([{ type: 'remove_rule', ruleId: r.id }], 'Delete rule')}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="label px-0.5">Add a rule in plain words</div>
        <textarea className="field resize-none" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder='e.g. "captions always yellow, no zoom, music low"' />
        {parsed.length > 0 && (
          <div className="text-[11px] text-paper-dim mt-1">Will save: {parsed.map((p) => p.kind).join(', ')}</div>
        )}
        <button className="btn-solid w-full mt-1.5" onClick={addRules}><Plus size={14} /> Save rule</button>
      </div>
    </div>
  );
}