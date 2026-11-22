/** Manual caption creation & editing — always available, never depends on AI. */
import { useRef, useState } from 'react';
import { Copy, Clipboard, Scissors, Trash2, Plus, Split, Merge, Clock3, AlertTriangle, Download, Upload, Search } from 'lucide-react';
import { useStore } from '../../state/store';
import { commit, Section, Hint } from './shared';
import {
  uid, parseSubtitles, serializeSubtitles, subtitleCuesFromProject, buildSubtitleImportActions, type Action,
} from '../../../engine';
import { downloadBlob } from '../../../exporter/artifacts';
import { evenWords, presetTextStyle, type CinematicPresetId } from './textPresets';

const PREFS_KEY = 'falconcut.captionStudio.manualPrefs';
interface ManualPrefs { duration: number; preset: CinematicPresetId; offset: number; rangeStart: number; rangeEnd: number; format: 'srt' | 'vtt' | 'ass' }
const DEFAULTS: ManualPrefs = { duration: 2.5, preset: 'tiktok', offset: 0, rangeStart: 0, rangeEnd: 10, format: 'srt' };
function prefs(): ManualPrefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return DEFAULTS; }
}

interface Snapshot { text: string; style: unknown; words?: unknown; duration: number }

export function ManualCaptionTools() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const playhead = useStore((s) => s.playhead);
  const [p, setP] = useState<ManualPrefs>(prefs);
  const [newText, setNewText] = useState('');
  const [copied, setCopied] = useState<Snapshot | null>(null);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const captions = project.clips.filter((c) => c.text?.role === 'caption' && c.kind === 'text')
    .sort((a, b) => a.start - b.start);
  const selected = captions.filter((c) => selection.includes(c.id));
  const update = (patch: Partial<ManualPrefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const notify = (m: string) => { setMessage(m); window.setTimeout(() => setMessage(''), 3500); };

  const styleFor = () => presetTextStyle(p.preset, 'caption', project.settings.aspect);
  const trackId = () => project.tracks.find((t) => t.kind === 'text' && !t.locked)?.id
    ?? project.tracks.find((t) => t.kind === 'text')?.id;

  const addAt = (start: number, text: string, duration = p.duration) => {
    const actions: Action[] = [];
    let tid = trackId();
    if (!tid) { tid = uid('trk'); actions.push({ type: 'add_track', track: { id: tid, kind: 'text', name: 'Captions' } }); }
    const style = styleFor();
    actions.push({
      type: 'add_text', trackId: tid, start: Math.max(0, start), duration: Math.max(0.04, duration),
      text, role: 'caption', preset: style.preset, style, words: evenWords(text, duration),
    });
    commit(actions, 'Add caption manually');
    setNewText('');
  };

  const duplicate = () => {
    const actions: Action[] = [];
    for (const c of selected) actions.push({
      type: 'add_text', trackId: c.trackId, start: c.start + c.duration, duration: c.duration,
      text: c.text!.text, role: 'caption', preset: c.text!.style.preset,
      style: { ...c.text!.style }, words: c.text!.words?.map((w) => ({ ...w, style: w.style ? { ...w.style } : undefined })),
    });
    if (!actions.length) return notify('Select a caption first');
    commit(actions, 'Duplicate caption');
  };

  const remove = () => {
    if (!selected.length) return notify('Select a caption first');
    commit(selected.map((c) => ({ type: 'remove_clip' as const, clipId: c.id, ripple: false })), 'Delete caption');
  };

  const split = () => {
    if (!selected.length) return notify('Select a caption first');
    const actions = selected.map((c) => ({
      type: 'split_clip' as const, clipId: c.id,
      time: playhead > c.start && playhead < c.start + c.duration ? playhead : c.start + c.duration / 2,
    }));
    commit(actions, 'Split caption');
  };

  const merge = () => {
    if (selected.length < 2) return notify('Select two or more captions to merge');
    const list = [...selected].sort((a, b) => a.start - b.start);
    const first = list[0];
    const end = list[list.length - 1].start + list[list.length - 1].duration;
    const actions: Action[] = [{ type: 'trim_clip', clipId: first.id, start: first.start, duration: end - first.start }];
    for (const c of list.slice(1)) actions.push({ type: 'remove_clip', clipId: c.id, ripple: false });
    commit(actions, 'Merge captions');
  };

  const copy = () => {
    if (!selected[0]) return notify('Select a caption first');
    const c = selected[0];
    setCopied({ text: c.text!.text, style: { ...c.text!.style }, words: c.text!.words, duration: c.duration });
    notify('Caption copied');
  };
  const paste = () => {
    if (!copied) return notify('Nothing copied yet');
    const text = String(copied.text);
    addAt(playhead, text, copied.duration);
  };

  const applyDuration = () => {
    if (!selected.length) return notify('Select captions first');
    commit(selected.map((c) => ({ type: 'trim_clip' as const, clipId: c.id, start: c.start, duration: p.duration })), 'Apply caption duration');
  };
  const distribute = () => {
    if (!selected.length) return notify('Select captions first');
    const span = Math.max(0.1, p.rangeEnd - p.rangeStart);
    const each = span / selected.length;
    commit([...selected].sort((a, b) => a.start - b.start).map((c, i) => ({
      type: 'trim_clip' as const, clipId: c.id, start: p.rangeStart + i * each, duration: Math.max(0.1, each - 0.02),
    })), 'Distribute captions');
  };
  const alignToPlayhead = () => {
    if (!selected.length) return notify('Select captions first');
    commit(selected.map((c) => ({ type: 'trim_clip' as const, clipId: c.id, start: playhead, duration: c.duration })), 'Align to playhead');
  };
  const offsetSelected = () => {
    if (!selected.length || !p.offset) return;
    commit(selected.map((c) => ({ type: 'move_clip' as const, clipId: c.id, start: Math.max(0, c.start + p.offset) })),
      `Shift captions ${p.offset > 0 ? '+' : ''}${p.offset}s`);
  };

  const overlaps = captions.filter((c, i) => i > 0 && c.start < captions[i - 1].start + captions[i - 1].duration - 1e-6).length;
  const fixOverlaps = () => {
    const actions: Action[] = [];
    let cursor = 0;
    for (const c of captions) {
      const start = Math.max(c.start, cursor);
      if (Math.abs(start - c.start) > 1e-6) actions.push({ type: 'trim_clip', clipId: c.id, start, duration: c.duration });
      cursor = start + c.duration;
    }
    if (!actions.length) return notify('No overlaps found');
    commit(actions, 'Resolve caption overlaps');
  };

  const replaceAll = () => {
    if (!find) return notify('Enter text to find');
    let changed = 0;
    const actions: Action[] = [];
    for (const c of captions) {
      const text = c.text!.text;
      if (!text.toLowerCase().includes(find.toLowerCase())) continue;
      const next = text.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replace);
      const words = c.text!.words?.length === next.split(/\s+/).filter(Boolean).length
        ? c.text!.words.map((w, i) => ({ ...w, w: next.split(/\s+/).filter(Boolean)[i] })) : undefined;
      actions.push({ type: 'set_text', clipId: c.id, text: next, words });
      changed++;
    }
    if (!changed) return notify('No matches');
    commit(actions, `Replace “${find}”`);
    notify(`Replaced in ${changed} captions`);
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    const format = file.name.toLowerCase().endsWith('.ass') ? 'ass' : file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
    const result = parseSubtitles(text, format);
    if (result.errors.length) return notify(result.errors[0].message);
    const actions = buildSubtitleImportActions(project, result.cues, {
      trackId: uid('trk'), trackName: `Imported ${format.toUpperCase()}`, preset: styleFor().preset,
    });
    commit(actions, `Import ${format.toUpperCase()} captions`);
    notify(`Imported ${result.cues.length} captions`);
    if (fileRef.current) fileRef.current.value = '';
  };

  const exportFile = () => {
    const tracks = [...new Set(captions.map((c) => c.trackId))];
    const cues = tracks.flatMap((t) => subtitleCuesFromProject(project, t));
    if (!cues.length) return notify('No captions to export');
    let text: string;
    let mime = 'text/plain';
    if (p.format === 'srt' || p.format === 'vtt' || p.format === 'ass') {
      const out = serializeSubtitles(cues, p.format);
      if (out.errors.length) return notify(out.errors[0].message);
      text = out.text;
      mime = p.format === 'vtt' ? 'text/vtt' : 'text/plain';
    } else text = cues.map((c) => c.text).join('\n');
    downloadBlob(new Blob([text], { type: mime }), `${project.name}.${p.format}`);
    if (outWarnings(p.format)) notify(outWarnings(p.format)!);
  };
  const outWarnings = (format: string) => format === 'ass' ? 'ASS exports plain text only (no styling).' : '';

  const exportJson = () => {
    downloadBlob(new Blob([JSON.stringify(captions.map((c) => ({
      text: c.text!.text, start: c.start, duration: c.duration, style: c.text!.style, words: c.text!.words, role: c.text!.role,
    })), null, 2)], { type: 'application/json' }), `${project.name}.captions.json`);
  };

  return (
    <div>
      <Section title="Manual caption editor">
        <textarea className="field w-full text-xs min-h-[64px] resize-y" placeholder="Type or paste caption text. Unicode and right-to-left text are supported."
          value={newText} onChange={(e) => setNewText(e.target.value)} dir="auto" />
        <div className="flex gap-1.5">
          <button className="btn-signal flex-1 justify-center text-xs" onClick={() => addAt(playhead, newText || 'New caption')} title="Add at the current playhead">
            <Plus size={13} /> Add at playhead
          </button>
          <button className="btn-solid justify-center text-xs px-2" onClick={copy} title="Copy selected caption"><Copy size={13} /></button>
          <button className="btn-solid justify-center text-xs px-2" onClick={paste} disabled={!copied} title="Paste at playhead"><Clipboard size={13} /></button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <button className="btn-solid justify-center text-[10px]" onClick={duplicate}><Copy size={11} /> Duplicate</button>
          <button className="btn-solid justify-center text-[10px]" onClick={split}><Scissors size={11} /> Split</button>
          <button className="btn-solid justify-center text-[10px]" onClick={merge}><Merge size={11} /> Merge</button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <button className="btn-solid justify-center text-[10px]" onClick={() => selected[0] && addAt(Math.max(0, selected[0].start - p.duration), selected[0].text!.text)}>Insert before</button>
          <button className="btn-solid justify-center text-[10px]" onClick={() => selected[0] && addAt(selected[0].start + selected[0].duration, selected[0].text!.text)}>Insert after</button>
          <button className="btn-solid justify-center text-[10px] hover:text-heat" onClick={remove}><Trash2 size={11} /> Delete</button>
        </div>
        <button className="btn-ghost w-full justify-center text-[11px]" onClick={() => useStore.getState().select(captions.map((c) => c.id))}>Select all captions ({captions.length})</button>
        <button className="btn-ghost w-full justify-center text-[11px] hover:text-heat" disabled={!captions.length}
          onClick={() => { if (window.confirm(`Delete all ${captions.length} captions? This can be undone.`)) commit(captions.map((c) => ({ type: 'remove_clip' as const, clipId: c.id, ripple: false })), 'Clear captions'); }}>
          Clear all captions
        </button>
        {message && <p className="text-[11px] text-signal">{message}</p>}
      </Section>

      <Section title="Caption timing tools">
        <div className="flex items-end gap-1.5">
          <label className="flex-1"><span className="label">Default duration</span>
            <input type="number" min={0.2} max={30} step={0.1} className="field py-1 text-xs" value={p.duration} onChange={(e) => update({ duration: Number(e.target.value) })} /></label>
          <button className="btn-solid text-[11px] px-2" onClick={applyDuration}><Clock3 size={12} /> Apply</button>
        </div>
        <div className="flex items-end gap-1.5">
          <label className="flex-1"><span className="label">Offset (seconds)</span>
            <input type="number" step={0.1} className="field py-1 text-xs" value={p.offset} onChange={(e) => update({ offset: Number(e.target.value) })} /></label>
          <button className="btn-solid text-[11px] px-2" onClick={offsetSelected}>Shift</button>
        </div>
        <button className="btn-ghost w-full justify-center text-[11px]" onClick={alignToPlayhead}>Align selected to playhead</button>
        <div className="grid grid-cols-2 gap-1.5">
          <label><span className="label">Range start</span><input type="number" className="field py-1 text-xs" value={p.rangeStart} onChange={(e) => update({ rangeStart: Number(e.target.value) })} /></label>
          <label><span className="label">Range end</span><input type="number" className="field py-1 text-xs" value={p.rangeEnd} onChange={(e) => update({ rangeEnd: Number(e.target.value) })} /></label>
        </div>
        <button className="btn-ghost w-full justify-center text-[11px]" onClick={distribute}>Distribute selected across range</button>
        {overlaps > 0 && <div className="rounded-lg border border-heat-amber/40 p-2 text-[11px] text-heat-amber">
          <span className="flex items-center gap-1"><AlertTriangle size={12} /> {overlaps} overlapping caption{overlaps === 1 ? '' : 's'}</span>
          <button className="btn-ghost w-full justify-center text-[10px] mt-1" onClick={fixOverlaps}>Resolve overlaps</button>
        </div>}
        <Hint>These are editing conveniences for manual captions — they do not claim speech synchronization.</Hint>
      </Section>

      <Section title="Find & replace">
        <div className="flex gap-1.5">
          <input className="field flex-1 min-w-0 py-1 text-xs" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
          <input className="field flex-1 min-w-0 py-1 text-xs" placeholder="Replace" value={replace} onChange={(e) => setReplace(e.target.value)} />
        </div>
        <button className="btn-ghost w-full justify-center text-[11px]" onClick={replaceAll}><Search size={12} /> Replace in all captions</button>
      </Section>

      <Section title="Caption shortcuts">
        <Hint>Ctrl/Cmd+Alt+C add at playhead · +D duplicate · +S split · +Backspace delete · +Left/Right nudge 0.1s (Shift = 1s). Undo/redo use the standard Ctrl/Cmd+Z / Y.</Hint>
      </Section>

      <Section title="Subtitle files">
        <div className="flex gap-1.5">
          <select className="field flex-1 py-1 text-xs" value={p.format} onChange={(e) => update({ format: e.target.value as ManualPrefs['format'] })}>
            <option value="srt">SRT</option><option value="vtt">WebVTT</option><option value="ass">ASS</option>
          </select>
          <button className="btn-solid text-[11px] px-2" onClick={exportFile}><Download size={12} /> Export</button>
          <button className="btn-solid text-[11px] px-2" onClick={exportJson} title="Export editable caption JSON">JSON</button>
        </div>
        <button className="btn-ghost w-full justify-center text-[11px]" onClick={() => fileRef.current?.click()}><Upload size={12} /> Import SRT / VTT / ASS</button>
        <input ref={fileRef} type="file" accept=".srt,.vtt,.ass" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
        <Hint>Imports create a new editable caption track. Original timestamps and text are preserved.</Hint>
      </Section>
    </div>
  );
}
