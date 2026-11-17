import { useState } from 'react';
import { Search } from 'lucide-react';
import { TOOLS } from '../../tools/registry';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { Dialog } from './Dialog';
import { ToolRunner } from './ToolRunner';

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState<string | null>(null);
  const ui = useUI();
  const close = () => ui.close('palette');
  const commands = [
    { name: 'Add text at playhead', detail: 'Editable title on the text track', run: () => { const s = useStore.getState(); s.commit([{ type: 'add_text', start: s.playhead, duration: 3, text: 'Your title', role: 'title' }], 'Add text'); ui.setRightTab('inspector'); close(); } },
    { name: 'Undo', detail: 'Ctrl+Z', run: () => { useStore.getState().undo(); close(); } },
    { name: 'Redo', detail: 'Ctrl+Shift+Z', run: () => { useStore.getState().redo(); close(); } },
    { name: 'Analyze media', detail: 'Speech, silence, scenes and beats', run: () => { close(); ui.open('analysis'); } },
    { name: 'Export', detail: 'Download from this device', run: () => { close(); ui.open('export'); } },
    { name: 'New project', detail: 'Start a new timeline', run: () => { close(); ui.open('newProject'); } },
    { name: 'Connect agent', detail: 'Local relay session', run: () => { close(); ui.open('connect'); } },
    ...TOOLS.map((t) => ({ name: t.name, detail: t.description, run: () => setTool(t.name) })),
  ].filter((c) => `${c.name} ${c.detail}`.toLowerCase().includes(query.toLowerCase()));
  if (tool) return <ToolRunner toolName={tool} onClose={close} />;
  const shortcuts: [string, string][] = [
    ['Space', 'Play / pause (stops at zone out)'],
    ['J / K / L', 'Rewind / pause / play (shuttle)'],
    ['V', 'Selection tool (preview overlay)'],
    ['C / S', 'Razor — split at playhead'],
    ['Ctrl+K', 'Add edit — split ALL clips at playhead'],
    ['Z', 'Lift selection (leaves a gap)'],
    ['Shift+X', 'Extract selection (closes the gap)'],
    ['I / O', 'Mark in / out zone'],
    ['Ctrl+Space', 'Play the zone'],
    ['Alt+Space', 'Loop the zone'],
    ['← / →', 'Step one frame'],
    ['Shift+← / →', 'Step one second'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
    ['Delete', 'Ripple delete selected'],
    ['Ctrl+/', 'Command palette'],
    ['Ctrl+E', 'Export'],
    ['M', 'Add marker at playhead'],
    ['+ / -', 'Zoom in / out (\\ = fit)'],
    ['Esc', 'Close menu → clear selection → clear zone → theater'],
  ];
  return <Dialog title="Commands" onClose={close}>
    <div className="flex items-center gap-2 mb-3"><Search size={17} className="text-paper-faint" /><input autoFocus aria-label="Search commands" className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search actions and editing tools…" onKeyDown={(e) => { if (e.key === 'Enter' && commands[0]) commands[0].run(); }} /></div>
    <div className="max-h-[55vh] overflow-auto space-y-1">
      {!commands.length && <p className="text-xs text-paper-dim p-4">No matching commands.</p>}
      {commands.map((c) => <button key={c.name} className="block w-full text-left p-3 rounded-lg hover:bg-ink-750 focus-visible:bg-ink-750 focus-visible:outline focus-visible:outline-signal" onClick={c.run}><span className="block text-sm text-paper">{c.name}</span><span className="block text-xs text-paper-dim mt-0.5">{c.detail}</span></button>)}
    </div>
    {/* keyboard cheatsheet — discoverable reference for every binding */}
    <div className="mt-3 pt-3 border-t border-line">
      <h3 className="text-xs font-semibold text-paper-dim mb-2 px-1">Keyboard shortcuts</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {shortcuts.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 px-1 py-0.5">
            <kbd className="text-[10px] font-mono text-signal bg-ink-800 border border-line rounded px-1.5 py-0.5 whitespace-nowrap">{k}</kbd>
            <span className="text-[11px] text-paper-dim truncate">{v}</span>
          </div>
        ))}
      </div>
    </div>
  </Dialog>;
}
