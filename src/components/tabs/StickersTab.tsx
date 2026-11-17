import { useRef } from 'react';
import { ImagePlus, CircleSlash } from 'lucide-react';
import { defaultTransform } from '../../../engine';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { commit, Section, Hint } from './shared';
import { CUTFLOW_MIME } from '../MediaTab';

const EMOJIS = [
  '😀','😂','🥲','😍','😎','🤯','🥳','😴','🤔','🫠','😤','😱',
  '👍','👏','🙌','💪','🤝','✌️','🫶','🙏','👀','🧠','🔥','✨',
  '❤️','💔','⭐','💡','🚀','🎯','📈','💰','🎁','⚡','🌙','☀️',
  '🍕','☕','🍿','🎮','🎧','📱','💻','🏆','📌','🔗','❌','✅',
];

export function StickersTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const ui = useUI();

  const addEmoji = (emoji: string) => {
    const p = useStore.getState().project;
    const actions = [];
    if (!p.tracks.some((t) => t.kind === 'text')) actions.push({ type: 'add_track' as const, track: { kind: 'text' as const } });
    actions.push({
      type: 'add_text' as const,
      start: useStore.getState().playhead,
      duration: 2,
      text: emoji,
      role: 'title' as const,
      preset: 'word-pop' as const,
      style: { fontSize: 0.12 },
    });
    commit(actions, `Add emoji ${emoji}`);
  };

  const importImage = async (files: File[]) => {
    if (!files.length) return;
    const before = new Set(useStore.getState().project.media.map((m) => m.id));
    try {
      await useStore.getState().importFiles(files, { addToTimeline: false });
      const p = useStore.getState().project;
      const fresh = p.media.find((m) => !before.has(m.id) && (m.type === 'image'));
      if (!fresh) { ui.toast('Import did not produce an image asset', 'error'); return; }
      const track = p.tracks.find((t) => t.kind === 'video');
      if (!track) { ui.toast('No video track', 'error'); return; }
      commit([{
        type: 'add_clip',
        clip: {
          trackId: track.id, mediaId: fresh.id, start: useStore.getState().playhead,
          duration: Math.max(1, fresh.duration || 3), inPoint: 0,
          transform: { ...defaultTransform(), scale: 0.35 },
        },
      }], `Add sticker ${fresh.name}`);
      ui.toast(`${fresh.name} added as sticker (35% scale)`, 'success');
    } catch (e) {
      ui.toast(`Import failed: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <div>
      <Section title="Emoji stickers">
        <div className="grid grid-cols-8 gap-1">
          {EMOJIS.map((e) => (
            <button key={e} draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData(CUTFLOW_MIME, JSON.stringify({ kind: 'sticker', value: e }));
                ev.dataTransfer.effectAllowed = 'copy';
              }}
              className="aspect-square flex items-center justify-center rounded-md text-lg cursor-grab active:cursor-grabbing hover:bg-ink-750 border border-transparent hover:border-line transition-colors select-none"
              onClick={() => addEmoji(e)} title={`Add ${e} at playhead — or drag to the timeline`}>{e}</button>
          ))}
        </div>
        <p className="text-[11px] text-paper-faint">Adds a large emoji text clip (word-pop preset) at the playhead, or drop onto the timeline.</p>
      </Section>

      <Section title="Image stickers">
        <input ref={inputRef} type="file" accept="image/png,image/gif" className="hidden"
          onChange={(e) => { void importImage(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <button className="btn-signal w-full" onClick={() => inputRef.current?.click()}><ImagePlus size={14} /> Import PNG / GIF</button>
        <p className="text-[11px] text-paper-faint">Added on the video track at the playhead at 35% scale. Animated GIF plays as static image (Partial).</p>
      </Section>

      <Section title="Lottie">
        <div className="flex items-center gap-2 text-[11px] text-paper-faint px-2 py-1.5 rounded-md border border-line bg-ink-850">
          <CircleSlash size={13} className="shrink-0" />
          <span>Not available in browser yet.</span>
        </div>
      </Section>
    </div>
  );
}
