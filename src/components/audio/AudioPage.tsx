/**
 * Audio workspace — a dense mixer view modeled on Premiere's Audio Clip Mixer
 * and Fairlight's channel strips. Every control maps to a real store action or
 * applyTool; meters render REAL analysis loudness data (or an honest "no
 * data" state), never fake movement.
 */
import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Volume2, VolumeX, Waves } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { VoiceoverRecorder } from '../tabs/AudioTab';
import { getMedia, type Action, type Clip, type MediaAnalysis, type Project, type Track } from '../../../engine';

type CommitFn = (actions: Action[], label: string, source?: 'human' | 'ai', coalesceKey?: string) => void;

const FADER_LEN = 128; // px, vertical travel of the rotated range input
const METER_W = 10;
const METER_H = 88;

const mmss = (t: number) => {
  const m = Math.floor(Math.max(0, t) / 60);
  const s = Math.floor(Math.max(0, t) % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/* ---------------- vertical fader (rotated range input) ---------------- */

function Fader({ value, disabled, disabledReason, onCommit }: {
  value: number;
  disabled?: boolean;
  disabledReason?: string;
  onCommit: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  /** Custom vertical drag surface: the old rotated range input had an ~18px
   * grab width, unusable on touch. This gives a 44px-wide hit zone and keeps a
   * screen-reader/keyboard range input for accessibility. */
  const valueAt = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return value;
    return Math.max(0, Math.min(2, (1 - (e.clientY - r.top) / r.height) * 2));
  };
  const release = (e: React.PointerEvent) => {
    if (drag !== null && Math.abs(drag - value) > 0.01) onCommit(Math.round(drag * 100) / 100);
    setDrag(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* released */ }
  };
  return (
    <div ref={ref} className="relative shrink-0 touch-none cursor-ns-resize" style={{ height: FADER_LEN, width: 44 }} title={disabledReason}
      onPointerDown={(e) => { if (disabled) return; e.preventDefault(); setDrag(valueAt(e)); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ } }}
      onPointerMove={(e) => { if (drag !== null) setDrag(valueAt(e)); }}
      onPointerUp={release} onPointerCancel={release}>
      <div className="absolute left-1/2 top-0 bottom-0 w-1.5 -translate-x-1/2 rounded bg-ink-700" />
      <div className="absolute bottom-0 left-1/2 w-1.5 -translate-x-1/2 rounded bg-signal" style={{ height: `${(shown / 2) * 100}%` }} />
      <div className="absolute left-1/2 w-7 h-5 -translate-x-1/2 -translate-y-1/2 rounded border border-line bg-ink-750 shadow-panel" style={{ bottom: `${(shown / 2) * 100}%` }} />
      <input type="range" min={0} max={2} step={0.01} value={shown} disabled={disabled}
        aria-label="clips vol" className="sr-only"
        onChange={(e) => onCommit(Number(e.target.value))} />
    </div>
  );
}

/* ---------------- track meter (real analysis loudness) ---------------- */

function TrackMeter({ clip, ma, playhead }: { clip: Clip | undefined; ma: MediaAnalysis | undefined; playhead: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hasData = Boolean(clip && ma && ma.loudness.length);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = METER_W;
    c.height = METER_H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, METER_W, METER_H);
    ctx.fillStyle = '#202024'; // ink-850 bed
    ctx.fillRect(0, 0, METER_W, METER_H);
    ctx.fillStyle = 'rgba(94,107,132,0.45)'; // paper-faint ticks
    for (let i = 1; i < 4; i++) ctx.fillRect(1, Math.round((METER_H * i) / 4), METER_W - 2, 1);
    if (!clip || !ma || !ma.loudness.length) return;
    // map playhead → source time → 10 Hz loudness envelope index
    const srcT = clip.inPoint + (playhead - clip.start) * clip.speed;
    const idx = Math.max(0, Math.min(ma.loudness.length - 1, Math.round(srcT * 10)));
    const rms = ma.loudness[idx]?.rms ?? 0;
    const level = Math.min(1, rms * 3);
    if (level <= 0) return;
    const grad = ctx.createLinearGradient(0, METER_H, 0, 0); // green → amber → red, bottom to top
    grad.addColorStop(0, '#34D399');
    grad.addColorStop(0.7, '#FBBF24');
    grad.addColorStop(1, '#FB7185');
    ctx.fillStyle = grad;
    ctx.fillRect(1, METER_H - level * (METER_H - 2), METER_W - 2, level * (METER_H - 2));
  }, [clip, ma, playhead]);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <canvas ref={ref} className="rounded-sm border border-line" style={{ width: METER_W, height: METER_H }} />
      <span className="text-[8px] text-paper-faint">{hasData ? 'lvl' : 'no data'}</span>
    </div>
  );
}

/* ---------------- one mixer channel strip ---------------- */

function TrackStrip({ track, project, playhead, commit }: { track: Track; project: Project; playhead: number; commit: CommitFn }) {
  const clips = project.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
  const active = clips.find((c) => playhead >= c.start && playhead < c.start + c.duration);
  const ma = active?.mediaId ? project.analysis?.byMedia[active.mediaId] : undefined;
  // Track gain is independent of legacy per-clip volumes; show only the value
  // this fader actually writes to the audio graph.
  const vol = track.volume ?? 1;

  return (
    <div className="panel w-24 shrink-0 flex flex-col items-center gap-1 px-1 py-2">
      <div className="w-full truncate text-center font-mono text-[10px] text-paper-dim" title={track.name}>{track.name}</div>
      <button
        type="button"
        className={`icon-btn ${track.muted ? 'text-heat' : ''}`}
        onClick={() => commit([{ type: 'set_track', trackId: track.id, patch: { muted: !track.muted } }], track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`)}
        title={track.muted ? 'Unmute track' : 'Mute track'}
      >
        {track.muted ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
      </button>
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[9px] text-paper-faint" title="Track gain — affects every clip on this track without changing clip volume">track gain · {clips.length} clip{clips.length === 1 ? '' : 's'}</span>
        <Fader
          value={vol ?? 1}
          disabled={track.locked}
          disabledReason={track.locked ? 'Track is locked' : undefined}
          onCommit={(v) => commit([{ type: 'set_track', trackId: track.id, patch: { volume: v } }], `Set ${track.name} gain`)}
        />
        <span className="font-mono text-[10px] text-signal">{vol != null ? `${vol.toFixed(2)}×` : '—'}</span>
      </div>
      <TrackMeter clip={active} ma={ma} playhead={playhead} />
      <div className="text-center font-mono text-[9px] leading-tight text-paper-faint" title="Fades of the clip under the playhead">
        {active ? `in ${active.fades.in.toFixed(2)}s · out ${active.fades.out.toFixed(2)}s` : '—'}
      </div>
    </div>
  );
}

/* ---------------- master strip (measured project loudness) ---------------- */

function MasterStrip({ project }: { project: Project }) {
  const analyses = Object.values(project.analysis?.byMedia ?? {});
  const avg = analyses.length ? analyses.reduce((sum, ma) => sum + ma.integratedLoudness, 0) / analyses.length : null;
  const peak = analyses.length ? analyses.reduce((sum, ma) => sum + ma.truePeak, 0) / analyses.length : null;
  return (
    <div className="panel w-28 shrink-0 flex flex-col items-center gap-1 border-signal/30 bg-ink-850 px-1 py-2">
      <div className="font-mono text-[10px] text-signal">MASTER</div>
      <div className="flex flex-1 flex-col items-center justify-center gap-0.5">
        <div className="font-mono text-2xl text-signal">{avg != null ? avg.toFixed(1) : '—'}</div>
        <div className="text-[9px] text-paper-faint">LUFS</div>
        <div className="font-mono text-[10px] text-paper-dim">{peak != null ? `${peak.toFixed(1)} dBTP` : '—'}</div>
        {analyses.length > 0 && <div className="text-[8px] text-paper-faint">{analyses.length} analyzed source{analyses.length === 1 ? '' : 's'}</div>}
      </div>
      <div className="text-center text-[9px] leading-tight text-paper-faint">-14 YouTube · -16 podcast · -23 broadcast</div>
    </div>
  );
}

/* ---------------- clip row in the right-hand list ---------------- */

function ClipRow({ clip, name, commit, onSeek }: { clip: Clip; name: string; commit: CommitFn; onSeek: (clip: Clip) => void }) {
  const setFade = (which: 'in' | 'out', v: number) =>
    commit(
      [{ type: 'set_fades', clipId: clip.id, ...(which === 'in' ? { fadeIn: v } : { fadeOut: v }) }],
      `Fade ${which}`,
      'human',
      `${clip.id}:f${which}`,
    );
  const num = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  return (
    <div className="panel space-y-1 p-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSeek(clip)}
          title={`${name} — click to move the playhead to its start`}
          className="min-w-0 flex-1 truncate text-left text-[11px] text-paper hover:text-signal"
        >
          {name}
        </button>
        <span className="font-mono text-[10px] text-paper-faint">{mmss(clip.start)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="range"
          min={0}
          max={4}
          step={0.01}
          value={clip.volume}
          disabled={clip.locked}
          aria-label={`Volume for ${name}`}
          className="min-w-0 flex-1"
          onChange={(e) =>
            commit(
              [{ type: 'set_clip_props', clipId: clip.id, patch: { volume: Number(e.target.value) } }],
              'Set clip volume',
              'human',
              `${clip.id}:vol`,
            )
          }
        />
        <span className="w-10 text-right font-mono text-[10px] text-signal">{clip.volume.toFixed(2)}×</span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-paper-faint">
        in
        <input
          type="number"
          min={0}
          step={0.05}
          value={clip.fades.in}
          disabled={clip.locked}
          aria-label={`Fade in for ${name}`}
          className="w-14 rounded border border-line bg-ink-850 px-1 py-0.5 text-right font-mono text-[10px] text-paper disabled:opacity-40"
          onChange={(e) => { const v = num(e); if (v != null) setFade('in', v); }}
        />
        out
        <input
          type="number"
          min={0}
          step={0.05}
          value={clip.fades.out}
          disabled={clip.locked}
          aria-label={`Fade out for ${name}`}
          className="w-14 rounded border border-line bg-ink-850 px-1 py-0.5 text-right font-mono text-[10px] text-paper disabled:opacity-40"
          onChange={(e) => { const v = num(e); if (v != null) setFade('out', v); }}
        />
        s
      </div>
    </div>
  );
}

/* ---------------- voice-over / TTS panel ---------------- */

function VoicePanel() {
  const row = (text: string) => (
    <div className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-paper-faint/50" aria-hidden />
      <span>{text}</span>
    </div>
  );
  return (
    <div className="space-y-2">
      {/* The real recorder (same component as the Audio tab) — records the mic
          while the timeline plays and drops the take on a Voiceover track. */}
      <VoiceoverRecorder />
      <div className="panel space-y-1 p-2 text-[11px] text-paper-faint">
        <div className="label mb-0.5">Text-to-speech</div>
        {row('Needs an API key (Settings)')}
      </div>
    </div>
  );
}

/* ---------------- page ---------------- */

export function AudioPage() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const commit = useStore((s) => s.commit);
  const toast = useUI((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);

  const audioTracks = project.tracks.filter((t) => t.kind === 'audio');
  const hasAudioMedia = project.media.some((m) => m.type === 'audio');
  const audioClips = project.clips
    .filter((c) => {
      const m = getMedia(project, c.mediaId);
      return !!m && (m.type === 'audio' || m.hasAudio);
    })
    .sort((a, b) => a.start - b.start);

  const runTool = async (name: string, params?: Record<string, unknown>) => {
    if (busy) return;
    setBusy(name);
    try {
      const result = await useStore.getState().applyTool(name, params);
      const changed = result.actions.length > 0;
      toast(result.summary || (changed ? `${name} applied.` : 'No changes applied.'), changed ? 'success' : 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : `Could not run ${name}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const seek = (clip: Clip) => {
    const s = useStore.getState();
    s.pause();
    s.select([clip.id]);
    s.setPlayhead(clip.start);
  };

  const toolBtn = 'btn-solid text-xs px-2.5 py-1';

  const isolateVoice = async () => {
    const s = useStore.getState();
    let clipId = s.selection.find((id) => s.project.clips.some((c) => c.id === id));
    if (!clipId) {
      const active = s.project.clips.find((c) => s.playhead >= c.start && s.playhead < c.start + c.duration
        && (() => { const m = getMedia(s.project, c.mediaId); return !!m && (m.type === 'audio' || m.hasAudio); })());
      clipId = active?.id;
    }
    if (!clipId) { toast('Select an audio or video clip with audio first', 'info'); return; }
    setBusy('voice');
    try {
      const result = await s.isolateVoice(clipId, { reduction: 0.85 });
      toast(result === 'ok' ? 'Voice isolated — a new cleaned clip replaced the original (DSP noise suppression, not AI stem separation)'
        : result === 'no-buffer' ? 'Audio is still decoding — try again in a moment'
          : result === 'no-clip' ? 'That clip has no usable audio' : 'This container cannot be decoded in the browser',
      result === 'ok' ? 'success' : 'error');
    } finally { setBusy(null); }
  };

  return (
    <div className="h-full flex flex-col bg-ink-950">
      {/* top strip: wraps on narrow screens instead of clipping the last tool */}
      <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-line px-2 py-1 sm:px-3">
        <div className="flex items-center gap-2 font-display text-xs tracking-widest text-paper-dim">
          <Waves size={13} className="text-signal" aria-hidden />
          <span className="hidden sm:inline">AUDIO</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
          <button type="button" className={toolBtn} disabled={busy !== null} onClick={() => void runTool('balance_audio')}>
            <SlidersHorizontal size={12} aria-hidden /> Balance &amp; normalize
          </button>
          <button type="button" className={toolBtn} disabled={busy !== null} onClick={() => void runTool('cleanup_audio')}>
            Clean up noise
          </button>
          <button type="button" className={toolBtn} disabled={busy !== null} onClick={() => void isolateVoice()}
            title="Spectral noise suppression on the selected clip — writes a real cleaned WAV used by preview and export. Not AI stem separation.">
            Isolate voice
          </button>
          <span title={hasAudioMedia ? 'Balance music under dialogue' : 'Import music first'}>
            <button
              type="button"
              className={toolBtn}
              disabled={busy !== null || !hasAudioMedia}
              onClick={() => void runTool('add_music', { mood: 'balanced' })}
            >
              Duck music
            </button>
          </span>
        </div>
      </div>

      {audioTracks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="panel space-y-3 p-6 text-center">
            <div className="text-sm text-paper-dim">No audio tracks</div>
            <button
              type="button"
              className="btn-signal text-xs"
              onClick={() => commit([{ type: 'add_track', track: { kind: 'audio' } }], 'Add audio track')}
            >
              Add audio track
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          {/* mixer strips */}
          <div className="cf-audio-mixer min-h-[140px] min-w-0 flex-1 overflow-y-auto p-2 sm:min-h-[240px] sm:p-3">
            <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
              {audioTracks.map((t) => (
                <TrackStrip key={t.id} track={t} project={project} playhead={playhead} commit={commit} />
              ))}
              <MasterStrip project={project} />
            </div>
          </div>
          {/* clip list: below the mixer on phones/tablets, beside it on wide desktops */}
          <div className="cf-audio-clips max-h-[42%] w-full shrink-0 space-y-1.5 overflow-y-auto border-t border-line p-2 xl:max-h-none xl:w-72 xl:border-t-0 xl:border-l">
            <div className="label">Audio clips</div>
            {audioClips.length === 0 && (
              <p className="px-1 text-[11px] text-paper-faint">No audio clips on the timeline yet.</p>
            )}
            {audioClips.map((c) => (
              <ClipRow key={c.id} clip={c} name={c.name ?? getMedia(project, c.mediaId)?.name ?? 'Clip'} commit={commit} onSeek={seek} />
            ))}
            <VoicePanel />
          </div>
        </div>
      )}
    </div>
  );
}
