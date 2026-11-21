/**
 * Stock media panel: search free stock providers and pull media straight
 * into the project. Import goes through the SAME importFiles() path as local
 * files, so everything (probe, thumbnails, timeline drag, export) behaves
 * identically afterwards.
 *
 * Provider honesty:
 * - Archive.org (Internet Archive) works KEYLESS — public-domain / CC media,
 *   full URLs, CORS allowed. This is the default and always functional.
 * - Pexels, Pixabay and Freesound need a free personal API key (pasted once,
 *   stored only in this browser). Without a key they show what to do instead
 *   of failing silently.
 * - Some CDNs block direct browser fetches (CORS). When that happens the
 *   item stays and a toast explains the manual-import fallback — no fake
 *   "added" state.
 */
import { useEffect, useState } from 'react';
import { Search, Download, KeyRound, Loader2, Globe, Clapperboard, Music, Image as ImageIcon } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { projectDuration } from '../../../engine';

type Kind = 'video' | 'audio' | 'image';
type Provider = 'archive' | 'pexels' | 'pixabay' | 'freesound';

interface StockItem {
  id: string;
  title: string;
  kind: Kind;
  duration?: number;
  thumb?: string;
  src: string; // direct media URL to fetch
  filename: string;
  license: string;
  provider: Provider;
}

const KEYS_STORAGE = 'falconcut.stockKeys';
const loadKeys = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(KEYS_STORAGE) || '{}'); } catch { return {}; }
};

const PROVIDERS: { id: Provider; label: string; icon: typeof Globe; status: 'working' | 'needs-key'; note: string }[] = [
  { id: 'archive', label: 'Archive.org', icon: Globe, status: 'working', note: 'Keyless · public-domain & CC films, audio' },
  { id: 'pexels', label: 'Pexels', icon: Clapperboard, status: 'needs-key', note: 'Free API key · HD video & photos' },
  { id: 'pixabay', label: 'Pixabay', icon: ImageIcon, status: 'needs-key', note: 'Free API key · video clips' },
  { id: 'freesound', label: 'Freesound', icon: Music, status: 'needs-key', note: 'Free API key · CC sound effects' },
];

const fmtDur = (s?: number) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

/* ---------------- provider searches (all return StockItem[]) ---------------- */

async function searchArchive(q: string, kind: 'video' | 'audio'): Promise<StockItem[]> {
  const media = kind === 'video' ? 'movies' : 'audio';
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}+AND+mediatype%3A(${media})&fl%5B%5D=identifier&fl%5B%5D=title&rows=24&page=1&output=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Archive.org search failed (HTTP ${res.status})`);
  const data = await res.json();
  const docs: { identifier: string; title?: string }[] = data?.response?.docs ?? [];
  return docs.map((d) => ({
    id: d.identifier,
    title: (d.title || d.identifier).slice(0, 60),
    kind,
    provider: 'archive' as const,
    thumb: `https://archive.org/services/img/${d.identifier}`,
    // The file is resolved lazily from item metadata at import time.
    src: `metadata:${d.identifier}`,
    filename: `${d.identifier}`,
    license: 'Archive.org item license (varies — check the item page)',
  }));
}

/** Resolve the best downloadable file of an Archive.org item. */
async function archiveFileFor(identifier: string, kind: Kind): Promise<{ url: string; name: string } | null> {
  const res = await fetch(`https://archive.org/metadata/${identifier}`);
  if (!res.ok) return null;
  const data = await res.json();
  const files: { name: string; format?: string; length?: string; height?: number }[] = data?.files ?? [];
  const want = kind === 'video' ? ['h.264', 'mpeg4', '512kb.mp4'] : ['vorbis', 'mp3', 'flac', 'ogg'];
  const ok = files
    .filter((f) => f.format && want.some((w) => f.format!.toLowerCase().includes(w)))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const pick = ok[0];
  if (!pick) return null;
  return { url: `https://archive.org/download/${identifier}/${encodeURIComponent(pick.name)}`, name: pick.name.split('/').pop() || pick.name };
}

async function searchPexels(q: string, kind: 'video' | 'image', key: string): Promise<StockItem[]> {
  const url = kind === 'video'
    ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=24`
    : `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=24`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels search failed (HTTP ${res.status} — check the API key)`);
  const data = await res.json();
  if (kind === 'video') {
    const vids: { id: number; duration: number; image: string; video_files: { link: string; width: number; quality: string; file_type: string }[]; user: { name: string } }[] = data?.videos ?? [];
    return vids.map((v) => {
      const files = (v.video_files || []).filter((f) => f.file_type === 'video/mp4');
      files.sort((a, b) => a.width - b.width);
      const pick = files.find((f) => f.width >= 1280) ?? files[files.length - 1];
      return {
        id: `pexels-v-${v.id}`, title: `Pexels video ${v.id} · ${v.user?.name ?? ''}`.slice(0, 60), kind: 'video' as const,
        duration: v.duration, thumb: v.image, src: pick?.link ?? '', filename: `pexels-${v.id}.mp4`,
        license: 'Pexels License — free to use, attribution appreciated',
        provider: 'pexels' as const,
      };
    }).filter((i) => i.src);
  }
  const photos: { id: number; src: { original: string; medium: string }; photographer: string }[] = data?.photos ?? [];
  return photos.map((p) => ({
    id: `pexels-p-${p.id}`, title: `Photo by ${p.photographer}`.slice(0, 60), kind: 'image' as const,
    thumb: p.src.medium, src: p.src.original, filename: `pexels-${p.id}.jpg`,
    license: 'Pexels License — free to use, attribution appreciated', provider: 'pexels' as const,
  }));
}

async function searchPixabay(q: string, key: string): Promise<StockItem[]> {
  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=24`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay search failed (HTTP ${res.status} — check the API key)`);
  const data = await res.json();
  const hits: { id: number; duration: number; videos: Record<string, { url: string; width: number }>; picture_id?: number; user: string }[] = data?.hits ?? [];
  return hits.map((h) => {
    const sizes = Object.values(h.videos || {});
    sizes.sort((a, b) => a.width - b.width);
    const pick = sizes.find((s) => s.width >= 1280) ?? sizes[sizes.length - 1];
    const thumb = h.picture_id ? `https://i.vimeocdn.com/video/${h.picture_id}_295x166.jpg` : undefined;
    return {
      id: `pixabay-${h.id}`, title: `Pixabay clip by ${h.user}`.slice(0, 60), kind: 'video' as const,
      duration: h.duration, thumb, src: pick?.url ?? '', filename: `pixabay-${h.id}.mp4`,
      license: 'Pixabay Content License — free to use, attribution appreciated',
      provider: 'pixabay' as const,
    };
  }).filter((i) => i.src);
}

async function searchFreesound(q: string, key: string): Promise<StockItem[]> {
  const url = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}&page_size=24&fields=id,name,duration,previews,license`;
  const res = await fetch(url, { headers: { Authorization: `Token ${key}` } });
  if (!res.ok) throw new Error(`Freesound search failed (HTTP ${res.status} — check the API key)`);
  const data = await res.json();
  const sounds: { id: number; name: string; duration: number; previews: Record<string, string>; license: string }[] = data?.results ?? [];
  return sounds.map((s) => ({
    id: `freesound-${s.id}`, title: s.name.replace(/\.mp3$|\.wav$/i, '').slice(0, 60), kind: 'audio' as const,
    duration: s.duration, thumb: undefined, src: s.previews?.['preview-hq-mp3'] ?? '',
    filename: `freesound-${s.id}.mp3`,
    license: s.license?.replace(/^http(s)?:\/\//, 'https://creativecommons.org/').replace('/licenses/', '/licenses/').slice(0, 48) || 'CC license (see freesound.org)',
    provider: 'freesound' as const,
  })).filter((i) => i.src);
}

/* ---------------- component ---------------- */

export function StockTab() {
  const ui = useUI();
  const [provider, setProvider] = useState<Provider>('archive');
  const [kind, setKind] = useState<'video' | 'audio' | 'image'>('video');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>(loadKeys);

  useEffect(() => { localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys)); }, [keys]);
  useEffect(() => { if (provider === 'pexels' && kind === 'audio') setKind('video'); }, [provider]); // pexels has no audio search

  const provDef = PROVIDERS.find((p) => p.id === provider)!;
  const key = keys[provider] ?? '';

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true); setError(null); setItems([]);
    try {
      let out: StockItem[] = [];
      if (provider === 'archive') out = await searchArchive(q, kind === 'image' ? 'video' : kind);
      else if (provider === 'pexels') out = await searchPexels(q, kind === 'audio' ? 'video' : kind, key);
      else if (provider === 'pixabay') out = await searchPixabay(q, key);
      else out = await searchFreesound(q, key);
      setItems(out);
      if (!out.length) setError(`No results for "${q}".`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  /** Fetch the media and import through the SAME path as local files. */
  const addItem = async (item: StockItem) => {
    setBusyId(item.id);
    try {
      let url = item.src;
      let filename = item.filename;
      if (url.startsWith('metadata:')) {
        const resolved = await archiveFileFor(url.slice('metadata:'.length), item.kind);
        if (!resolved) throw new Error('No downloadable file in this item — open it on archive.org');
        url = resolved.url; filename = resolved.name || filename;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const blob = await res.blob();
      if (blob.type === 'text/html') throw new Error('Blocked by the CDN (CORS) — download this file manually and import it from the Media tab');
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      const { imported, skipped } = await useStore.getState().importFiles([file]);
      if (imported) {
        // Add straight to the timeline like the Media tab does.
        const p = useStore.getState().project;
        const asset = p.media[p.media.length - 1];
        if (asset) {
          const isAudio = asset.type === 'audio';
          const track = p.tracks.find((t) => t.kind === (isAudio ? 'audio' : 'video'));
          if (track) {
            useStore.getState().commit([{ type: 'add_clip', clip: { trackId: track.id, mediaId: asset.id, start: isAudio ? 0 : projectDuration(p), duration: Math.max(0.5, asset.duration || 5), inPoint: 0 } }], `Add ${asset.name}`);
          }
        }
        ui.toast(`Imported "${item.title}" from ${item.provider}`, 'success');
      } else if (skipped?.length) {
        ui.toast(`Import failed — ${skipped[0]}`, 'error');
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (/failed to fetch/i.test(msg)) {
        ui.toast(
          `Download blocked by the network (CORS or offline). Open ${item.provider === 'archive' ? `archive.org/details/${item.id}` : 'the item on ' + item.provider}, save the file, then import it from the Media tab.`,
          'error',
        );
      } else ui.toast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <p className="text-paper-dim px-1">Free stock media, imported into your local project. Nothing is uploaded anywhere.</p>

      {/* provider chips */}
      <div className="grid grid-cols-2 gap-1">
        {PROVIDERS.map((p) => {
          const Icon = p.icon;
          const active = provider === p.id;
          return (
            <button
              key={p.id}
              onClick={() => { setProvider(p.id); setItems([]); setError(null); }}
              title={`${p.label} — ${p.note}`}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${active ? 'border-signal/60 bg-signal/10 text-paper' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}
            >
              <Icon size={13} className={active ? 'text-signal' : ''} />
              <span className="truncate">{p.label}</span>
              <span className={`ml-auto text-[9px] px-1 rounded ${p.status === 'working' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                {p.status === 'working' ? 'ready' : 'key'}
              </span>
            </button>
          );
        })}
      </div>

      {/* API key input for keyed providers — honest, stored locally only */}
      {provDef.status === 'needs-key' && (
        <div className="flex items-center gap-1.5 px-1">
          <KeyRound size={12} className="text-paper-faint shrink-0" />
          <input
            className="field py-1 text-[11px]"
            placeholder={`${provDef.label} API key (free — get one at ${provider === 'pexels' ? 'pexels.com/api' : provider === 'pixabay' ? 'pixabay.com/api' : 'freesound.org/apiv2'})`}
            value={key}
            onChange={(e) => setKeys((k) => ({ ...k, [provider]: e.target.value }))}
            aria-label={`${provDef.label} API key`}
          />
        </div>
      )}

      {/* kind filter (provider-supported) */}
      <div className="flex gap-1 px-1">
        {(['video', 'audio', 'image'] as const).map((k) => {
          const unsupported = (provider === 'pexels' && k === 'audio') || (provider === 'pixabay' && k !== 'video') || (provider === 'freesound' && k !== 'audio');
          return (
            <button
              key={k}
              disabled={unsupported}
              onClick={() => setKind(k)}
              className={`px-2 py-1 rounded-md border text-[11px] transition-colors ${kind === k ? 'border-signal/60 bg-signal/10 text-paper' : 'border-line text-paper-dim hover:text-paper'} ${unsupported ? 'opacity-30 cursor-not-allowed' : ''}`}
              title={unsupported ? `${provDef.label} does not offer ${k} search` : `Search ${k}s`}
            >
              {k}
            </button>
          );
        })}
      </div>

      {/* search */}
      <div className="flex gap-1.5 px-1">
        <input
          className="field py-1.5 text-[11px]"
          placeholder={`Search ${provDef.label}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }}
          aria-label="Stock search"
        />
        <button className="btn-solid px-2.5 py-1.5 flex items-center gap-1" onClick={() => void doSearch()} disabled={loading || !query.trim()}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          Search
        </button>
      </div>

      {error && <p className="text-[11px] text-amber-400 px-1">{error}</p>}

      {/* results */}
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-line bg-ink-850 overflow-hidden flex flex-col">
            <div className="aspect-video bg-ink-800 relative overflow-hidden">
              {item.thumb ? <img src={item.thumb} alt="" className="w-full h-full object-cover" loading="lazy" /> : <Music size={20} className="absolute inset-0 m-auto text-paper-faint" />}
              {item.duration != null && item.duration > 0 && (
                <span className="absolute bottom-1 right-1 px-1 rounded bg-ink-950/80 text-[9px] font-mono text-paper">{fmtDur(item.duration)}</span>
              )}
            </div>
            <div className="p-1.5 flex flex-col gap-1 flex-1">
              <span className="text-[10px] text-paper leading-tight line-clamp-2" title={item.title}>{item.title}</span>
              <span className="text-[9px] text-paper-faint leading-tight line-clamp-2">{item.license}</span>
              <button
                className="btn-solid text-[10px] py-1 mt-auto flex items-center justify-center gap-1"
                onClick={() => void addItem(item)}
                disabled={busyId === item.id}
                title={`Download and import this ${item.kind} into the project`}
              >
                {busyId === item.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                Add
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
