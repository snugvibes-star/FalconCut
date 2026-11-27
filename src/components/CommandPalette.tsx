/**
 * Keyboard-first command palette. It exposes the same remappable actions as
 * the keyboard hook (via features/editorActions), the project commands, and
 * every AI tool in the registry — grouped when idle, ranked when searching.
 * No fake actions: each entry runs the same store/engine path as its button.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft, Search, Sparkles } from 'lucide-react';
import { TOOLS, toolLabel } from '../../tools/registry';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { DEFAULT_SHORTCUTS, formatCombo, shortcutCombo } from '../features/shortcuts';
import { commandScore, nextRecent } from '../features/commandSearch';
import { runEditorAction } from '../features/editorActions';
import { Dialog } from './Dialog';
import { ToolRunner } from './ToolRunner';

type PaletteKind = 'action' | 'tool' | 'custom';

interface PaletteItem {
  id: string;
  name: string;
  detail: string;
  group: string;
  kind: PaletteKind;
  shortcut?: string;
  keywords?: string;
  toolName?: string;
  run: () => void;
}

const RECENT_KEY = 'falconcut.palette.recent.v1';
const RECENT_MAX = 6;

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
      : [];
  } catch { return []; }
}

function saveRecent(ids: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids)); } catch { /* private mode */ }
}

const GROUP_LABEL: Record<string, string> = {
  Playback: 'Playback',
  Editing: 'Editing',
  Clipboard: 'History & clipboard',
  'Markers & notes': 'Markers & notes',
  View: 'View',
  App: 'Project',
};

const GROUP_ORDER = [
  'Recent',
  'Editing',
  'Add',
  'Playback',
  'History & clipboard',
  'Markers & notes',
  'View',
  'Project',
  'AI tools',
];

/** Curated shortcuts shown before anything is typed; searching reaches all of them. */
const FEATURED_TOOLS = ['auto_edit', 'add_captions', 'remove_dead_air', 'reframe', 'add_music', 'auto_fix'];

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [tool, setTool] = useState<string | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const ui = useUI();
  const close = () => ui.close('palette');

  const remember = (id: string) => {
    setRecent((prev) => {
      const next = nextRecent(prev, id, RECENT_MAX);
      saveRecent(next);
      return next;
    });
  };

  const addTrack = (kind: 'video' | 'audio' | 'text') => {
    useStore.getState().commit([{ type: 'add_track', track: { kind } }], 'Add track');
  };

  /* ---- every remappable shortcut, using its live (possibly remapped) combo ---- */
  const actions: PaletteItem[] = DEFAULT_SHORTCUTS
    .filter((d) => d.id !== 'palette' && d.id !== 'redoAlt') // two ways into the same action
    .map((d) => {
      const [name, ...detail] = d.label.split(' — ');
      return {
        id: `action:${d.id}`,
        name,
        detail: detail.join(' — ') || d.group,
        group: GROUP_LABEL[d.group] ?? d.group,
        kind: 'action',
        shortcut: formatCombo(shortcutCombo(d.id)).join(' + '),
        run: () => { runEditorAction(d.id); },
      };
    });

  const custom: PaletteItem[] = [
    {
      id: 'custom:add-text', name: 'Add text at playhead', group: 'Add', kind: 'custom',
      detail: 'Editable title on the text track',
      run: () => {
        const s = useStore.getState();
        s.commit([{ type: 'add_text', start: s.playhead, duration: 3, text: 'Your title', role: 'title' }], 'Add text');
        ui.setRightTab('inspector');
      },
    },
    { id: 'custom:add-video-track', name: 'Add video track', group: 'Add', kind: 'custom', detail: 'A new empty video track at the top', run: () => addTrack('video') },
    { id: 'custom:add-audio-track', name: 'Add audio track', group: 'Add', kind: 'custom', detail: 'A new empty audio track at the top', run: () => addTrack('audio') },
    { id: 'custom:add-text-track', name: 'Add text track', group: 'Add', kind: 'custom', detail: 'A new empty text track at the top', run: () => addTrack('text') },
    {
      id: 'custom:zoom-fit', name: 'Zoom timeline to fit', group: 'View', kind: 'custom',
      detail: 'Frame the whole edit in the timeline',
      run: () => window.dispatchEvent(new CustomEvent('falconcut:zoom-to-fit')),
    },
    {
      id: 'custom:focus', name: 'Toggle theater mode', group: 'View', kind: 'custom',
      detail: 'Hide the panels and focus on the preview',
      run: () => useUI.getState().toggleFocusMode(),
    },
    { id: 'custom:workspace-edit', name: 'Switch to Edit workspace', group: 'View', kind: 'custom', detail: 'Media, timeline and inspector', run: () => ui.setWorkspace('edit') },
    { id: 'custom:workspace-color', name: 'Switch to Color workspace', group: 'View', kind: 'custom', detail: 'Wheels, curves and scopes', run: () => ui.setWorkspace('color') },
    { id: 'custom:workspace-audio', name: 'Switch to Audio workspace', group: 'View', kind: 'custom', detail: 'Mixer, levels and music', run: () => ui.setWorkspace('audio') },
    {
      id: 'custom:checkpoint', name: 'Save a checkpoint', group: 'Project', kind: 'custom',
      detail: 'Snapshot now; restore it any time in Versions',
      run: () => {
        useStore.getState().snapshot('Manual save', 'manual');
        useUI.getState().toast('Checkpoint saved — restore it in Versions', 'success');
      },
    },
    { id: 'custom:new-project', name: 'New project', group: 'Project', kind: 'custom', detail: 'Start a new timeline', run: () => ui.open('newProject') },
    { id: 'custom:projects', name: 'Open projects', group: 'Project', kind: 'custom', detail: 'Switch, duplicate or delete saved projects', run: () => ui.open('projects') },
    { id: 'custom:analysis', name: 'Analyze media', group: 'Project', kind: 'custom', detail: 'Speech, silence, scenes and beats', run: () => ui.open('analysis') },
    { id: 'custom:settings', name: 'Open settings', group: 'Project', kind: 'custom', detail: 'AI, analysis, shortcuts and appearance', run: () => ui.open('settings') },
    { id: 'custom:ai-control', name: 'Open AI Control Center', group: 'Project', kind: 'custom', detail: 'Providers, task routing, permissions and usage', run: () => ui.open('aiControl') },
    { id: 'custom:connect', name: 'Connect an agent', group: 'Project', kind: 'custom', detail: 'Local relay session for an external agent', run: () => ui.open('connect') },
  ];

  const tools: PaletteItem[] = TOOLS.map((t) => ({
    id: `tool:${t.name}`,
    name: toolLabel(t.name),
    detail: t.description,
    group: 'AI tools',
    kind: 'tool',
    keywords: `${t.name} ${t.name.replace(/_/g, ' ')}`,
    toolName: t.name,
    run: () => setTool(t.name),
  }));

  const allById = new Map([...actions, ...custom, ...tools].map((item) => [item.id, item]));
  const q = query.trim().toLowerCase();
  const groups: { title: string; items: PaletteItem[] }[] = [];

  if (!q) {
    const recentItems = recent.map((id) => allById.get(id)).filter((x): x is PaletteItem => !!x);
    const shown = new Set(recentItems.map((i) => i.id));
    if (recentItems.length) groups.push({ title: 'Recent', items: recentItems });
    for (const title of GROUP_ORDER) {
      if (title === 'Recent' || title === 'AI tools') continue;
      const items = [...actions, ...custom].filter((i) => i.group === title && !shown.has(i.id));
      if (items.length) groups.push({ title, items });
    }
    const featured = FEATURED_TOOLS
      .map((name) => tools.find((t) => t.toolName === name))
      .filter((x): x is PaletteItem => !!x && !shown.has(x.id));
    if (featured.length) groups.push({ title: 'AI tools', items: featured });
  } else {
    const ranked = [...actions, ...custom, ...tools]
      .map((item) => ({ item, score: commandScore(q, item) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
    if (ranked.length) groups.push({ title: '', items: ranked.map((x) => x.item) });
  }

  const flat = groups.flatMap((g) => g.items);
  const indexOf = new Map(flat.map((item, i) => [item.id, i]));

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, flat.length - 1))); }, [flat.length]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [active, query]);

  const runItem = (item: PaletteItem) => {
    remember(item.id);
    if (item.toolName) { setTool(item.toolName); return; }
    item.run();
    close();
  };

  if (tool) return <ToolRunner toolName={tool} onClose={close} />;

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Home') {
      e.preventDefault(); setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault(); setActive(Math.max(0, flat.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[active];
      if (item) runItem(item);
    }
  };

  // Live bindings from the shared registry (reflects any Settings → Shortcuts
  // remap) plus the handful of fixed combos the keyboard hook never remaps.
  const fixedShortcuts: [string, string][] = [
    ['Ctrl + Space', 'Play the zone'],
    ['Alt + Space', 'Loop the zone'],
    ['← / →', 'Step 0.1s (Shift + ←/→ steps one frame)'],
    ['Delete', 'Ripple delete selected'],
    ['Esc', 'Close menu → clear selection → clear zone → theater'],
    ['Ctrl + S', 'Save a checkpoint now (Versions)'],
  ];
  const shortcuts: [string, string][] = [
    ...DEFAULT_SHORTCUTS.map((d) => [formatCombo(shortcutCombo(d.id)).join(' + '), d.label] as [string, string]),
    ...fixedShortcuts,
  ];

  return <Dialog title="Commands" onClose={close}>
    <div className="relative mb-2">
      <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-paper-faint pointer-events-none" />
      <input
        autoFocus
        aria-label="Search commands and AI tools"
        role="combobox"
        aria-expanded="true"
        aria-controls="command-results"
        aria-activedescendant={flat[active] ? `command-option-${flat[active].id.replace(/[^a-z0-9_-]/gi, '-')}` : undefined}
        className="field pl-9"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onSearchKeyDown}
        placeholder="Search commands, AI tools and settings…"
      />
    </div>

    <div id="command-results" role="listbox" aria-label="Command results" className="max-h-[52vh] overflow-auto -mx-1 px-1">
      {!flat.length && (
        <div className="p-6 text-center">
          <p className="text-xs text-paper-dim">No matches for “{query.trim()}”.</p>
          <button className="mt-2 text-xs text-signal hover:underline" onClick={() => setQuery('')}>Clear search</button>
        </div>
      )}
      {groups.map((group) => (
        <div key={group.title || 'results'} className={group.title ? 'mt-2 first:mt-0' : ''}>
          {group.title && <div className="label px-1 py-1.5">{group.title}</div>}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const idx = indexOf.get(item.id) ?? 0;
              const selected = idx === active;
              return (
                <button
                  key={item.id}
                  id={`command-option-${item.id.replace(/[^a-z0-9_-]/gi, '-')}`}
                  ref={selected ? activeRef : undefined}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => runItem(item)}
                  className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${selected ? 'bg-ink-750' : 'hover:bg-ink-800'}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-paper truncate">{item.name}</span>
                    {item.kind === 'tool' && (
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded bg-mind/15 text-mind">AI</span>
                    )}
                    {!group.title && <span className="hidden sm:inline shrink-0 text-[10px] text-paper-faint">{item.group}</span>}
                    <span className="flex-1" />
                    {item.shortcut && <kbd className="shrink-0 text-[10px] font-mono text-signal bg-ink-800 border border-line rounded px-1.5 py-0.5 whitespace-nowrap">{item.shortcut}</kbd>}
                  </div>
                  <div className="text-[11px] text-paper-dim mt-0.5 line-clamp-2">{item.detail}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>

    <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-line text-[10px] text-paper-faint">
      <span>{flat.length} result{flat.length === 1 ? '' : 's'}{!q ? ` · type to search ${TOOLS.length} AI tools` : ''}</span>
      <span className="hidden sm:flex items-center gap-2">
        <span className="flex items-center gap-0.5"><ArrowUp size={10} /><ArrowDown size={10} /> navigate</span>
        <span className="flex items-center gap-0.5"><CornerDownLeft size={10} /> run</span>
        <span>Esc close</span>
      </span>
    </div>

    {/* Reference sheet — collapsed by default so the palette stays fast. */}
    <details className="mt-2 pt-2 border-t border-line">
      <summary className="cursor-pointer select-none text-xs font-semibold text-paper-dim px-1 py-1 hover:text-paper">
        Keyboard shortcuts <span className="font-normal text-paper-faint">({shortcuts.length})</span>
      </summary>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
        {shortcuts.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 px-1 py-0.5">
            <kbd className="text-[10px] font-mono text-signal bg-ink-800 border border-line rounded px-1.5 py-0.5 whitespace-nowrap">{k}</kbd>
            <span className="text-[11px] text-paper-dim truncate">{v}</span>
          </div>
        ))}
      </div>
    </details>

    <p className="mt-2 flex items-center gap-1.5 text-[10px] text-paper-faint">
      <Sparkles size={11} className="text-mind" /> AI tools use the same validated, undoable engine actions as the rest of the editor.
    </p>
  </Dialog>;
}
