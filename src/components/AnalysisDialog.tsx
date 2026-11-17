import { useState, type FormEvent } from 'react';
import type { AnalyzeOptions } from '../../analysis/analyze';
import type { WhisperModel } from '../../analysis/transcript';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { Dialog } from './Dialog';

const MODELS: { value: WhisperModel; label: string }[] = [
  { value: 'onnx-community/whisper-tiny.en', label: 'Whisper tiny · English' },
  { value: 'onnx-community/whisper-tiny', label: 'Whisper tiny · Multilingual' },
  { value: 'onnx-community/whisper-base.en', label: 'Whisper base · English' },
  { value: 'onnx-community/whisper-base', label: 'Whisper base · Multilingual' },
];

export function AnalysisDialog() {
  const project = useStore((s) => s.project);
  const options = useStore((s) => s.analyzeOptions);
  const queue = useStore((s) => s.queue);
  const close = useUI((s) => s.close);
  const toast = useUI((s) => s.toast);
  const [draft, setDraft] = useState(() => ({
    ...options,
    language: options.language ?? '',
    silenceThresholdDb: String(options.silenceThresholdDb),
    silenceMinMs: String(options.silenceMinMs),
  }));
  const [error, setError] = useState('');
  const analysis = project.analysis;
  const hasLoudness = project.media.some((media) => (analysis?.byMedia[media.id]?.loudness.length ?? 0) > 0);
  const progress = queue && Number.isFinite(queue.pct) ? Math.round(Math.min(1, Math.max(0, queue.pct)) * 100) : 0;

  const validatedOptions = (): AnalyzeOptions | null => {
    const silenceThresholdDb = Number(draft.silenceThresholdDb);
    const silenceMinMs = Number(draft.silenceMinMs);
    if (!draft.silenceThresholdDb.trim() || !Number.isFinite(silenceThresholdDb) || silenceThresholdDb < -100 || silenceThresholdDb > 0) {
      setError('Set the silence threshold between -100 and 0 dB.');
      return null;
    }
    if (!draft.silenceMinMs.trim() || !Number.isFinite(silenceMinMs) || !Number.isInteger(silenceMinMs) || silenceMinMs < 1) {
      setError('Set a minimum silence length of at least 1 whole millisecond.');
      return null;
    }
    setError('');
    return { ...draft, language: draft.language.trim() || undefined, silenceThresholdDb, silenceMinMs };
  };

  const analyzeAll = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = validatedOptions();
    const store = useStore.getState();
    if (!next || store.queue || !store.project.media.length) return;
    try {
      store.setAnalyzeOptions(next);
      store.analyzeAll();
      toast('Media analysis queued. Follow progress below.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not queue analysis. Try again.');
    }
  };

  const refreshSilences = () => {
    const next = validatedOptions();
    const store = useStore.getState();
    if (!next || store.queue || !hasLoudness) return;
    try {
      // Silence-only refresh must not enable transcription or load a model.
      store.setAnalyzeOptions({ silenceThresholdDb: next.silenceThresholdDb, silenceMinMs: next.silenceMinMs });
      store.refreshSilences();
      toast('Silence maps refreshed from existing audio analysis.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh silence maps. Try again.');
    }
  };

  return (
    <Dialog title="Media analysis" onClose={() => close('analysis')}>
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-paper-dim">Analyze audio, scene changes and faces locally. Results depend on the media and browser; notes below report unsupported or skipped analysis.</p>
        <form onSubmit={analyzeAll} className="space-y-3">
          <fieldset disabled={Boolean(queue)} className="space-y-3 disabled:opacity-60">
            <legend className="label">Analysis options</legend>
            <div className="panel bg-ink-850 p-3">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-paper" htmlFor="analysis-transcribe">
                <input id="analysis-transcribe" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-signal"
                  checked={draft.transcribe} onChange={(e) => setDraft({ ...draft, transcribe: e.target.checked })} aria-describedby="analysis-download-note" />
                Transcribe speech locally with Whisper
              </label>
              <p id="analysis-download-note" className="mt-2 text-[11px] leading-relaxed text-paper-dim">
                Optional: the first run needs a one-time model download from the model host (network access required). Models use substantial memory, storage and CPU; long recordings may take several minutes or fail on low-memory devices. Base models need more resources than tiny models. Browser cache eviction can require another download.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-heat-amber">Checking this box does not download anything. Click Analyze all to start; with transcription enabled, it downloads the selected model if needed.</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="analysis-model">Whisper model</label>
                  <select id="analysis-model" className="field" disabled={!draft.transcribe} value={draft.model}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value as WhisperModel })}>
                    {MODELS.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="analysis-language">Language (optional)</label>
                  <input id="analysis-language" className="field" disabled={!draft.transcribe} value={draft.language}
                    onChange={(e) => setDraft({ ...draft, language: e.target.value })} placeholder="Auto-detect" autoComplete="off" spellCheck={false}
                    aria-describedby="analysis-language-note" />
                </div>
              </div>
              <p id="analysis-language-note" className="mt-1 text-[11px] text-paper-dim">Leave blank to auto-detect, or enter a language such as en or fr. English-only models require English audio.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="analysis-threshold">Silence threshold (dB)</label>
                <input id="analysis-threshold" type="number" className="field" min="-100" max="0" step="any" required
                  value={draft.silenceThresholdDb} onChange={(e) => setDraft({ ...draft, silenceThresholdDb: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="analysis-min-ms">Minimum silence (ms)</label>
                <input id="analysis-min-ms" type="number" className="field" min="1" step="1" required
                  value={draft.silenceMinMs} onChange={(e) => setDraft({ ...draft, silenceMinMs: e.target.value })} />
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-paper-dim">Refresh silences reuses measured audio without downloading a model. Analyze all reruns media analysis and replaces existing results, including transcripts.</p>
          </fieldset>
          {error && <p role="alert" className="text-xs text-heat">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" disabled={Boolean(queue) || !hasLoudness}
              onClick={refreshSilences} title={!hasLoudness ? 'Analyze media with decodable audio first' : 'Recompute silence maps from existing audio measurements'}>Refresh silences</button>
            <button type="submit" className="btn-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" disabled={Boolean(queue) || !project.media.length}>Analyze all</button>
          </div>
        </form>

        <section className="panel bg-ink-850 p-3" aria-label="Analysis queue">
          {queue ? (
            <>
              <div className="flex items-start justify-between gap-3 text-xs">
                <p className="min-w-0 break-words font-medium text-paper">{queue.label}</p>
                <span className="shrink-0 font-mono text-signal">{progress}%</span>
              </div>
              <progress className="mt-2 h-1.5 w-full overflow-hidden rounded-full accent-signal" max={100} value={progress} aria-label={`${queue.label}: ${queue.stage} progress`} />
              <div role="status" className="mt-1 text-[11px] leading-relaxed text-paper-dim">
                <p>{queue.stage} · {queue.pending} waiting</p>
                {queue.note && <p className="mt-1 break-words">{queue.note}</p>}
              </div>
              <p className="mt-2 text-[11px] text-paper-dim">Progress is for the current stage. You can close this dialog while analysis runs.</p>
            </>
          ) : <p role="status" className="text-xs text-paper-dim">No analysis running. {project.media.length ? 'Ready to analyze your media.' : 'Import media to begin.'}</p>}
        </section>

        <section aria-labelledby="analysis-results-title">
          <h3 id="analysis-results-title" className="mb-2 font-display text-sm font-semibold">Media results <span className="ml-1 font-mono text-xs font-normal text-paper-dim">{project.media.length}</span></h3>
          {!project.media.length ? <p className="text-xs text-paper-dim">No media in this project. Import video, audio or images from the media library.</p> : (
            <ul className="space-y-2">
              {project.media.map((media) => {
                const result = analysis?.byMedia[media.id];
                return (
                  <li key={media.id} className="panel bg-ink-850 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h4 className="min-w-0 break-words text-xs font-medium text-paper">{media.name}</h4>
                      <span className="text-[11px] text-paper-dim">{media.type} · {result ? 'Analysis recorded' : 'Not analyzed'}</span>
                    </div>
                    {result ? (
                      <>
                        <p className="mt-1 text-[11px] text-paper-dim">{result.silences.length} silences · {result.scenes.length} scene changes · {result.faces.length} face samples · {result.beats.length} beats</p>
                        <p className="mt-1 text-[11px] text-paper-dim">Face method: {result.faceMethod}. Transcript: {result.transcript ? result.transcript.complete ? `${result.transcript.words.length} words recorded` : 'incomplete / failed' : 'not available'}.</p>
                        {result.transcript && <p className="mt-1 break-words font-mono text-[10px] text-paper-dim">{result.transcript.model}{result.transcript.language ? ` · ${result.transcript.language}` : ''}</p>}
                        {result.flags.length > 0 && <ul className="mt-2 space-y-1 border-l-2 border-heat-amber/40 pl-2 text-[11px] leading-relaxed text-heat-amber">{result.flags.map((flag, index) => <li key={`${index}-${flag}`} className="break-words">{flag}</li>)}</ul>}
                        <p className="mt-2 text-[10px] text-paper-dim">Recorded {new Date(result.analyzedAt).toLocaleString()}</p>
                      </>
                    ) : <p className="mt-1 text-[11px] text-paper-dim">No stored results. Run Analyze all to inspect this media.</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="analysis-storyboard-title" className="border-t border-line pt-3">
          <h3 id="analysis-storyboard-title" className="mb-2 font-display text-sm font-semibold">Storyboard</h3>
          {analysis?.storyboard ? <pre className="panel max-h-64 overflow-y-auto whitespace-pre-wrap break-words bg-ink-850 p-3 font-mono text-[11px] leading-relaxed text-paper-dim">{analysis.storyboard}</pre> : <p className="text-xs text-paper-dim">No storyboard recorded yet. Analyze media to generate one from this project's results.</p>}
        </section>
      </div>
    </Dialog>
  );
}
