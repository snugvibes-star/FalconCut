/**
 * Serial node graph for the graded clip. Each node is a REAL effect already
 * evaluated by resolveEffects() in the shared preview/export renderer — this
 * UI is an editable view of that chain, not a decorative diagram.
 *
 * Honest scope: a serial chain (Source → FX → Mask → Output), not a free-form
 * compositor with arbitrary routing, merge nodes, plugins or 3D transforms.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2, Diamond } from 'lucide-react';
import { useStore } from '../../state/store';
import { EFFECT_DEFAULTS } from '../Inspector';
import type { Clip, EffectType } from '../../../engine';

const ADDABLE: EffectType[] = [
  'color', 'blur', 'sharpen', 'vignette', 'chromaKey', 'negate', 'normalize',
  'pixelate', 'noise', 'rgbSplit', 'glow', 'eq', 'gate', 'deess', 'denoise',
  'compressor', 'limiter', 'echo', 'pan',
];

export function NodeGraph({ clip }: { clip: Clip | null }) {
  const [adding, setAdding] = useState(false);
  if (!clip) return <p className="text-[11px] text-paper-faint p-2">Select a clip to edit its node chain.</p>;
  const s = useStore.getState();
  const fx = clip.effects;
  const disabled = !!clip.locked;

  const commit = (actions: Parameters<typeof s.commit>[0], label: string) => s.commit(actions, label);
  const move = (index: number, delta: number) => {
    const next = [...fx];
    const to = Math.max(0, Math.min(next.length - 1, index + delta));
    if (to === index) return;
    [next[index], next[to]] = [next[to], next[index]];
    const actions = [
      ...fx.map((e) => ({ type: 'remove_effect' as const, clipId: clip.id, effectId: e.id })),
      ...next.map((e) => ({ type: 'add_effect' as const, clipId: clip.id, effect: { ...e } })),
    ];
    commit(actions, 'Reorder effect nodes');
  };
  const setEnabled = (id: string, enabled: boolean) =>
    commit([{ type: 'set_effect', clipId: clip.id, effectId: id, enabled }], enabled ? 'Enable node' : 'Bypass node');
  const remove = (id: string) => commit([{ type: 'remove_effect', clipId: clip.id, effectId: id }], 'Delete node');
  const add = (type: EffectType) => {
    const params = EFFECT_DEFAULTS[type] ?? {};
    commit([{ type: 'add_effect', clipId: clip.id, effect: { type, enabled: true, params } }], `Add ${type} node`);
    setAdding(false);
  };

  return (
    <div className="space-y-1.5 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-paper-faint">Serial node chain</span>
        <button className="icon-btn p-0.5" onClick={() => setAdding((v) => !v)} title="Add an effect node"><Plus size={13} /></button>
      </div>
      {adding && (
        <select className="field py-1 text-[11px] cursor-pointer" defaultValue="" onChange={(e) => { if (e.target.value) add(e.target.value as EffectType); }}>
          <option value="" disabled>Choose effect…</option>
          {ADDABLE.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      <div className="flex flex-col items-stretch gap-1">
        <div className="rounded border border-signal/40 bg-signal/10 px-2 py-1 text-[10px] text-signal text-center">01 · SOURCE · {clip.name ?? clip.kind}</div>
        {fx.map((e, i) => (
          <div key={e.id} className="flex items-center gap-1">
            <div className="flex flex-col">
              <button className="icon-btn p-0" disabled={disabled || i === 0} onClick={() => move(i, -1)} title="Move node earlier"><ArrowUp size={11} /></button>
              <button className="icon-btn p-0" disabled={disabled || i === fx.length - 1} onClick={() => move(i, 1)} title="Move node later"><ArrowDown size={11} /></button>
            </div>
            <div className={`flex-1 rounded border px-2 py-1 text-[10px] ${e.enabled ? 'border-line bg-ink-850 text-paper' : 'border-line/60 text-paper-faint line-through'}`}>
              {String(i + 2).padStart(2, '0')} · {e.type}
            </div>
            <button className="icon-btn p-0.5" disabled={disabled} onClick={() => setEnabled(e.id, !e.enabled)} title={e.enabled ? 'Bypass node' : 'Enable node'}>
              {e.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <button className="icon-btn p-0.5 hover:text-heat" disabled={disabled} onClick={() => remove(e.id)} title="Delete node"><Trash2 size={12} /></button>
          </div>
        ))}
        {clip.mask && clip.mask.shape !== 'none' && (
          <div className="rounded border border-mind/40 bg-mind/10 px-2 py-1 text-[10px] text-mind text-center">
            {String(fx.length + 2).padStart(2, '0')} · MASK · {clip.mask.shape}{clip.mask.invert ? ' inverted' : ''}
          </div>
        )}
        <div className="rounded border border-line bg-ink-850 px-2 py-1 text-[10px] text-paper-dim text-center">OUTPUT · composited frame</div>
      </div>
      <p className="text-[10px] leading-relaxed text-paper-faint">
        Nodes are applied top-to-bottom by the same renderer that makes preview and export. Effect keyframes on each node stay editable in the Inspector. This is a serial chain, not a free-form compositor.
      </p>
      <button className="btn-ghost w-full justify-center text-[11px]" onClick={() => window.dispatchEvent(new CustomEvent('falconcut:inspector-tab', { detail: 'mask' }))}>
        <Diamond size={12} /> Edit mask node
      </button>
    </div>
  );
}
