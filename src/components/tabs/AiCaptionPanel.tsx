/**
 * AI caption creation — strictly on demand.
 * Importing this panel initialises nothing. Models are only downloaded when
 * the user explicitly presses Install, and transcription only starts when the
 * user presses Start Transcription. Audio stays on the device.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, Play, Square, Trash2, RefreshCw, CheckCircle2, Info } from 'lucide-react';
import { useStore } from '../../state/store';
import { getBlob } from '../../state/persistence';
import { transcriptClient } from '../../../analysis/transcript';
import { buildCues } from '../../../engine';
import { sourceToTimeline } from '../../../tools/helpers';
import { presetTextStyle, type CinematicPresetId } from './textPresets';
import { commit, Section, Hint } from './shared';
import {
  CAPTION_MODELS, installModel, isModelInstalled, modelBytes, formatBytes,
  deleteModel, clearModelCache, storageEstimate, cancelInstall,
  type LocalCaptionModel,
} from '../../features/captionStudio/models';

type Phase = 'idle' | 'installing' | 'ready' | 'extracting' | 'transcribing' | 'done' | 'error';

const PREFERENCES_KEY = 'falconcut.captionStudio.prefs';
interface Prefs { modelId: string; language: string; preset: CinematicPresetId; maxWords: number; maxSeconds: number; chunkSec: number }
const DEFAULT_PREFS: Prefs = {
  modelId: CAPTION_MODELS[0].id, language: '', preset: 'tiktok', maxWords: 12, maxSeconds: 6, chunkSec: 30,
};
function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') }; }
  catch { return DEFAULT_PREFS; }
}

export function AiCaptionPanel() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [installed, setInstalled] = useState<string[]>([]);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({});
  const [cues, setCues] = useState<{ text: string; start: number; end: number; words?: { w: string; start: number; end: number; timingEstimated?: boolean }[] }[]>([]);
  const [timingNote, setTimingNote] = useState('');
  const mediaIdRef = useRef<string>('');
  const startedRef = useRef(0);

  const media = project.media.filter((m) => (m.type === 'video' || m.type === 'audio') && m.blobKey && m.duration > 0);
  const onTimeline = new Set(project.clips.filter((c) => c.kind === 'media' && c.mediaId).map((c) => c.mediaId!));
  // Prefer the asset that is actually on the timeline: otherwise duplicate
  // imports produce a transcript for a clip that does not exist in the edit.
  const selectedMedia = media.find((m) => m.id === mediaIdRef.current)
    ?? media.find((m) => onTimeline.has(m.id))
    ?? media[0];
  const model = CAPTION_MODELS.find((m) => m.id === prefs.modelId) ?? CAPTION_MODELS[0];

  useEffect(() => {
    setInstalled(CAPTION_MODELS.filter((m) => isModelInstalled(m.id)).map((m) => m.id));
    void storageEstimate().then(setStorage);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);
  useEffect(() => {
    if (phase !== 'installing' && phase !== 'transcribing') return;
    const timer = setInterval(() => setElapsed(Math.floor((performance.now() - startedRef.current) / 1000)), 500);
    return () => clearInterval(timer);
  }, [phase]);

  const update = (p: Partial<Prefs>) => setPrefs((v) => ({ ...v, ...p }));

  const install = async (target: LocalCaptionModel = model) => {
    setError(''); setPhase('installing'); setProgress(0); setStage(`Requesting ${target.label}…`);
    startedRef.current = performance.now();
    try {
      await installModel(target, (p) => {
        setProgress(Math.max(0, Math.min(1, p.pct)));
        setStage(p.file ? `${p.note} · ${p.file}` : p.note);
      });
      setInstalled(CAPTION_MODELS.filter((m) => isModelInstalled(m.id)).map((m) => m.id));
      setPhase('ready');
      void storageEstimate().then(setStorage);
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  const transcribe = async () => {
    if (!selectedMedia) { setError('Import a video or audio file first.'); setPhase('error'); return; }
    setError(''); setCues([]); setTimingNote(''); setPhase('extracting'); setProgress(0); setStage('Decoding local audio…');
    startedRef.current = performance.now();
    try {
      const blob = await getBlob(selectedMedia.blobKey!);
      if (!blob) throw new Error('The media blob is no longer available. Re-import the file.');
      const ctx = new AudioContext();
      let buffer: AudioBuffer;
      try { buffer = await ctx.decodeAudioData(await blob.arrayBuffer()); }
      finally { void ctx.close(); }
      setPhase('transcribing');
      const result = await transcriptClient.transcribe(buffer, model.id, prefs.language.trim() || undefined, (p) => {
        setProgress(Math.max(0, Math.min(1, p.pct)));
        setStage(p.note ?? p.stage);
      }, { chunkSec: prefs.chunkSec, overlapSec: 2 });
      const built = buildCues(result.words, 34, 2, 0.7, {
        maxCueSec: prefs.maxSeconds, targetCps: 18, sentenceBreak: true, removeFillers: false,
      });
      setCues(built.map((c) => ({
        text: c.text, start: c.start, end: c.end,
        words: c.words.map((w) => ({ ...w, timingEstimated: w.timingEstimated || result.estimated })),
      })));
      setTimingNote(result.note ?? '');
      // Persist the real transcript in the project so the existing "Generate
      // captions" tool and the rest of the editor can use it too.
      useStore.getState().commit([{
        type: 'set_transcript', mediaId: selectedMedia.id,
        transcript: {
          segments: result.segments, words: result.words,
          language: result.language, model: result.model, complete: true,
        },
      }], 'Store AI transcription');
      setPhase('done');
    } catch (e) {
      const err = e as Error;
      setError(err.name === 'AbortError' || err.message === 'Cancelled by user' ? 'Transcription cancelled.' : err.message);
      setPhase('error');
    }
  };

  const cancel = () => { cancelInstall(); setPhase('idle'); setProgress(0); setStage(''); };

  const addToTimeline = () => {
    if (!cues.length || !selectedMedia) return;
    const trackId = project.tracks.find((t) => t.kind === 'text' && !t.locked)?.id
      ?? project.tracks.find((t) => t.kind === 'text')?.id;
    const actions: import('../../../engine').Action[] = [];
    if (!trackId) actions.push({ type: 'add_track', track: { kind: 'text', name: 'AI Captions' } });
    const tid = trackId ?? 'new-ai-track';
    const style = presetTextStyle(prefs.preset, 'caption', project.settings.aspect);
    let added = 0;
    for (const c of cues) {
      const mappedStart = sourceToTimeline(project, selectedMedia.id, c.start);
      const mappedEnd = sourceToTimeline(project, selectedMedia.id, c.end);
      // If this asset is not on the timeline yet, keep the source times so the
      // captions are still created instead of silently disappearing.
      const start = mappedStart ?? c.start;
      const end = mappedEnd ?? c.end;
      if (end - start < 0.1) continue;
      const words = c.words ?? [];
      actions.push({
        type: 'add_text', trackId: tid, start, duration: end - start,
        text: c.text, role: 'caption', preset: style.preset, style,
        words: words.length ? words : undefined,
      });
      added++;
    }
    if (!added) { setError('No cues could be mapped to the timeline for this media.'); return; }
    commit(actions, `Add ${added} AI captions to timeline`);
    useStore.getState().setPlayhead(playhead);
    setCues([]);
  };

  const busy = phase === 'installing' || phase === 'transcribing' || phase === 'extracting';

  return (
    <div>
      <Section title="AI model library" action={
        <button className="icon-btn" title="Clear all cached models" onClick={() => void clearModelCache().then(() => {
          setInstalled([]); void storageEstimate().then(setStorage);
        })}><Trash2 size={14} /></button>
      }>
        <Hint>Models download only when you press Install. FalconCut never uploads your video or audio. Each listed file is under 70 MB.</Hint>
        <div className="space-y-1.5">
          {CAPTION_MODELS.map((m) => {
            const active = m.id === model.id;
            const done = installed.includes(m.id);
            return (
              <div key={m.id} className={`rounded-lg border p-2 ${active ? 'border-signal/50 bg-signal/5' : 'border-line'}`}>
                <button className="w-full text-left" onClick={() => { if (!busy) update({ modelId: m.id }); }}>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium ${active ? 'text-signal' : 'text-paper'}`}>{m.label}</span>
                    {done && <CheckCircle2 size={12} className="text-heat-green" />}
                  </div>
                  <div className="text-[10px] text-paper-faint">{m.languages} · {m.files.length} files · {formatBytes(modelBytes(m))} total</div>
                  {m.files.map((f) => (
                    <div key={f.path} className="text-[9px] text-paper-faint font-mono truncate">{f.path} · {formatBytes(f.bytes)}</div>
                  ))}
                </button>
                <div className="flex gap-1 mt-1.5">
                  <button className="chip border border-line text-[10px] flex-1 justify-center" disabled={busy || done}
                    onClick={() => { if (window.confirm(`Download ${m.label} (${formatBytes(modelBytes(m))}) from Hugging Face?`)) void install(m); }}>
                    {done ? 'Installed' : <><Download size={11} /> Install</>}
                  </button>
                  {done && <button className="chip border border-line text-[10px]" disabled={busy}
                    onClick={() => void deleteModel(m.id).then(() => setInstalled(CAPTION_MODELS.filter((x) => isModelInstalled(x.id)).map((x) => x.id)))}>
                    <Trash2 size={11} />
                  </button>}
                </div>
              </div>
            );
          })}
        </div>
        {storage.quota ? <p className="text-[10px] text-paper-faint">Browser storage: {formatBytes(storage.usage ?? 0)} used of {formatBytes(storage.quota)}.</p> : null}
      </Section>

      <Section title="Transcription">
        <label className="block">
          <span className="label">Media</span>
          <select className="field py-1 text-xs" value={selectedMedia?.id ?? ''} onChange={(e) => { mediaIdRef.current = e.target.value; }} disabled={busy}>
            {media.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.duration.toFixed(1)}s)</option>)}
          </select>
        </label>
        {media.length === 0 && <Hint>Import a video with audio first. No audio is extracted until you press Start Transcription.</Hint>}
        <label className="block">
          <span className="label">Language (blank = auto-detect)</span>
          <input className="field py-1 text-xs" value={prefs.language} placeholder="e.g. en, ur" onChange={(e) => update({ language: e.target.value })} disabled={busy} />
        </label>
        <label className="block">
          <span className="label">Caption style</span>
          <select className="field py-1 text-xs" value={prefs.preset} onChange={(e) => update({ preset: e.target.value as CinematicPresetId })} disabled={busy}>
            {['tiktok', 'karaoke', 'beast', 'focus', 'mogul', 'minimal', 'podcast', 'gaming', 'cinematic'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <div className="flex gap-1.5">
          <label className="flex-1"><span className="label">Max words / cue</span>
            <input type="number" min={3} max={30} className="field py-1 text-xs" value={prefs.maxWords}
              onChange={(e) => update({ maxWords: Math.max(3, Math.min(30, Number(e.target.value) || 12)) })} disabled={busy} /></label>
          <label className="flex-1"><span className="label">Max cue sec</span>
            <input type="number" min={1} max={20} className="field py-1 text-xs" value={prefs.maxSeconds}
              onChange={(e) => update({ maxSeconds: Math.max(1, Math.min(20, Number(e.target.value) || 6)) })} disabled={busy} /></label>
        </div>
        <label className="block">
          <span className="label">Chunk duration (long videos)</span>
          <select className="field py-1 text-xs" value={prefs.chunkSec} onChange={(e) => update({ chunkSec: Number(e.target.value) })} disabled={busy}>
            <option value={15}>15 seconds — low memory</option>
            <option value={30}>30 seconds — balanced</option>
            <option value={45}>45 seconds — fewer chunks</option>
          </select>
        </label>
        <Hint>Long videos are processed in overlapping chunks with preserved timestamps. Shorter chunks use less memory on low-RAM devices.</Hint>
        {busy && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden"><div className="h-full cf-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <p className="text-[10px] text-paper-dim">{stage} · {Math.round(progress * 100)}% · {elapsed}s</p>
            <button className="btn-ghost w-full justify-center text-[11px]" onClick={cancel}><Square size={12} /> Cancel</button>
          </div>
        )}
        {phase === 'error' && <div className="flex items-center gap-2"><p className="text-heat text-[11px] flex-1">{error}</p>
          <button className="icon-btn" title="Retry" onClick={() => { void transcribe(); }}><RefreshCw size={13} /></button></div>}
        <button className="btn-signal w-full justify-center text-xs" disabled={busy || !selectedMedia || !installed.includes(model.id)}
          onClick={() => void transcribe()} title={!installed.includes(model.id) ? 'Install a model first' : 'Extract audio and transcribe locally'}>
          <Play size={13} /> Start transcription
        </button>
        <p className="text-[10px] text-paper-faint"><Info size={10} className="inline" /> Word timing comes from recognition where available; if the engine estimates it, the caption remains editable for manual correction.</p>
      </Section>

      {cues.length > 0 && (
        <Section title={`Transcription result (${cues.length} cues)`}>
          <Hint>Review below, then add the captions to the timeline. Nothing is added until you confirm.</Hint>
          {timingNote && <div className="rounded-lg border border-heat-amber/40 p-2 text-[11px] text-heat-amber">
            <Info size={11} className="inline mr-1" />{timingNote}
          </div>}
          <div className="max-h-52 overflow-y-auto space-y-1">
            {cues.map((c, i) => <div key={i} className="rounded border border-line px-2 py-1 text-[11px] text-paper-dim">
              <span className="font-mono text-paper-faint mr-1">{c.start.toFixed(1)}s</span>{c.text}
            </div>)}
          </div>
          <button className="btn-solid w-full justify-center text-xs" onClick={addToTimeline}>Add to timeline</button>
        </Section>
      )}
    </div>
  );
}
