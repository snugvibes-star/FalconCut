import { Type, AlignLeft } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { commit, Section, Hint } from './shared';
import { CUTFLOW_MIME } from '../MediaTab';
import type { TextData } from '../../../engine';

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Serializable add_text params carried to the Timeline drop zone. */
interface TextPresetDrop {
  text: string;
  role: TextData['role'];
  duration: number;
}

const PRESETS: { id: string; label: string; params: TextPresetDrop; icon: typeof Type; previewCls: string }[] = [
  { id: 'title', label: 'Title', params: { text: 'Your title', role: 'title', duration: 3 }, icon: Type, previewCls: 'text-sm font-bold text-paper' },
  { id: 'caption', label: 'Caption', params: { text: 'Caption text', role: 'caption', duration: 3 }, icon: AlignLeft, previewCls: 'text-[11px] text-paper-dim' },
];

export function TextTab() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const ui = useUI();
  const textClips = project.clips.filter((c) => c.kind === 'text').sort((a, b) => a.start - b.start);

  const addText = (role: TextData['role']) => {
    const p = useStore.getState().project;
    const actions = [];
    if (!p.tracks.some((t) => t.kind === 'text')) actions.push({ type: 'add_track' as const, track: { kind: 'text' as const } });
    actions.push({ type: 'add_text' as const, start: playhead, duration: 3, text: role === 'title' ? 'Your title' : 'Caption text', role });
    commit(actions, `Add ${role}`);
    ui.toast(`${role === 'title' ? 'Title' : 'Caption'} added at playhead`, 'success');
  };

  const seekTo = (clipId: string, start: number) => {
    useStore.getState().setPlayhead(start);
    useStore.getState().select([clipId]);
  };

  return (
    <div>
      <Section title="Add text">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(CUTFLOW_MIME, JSON.stringify({ kind: 'text', preset: p.params }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => addText(p.params.role)}
                title={`${p.label} — drag to timeline or click to add at playhead`}
                className="cursor-grab active:cursor-grabbing rounded-lg border border-line bg-ink-850 hover:bg-ink-800 hover:border-line-bright px-2 py-2.5 flex flex-col items-center gap-1.5 transition-colors select-none"
              >
                <div className="w-full h-9 rounded-md bg-ink-900 border border-line flex items-center justify-center overflow-hidden px-1">
                  <span className={`truncate ${p.previewCls}`}>{p.params.text}</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-paper-dim">
                  <Icon size={12} />
                  <span>{p.label}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-paper-faint">Added at the playhead, or drop onto the timeline. Edit content and style in the Inspector.</p>
      </Section>

      <Section title={`Text clips (${textClips.length})`}>
        {textClips.length === 0 && <Hint>No text clips yet.</Hint>}
        {textClips.map((c) => (
          <button key={c.id} className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-800 border border-line"
            onClick={() => seekTo(c.id, c.start)} title="Seek to start and select">
            <span className="text-[10px] text-paper-faint font-mono shrink-0">{fmtTime(c.start)}</span>
            <span className="text-xs text-paper truncate flex-1">{c.text?.text || '(empty)'}</span>
            <span className={`text-[9px] uppercase shrink-0 px-1 rounded ${c.text?.role === 'title' ? 'text-signal' : 'text-paper-faint'}`}>{c.text?.role}</span>
          </button>
        ))}
      </Section>
    </div>
  );
}
