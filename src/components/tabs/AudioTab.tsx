import { Music, Volume2, VolumeX } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { commit, DragSlider, Section, Hint, useSelectedClip } from './shared';
import type { MediaAsset } from '../../../engine';

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
