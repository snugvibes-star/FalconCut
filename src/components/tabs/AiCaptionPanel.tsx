/**
 * AI caption creation — strictly on demand.
 * Importing this panel initialises nothing. Models are only downloaded when
 * the user explicitly presses Install, and transcription only starts when the
 * user presses Start Transcription. Audio stays on the device.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, Play, Square, Trash2, RefreshCw, CheckCircle2, Info, Pause, RotateCcw } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { getBlob } from '../../state/persistence';
import { transcriptClient } from '../../../analysis/transcript';
import { toMono, resampleLinear } from '../../../analysis/audioAnalysis';
import { segmentWords } from '../../../analysis/textAnalysis';
import { TranscriptionJob, autoChunkSec, type JobProgress, type JobResult } from '../../../analysis/transcriptionJob';
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
interface Prefs { modelId: string; language: string; preset: CinematicPresetId; maxWords: number; maxSeconds: number; chunkSec: number; autoRetry: boolean; overlapSec: number }
const DEFAULT_PREFS: Prefs = {
  modelId: CAPTION_MODELS[0].id, language: '', preset: 'tiktok', maxWords: 12, maxSeconds: 6,
  chunkSec: 30, autoRetry: true, overlapSec: 1,
};
function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') }; }
  catch { return DEFAULT_PREFS; }
}

export function AiCaptionPanel() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const ui = useUI();
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
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [paused, setPaused] = useState(false);
  const jobRef = useRef<TranscriptionJob | null>(null);
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
    if (phase !== 'installing') return;
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

  const applyResult = (result: JobResult, partial = false) => {
    const built = buildCues(result.words, 34, 2, 0.7, {
      maxCueSec: prefs.maxSeconds, targetCps: 18, sentenceBreak: true, removeFillers: false,
    });
    setCues(built.map((c) => ({
      text: c.text, start: c.start, end: c.end,
      words: c.words.map((w) => ({ ...w, timingEstimated: w.timingEstimated || result.estimated })),
    })));
    setTimingNote([partial ? 'Partial result — some chunks failed and were not included.' : '', result.note ?? ''].filter(Boolean).join(' '));
    if (!partial && selectedMedia) {
      // Persist the real transcript in the project so the existing "Generate
      // captions" tool and the rest of the editor can use it too.
      useStore.getState().commit([{
        type: 'set_transcript', mediaId: selectedMedia.id,
        transcript: {
          segments: segmentWords(result.words), words: result.words,
          language: result.language, model: model.id, complete: true,
        },
      }], 'Store AI transcription');
    }
  };

  const transcribe = async () => {
    if (!selectedMedia) { setError('Import a video or audio file first.'); setPhase('error'); return; }
    setError(''); setCues([]); setTimingNote(''); setJobProgress(null); setPaused(false);
    setPhase('extracting'); setProgress(0); setStage('Decoding local audio…');
    startedRef.current = performance.now();
    try {
      const blob = await getBlob(selectedMedia.blobKey!);
      if (!blob) throw new Error('The media blob is no longer available. Re-import the file.');
      const ctx = new AudioContext();
      let buffer: AudioBuffer;
      try { buffer = await ctx.decodeAudioData(await blob.arrayBuffer()); }
      finally { void ctx.close(); }
      const resampled = resampleLinear(toMono(buffer), buffer.sampleRate, 16000);
      const chunkSec = autoChunkSec(selectedMedia.duration);
      setPhase('transcribing');
      const job = new TranscriptionJob(transcriptClient, {
        audio: resampled,
        durationSec: buffer.duration,
        model: model.id,
        language: prefs.language.trim() || undefined,
        chunkSec,
        overlapSec: Math.min(chunkSec - 5, Math.max(0.5, prefs.overlapSec)),
        autoRetry: prefs.autoRetry,
        onProgress: (p) => {
          setJobProgress(p);
          setProgress(p.pct);
          setStage(p.stage);
          setElapsed(p.elapsed);
        },
        onDone: (result) => {
          applyResult(result);
          setPhase('done');
          ui.toast('Transcription complete — review your captions', 'success');
        },
        onError: (message, partial) => {
          if (partial) applyResult(partial, true);
          setError(message);
          setPhase('error');
        },
      });
      jobRef.current = job;
      job.start();
    } catch (e) {
      const err = e as Error;
      setError(err.name === 'AbortError' || err.message === 'Cancelled by user' ? 'Transcription cancelled.' : err.message);
      setPhase('error');
    }
  };

  const togglePause = () => {
    if (!jobRef.current) return;
    if (paused) { jobRef.current.resume(); setPaused(false); }
    else { jobRef.current.pause(); setPaused(true); }
  };
  const retryFailed = () => {
    if (!jobRef.current) { void transcribe(); return; }
    setError(''); setPhase('transcribing'); jobRef.current.retryFailed();
  };
  const cancel = () => {
    jobRef.current?.cancel();
    jobRef.current = null;
    cancelInstall();
    setPhase('idle'); setProgress(0); setStage(''); setJobProgress(null); setPaused(false);
  };

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

      <Section title="AI Processing Settings">
        <button className={`chip w-full justify-center border ${prefs.autoRetry ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}
          onClick={() => update({ autoRetry: !prefs.autoRetry })}>
          Automatic retry for failed segments: {prefs.autoRetry ? 'on' : 'off'}
        </button>
        <Hint>Chunk length and overlap are chosen automatically from video length and device memory. The model is loaded once per session and reused for every segment. Completed segments are kept on pause, cancel and failure.</Hint>
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
        <Hint>Chunking, cue length and word limits are chosen automatically from the video length and available device memory. Nothing is downloaded or processed until you press Start.</Hint>
        {jobProgress && phase !== 'done' && (
          <div className="rounded-lg border border-line bg-ink-850 p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-paper-dim">
              <span className="truncate">{selectedMedia?.name}</span>
              <span>{selectedMedia ? `${Math.floor(selectedMedia.duration / 60)}:${String(Math.floor(selectedMedia.duration % 60)).padStart(2, '0')}` : ''}</span>
            </div>
            <p className="text-[10px] text-paper-faint">{model.label} · {jobProgress.chunkSec}s chunks · {jobProgress.total} segments · overlap {jobProgress.overlapSec}s</p>
            <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden"><div className="h-full cf-progress-bar" style={{ width: `${Math.round(jobProgress.pct * 100)}%` }} /></div>
            <p className="text-[10px] text-paper-dim">{stage} · {Math.round(jobProgress.pct * 100)}% · {jobProgress.completed}/{jobProgress.total} done · {jobProgress.failed} failed · {jobProgress.elapsed}s{jobProgress.etaSec ? ` · ~${jobProgress.etaSec}s left` : ''}</p>
            <div className="max-h-24 overflow-y-auto grid grid-cols-2 gap-1">
              {jobProgress.chunks.map((c) => (
                <div key={c.index} className={`text-[9px] px-1 rounded border ${c.status === 'done' ? 'border-heat-green/30 text-heat-green' : c.status === 'failed' ? 'border-heat/40 text-heat' : c.status === 'processing' ? 'border-signal/40 text-signal' : 'border-line text-paper-faint'}`}>
                  {c.index + 1}: {c.start.toFixed(0)}–{c.end.toFixed(0)}s · {c.status}
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <button className="btn-ghost flex-1 justify-center text-[10px]" onClick={togglePause}>
                {paused ? <><Play size={11} /> Resume</> : <><Pause size={11} /> Pause</>}
              </button>
              <button className="btn-ghost flex-1 justify-center text-[10px]" onClick={cancel}><Square size={11} /> Cancel</button>
            </div>
          </div>
        )}
        {phase === 'error' && <div className="flex items-center gap-2"><p className="text-heat text-[11px] flex-1">{error}</p>
          {jobRef.current?.total ? (
            <button className="btn-solid text-[10px] px-2" onClick={retryFailed}><RotateCcw size={12} /> Retry failed</button>
          ) : (
            <button className="icon-btn" title="Retry" onClick={() => { void transcribe(); }}><RefreshCw size={13} /></button>
          )}</div>}
        <button className="btn-signal w-full justify-center text-xs" disabled={busy || !selectedMedia || !installed.includes(model.id)}
          onClick={() => void transcribe()} title={!installed.includes(model.id) ? 'Install a model first' : 'Extract audio and transcribe locally'}>
          <Play size={13} /> Start transcription
        </button>
        <p className="text-[10px] text-paper-faint"><Info size={10} className="inline" /> Word timing comes from recognition where available; if the engine estimates it, the caption remains editable for manual correction.</p>
      </Section>

      {cues.length > 0 && (
        <Section title={`Transcription result (${cues.length} cues)`}>
          {phase === 'done' && (
            <div className="rounded-xl border border-heat-green/40 bg-heat-green/10 p-3 flex items-start gap-2">
              <span className="w-7 h-7 shrink-0 rounded-full bg-heat-green/20 border border-heat-green/40 flex items-center justify-center">
                <CheckCircle2 size={16} className="text-heat-green" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-heat-green">Transcription complete</p>
                <p className="text-[10px] text-paper-dim">
                  {cues.length} caption cues · {cues.reduce((n, c) => n + (c.words?.length ?? 0), 0)} words · {model.label}
                </p>
                <p className="text-[10px] text-paper-faint">Review below, then add them to the timeline.</p>
              </div>
            </div>
          )}
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
