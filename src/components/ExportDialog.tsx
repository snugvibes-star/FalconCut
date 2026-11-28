import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Film, X, CheckCircle2, Image } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { getBlob } from '../state/persistence';
import { projectDuration } from '../../engine/types';
import { downloadBlob, projectPNG, projectSRT, mixProjectAudio, encodeWAV } from '../../exporter/artifacts';
import { projectGIF } from '../../exporter/gif';
import { projectWebM } from '../../exporter/webm';
import { exportVideo, videoExportSupport, type ExportQuality } from '../../exporter/video';
import { Dialog } from './Dialog';

interface Prog { pct: number; label: string }

/** Delivery targets. Choosing one reframes the project (a real, undoable edit)
 * so the preview, the timeline and the exported file all match the platform
 * the clip is going to — the same idea as an NLE's export destination list,
 * minus the upload that a browser app cannot honestly promise. */
const DESTINATIONS: { id: string; label: string; aspect: '9:16' | '16:9' | '1:1' | '4:5'; width: number; height: number; note: string }[] = [
  { id: 'tiktok', label: 'TikTok · Reels · Shorts', aspect: '9:16', width: 1080, height: 1920, note: 'Vertical 1080×1920' },
  { id: 'youtube', label: 'YouTube', aspect: '16:9', width: 1920, height: 1080, note: 'Landscape 1920×1080' },
  { id: 'instagram', label: 'Instagram feed', aspect: '4:5', width: 1080, height: 1350, note: 'Portrait 1080×1350' },
  { id: 'square', label: 'Square post', aspect: '1:1', width: 1080, height: 1080, note: 'Square 1080×1080' },
];

export function ExportDialog() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const ui = useUI();
  const duration = projectDuration(project);

  const [support, setSupport] = useState<{ supported: boolean; label: string } | null>(null);
  const [storage, setStorage] = useState<{ quota: number; usage: number } | null>(null);
  const [quality, setQuality] = useState<ExportQuality>('standard');
  const [scale, setScale] = useState(1);
  const [includeAudio, setIncludeAudio] = useState(true);
  /** 0 = auto (derived from quality + resolution); otherwise bits/sec override. */
  const [bitrateMbps, setBitrateMbps] = useState(0);
  const [prog, setProg] = useState<Prog | null>(null);
  const [done, setDone] = useState('');
  const [doneKind, setDoneKind] = useState<'video' | 'gif' | ''>('');
  const abortRef = useRef<AbortController | null>(null);
  const zone = useStore((s) => s.zone);
  const [gifFps, setGifFps] = useState(10);
  const [gifWidth, setGifWidth] = useState(480);

  useEffect(() => { void videoExportSupport().then(setSupport); }, []);
  useEffect(() => { void navigator.storage?.estimate?.().then((e) => setStorage({ quota: e.quota ?? 0, usage: e.usage ?? 0 })).catch(() => {}); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const offline = !!support?.supported;
  /** Honest pre-flight: report problems BEFORE a long render starts. */
  const preflight: string[] = [];
  if (support && !support.supported) preflight.push(`${support.label} — WebM capture will be used instead.`);
  if (project.settings.width % 2 || project.settings.height % 2) preflight.push('Output dimensions must be even numbers for video encoding.');
  if (project.settings.width > 3840 || project.settings.height > 2160) preflight.push('Output above 4K may fail on this device; try a lower resolution.');
  if (!offline && duration > 300) preflight.push('WebM capture is real-time: this project takes about its full duration to export.');
  if (storage && storage.quota > 0 && duration > 60 && storage.quota - storage.usage < 750 * 1024 * 1024) {
    preflight.push('Less than 750 MB of local storage is free — exports may fail. Free space before rendering.');
  }
  const blockingPreflight = preflight.some((m) => /must be even|above 4K|Less than 750 MB/.test(m));

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
    setBusy('video'); setError(''); setDone(''); setDoneKind(''); setProg({ pct: 0, label: 'Preparing…' });
    useStore.getState().pause();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (support?.supported) {
        const r = await exportVideo(project, getBlob, { quality, scale, includeAudio, ...(bitrateMbps ? { bitrate: bitrateMbps * 1_000_000 } : {}) }, (p) => {
          const label = { prepare: 'Preparing fonts & audio', video: `Rendering frame ${p.frame}/${p.totalFrames}`, audio: 'Encoding audio', finalize: 'Muxing container' }[p.stage];
          setProg({ pct: p.pct, label });
        }, ctrl.signal);
        downloadBlob(r.blob, `${project.name}.${r.container}`);
        setDone(`${r.container.toUpperCase()} · ${r.width}×${r.height} · ${r.frames} frames${r.hasAudio ? ' · audio' : ' · silent'} · ${(r.blob.size / 1e6).toFixed(1)} MB`);
        setDoneKind('video');
      } else {
        const blob = await projectWebM(project, getBlob, (pct) => setProg({ pct, label: `Recording in real time · ${Math.round(pct * 100)}%` }), ctrl.signal);
        downloadBlob(blob, `${project.name}.webm`);
        setDone(`WEBM · real-time capture · ${(blob.size / 1e6).toFixed(1)} MB`);
        setDoneKind('video');
      }
      ui.toast('Video export complete', 'success');
    } catch (e) {
      const err = e as Error;
      setError(err.name === 'AbortError' ? 'Export cancelled.' : err.message);
    } finally { setBusy(''); setProg(null); abortRef.current = null; }
  };

  /** Pick a delivery target: reframe the project, keep export at 100%. */
  const applyDestination = (d: (typeof DESTINATIONS)[number]) => {
    const s = project.settings;
    if (s.aspect === d.aspect && s.width === d.width && s.height === d.height) return;
    setDone(''); setDoneKind('');
    useStore.getState().commit(
      [{ type: 'set_settings', patch: { aspect: d.aspect, width: d.width, height: d.height } }],
      `Reframe for ${d.label}`,
    );
    setScale(1);
    ui.toast(`Project reframed to ${d.width}×${d.height} (${d.aspect})`, 'success');
  };

  const zoneValid = !!zone && zone.out > zone.in + 0.05;
  const gifRange = zoneValid ? { start: zone!.in, end: zone!.out } : { start: 0, end: duration };

  const exportGif = async () => {
    setBusy('gif'); setError(''); setDone(''); setDoneKind(''); setProg({ pct: 0, label: 'Rendering GIF frames…' });
    useStore.getState().pause();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const blob = await projectGIF(project, getBlob, { start: gifRange.start, end: gifRange.end, fps: gifFps, width: gifWidth },
        (p) => setProg({ pct: p, label: 'Rendering GIF frames…' }), ctrl.signal);
      downloadBlob(blob, `${project.name}-${gifRange.start.toFixed(1)}-${gifRange.end.toFixed(1)}s.gif`);
      setDone(`GIF · ${(gifRange.end - gifRange.start).toFixed(1)}s · ${gifWidth}px · ${(blob.size / 1e6).toFixed(1)} MB`);
      setDoneKind('gif');
      ui.toast('GIF export complete', 'success');
    } catch (e) {
      const err = e as Error;
      setError(err.name === 'AbortError' ? 'GIF export cancelled.' : err.message);
    } finally { setBusy(''); setProg(null); abortRef.current = null; }
  };

  const closeExport = () => {
    if (busy && !window.confirm('Cancel the running export? The partial file will be discarded.')) return;
    if (busy) abortRef.current?.abort();
    ui.close('export');
  };

  return <Dialog title="Export" onClose={closeExport}>
    <div className="space-y-4 text-xs">
      <p className="text-paper-dim">{project.name} · {duration.toFixed(2)} seconds · {project.settings.width}×{project.settings.height} @ {project.settings.fps}fps</p>

      {preflight.length > 0 && (
        <div className={`rounded-lg border p-2 text-[11px] leading-snug ${blockingPreflight ? 'border-heat/50 bg-heat/10 text-heat' : 'border-heat-amber/40 text-paper-dim'}`}>
          <span className="font-semibold">Before you export:</span>
          <ul className="list-disc ml-4 mt-0.5">{preflight.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      {/* ---- Destination ---- */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="label mb-0">Destination</span>
          <span className="text-[11px] text-paper-faint tabular-nums">{project.settings.width}×{project.settings.height} · {project.settings.aspect}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DESTINATIONS.map((d) => {
            const active = project.settings.aspect === d.aspect
              && project.settings.width === d.width && project.settings.height === d.height;
            return (
              <button key={d.id} type="button" disabled={!!busy} onClick={() => applyDestination(d)}
                className={`p-2 rounded-lg border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  active ? 'border-signal/60 bg-signal/10' : 'border-line bg-ink-850 hover:border-signal/40'
                }`}
                title={`Reframe the project to ${d.width}×${d.height} (${d.aspect}) — one undo step`}>
                <span className={`block text-[11px] font-medium truncate ${active ? 'text-signal' : 'text-paper'}`}>{d.label}</span>
                <span className="block text-[10px] text-paper-faint">{d.note}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-paper-faint">Reframing changes the project frame (one undo step) so the preview, timeline and export all match the platform.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-paper-dim">Output resolution</span>
          <button type="button" className="btn-ghost text-[11px] px-2 py-1" disabled={!!busy}
            onClick={() => { setDone(''); setDoneKind(''); useStore.getState().upscaleOutput(2); }}
            title="2× output resolution with high-quality resampling and a mild sharpen — one undo step. No AI detail is invented.">
            Upscale 2×
          </button>
          <button type="button" className="btn-ghost text-[11px] px-2 py-1" disabled={!!busy}
            onClick={() => { setDone(''); setDoneKind(''); useStore.getState().upscaleOutput(4); }}
            title="4× output resolution with high-quality resampling and a mild sharpen — one undo step. No AI detail is invented.">
            Upscale 4×
          </button>
          <span className="text-[10px] text-paper-faint">resamples existing pixels — no generated detail</span>
        </div>
      </div>

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
          <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2.5">
            <label className="block">
              <span className="label">Quality</span>
              <select className="field py-1 text-xs cursor-pointer" value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)} disabled={!!busy}>
                <option value="draft">Draft</option><option value="standard">Standard</option><option value="high">High</option>
              </select>
            </label>
            <label className="block" title="Video bitrate — Auto derives it from quality and resolution; pick a value to force it">
              <span className="label">Bitrate</span>
              <select className="field py-1 text-xs cursor-pointer" value={bitrateMbps} onChange={(e) => setBitrateMbps(Number(e.target.value))} disabled={!!busy}>
                <option value={0}>Auto</option>
                <option value={4}>4 Mbps</option>
                <option value={8}>8 Mbps</option>
                <option value={12}>12 Mbps</option>
                <option value={16}>16 Mbps</option>
                <option value={24}>24 Mbps</option>
                <option value={32}>32 Mbps</option>
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
            <label className="block">
              <span className="label">Frame rate</span>
              <select className="field py-1 text-xs cursor-pointer" value={project.settings.fps} disabled={!!busy}
                onChange={(e) => useStore.getState().commit(
                  [{ type: 'set_settings', patch: { fps: Number(e.target.value) } }],
                  `Set ${e.target.value} fps`,
                )}>
                <option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option>
              </select>
            </label>
          </div>
          <div className="flex items-end gap-2 mb-2.5">
            <label className="flex-1">
              <span className="label">Custom width (px)</span>
              <input type="number" min={320} max={3840} className="field py-1 text-xs" defaultValue={project.settings.width}
                key={`w:${project.settings.width}`} disabled={!!busy}
                onBlur={(e) => { const w = Number(e.target.value); if (w >= 320 && w <= 3840 && w !== project.settings.width) useStore.getState().commit([{ type: 'set_settings', patch: { width: w } }], 'Set export width'); }} />
            </label>
            <label className="flex-1">
              <span className="label">Custom height (px)</span>
              <input type="number" min={320} max={3840} className="field py-1 text-xs" defaultValue={project.settings.height}
                key={`h:${project.settings.height}`} disabled={!!busy}
                onBlur={(e) => { const h = Number(e.target.value); if (h >= 320 && h <= 3840 && h !== project.settings.height) useStore.getState().commit([{ type: 'set_settings', patch: { height: h } }], 'Set export height'); }} />
            </label>
          </div>
          </>
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
            disabled={!!busy || support === null || duration <= 0 || (!offline && duration > 300) || blockingPreflight}
            onClick={() => void exportVideoFile()}
            title={offline ? 'Render and encode on this device (faster than real time)' : 'Records in real time'}
          >
            <Download size={15} /> Export video
          </button>
        )}
        {done && doneKind === 'video' && <p className="text-heat-green mt-2 text-[11px]">{done}</p>}
        {support && !offline && <p className="text-heat-amber mt-2 text-[11px]">No WebCodecs encoder here — using real-time WebM capture (a {Math.round(duration)}s project takes ~{Math.round(duration)}s). Chrome / Edge enable fast MP4 export.</p>}
      </div>

      {/* ---- Sidecars ---- */}
      <div className="grid grid-cols-2 gap-2">
        {([
          ['json', 'Project JSON', 'Editing document; does not embed source files.', false],
          ['png', 'Current frame PNG', `Render at ${playhead.toFixed(2)}s without safe-zone guides.`, !project.clips.length],
          ['srt', 'Captions SRT', projectSRT(project).trim() ? 'Plain subtitle cues with timeline timing.' : 'No visible caption cues to export.', !projectSRT(project).trim()],
          ['wav', 'Mixed audio WAV', 'Stereo PCM, up to 5 minutes. Speed changes pitch.', duration <= 0 || duration > 300],
        ] as const).map(([format, title, description, disabled]) => <button key={format} disabled={!!busy || disabled} className="p-3 text-left rounded-lg border border-line hover:border-signal/50 bg-ink-850 disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => void exportFile(format)}>
          <span className="flex items-center gap-2 text-paper font-medium mb-1">{busy === format ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{title}</span>
          <span className="text-paper-dim text-[11px]">{description}</span>
        </button>)}
      </div>

      {typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && (
        <button className="btn-ghost w-full justify-center text-[11px] px-2 py-1" disabled={!!busy}
          title="Share the project document via the device's native share sheet (where supported)"
          onClick={() => {
            const file = new File([JSON.stringify(project, null, 2)], `${project.name}.falconcut.json`, { type: 'application/json' });
            if (navigator.canShare({ files: [file] })) void navigator.share({ files: [file], title: project.name }).catch(() => {});
            else ui.toast('This device cannot share files', 'info');
          }}>
          Share project file
        </button>
      )}

      {/* ---- Animated GIF ---- */}
      <div className="rounded-xl p-3.5 border border-line bg-ink-850">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-7 h-7 rounded-lg bg-mind/15 border border-mind/30 flex items-center justify-center"><Image size={15} className="text-mind" /></span>
          <div className="min-w-0">
            <div className="text-paper font-semibold text-sm leading-tight">Animated GIF</div>
            <div className="text-[11px] text-paper-faint truncate">{zoneValid ? `Marked zone ${gifRange.start.toFixed(1)}–${gifRange.end.toFixed(1)}s` : 'Whole video (set I / O marks for a section)'}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="block">
            <span className="label">Frame rate</span>
            <select className="field py-1 text-xs cursor-pointer" value={gifFps} onChange={(e) => setGifFps(Number(e.target.value))} disabled={!!busy}>
              <option value={8}>8 fps — small file</option>
              <option value={10}>10 fps</option>
              <option value={15}>15 fps — smoother</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Width</span>
            <select className="field py-1 text-xs cursor-pointer" value={gifWidth} onChange={(e) => setGifWidth(Number(e.target.value))} disabled={!!busy}>
              <option value={320}>320px</option>
              <option value={480}>480px</option>
              <option value={640}>640px</option>
            </select>
          </label>
        </div>
        {busy === 'gif' && prog ? (
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
          <button className="btn-solid w-full py-2" disabled={!!busy || duration <= 0} onClick={() => void exportGif()} title="Renders the section through the same engine as the preview, quantized to 256 colors (max 240 frames — longer sections get a stretched frame step)">
            <Download size={15} /> Export GIF
          </button>
        )}
        {done && doneKind === 'gif' && <p className="text-heat-green mt-2 text-[11px]">{done}</p>}
      </div>

      {busy && busy !== 'video' && <p role="status" className="text-signal">Preparing {busy.toUpperCase()} locally…</p>}
      {error && (
        <div role="alert" className="text-heat">
          <p>{error}</p>
          <button className="btn-ghost mt-1 text-[11px] px-2 py-1" onClick={() => {
            const diagnostics = JSON.stringify({
              error, project: project.name, duration, settings: project.settings,
              clips: project.clips.length, tracks: project.tracks.length,
              media: project.media.map((m) => ({ name: m.name, type: m.type, size: m.size })),
              support, userAgent: navigator.userAgent, at: new Date().toISOString(),
            }, null, 2);
            void navigator.clipboard?.writeText(diagnostics).then(() => ui.toast('Diagnostics copied', 'success')).catch(() => ui.toast('Clipboard unavailable', 'error'));
          }}>Copy diagnostics</button>
        </div>
      )}
      <p className="text-paper-faint">Everything is rendered and encoded on this device — no upload. JSON is not a media backup: keep your original files. Video uses the same render engine as the preview; audio uses the preview mix graph.</p>
    </div>
  </Dialog>;
}