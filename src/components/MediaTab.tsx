import { useEffect, useRef, useState } from 'react';
import { Upload, Plus, Trash2, Film, Music, Image as ImageIcon, Sparkles, Loader2 } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { projectDuration, uid, type MediaAsset, type GeneratorSpec, type Action } from '../../engine';

/** MIME type shared with the Timeline drop zone. */
export const FALCONCUT_MIME = 'application/x-falconcut';

const thumbCache = new Map<string, string>();

function Thumb({ asset, className = '' }: { asset: MediaAsset; className?: string }) {
  const pool = useStore((s) => s.pool);
  const [src, setSrc] = useState<string | null>(thumbCache.get(asset.id) ?? null);
  useEffect(() => {
    if (thumbCache.has(asset.id)) { setSrc(thumbCache.get(asset.id)!); return; }
    let alive = true;
    if (asset.type === 'video' || asset.type === 'image') {
      pool.thumbnail(asset.id, Math.min(1, asset.duration / 2), 160).then((d) => {
        if (d && alive) { thumbCache.set(asset.id, d); setSrc(d); }
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [asset.id, asset.type, asset.duration, pool]);

  const Icon = asset.type === 'audio' ? Music : asset.type === 'image' ? ImageIcon : asset.type === 'generator' ? Sparkles : Film;
  return (
    <div className={`bg-ink-800 flex items-center justify-center overflow-hidden ${className}`}>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" draggable={false} /> : <Icon size={22} className="text-paper-faint" />}
    </div>
  );
}

const GENERATORS: { label: string; spec: GeneratorSpec }[] = [
  { label: 'Gradient', spec: { kind: 'gradient', colors: ['#5B21B6', '#0E7FBF', '#101012'], speed: 0.3, seed: 7 } },
  { label: 'Particles', spec: { kind: 'particles', colors: ['#4C9AFF', '#38BDF8'], speed: 0.5, seed: 3 } },
  { label: 'Waves', spec: { kind: 'waves', colors: ['#0E7FBF', '#C084FC'], speed: 0.4, seed: 11 } },
  { label: 'Solid', spec: { kind: 'solid', colors: ['#0F131D'], speed: 0, seed: 1 } },
];

export function MediaTab() {
  const project = useStore((s) => s.project);
  const queue = useStore((s) => s.queue);
  const ui = useUI();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      const { imported, skipped } = await useStore.getState().importFiles(files);
      if (skipped.length) {
        ui.toast(`Imported ${imported} file${imported === 1 ? '' : 's'}; ${skipped.length} failed — ${skipped[0]}`, 'error');
      } else {
        ui.toast(`Imported ${imported} file${imported === 1 ? '' : 's'}`, 'success');
      }
    } catch (e) {
      ui.toast(`Import failed: ${(e as Error).message}`, 'error');
    }
  };

  const addToTimeline = (asset: MediaAsset) => {
    const p = useStore.getState().project;
    const isAudio = asset.type === 'audio';
    const track = p.tracks.find((t) => t.kind === (isAudio ? 'audio' : 'video'));
    if (!track) return;
    const start = isAudio ? 0 : projectDuration(p);
    const duration = Math.max(0.5, asset.duration || 5);
    useStore.getState().commit([{ type: 'add_clip', clip: { trackId: track.id, mediaId: asset.id, start, duration, inPoint: 0 } }], `Add ${asset.name}`);
    ui.toast(`Added ${asset.name} to timeline`);
  };

  const addGenerator = (spec: GeneratorSpec, label: string) => {
    const p = useStore.getState().project;
    const id = uid('media');
    const asset: MediaAsset = {
      id, name: `${label} background`, type: 'generator', duration: 6,
      width: p.settings.width, height: p.settings.height, hasAudio: false,
      generator: { ...spec, label }, source: 'demo',
    };
    const track = p.tracks.find((t) => t.kind === 'video');
    const actions: Action[] = [{ type: 'add_media', asset }];
    if (track) actions.push({ type: 'add_clip', clip: { trackId: track.id, mediaId: id, start: projectDuration(p), duration: 6, inPoint: 0 } });
    useStore.getState().commit(actions, `Add ${label} background`);
    void useStore.getState().pool.register(asset);
    setGenOpen(false);
    ui.toast(`${label} background added`, 'success');
  };

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  return (
    <div
      className="p-2.5 relative min-h-full"
      onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (hasFiles(e) && !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragging(false); void importFiles(Array.from(e.dataTransfer.files)); }}
    >
      {dragging && <div className="absolute inset-1 z-10 rounded-xl border-2 border-dashed border-signal bg-signal/10 flex items-center justify-center text-signal text-sm font-medium pointer-events-none">Drop media to import</div>}

      <input ref={inputRef} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={(e) => { void importFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

      <div className="flex gap-1.5 mb-2">
        <button className="btn-signal flex-1" onClick={() => inputRef.current?.click()}><Upload size={15} /> Import</button>
        <div className="relative">
          <button className="btn-solid" onClick={() => setGenOpen((v) => !v)} title="Generate a procedural background"><Sparkles size={15} /></button>
          {genOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 panel p-1 w-36 shadow-panel animate-fade-in">
              {GENERATORS.map((g) => (
                <button key={g.label} className="w-full text-left px-2.5 py-1.5 rounded-md text-sm text-paper-dim hover:text-paper hover:bg-ink-750" onClick={() => addGenerator(g.spec, g.label)}>{g.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {project.media.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-bright text-center text-paper-faint text-[11px] py-8 px-3">
          <Film size={22} className="mx-auto mb-2 opacity-50" />
          <div className="text-paper-dim font-medium mb-1">Drag media to the timeline</div>
          Import files or generate a background. Videos never leave this device.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {project.media.map((m) => {
            const ma = project.analysis?.byMedia[m.id];
            const selected = selectedId === m.id;
            return (
              <div
                key={m.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(FALCONCUT_MIME, JSON.stringify({ kind: 'media', mediaId: m.id }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => setSelectedId(m.id)}
                onDoubleClick={() => addToTimeline(m)}
                title={`${m.name} — drag to timeline, double-click to add at playhead`}
                className={`group relative rounded-lg border overflow-hidden bg-ink-850 cursor-grab active:cursor-grabbing transition-colors ${selected ? 'ring-2 ring-signal border-signal/60' : 'border-line hover:border-line-bright hover:bg-ink-800'}`}
              >
                <div className="relative aspect-video">
                  <Thumb asset={m} className="absolute inset-0 w-full h-full" />
                  {/* asset type badge */}
                  <span className="absolute top-1 left-1 text-[8px] font-bold uppercase tracking-wider px-1 rounded bg-ink-950/70 text-paper-dim pointer-events-none">{m.type}</span>
                  {/* duration badge */}
                  {m.duration > 0 && (
                    <span className="absolute bottom-1 right-1 text-[9px] font-mono px-1 rounded bg-ink-950/70 text-paper pointer-events-none">{m.duration.toFixed(1)}s</span>
                  )}
                  {ma && <span className="absolute top-1 right-1 text-[9px] text-heat-green pointer-events-none" title={ma.flags.join('\n') || 'Analyzed'}>✓</span>}
                </div>
                <div className="flex items-center gap-1 px-1.5 py-1">
                  <span className="text-[11px] text-paper truncate flex-1">{m.name}</span>
                  <button className="icon-btn p-0.5 opacity-0 group-hover:opacity-100 shrink-0" onClick={(e) => { e.stopPropagation(); addToTimeline(m); }} title="Add to timeline"><Plus size={13} /></button>
                  <button className="icon-btn p-0.5 opacity-0 group-hover:opacity-100 hover:text-heat shrink-0" onClick={(e) => { e.stopPropagation(); useStore.getState().removeMedia(m.id); if (selectedId === m.id) setSelectedId(null); }} title="Remove media"><Trash2 size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {queue && (
        <div className="mt-3 panel p-2.5">
          <div className="flex items-center gap-2 text-xs text-paper-dim mb-1.5">
            <Loader2 size={13} className="animate-spin text-mind" />
            <span className="truncate">{queue.label}</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-750 overflow-hidden">
            <div className="h-full bg-mind transition-all" style={{ width: `${Math.round(queue.pct * 100)}%` }} />
          </div>
          <div className="text-[10px] text-paper-faint mt-1">{queue.stage}{queue.note ? ` · ${queue.note}` : ''}{queue.pending ? ` · ${queue.pending} queued` : ''}</div>
        </div>
      )}
    </div>
  );
}
