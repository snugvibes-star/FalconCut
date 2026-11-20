import { useState } from 'react';
import {
  Undo2, Redo2, Wand2, Plug, Download, Settings, FolderOpen, Plus, Command, Bot, Check, Loader2,
  PanelLeft, PanelRight, MoreVertical, Sparkles, MonitorDown,
} from 'lucide-react';
import { useStore } from '../state/store';
import { useUI, type Workspace } from '../state/ui';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { ASPECT_SIZES, type Aspect } from '../../engine';
import { LogoMark } from './brand/LogoMark';

const WORKSPACES: { id: Workspace; label: string; title: string }[] = [
  { id: 'edit', label: 'Edit', title: 'Edit workspace — media, timeline, inspector' },
  { id: 'color', label: 'Color', title: 'Color grading workspace — wheels, scopes, presets' },
  { id: 'audio', label: 'Audio', title: 'Audio workspace — mixer, levels, music' },
];

interface TopBarProps {
  /** Overlay panel toggles (shown <lg on the Edit workspace). Owned by App. */
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function TopBar({ leftOpen, rightOpen, onToggleLeft, onToggleRight }: TopBarProps) {
  const project = useStore((s) => s.project);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const undoLabel = useStore((s) => s.undoLabel);
  const redoLabel = useStore((s) => s.redoLabel);
  const saveStatus = useStore((s) => s.saveStatus);
  const lastSaved = useStore((s) => s.lastSaved);
  const session = useStore((s) => s.session);
  const autopilot = useStore((s) => s.autopilot);
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const workspace = useUI((s) => s.workspace);
  const ui = useUI();
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const { canInstall, installed, install } = useInstallPrompt();

  /** One-click install when the browser offers it; otherwise explain the
   *  browser's own menu entry instead of pretending a button worked. */
  const installApp = async () => {
    setMoreOpen(false);
    const outcome = await install();
    if (outcome === 'accepted') {
      ui.toast('Installing CutFlow — the app icon will appear on your home screen or desktop.', 'success');
    } else if (outcome === 'dismissed') {
      ui.toast('Install cancelled.', 'info');
    } else {
      ui.toast('Open your browser menu and choose “Install app” or “Add to Home screen”. The icon comes from /icon-192.png and /icon-512.png.', 'info');
    }
  };

  const rename = (name: string) => {
    useStore.getState().commit([{ type: 'rename_project', name: name || 'Untitled project' }], 'Rename project');
    setEditingName(false);
  };

  const setAspect = (aspect: Aspect) => {
    const [width, height] = ASPECT_SIZES[aspect];
    useStore.getState().commit([{ type: 'set_settings', patch: { aspect, width, height } }], `Aspect ${aspect}`);
  };

  const autoEdit = async () => {
    setBusy(true);
    try {
      const r = await useStore.getState().applyTool('auto_edit', {});
      ui.toast(r.summary || 'Auto edit complete', 'success');
      ui.setRightTab('quality');
    } catch (e) {
      ui.toast(`Auto edit failed: ${(e as Error).message}`, 'error');
    } finally { setBusy(false); }
  };

  const openDialog = (d: Parameters<typeof ui.open>[0]) => {
    setMoreOpen(false);
    ui.open(d);
  };

  const savedAt = lastSaved ? new Date(lastSaved) : null;
  const savedClock = savedAt
    ? `${String(savedAt.getHours()).padStart(2, '0')}:${String(savedAt.getMinutes()).padStart(2, '0')}`
    : null;

  const panelToggles = workspace === 'edit' && (
    <div className="flex items-center gap-0.5 lg:hidden shrink-0">
      <button
        className={`icon-btn ${leftOpen ? 'text-signal' : ''}`}
        onClick={onToggleLeft}
        title="Toggle media panel"
      >
        <PanelLeft size={15} />
      </button>
      <button
        className={`icon-btn ${rightOpen ? 'text-signal' : ''}`}
        onClick={onToggleRight}
        title="Toggle inspector panel"
      >
        <PanelRight size={15} />
      </button>
    </div>
  );

  // ---- <768px: condensed bar — workspace segmented control, non-essential
  // controls relocated into a real "more" menu (nothing removed, just moved).
  if (isMobile) {
    return (
      <header className="relative h-11 shrink-0 flex items-center gap-1 px-2 bg-ink-900 border-b border-line overflow-x-auto">
        {panelToggles}

        {/* Brand mark stays visible on narrow windows too — it is the only place
            the app is identified once the wordmark is dropped. */}
        <LogoMark size={18} />

        <div className="flex items-center gap-0.5 shrink-0">
          <button className="icon-btn" disabled={!canUndo} onClick={() => useStore.getState().undo()} title={canUndo ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}><Undo2 size={15} /></button>
          <button className="icon-btn" disabled={!canRedo} onClick={() => useStore.getState().redo()} title={canRedo ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}><Redo2 size={15} /></button>
        </div>

        <div className="h-5 w-px bg-line shrink-0" />

        {editingName ? (
          <input
            autoFocus
            defaultValue={project.name}
            className="field w-28 shrink-0 py-0.5 text-xs"
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') rename((e.target as HTMLInputElement).value); if (e.key === 'Escape') setEditingName(false); }}
          />
        ) : (
          <button
            className="text-xs text-paper-dim hover:text-paper px-1 py-1 rounded-md hover:bg-ink-750 max-w-[96px] truncate shrink-0"
            onClick={() => setEditingName(true)}
            title="Rename project"
          >
            {project.name}
          </button>
        )}

        {/* Compact workspace switcher (Resolve-style pages kept) */}
        <nav className="cf-segmented shrink-0 ml-1" aria-label="Workspace">
          {WORKSPACES.map((w) => (
            <button
              key={w.id}
              data-active={workspace === w.id}
              onClick={() => ui.setWorkspace(w.id)}
              title={w.title}
            >
              {w.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-1" />

        <select
          className="field w-auto py-0.5 text-xs cursor-pointer shrink-0"
          value={project.settings.aspect}
          onChange={(e) => setAspect(e.target.value as Aspect)}
          title="Canvas aspect ratio"
        >
          {(Object.keys(ASPECT_SIZES) as Aspect[]).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        <div className="sticky right-0 flex items-center gap-1 bg-ink-900 pl-1 shrink-0">
          <button className="btn-signal shrink-0" onClick={autoEdit} disabled={busy} title="One-click professional edit using the active style pack (no AI key needed)">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          </button>

          <button className="btn-solid shrink-0" onClick={() => ui.open('export')} title="Export (Ctrl+E)"><Download size={15} /></button>

          <button className="icon-btn shrink-0" onClick={() => setMoreOpen(true)} title="More actions"><MoreVertical size={16} /></button>
        </div>

        {moreOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
            <div className="cf-more-menu">
              <button className="cf-menu-item" onClick={() => { setMoreOpen(false); ui.setRightTab('ai'); if (!rightOpen) onToggleRight(); }}>
                <Sparkles size={15} /> Chat with AI
              </button>
              <button className="cf-menu-item" onClick={() => openDialog('connect')}>
                <Plug size={15} /> {session?.connected ? 'Agent live' : 'Connect agent'}
              </button>
              <button className="cf-menu-item" onClick={() => openDialog('palette')}>
                <Command size={15} /> Command palette
              </button>
              <button className="cf-menu-item" onClick={() => openDialog('projects')}>
                <FolderOpen size={15} /> Projects
              </button>
              <button className="cf-menu-item" onClick={() => openDialog('newProject')}>
                <Plus size={15} /> New project
              </button>
              <button className="cf-menu-item" onClick={() => openDialog('settings')}>
                <Settings size={15} /> Settings
              </button>
              <button className="cf-menu-item" onClick={() => void installApp()}>
                <MonitorDown size={15} /> {installed ? 'Installed — how to re-add the icon' : 'Install app'}
              </button>
              <div className="divider my-1" />
              <button
                className={`cf-menu-item ${autopilot ? 'text-mind' : ''}`}
                onClick={() => { setMoreOpen(false); useStore.getState().setAutopilot(!autopilot); }}
                title={autopilot ? 'Autopilot ON: connected agents apply plans automatically' : 'Review mode: you approve each AI plan'}
              >
                <Bot size={15} /> Autopilot: {autopilot ? 'ON' : 'OFF'}
              </button>
            </div>
          </>
        )}
      </header>
    );
  }

  // ---- ≥768px: pro desktop bar, unchanged layout
  return (
    <header className="relative h-11 shrink-0 flex items-center gap-1.5 px-3 bg-ink-900 border-b border-line">
      {panelToggles}

      {/* LEFT — app mark, project name, autosave, undo/redo */}
      <div className="flex items-center gap-2 pr-1">
        <LogoMark size={20} />
        <span className="cf-brand font-display font-semibold text-[13px] tracking-tight hidden sm:block">CutFlow</span>
      </div>

      <div className="h-5 w-px bg-line" />

      {editingName ? (
        <input
          autoFocus
          defaultValue={project.name}
          className="field w-44 py-0.5 text-xs"
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') rename((e.target as HTMLInputElement).value); if (e.key === 'Escape') setEditingName(false); }}
        />
      ) : (
        <button className="text-xs text-paper-dim hover:text-paper px-1.5 py-1 rounded-md hover:bg-ink-750 max-w-[160px] truncate" onClick={() => setEditingName(true)} title="Rename project">
          {project.name}
        </button>
      )}

      <div
        className="flex items-center gap-1 text-[10px] font-mono ml-0.5"
        title="Autosave to this device"
      >
        {saveStatus === 'saving' && (
          <>
            <Loader2 size={11} className="animate-spin text-heat-amber" />
            <span className="text-paper-faint hidden md:block">Saving…</span>
          </>
        )}
        {saveStatus === 'error' && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-heat" />
            <span className="text-heat hidden md:block">Save failed</span>
          </>
        )}
        {(saveStatus === 'saved' || saveStatus === 'idle') && (
          <>
            <Check size={11} className="text-heat-green" />
            <span className="text-paper-faint hidden md:block">Saved{savedClock ? ` ${savedClock}` : ''}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <button className="icon-btn" disabled={!canUndo} onClick={() => useStore.getState().undo()} title={canUndo ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}><Undo2 size={15} /></button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => useStore.getState().redo()} title={canRedo ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}><Redo2 size={15} /></button>
      </div>

      {/* CENTER — workspace switcher. A real flex item (not absolute) so it can
          never overlap the left/right clusters; below 1280px the pages become a
          select, because five text tabs do not fit next to the tool cluster. */}
      <div className="flex-1 flex justify-center min-w-0 self-stretch overflow-hidden">
        <nav className="hidden xl:flex items-stretch min-w-0" aria-label="Workspace">
          {WORKSPACES.map((w) => {
            const active = workspace === w.id;
            return (
              <button
                key={w.id}
                onClick={() => ui.setWorkspace(w.id)}
                title={w.title}
                className={`relative px-4 text-xs tracking-wide uppercase font-medium transition-colors shrink-0 ${active ? 'text-paper' : 'text-paper-dim hover:text-paper'}`}
              >
                {w.label}
                {active && <span className="absolute bottom-0 left-2.5 right-2.5 h-0.5 bg-signal rounded-full" />}
              </button>
            );
          })}
        </nav>
        <select
          className="xl:hidden field w-auto max-w-[132px] my-auto py-0.5 text-[11px] uppercase tracking-wide cursor-pointer"
          value={workspace}
          onChange={(e) => ui.setWorkspace(e.target.value as Workspace)}
          title="Workspace"
          aria-label="Workspace"
        >
          {WORKSPACES.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </div>

      {/* RIGHT — canvas + tools + agent + projects + export */}
      <div className="shrink-0 flex items-center gap-1.5">
      <select
        className="field w-auto py-0.5 text-xs cursor-pointer"
        value={project.settings.aspect}
        onChange={(e) => setAspect(e.target.value as Aspect)}
        title="Canvas aspect ratio"
      >
        {(Object.keys(ASPECT_SIZES) as Aspect[]).map((a) => <option key={a} value={a}>{a}</option>)}
      </select>

      <div className="h-5 w-px bg-line" />

      <button className="btn-signal" onClick={autoEdit} disabled={busy} title="One-click professional edit using the active style pack (no AI key needed)">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
        <span className="hidden lg:block">Auto edit</span>
      </button>

      <button
        className="btn-ghost"
        onClick={() => { ui.setRightTab('ai'); if (!rightOpen) onToggleRight(); }}
        title="Chat with AI — describe the edit you want and review the plan (works with or without a key)"
      >
        <Sparkles size={15} />
        <span className="hidden lg:block">Ask AI</span>
      </button>

      <button
        className={`btn-ghost relative ${session?.connected ? 'text-heat-green' : ''}`}
        onClick={() => ui.open('connect')}
        title={session?.connected ? 'Agent connected — manage session' : 'Connect an external agent'}
      >
        <Plug size={15} />
        <span className="hidden lg:block">{session?.connected ? 'Agent live' : 'Connect'}</span>
        {session?.connected && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-heat-green animate-pulse-dot" />}
      </button>

      <div className="h-5 w-px bg-line" />

      <button className="btn-ghost" onClick={() => ui.toggle('palette')} title="Command palette (Ctrl+/)"><Command size={15} /></button>
      <button className="btn-ghost" onClick={() => ui.open('projects')} title="Projects"><FolderOpen size={15} /></button>
      <button className="btn-ghost" onClick={() => ui.open('newProject')} title="New project"><Plus size={15} /></button>
      <button className="btn-ghost" onClick={() => ui.open('settings')} title="AI & analysis settings"><Settings size={15} /></button>

      <div className="h-5 w-px bg-line" />

      {canInstall && !installed && (
        <button className="btn-ghost" onClick={() => void installApp()} title="Install CutFlow as an app — the app icon is added to your desktop / home screen">
          <MonitorDown size={15} /><span className="hidden lg:block">Install</span>
        </button>
      )}

      <button className="btn-solid" onClick={() => ui.open('export')} title="Export (Ctrl+E)"><Download size={15} /><span className="hidden lg:block">Export</span></button>

      <button
        className={`icon-btn ${autopilot ? 'text-mind' : ''}`}
        onClick={() => useStore.getState().setAutopilot(!autopilot)}
        title={autopilot ? 'Autopilot ON: connected agents apply plans automatically' : 'Review mode: you approve each AI plan'}
      >
        <Bot size={15} />
      </button>
      </div>
    </header>
  );
}
