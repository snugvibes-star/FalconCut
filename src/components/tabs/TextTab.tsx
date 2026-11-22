import { useState } from 'react';
import { Type, AlignLeft, Plus, WandSparkles } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { commit, Section, Hint } from './shared';
import { FALCONCUT_MIME } from '../MediaTab';
import { StylePreview } from './CaptionsTab';
import {
  TEXT_EFFECTS, TEXT_TRANSITIONS, buildStyledText, effectPatch, transitionActions,
  textStyleFor, type TextEffect, type TextRole, type TextTransition,
} from './textPresets';
import { defaultTextStyle, type CaptionStyleId } from '../../../engine';

const PRESETS: CaptionStyleId[] = ['clean', 'karaoke', 'bold-keywords', 'word-pop'];
const ROLES: { id: TextRole; label: string; text: string; icon: typeof Type }[] = [
  { id: 'title', label: 'Title', text: 'Your title', icon: Type },
  { id: 'caption', label: 'Caption', text: 'Caption text', icon: AlignLeft },
];

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Serializable add_text params carried to the Timeline drop zone. */
interface TextPresetDrop {
  text: string;
  role: TextRole;
  duration: number;
  preset: CaptionStyleId;
  effect: TextEffect;
  transition: TextTransition;
}

export function TextTab() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const playhead = useStore((s) => s.playhead);
  const ui = useUI();
  const [role, setRole] = useState<TextRole>('title');
  const [preset, setPreset] = useState<CaptionStyleId>('clean');
  const [effect, setEffect] = useState<TextEffect>('pop');
  const [transition, setTransition] = useState<TextTransition>('in');
  const textClips = project.clips.filter((c) => c.kind === 'text').sort((a, b) => a.start - b.start);
  const selected = textClips.find((c) => selection.includes(c.id));

  const payloadFor = (): TextPresetDrop => ({
    text: role === 'title' ? 'Your title' : 'Caption text',
    role, duration: role === 'title' ? 3 : 2.5,
    preset, effect, transition,
  });

  const addText = () => {
    const p = payloadFor();
    const { actions, clipId } = buildStyledText(project, {
      ...p, start: playhead,
    });
    commit(actions, `Add ${p.role} (${p.preset})`);
    if (clipId) useStore.getState().select([clipId]);
    ui.toast(`${p.role === 'title' ? 'Title' : 'Caption'} added to the video — visible in preview and export`, 'success');
  };

  const applyLookToSelected = () => {
    if (!selected) return;
    const clipRole = (selected.text?.role as TextRole) || 'caption';
    const clipPreset = selected.text?.style.preset ?? 'clean';
    commit([
      { type: 'set_text_style', clipId: selected.id, patch: effectPatch(clipPreset, effect, clipRole, project.settings.aspect) },
      ...transitionActions(selected.id, transition),
    ], 'Text look');
    ui.toast('Effect + transition applied', 'success');
  };

  const seekTo = (clipId: string, start: number) => {
    useStore.getState().setPlayhead(start);
    useStore.getState().select([clipId]);
  };

  return (
    <div>
      <Section title="Add text">
        <div className="flex gap-1.5">
          {ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <button key={r.id} onClick={() => setRole(r.id)}
                title={`Add a ${r.label.toLowerCase()} at the playhead`}
                className={`chip flex-1 justify-center border ${role === r.id ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>
                <Icon size={12} /> {r.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((s) => {
            const style = textStyleFor(s, effect, role, project.settings.aspect);
            return (
              <div
                key={s}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(FALCONCUT_MIME, JSON.stringify({ kind: 'text', preset: payloadFor() }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => { setPreset(s); addText(); }}
                title={`Add a ${s} ${role} at the playhead, or drag onto the timeline — renders into the video`}
                className={`cursor-grab active:cursor-grabbing rounded-lg border overflow-hidden transition-all select-none ${preset === s ? 'ring-2 ring-signal border-transparent' : 'border-line hover:border-line-bright'}`}
              >
                <div className="aspect-video">
                  <StylePreview style={style} />
                </div>
                <div className="flex items-center justify-between px-2 py-1">
                  <span className={`text-[11px] font-medium capitalize ${preset === s ? 'text-signal' : 'text-paper-dim'}`}>{s}</span>
                  <Plus size={12} className="text-paper-faint" />
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <span className="label">Effect</span>
          <div className="flex flex-wrap gap-1">
            {TEXT_EFFECTS.map((e) => (
              <button key={e.id} title={e.hint} onClick={() => setEffect(e.id)}
                className={`chip border ${effect === e.id ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}>
                {e.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Transition</span>
          <div className="flex flex-wrap gap-1">
            {TEXT_TRANSITIONS.map((t) => (
              <button key={t.id} title={t.hint} onClick={() => setTransition(t.id)}
                className={`chip border ${transition === t.id ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-ghost w-full justify-center text-[11px]" onClick={addText}>
          <Plus size={13} /> Add {role} at playhead
        </button>
        {selected ? (
          <button className="btn-signal w-full justify-center text-[11px]" onClick={applyLookToSelected}>
            <WandSparkles size={13} /> Apply effect + transition to selected clip
          </button>
        ) : (
          <Hint>Click a style to add at the playhead, or drag it onto the timeline. Text is burned into the exported video.</Hint>
        )}
      </Section>

      <Section title={`Text clips (${textClips.length})`}>
        {textClips.length === 0 && <Hint>No text clips yet.</Hint>}
        {textClips.map((c) => (
          <button key={c.id} className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-800 border ${selection.includes(c.id) ? 'border-signal/50 bg-signal/5' : 'border-line'}`}
            onClick={() => seekTo(c.id, c.start)} title="Seek to start and select">
            <span className="text-[10px] text-paper-faint font-mono shrink-0">{fmtTime(c.start)}</span>
            <span className="text-xs text-paper truncate flex-1">{c.text?.text || '(empty)'}</span>
            <span className="text-[9px] uppercase shrink-0 px-1 rounded text-paper-faint">{c.text?.style.preset ?? defaultTextStyle().preset}</span>
            <span className={`text-[9px] uppercase shrink-0 px-1 rounded ${c.text?.role === 'title' ? 'text-signal' : 'text-paper-faint'}`}>{c.text?.role}</span>
          </button>
        ))}
      </Section>
    </div>
  );
}
