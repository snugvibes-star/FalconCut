import { useState } from 'react';
import { useStore } from '../../state/store';
import { commit, DragSlider, Section } from './shared';
import { useSelectedClip } from './shared';
import type { Transition } from '../../../engine';

const TYPES: Transition['type'][] = ['crossfade', 'dip-black', 'dip-white', 'wipe-left', 'slide-left', 'zoom-in'];

export function TransitionsTab() {
  const clip = useSelectedClip();
  const [edge, setEdge] = useState<'in' | 'out'>('out');

  const current = clip ? (edge === 'in' ? clip.transitionIn : clip.transitionOut) : undefined;
  const disabled = !clip;

  const apply = (transition?: Transition) => {
    if (!clip) return;
    commit([{ type: 'set_transition', clipId: clip.id, edge, transition }], transition ? `Transition ${transition.type}` : 'Remove transition');
  };

  const applyAll = () => {
    if (!clip || !current) return;
    const actions = useStore.getState().project.clips
      .filter((c) => c.kind === 'media')
      .map((c) => ({ type: 'set_transition' as const, clipId: c.id, edge, transition: { ...current } }));
    commit(actions, `Apply ${current.type} to all cuts (${edge})`);
  };

  return (
    <div className={disabled ? 'opacity-50' : ''}>
      <Section title="Edge">
        {!clip && <p className="text-[11px] text-paper-faint">Select a clip on the timeline to set transitions.</p>}
        <div className="grid grid-cols-2 gap-1.5">
          {(['in', 'out'] as const).map((e) => (
            <button key={e} disabled={disabled} onClick={() => setEdge(e)}
              className={`rounded-lg py-1.5 text-xs font-medium capitalize transition-colors border ${edge === e ? 'bg-ink-700 text-paper border-signal/40' : 'text-paper-dim hover:text-paper hover:bg-ink-800 border-line'}`}>
              {e}
            </button>
          ))}
        </div>
        {clip && <p className="text-[11px] text-paper-faint">{current ? `Current ${edge}: ${current.type} (${current.duration.toFixed(2)}s)` : `No ${edge} transition.`}</p>}
      </Section>

      <Section title="Type">
        <div className="grid grid-cols-3 gap-1.5">
          {TYPES.map((t) => (
            <button key={t} disabled={disabled} onClick={() => apply({ type: t, duration: current?.duration ?? 0.4 })}
              className={`rounded-lg py-1.5 text-[11px] font-medium transition-colors border ${current?.type === t ? 'bg-ink-700 text-paper border-signal/40' : 'text-paper-dim hover:text-paper hover:bg-ink-800 border-line'}`}>
              {t}
            </button>
          ))}
        </div>
        {current && (
          <>
            <DragSlider label="Duration" value={current.duration} min={0.1} max={2} step={0.05} fmt={(v) => `${v.toFixed(2)}s`} commitKey="tr-dur"
              onCommit={(v) => apply({ type: current.type, duration: v })} />
            <button className="btn-solid w-full justify-center text-xs" onClick={() => apply(undefined)}>Remove {edge} transition</button>
          </>
        )}
      </Section>

      <Section title="Batch">
        <button className="btn-signal w-full justify-center text-xs" disabled={disabled || !current} onClick={applyAll}>
          Apply to all cuts ({edge})
        </button>
        {!current && clip && <p className="text-[11px] text-paper-faint">Set a transition type first.</p>}
      </Section>
    </div>
  );
}
