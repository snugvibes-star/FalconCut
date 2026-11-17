import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Film, X, CheckCircle2 } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { getBlob } from '../state/persistence';
import { projectDuration } from '../../engine/types';
import { downloadBlob, projectPNG, projectSRT, mixProjectAudio, encodeWAV } from '../../exporter/artifacts';
import { projectWebM } from '../../exporter/webm';
import { exportVideo, videoExportSupport, type ExportQuality } from '../../exporter/video';
import { Dialog } from './Dialog';

interface Prog { pct: number; label: string }

export function ExportDialog() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const ui = useUI();
  const duration = projectDuration(project);

  const [support, setSupport] = useState<{ supported: boolean; label: string } | null>(null);
  const [quality, setQuality] = useState<ExportQuality>('standard');
  const [scale, setScale] = useState(1);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [prog, setProg] = useState<Prog | null>(null);
  const [done, setDone] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { void videoExportSupport().then(setSupport); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const exportFile = async (format: 'json' | 'srt' | 'png' | 'wav') => {
    setBusy(format); setError(''); setDone('');
    useStore.getState().pause();
    try {
      const blob = format === 'json' ? new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
        : format === 'srt' ? new Blob([projectSRT(project)], { type: 'application/x-subrip' })
        : format === 'png' ? await projectPNG(project, playhead, getBlob)
        : encodeWAV(await mixProjectAudio(project, getBlob));
      downloadBlob(blob, `${project.name}${format === 'png' ? `-${playhead.toFixed(2)}s` : ''}.${format}`);
      ui.toast(`${format.toUpperCase()} download started`, 'success');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };

  const exportVideoFile = async () => {
    setBusy('video'); setError(''); setDone(''); setProg({ pct: 0, label: 'Preparing…' });
    useStore.getState().pause();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (support?.supported) {
        const r = await exportVideo(project, getBlob, { quality, scale, includeAudio }, (p) => {
          const label = { prepare: 'Preparing fonts & audio', video: `Rendering frame ${p.frame}/${p.totalFrames}`, audio: 'Encoding audio', finalize: 'Muxing container' }[p.stage];
          setProg({ pct: p.pct, label });
        }, ctrl.signal);
        downloadBlob(r.blob, `${project.name}.${r.container}`);
        setDone(`${r.container.toUpperCase()} · ${r.width}×${r.height} · ${r.frames} frames${r.hasAudio ? ' · audio' : ' · silent'} · ${(r.blob.size / 1e6).toFixed(1)} MB`);
      } else {
        const blob = await projectWebM(project, getBlob, (pct) => setProg({ pct, label: `Recording in real time · ${Math.round(pct * 100)}%` }), ctrl.signal);
        downloadBlob(blob, `${project.name}.webm`);
        setDone(`WEBM · real-time capture · ${(blob.size / 1e6).toFixed(1)} MB`);
      }
      ui.toast('Video export complete', 'success');
    } catch (e) {
      const err = e as Error;
      setError(err.name === 'AbortError' ? 'Export cancelled.' : err.message);
    } finally { setBusy(''); setProg(null); abortRef.current = null; }
  };

  const offline = !!support?.supported;

  return <Dialog title="Export" onClose={() => ui.close('export')}>
    <div className="space-y-4 text-xs">
      <p className="text-paper-dim">{project.name} · {duration.toFixed(2)} seconds · {project.settings.width}×{project.settings.height} @ {project.settings.fps}fps</p>

      {/* ---- Video ---- */}
      <div className="cf-export-video rounded-xl p-3.5 border border-signal/30">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="w-7 h-7 rounded-lg bg-signal/15 border border-signal/30 flex items-center justify-center"><Film size={15} className="text-signal" /></span>
          <div className="min-w-0">
            <div className="text-paper font-semibold text-sm leading-tight">Video file</div>
            <div className="text-[11px] text-paper-faint truncate">{support ? (offline ? support.label : 'WebM · real-time capture (fallback)') : 'Probing encoder…'}</div>
          </div>
          <div className="flex-1" />
          {done && <CheckCircle2 size={16} className="text-heat-green shrink-0" />}
        </div>

        {offline && (
          <div className="grid grid-cols-3 gap-2 mb-2.5">
            <label className="block">
              <span className="label">Quality</span>
              <select className="field py-1 text-xs cursor-pointer" value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)} disabled={!!busy}>
                <option value="draft">Draft</option><option value="standard">Standard</option><option value="high">High</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Resolution</span>
              <select className="field py-1 text-xs cursor-pointer" value={scale} onChange={(e) => setScale(Number(e.target.value))} disabled={!!busy}>
                <option value={1}>100%</option><option value={0.75}>75%</option><option value={0.5}>50%</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Audio</span>
              <select className="field py-1 text-xs cursor-pointer" value={includeAudio ? '1' : '0'} onChange={(e) => setIncludeAudio(e.target.value === '1')} disabled={!!busy}>
                <option value="1">Include</option><option value="0">Silent</option>
              </select>
            </label>
          </div>
        )}

        {busy === 'video' && prog ? (
          <div className="space-y-2">
            <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
              <div className="h-full cf-progress-bar transition-[width] duration-150" style={{ width: `${Math.round(prog.pct * 100)}%` }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-paper-dim flex-1 truncate" role="status">{prog.label} · {Math.round(prog.pct * 100)}%</span>
              <button className="btn-danger py-1 px-2 text-[11px]" onClick={() => abortRef.current?.abort()}><X size={12} /> Cancel</button>
            </div>
          </div>
        ) : (
          <button
            className="btn-signal w-full py-2"
            disabled={!!busy || support === null || duration <= 0 || (!offline && duration > 300)}
            onClick={() => void exportVideoFile()}
            title={offline ? 'Render and encode on this device (faster than real time)' : 'Records in real time'}
          >
            <Download size={15} /> Export video
          </button>
        )}
        {done && <p className="text-heat-green mt-2 text-[11px]">{done}</p>}
        {support && !offline && <p className="text-heat-amber mt-2 text-[11px]">No WebCodecs encoder here — using real-time WebM capture (a {Math.round(duration)}s project takes ~{Math.round(duration)}s). Chrome / Edge enable fast MP4 export.</p>}
      </div>

      {/* ---- Sidecars ---- */}
      <div className="grid grid-cols-2 gap-2">
        {([
          ['json', 'Project JSON', 'Editing document; does not embed source files.', false],
          ['png', 'Current frame PNG', `Render at ${playhead.toFixed(2)}s without safe-zone guides.`, !project.clips.length],
          ['srt', 'Captions SRT', 'Plain subtitle cues with timeline timing.', !project.clips.some((c) => c.text?.role === 'caption')],
          ['wav', 'Mixed audio WAV', 'Stereo PCM, up to 5 minutes. Speed changes pitch.', duration <= 0 || duration > 300],
        ] as const).map(([format, title, description, disabled]) => <button key={format} disabled={!!busy || disabled} className="p-3 text-left rounded-lg border border-line hover:border-signal/50 bg-ink-850 disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => void exportFile(format)}>
          <span className="flex items-center gap-2 text-paper font-medium mb-1">{busy === format ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{title}</span>
          <span className="text-paper-dim text-[11px]">{description}</span>
        </button>)}
      </div>

      {busy && busy !== 'video' && <p role="status" className="text-signal">Preparing {busy.toUpperCase()} locally…</p>}
      {error && <p role="alert" className="text-heat">{error}</p>}
      <p className="text-paper-faint">Everything is rendered and encoded on this device — no upload. JSON is not a media backup: keep your original files. Video uses the same render engine as the preview; audio uses the preview mix graph.</p>
    </div>
  </Dialog>;
}