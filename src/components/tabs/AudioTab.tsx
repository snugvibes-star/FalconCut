import { useRef, useState } from 'react';
import { Mic, Music, Square, Volume2, VolumeX } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { commit, DragSlider, Section, Hint, useSelectedClip } from './shared';
import { uid, type Action } from '../../../engine';
import type { MediaAsset } from '../../../engine';

/** Real voiceover recording: capture the microphone with MediaRecorder while
 * the timeline plays so the user can narrate over their video. On stop the
 * recording is imported through the SAME importFiles path as local files and
 * placed at the playhead (where recording started) on a Voiceover audio track
 * — one undo step for the whole thing. */
export function VoiceoverRecorder() {
  const ui = useUI();
  const [phase, setPhase] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startAtRef = useRef(0);
  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const finish = async (stream: MediaStream, mime: string) => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    useStore.getState().pause();
    stream.getTracks().forEach((t) => t.stop());
    recRef.current = null;
    const seconds = Math.max(0.5, elapsedRef.current);
    setPhase('saving');
    try {
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunksRef.current, { type: mime });
      if (blob.size === 0) throw new Error('The recording came back empty — check the microphone.');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const { ids } = await useStore.getState().importFiles(
        [new File([blob], `voiceover-${stamp}.${ext}`, { type: mime })],
        { addToTimeline: false },
      );
      const s = useStore.getState();
      const mediaId = ids[0];
      if (!mediaId) throw new Error('Could not import the recording.');
      const existing = s.project.tracks.find((t) => t.kind === 'audio' && t.name === 'Voiceover');
      const trackId = existing?.id ?? uid('trk');
      const actions: Action[] = [];
      if (!existing) actions.push({ type: 'add_track', track: { id: trackId, kind: 'audio', name: 'Voiceover' } });
      actions.push({ type: 'add_clip', clip: { trackId, mediaId, start: startAtRef.current, duration: seconds, inPoint: 0, name: 'Voiceover' } });
      s.commit(actions, 'Record voiceover');
      ui.toast(`Voiceover added — ${seconds.toFixed(1)}s at the playhead`, 'success');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      setPhase('idle');
      setElapsed(0);
      elapsedRef.current = 0;
    }
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => { void finish(stream, rec.mimeType || mime || 'audio/webm'); };
      startAtRef.current = useStore.getState().playhead;
      rec.start(250);
      recRef.current = rec;
      elapsedRef.current = 0;
      setElapsed(0);
      setPhase('recording');
      timerRef.current = setInterval(() => { elapsedRef.current += 1; setElapsed(elapsedRef.current); }, 1000);
      // Play the timeline so the user narrates over their video (headphones
      // recommended — the mic hears speakers otherwise).
      useStore.getState().play();
    } catch (e) {
      const err = e as Error;
      ui.toast(
        err.name === 'NotAllowedError' ? 'Microphone access was denied. Allow the mic in the browser (padlock icon) and try again.'
          : err.name === 'NotFoundError' ? 'No microphone found on this device.'
          : `Could not start recording: ${err.message}`,
        'error',
      );
    }
  };

  const stop = () => {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  };

  return (
    <Section title="Voiceover">
      <Hint>Records your microphone while the timeline plays, then drops the take at the playhead on a Voiceover track. Use headphones so the mic only hears you.</Hint>
      {phase === 'recording' ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-heat flex-1">
            <span className="w-2 h-2 rounded-full bg-heat animate-pulse" /> Recording · {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
          </span>
          <button className="btn-danger py-1 px-3 text-xs" onClick={stop}><Square size={13} /> Stop</button>
        </div>
      ) : (
        <button className="btn-solid w-full py-1.5 text-xs justify-center" disabled={phase === 'saving'} onClick={() => void start()}>
          <Mic size={14} /> {phase === 'saving' ? 'Saving take…' : 'Record voiceover'}
        </button>
      )}
    </Section>
  );
}

export function AudioTab() {
  const project = useStore((s) => s.project);
  const ui = useUI();
  const clip = useSelectedClip();
  const audioAssets = project.media.filter((m) => m.type === 'audio');
  const audioTracks = project.tracks.filter((t) => t.kind === 'audio');

  const addToTimeline = (asset: MediaAsset) => {
    const p = useStore.getState().project;
    const track = p.tracks.find((t) => t.kind === 'audio');
    if (!track) { ui.toast('No audio track', 'error'); return; }
    commit([{ type: 'add_clip', clip: { trackId: track.id, mediaId: asset.id, start: 0, duration: Math.max(0.5, asset.duration || 5), inPoint: 0 } }], `Add ${asset.name}`);
    ui.toast(`Added ${asset.name} to audio track`);
  };

  return (
    <div>
      <VoiceoverRecorder />
      <Section title="Audio assets">
        {audioAssets.length === 0 && <Hint>Import audio files in the Media tab, or use video files that contain audio.</Hint>}
        {audioAssets.map((m) => (
          <div key={m.id} className="group flex items-center gap-2 p-1.5 rounded-lg hover:bg-ink-800 border border-transparent hover:border-line">
            <div className="w-7 h-7 shrink-0 rounded-md bg-ink-800 border border-line flex items-center justify-center"><Music size={13} className="text-paper-faint" /></div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-paper truncate" title={m.name}>{m.name}</div>
              <div className="text-[10px] text-paper-faint">{m.duration > 0 ? `${m.duration.toFixed(1)}s` : 'audio'}</div>
            </div>
            <button className="icon-btn opacity-0 group-hover:opacity-100" onClick={() => addToTimeline(m)} title="Add to audio track (at 0s)"><Music size={14} /></button>
          </div>
        ))}
      </Section>

      <Section title="Audio tracks">
        {audioTracks.map((t) => (
          <div key={t.id} className="flex items-center gap-2 text-xs">
            <span className="text-paper-dim flex-1 truncate">{t.name}</span>
            <button
              className={`icon-btn ${t.muted ? 'text-heat' : ''}`}
              onClick={() => commit([{ type: 'set_track', trackId: t.id, patch: { muted: !t.muted } }], t.muted ? 'Unmute track' : 'Mute track')}
              title={t.muted ? 'Unmute' : 'Mute'}
            >
              {t.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        ))}
        {audioTracks.length === 0 && <Hint>No audio tracks.</Hint>}
      </Section>

      <Section title="Selected clip audio">
        {!clip && <Hint>Select a clip on the timeline to adjust volume and fades.</Hint>}
        {clip && (
          <>
            <DragSlider label="Volume" value={clip.volume} min={0} max={2} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} commitKey={`${clip.id}:vol`}
              onCommit={(v) => commit([{ type: 'set_clip_props', clipId: clip.id, patch: { volume: v } }], 'Volume', `${clip.id}:vol`)} />
            <DragSlider label="Fade in" value={clip.fades.in} min={0} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}s`} commitKey={`${clip.id}:fi`}
              onCommit={(v) => commit([{ type: 'set_fades', clipId: clip.id, fadeIn: v }], 'Fade in', `${clip.id}:fi`)} />
            <DragSlider label="Fade out" value={clip.fades.out} min={0} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}s`} commitKey={`${clip.id}:fo`}
              onCommit={(v) => commit([{ type: 'set_fades', clipId: clip.id, fadeOut: v }], 'Fade out', `${clip.id}:fo`)} />
          </>
        )}
      </Section>
    </div>
  );
}
