import { useId, useState } from 'react';
import { ArrowRight, Check, MessageSquare, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { projectDuration, uid, type Clip, type Tack } from '../../engine/types';
import type { Action } from '../../engine/actions';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mind focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900';

function NoteCard({ tack, clip, duration }: { tack: Tack; clip?: Clip; duration: number }) {
  const toast = useUI((s) => s.toast);
  const [reply, setReply] = useState('');
  const id = useId();

  const edit = (action: Action, label: string) => {
    try {
      useStore.getState().commit([action], label);
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : `Could not ${label.toLowerCase()}`, 'error');
      return false;
    }
  };

  const seek = () => {
    const store = useStore.getState();
    store.pause();
    store.setPlayhead(tack.time);
    store.select(clip ? [clip.id] : []);
  };

  const sendReply = () => {
    const text = reply.trim();
    if (!text) return;
    if (edit({ type: 'reply_tack', tackId: tack.id, author: 'user', text }, 'Reply to note')) {
      setReply('');
      toast('Reply added', 'success');
    }
  };

  const remove = () => {
    if (!window.confirm(`Remove this note at ${tack.time.toFixed(2)}s and all ${tack.replies.length} replies?`)) return;
    if (edit({ type: 'remove_tack', tackId: tack.id }, 'Remove note')) toast('Note removed', 'success');
  };

  return (
    <li className={`panel p-2.5 space-y-2 ${tack.resolved ? '' : 'border-mind/30'}`}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={`btn-solid px-2 py-1 text-[11px] font-mono ${focus}`} onClick={seek} aria-label={`Go to note at ${tack.time.toFixed(2)} seconds${clip ? ` and select ${clip.name || clip.kind}` : ''}`}><ArrowRight size={12} aria-hidden="true" /> {tack.time.toFixed(2)}s</button>
        <span className={`chip ${tack.resolved ? 'bg-signal/10 text-signal' : 'bg-mind/10 text-mind'}`}>{tack.resolved ? 'Resolved' : 'Open'}</span>
      </div>
      {tack.clipId && <p className="text-[11px] text-paper-dim break-words">{clip ? `Attached clip: ${clip.name || clip.kind}` : 'Attached clip is no longer in the timeline.'}</p>}
      {tack.time > duration && <p className="text-[11px] text-heat-amber">This note is past the current timeline end. Seeking stops at the end.</p>}
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{tack.text}</p>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[10px] text-paper-dim">
        <span className={tack.author === 'ai' ? 'text-mind' : 'text-paper'}>{tack.author === 'ai' ? 'AI' : 'You'}</span>
        <time dateTime={new Date(tack.createdAt).toISOString()}>{new Date(tack.createdAt).toLocaleString()}</time>
      </div>
      {tack.replies.length > 0 && (
        <ol className="space-y-2 border-l border-mind/30 pl-2" aria-label="Note replies">
          {tack.replies.map((item, index) => (
            <li key={`${item.at}-${index}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 text-[10px] text-paper-dim">
                <span className={item.author === 'ai' ? 'text-mind' : 'text-paper'}>{item.author === 'ai' ? 'AI' : 'You'}</span>
                <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleString()}</time>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-paper-dim">{item.text}</p>
            </li>
          ))}
        </ol>
      )}
      <form className="space-y-1.5" onSubmit={(event) => { event.preventDefault(); sendReply(); }}>
        <label className="label" htmlFor={`${id}-reply`}>Reply as you</label>
        <textarea id={`${id}-reply`} className={`field resize-y text-xs ${focus}`} rows={2} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Add a reply to this note" required />
        <button type="submit" className={`btn-solid px-2 py-1 text-[11px] ${focus}`} disabled={!reply.trim()}>Add reply</button>
      </form>
      <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
        <button type="button" className={`btn-solid px-2 py-1 text-[11px] ${focus}`} onClick={() => {
          if (edit({ type: 'resolve_tack', tackId: tack.id, resolved: !tack.resolved }, tack.resolved ? 'Reopen note' : 'Resolve note')) toast(tack.resolved ? 'Note reopened' : 'Note resolved', 'success');
        }}>{tack.resolved ? <RotateCcw size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}{tack.resolved ? 'Reopen note' : 'Resolve note'}</button>
        <button type="button" className={`btn-ghost px-2 py-1 text-[11px] hover:text-heat ${focus}`} onClick={remove}><Trash2 size={12} aria-hidden="true" /> Remove note</button>
      </div>
    </li>
  );
}

export function NotesPanel() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const selection = useStore((s) => s.selection);
  const toast = useUI((s) => s.toast);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState('');
  const id = useId();
  const selectedClips = project.clips.filter((clip) => selection.includes(clip.id));
  const attachedClipId = selectedClips.some((clip) => clip.id === attachment) ? attachment : '';
  const tacks = [...project.tacks].sort((a, b) => a.time - b.time || a.createdAt - b.createdAt);
  const openCount = tacks.filter((tack) => !tack.resolved).length;
  const duration = projectDuration(project);

  const addNote = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const store = useStore.getState();
      const clipId = store.selection.includes(attachedClipId) && store.project.clips.some((clip) => clip.id === attachedClipId) ? attachedClipId : undefined;
      store.commit([{ type: 'add_tack', tack: { id: uid('tack'), time: store.playhead, text: trimmed, author: 'user', clipId } }], 'Add note at playhead');
      setText('');
      toast('Note added at playhead', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not add note', 'error');
    }
  };

  return (
    <section className="p-2.5 space-y-3" aria-labelledby={`${id}-heading`}>
      <header className="flex items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="flex items-center gap-1.5 font-display text-sm font-semibold"><MessageSquare size={15} aria-hidden="true" /> Pinned notes</h2>
        <span className="text-[11px] text-paper-dim">{openCount} open · {tacks.length - openCount} resolved</span>
      </header>
      <form className="panel p-2.5 space-y-2" onSubmit={(event) => { event.preventDefault(); addNote(); }}>
        <div>
          <label htmlFor={`${id}-text`} className="label">New note</label>
          <textarea id={`${id}-text`} className={`field resize-y text-xs ${focus}`} rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder="What needs attention at this moment?" required />
        </div>
        <div>
          <label htmlFor={`${id}-attachment`} className="label">Attach to selected clip (optional)</label>
          <select id={`${id}-attachment`} className={`field text-xs ${focus}`} value={attachedClipId} onChange={(event) => setAttachment(event.target.value)} disabled={selectedClips.length === 0} aria-describedby={`${id}-attachment-help`}>
            <option value="">Timeline only</option>
            {selectedClips.map((clip) => <option key={clip.id} value={clip.id}>{clip.name || clip.kind} · {clip.start.toFixed(2)}s</option>)}
          </select>
          <p id={`${id}-attachment-help`} className="mt-1 text-[11px] text-paper-dim">{selectedClips.length === 0 ? 'Select a clip in the timeline to attach it.' : 'The note stays pinned to the playhead time, not the clip start.'}</p>
        </div>
        <button type="submit" className={`btn-signal w-full text-xs ${focus}`} disabled={!text.trim()}><Plus size={13} aria-hidden="true" /> Add note at {playhead.toFixed(2)}s</button>
      </form>
      {tacks.length === 0 ? (
        <p className="panel p-3 text-xs text-paper-dim">No notes yet. Move the playhead to a moment and add a note above.</p>
      ) : (
        <ol className="space-y-2" aria-label="Notes in timeline order">
          {tacks.map((tack) => <NoteCard key={`${project.id}-${tack.id}`} tack={tack} clip={project.clips.find((clip) => clip.id === tack.clipId)} duration={duration} />)}
        </ol>
      )}
    </section>
  );
}
