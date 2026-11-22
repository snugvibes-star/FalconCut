/**
 * Right-click context menu for timeline clips and empty timeline space.
 * Every item is a real engine action; nothing decorative.
 */
import { useEffect, useRef } from 'react';
import {
  Scissors, Copy, Trash2, Lock, Unlock, Volume2, VolumeX, ArrowLeftToLine,
  ArrowRightToLine, FastForward, Tag, Flag, Maximize, AudioLines, ClipboardPaste,
  ChevronUp, ChevronDown, ListChecks, Headphones, Gauge, Rows3,
} from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { clipboardCount, pasteClipboard } from '../features/clipClipboard';
import { uid, type Action, type Clip } from '../../engine';

export interface CtxMenuState {
  /** Viewport coordinates for the menu. */
  x: number;
  y: number;
  /** Clip under the cursor, or null = empty timeline space. */
  clipId: string | null;
  /** Track under the cursor (track header or empty lane), when known. */
  trackId?: string | null;
}

const LABEL_COLORS: { key: string; css: string }[] = [
  { key: 'red', css: '#FB7185' },
  { key: 'amber', css: '#FBBF24' },
  { key: 'green', css: '#34D399' },
  { key: 'blue', css: '#4C9AFF' },
  { key: 'purple', css: '#C084FC' },
];

export function ClipContextMenu({ menu, onClose }: { menu: CtxMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  if (!menu) return null;

  const s = useStore.getState();
  const clip: Clip | undefined = menu.clipId ? s.project.clips.find((c) => c.id === menu.clipId) : undefined;
  const track = menu.trackId ? s.project.tracks.find((t) => t.id === menu.trackId) : undefined;
  const sameKind = track ? s.project.tracks.map((t, i) => ({ t, i })).filter((x) => x.t.kind === track.kind) : [];
  const trackPos = track ? sameKind.findIndex((x) => x.t.id === track.id) : -1;
  const canMoveUp = trackPos > 0;
  const canMoveDown = trackPos >= 0 && trackPos < sameKind.length - 1;
  const trackClips = track ? s.project.clips.filter((c) => c.trackId === track.id) : [];

  const run = (fn: () => void) => () => { fn(); onClose(); };
  const commit = (actions: Parameters<typeof s.commit>[0], label: string) => s.commit(actions, label, 'human');

  // position: keep inside the viewport
  const W = 210;
  const left = Math.min(menu.x, window.innerWidth - W - 8);
  const top = Math.min(menu.y, window.innerHeight - (clip ? 400 : track ? 360 : 220) - 8);

  const Item = ({ icon: Icon, label, onClick, danger, disabled, title }: {
    icon: typeof Scissors; label: string; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] rounded-md text-left transition-colors disabled:opacity-30 disabled:pointer-events-none ${danger ? 'text-heat hover:bg-heat/10' : 'text-paper hover:bg-ink-700'}`}
    >
      <Icon size={13} className="shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      data-falconcut-menu=""
      className="fixed z-[100] min-w-[210px] panel !rounded-lg p-1 shadow-panel animate-fade-in"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {clip ? (
        <>
          <div className="px-2.5 pt-1 pb-1.5 text-[10px] text-paper-faint truncate border-b border-line mb-1">
            {clip.name ?? clip.text?.text ?? 'Clip'}
          </div>
          <Item icon={Scissors} label="Split at playhead"
            disabled={!(s.playhead > clip.start + 0.01 && s.playhead < clip.start + clip.duration - 0.01)}
            title="Split the clip where the playhead sits"
            onClick={run(() => commit([{ type: 'split_clip', clipId: clip.id, time: s.playhead }], 'Split clip'))} />
          <Item icon={Copy} label="Duplicate"
            title="Place a copy right after this clip — effects, keyframes and fades included"
            onClick={run(() => {
              // Deep-copy the whole clip (effects, keyframes, fades, transform,
              // transitions, label), regenerating per-clip ids; start is clamped
              // into the nearest free gap by the engine so it can't stack.
              const copy = JSON.parse(JSON.stringify(clip)) as unknown as Partial<Clip> & { trackId: string; start: number; duration: number };
              copy.id = undefined;
              copy.start = clip.start + clip.duration;
              copy.keyframes = clip.keyframes.map((k) => ({ ...k, id: undefined as unknown as string }));
              copy.effects = clip.effects.map((f) => ({ ...f, id: undefined as unknown as string }));
              commit([{ type: 'add_clip', clip: copy }], 'Duplicate clip');
            })} />
          {(() => {
            // Kdenlive-style "Extract audio" for video clips with decodable audio.
            const asset = clip.mediaId ? s.project.media.find((m) => m.id === clip.mediaId) : undefined;
            if (!asset || asset.type !== 'video') return null;
            const undecodable = s.pool.decodeFailedFor(asset.id);
            const hasBuffer = !!s.pool.getBuffer(asset.id);
            return (
              <Item icon={AudioLines} label="Extract audio"
                disabled={undecodable || !hasBuffer}
                title={undecodable
                  ? `Cannot extract: this browser cannot decode ${asset.name}'s audio (e.g. AC3). Convert it to AAC or WAV first.`
                  : 'Detach this video\'s audio to its own audio clip (original is muted)'}
                onClick={run(() => {
                  void s.extractAudio(clip.id).then((status) => {
                    const ui = useUI.getState();
                    if (status === 'ok') ui.toast('Audio extracted to a new audio clip');
                    else if (status === 'undecodable') ui.toast(`Cannot extract: browser cannot decode ${asset.name}'s audio (e.g. AC3)`, 'error');
                    else if (status === 'no-buffer') ui.toast('Audio is still decoding — try again in a moment', 'error');
                  });
                })} />
            );
          })()}
          <Item icon={Gauge} label="Adjust speed in Inspector"
            title="Open the Inspector's Speed tab with curve editor, presets and audio options"
            onClick={run(() => {
              s.select([clip.id]);
              useUI.getState().setRightTab('inspector');
              window.dispatchEvent(new CustomEvent('falconcut:inspector-tab', { detail: 'speed' }));
            })} />
          <div className="h-px bg-line my-1" />
          {clip.volume > 0 ? (
            <Item icon={VolumeX} label="Mute clip"
              title="Set clip volume to 0"
              onClick={run(() => commit([{ type: 'set_clip_props', clipId: clip.id, patch: { volume: 0 } }], 'Mute clip'))} />
          ) : (
            <Item icon={Volume2} label="Unmute clip (100%)"
              onClick={run(() => commit([{ type: 'set_clip_props', clipId: clip.id, patch: { volume: 1 } }], 'Unmute clip'))} />
          )}
          <Item icon={ArrowLeftToLine} label="Fade in 0.3s"
            title="Add a 0.3s audio fade-in"
            onClick={run(() => commit([{ type: 'set_fades', clipId: clip.id, fadeIn: 0.3 }], 'Fade in'))} />
          <Item icon={ArrowRightToLine} label="Fade out 0.3s"
            title="Add a 0.3s audio fade-out"
            onClick={run(() => commit([{ type: 'set_fades', clipId: clip.id, fadeOut: 0.3 }], 'Fade out'))} />
          <div className="h-px bg-line my-1" />
          <div className="px-2.5 py-1 flex items-center gap-1.5">
            <Tag size={12} className="text-paper-faint" />
            <span className="text-[10px] text-paper-faint mr-0.5">Label</span>
            {LABEL_COLORS.map((c) => (
              <button key={c.key} title={`Label: ${c.key}`}
                onClick={run(() => commit([{ type: 'set_clip_props', clipId: clip.id, patch: { label: c.key } }], `Label ${c.key}`))}
                className="w-3.5 h-3.5 rounded-sm border border-line hover:scale-110 transition-transform"
                style={{ background: c.css }} />
            ))}
          </div>
          <div className="h-px bg-line my-1" />
          <Item icon={clip.locked ? Unlock : Lock} label={clip.locked ? 'Unlock clip' : 'Lock clip'}
            onClick={run(() => commit([{ type: 'set_clip_props', clipId: clip.id, patch: { locked: !clip.locked } }], clip.locked ? 'Unlock clip' : 'Lock clip'))} />
          <Item icon={Trash2} label="Delete" danger
            onClick={run(() => commit([{ type: 'remove_clip', clipId: clip.id }], 'Delete clip'))} />
          <Item icon={FastForward} label="Ripple delete (close gap)" danger
            title="Delete this clip and pull every later clip back to close the gap"
            onClick={run(() => commit([{ type: 'remove_clip', clipId: clip.id, ripple: true }], 'Ripple delete clip'))} />
        </>
      ) : track ? (
        <>
          <div className="px-2.5 pt-1 pb-1.5 text-[10px] text-paper-faint truncate border-b border-line mb-1">
            {track.name} · {track.kind === 'text' ? 'text' : track.kind}
          </div>
          <Item icon={ChevronUp} label="Move track up" disabled={!canMoveUp}
            title="Reorder this track above the previous track of the same kind"
            onClick={run(() => commit([{ type: 'move_track', trackId: track.id, toIndex: sameKind[trackPos - 1].i }], 'Move track up'))} />
          <Item icon={ChevronDown} label="Move track down" disabled={!canMoveDown}
            title="Reorder this track below the next track of the same kind"
            onClick={run(() => commit([{ type: 'move_track', trackId: track.id, toIndex: sameKind[trackPos + 1].i }], 'Move track down'))} />
          <Item icon={Copy} label={`Duplicate track (${trackClips.length} clip${trackClips.length === 1 ? '' : 's'})`}
            title="Copy this track and everything on it — one undo step"
            onClick={run(() => {
              const idx = s.project.tracks.findIndex((t) => t.id === track.id);
              const newTrackId = uid('trk');
              const actions: Action[] = [{
                type: 'add_track',
                track: { id: newTrackId, kind: track.kind, name: `${track.name} copy`, height: track.height },
                index: idx + 1,
              }];
              for (const c of trackClips) {
                const copy = JSON.parse(JSON.stringify(c)) as Record<string, unknown> & { trackId: string };
                copy.id = undefined;
                copy.trackId = newTrackId;
                copy.keyframes = (c.keyframes as { id: string }[]).map((k) => ({ ...k, id: undefined }));
                copy.effects = (c.effects as { id: string }[]).map((e) => ({ ...e, id: undefined }));
                actions.push({ type: 'add_clip', clip: copy as unknown as Clip });
              }
              commit(actions, `Duplicate ${track.name}`);
            })} />
          <div className="h-px bg-line my-1" />
          <div className="px-2.5 py-1 flex items-center gap-1.5">
            <Rows3 size={12} className="text-paper-faint" />
            <span className="text-[10px] text-paper-faint mr-0.5">Height</span>
            {[{ label: 'Compact', h: 44 }, { label: 'Normal', h: 64 }, { label: 'Tall', h: 96 }].map((x) => (
              <button key={x.h} title={`Set track height to ${x.label.toLowerCase()} (${x.h}px)`}
                onClick={run(() => commit([{ type: 'set_track', trackId: track.id, patch: { height: x.h } }], `Track height ${x.label}`))}
                className={`px-1.5 py-0.5 rounded border text-[10px] leading-none transition-colors ${Math.abs((track.height ?? 64) - x.h) < 2 ? 'border-signal/60 bg-signal/10 text-signal' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="h-px bg-line my-1" />
          <Item icon={ListChecks} label={`Select all ${trackClips.length} clip${trackClips.length === 1 ? '' : 's'} on this track`}
            disabled={!trackClips.length}
            onClick={run(() => s.select(trackClips.map((c) => c.id)))} />
          <Item icon={Headphones} label={track.solo ? 'Solo off' : 'Solo track'}
            disabled={track.kind === 'text'}
            title={track.kind === 'text' ? 'Text tracks carry no audio' : 'Only this track of its kind plays'}
            onClick={run(() => commit([{ type: 'set_track', trackId: track.id, patch: { solo: !track.solo } }], track.solo ? 'Solo off' : 'Solo track'))} />
          <Item icon={track.locked ? Unlock : Lock} label={track.locked ? 'Unlock track' : 'Lock track'}
            onClick={run(() => commit([{ type: 'set_track', trackId: track.id, patch: { locked: !track.locked } }], track.locked ? 'Unlock track' : 'Lock track'))} />
          <div className="h-px bg-line my-1" />
          <Item icon={Trash2} label={`Delete track${trackClips.length ? ` and ${trackClips.length} clip${trackClips.length === 1 ? '' : 's'}` : ''}`} danger
            title="Removes the track and everything on it — undo brings it back"
            onClick={run(() => commit([{ type: 'remove_track', trackId: track.id }], 'Delete track'))} />
        </>
      ) : (
        <>
          <Item icon={ClipboardPaste} label="Paste at playhead" disabled={!clipboardCount()}
            title="Paste the copied clips at the playhead (Ctrl+V)"
            onClick={run(() => pasteClipboard(s.playhead))} />
          <Item icon={Flag} label="Add marker at playhead"
            onClick={run(() => commit([{ type: 'add_marker', marker: { time: s.playhead, label: `M${s.project.markers.length + 1}`, color: '#4C9AFF' } }], 'Add marker'))} />
          <Item icon={Maximize} label="Zoom to fit"
            onClick={run(() => {
              // same math the toolbar button uses is inside Timeline; approximate via store zoom if available
              const ev = new CustomEvent('falconcut:zoom-to-fit');
              window.dispatchEvent(ev);
            })} />
          <div className="h-px bg-line my-1" />
          <div className="px-2.5 py-1 text-[10px] text-paper-faint">
            Drag on empty space to marquee-select · drag media/text/stickers from the left panel.
          </div>
        </>
      )}
    </div>
  );
}
