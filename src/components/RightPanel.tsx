import { useState } from 'react';
import {
  SlidersHorizontal, Bot, History, ShieldCheck, MessageSquare, Music,
  ChevronsLeft, ChevronsRight, X,
} from 'lucide-react';
import { useUI, type RightTab } from '../state/ui';
import { useStore } from '../state/store';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useDeviceClass } from '../hooks/useDeviceClass';
import { usePanelWidth } from '../hooks/usePanelLayout';
import { Inspector } from './Inspector';
import { AudioTab } from './tabs/AudioTab';
import { ChatPanel } from './ChatPanel';
import { VersionsPanel } from './VersionsPanel';
import { QualityPanel } from './QualityPanel';
import { NotesPanel } from './NotesPanel';

const TABS: { id: RightTab; label: string; icon: typeof Bot }[] = [
  { id: 'inspector', label: 'Inspect', icon: SlidersHorizontal },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'versions', label: 'Versions', icon: History },
  { id: 'quality', label: 'Quality', icon: ShieldCheck },
  { id: 'notes', label: 'Notes', icon: MessageSquare },
];

const MIN_W = 240;
const MAX_W = 460;
const DEFAULT_W = 320; // was w-80

interface RightPanelProps {
  /** <lg only: overlay panel visibility, owned by App */
  overlayOpen: boolean;
  onOverlayClose: () => void;
}

export function RightPanel({ overlayOpen, onOverlayClose }: RightPanelProps) {
  const rightTab = useUI((s) => s.rightTab);
  const setRightTab = useUI((s) => s.setRightTab);
  const issueCount = useStore((s) => s.lint.issues.length);
  const tackCount = useStore((s) => s.project.tacks.filter((t) => !t.resolved).length);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const device = useDeviceClass();
  const [collapsed, setCollapsed] = useState(false);
  const { width, dragging, onHandlePointerDown } = usePanelWidth('right', MIN_W, MAX_W, DEFAULT_W);

  const badgeFor = (id: RightTab) => (id === 'quality' ? issueCount : id === 'notes' ? tackCount : 0);

  const strip = (onPick?: () => void) => (
    <div className="cf-hscroll flex items-center gap-0.5 p-1.5 border-b border-line shrink-0">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = rightTab === t.id;
        const badge = badgeFor(t.id);
        return (
          <button
            key={t.id}
            onClick={() => { setRightTab(t.id); onPick?.(); }}
            title={t.label}
            className={`relative flex-1 flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors ${active ? 'bg-ink-700 text-paper' : 'text-paper-dim hover:text-paper hover:bg-ink-800'}`}
          >
            <Icon size={15} />
            {t.label}
            {badge > 0 && (
              <span className="absolute top-0.5 right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-heat text-ink-950 text-[9px] font-bold flex items-center justify-center">
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const body = (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {rightTab === 'inspector' && <Inspector />}
      {rightTab === 'audio' && (
        <div className="p-1">
          <AudioTab />
        </div>
      )}
      {rightTab === 'ai' && <ChatPanel />}
      {rightTab === 'versions' && <VersionsPanel />}
      {rightTab === 'quality' && <QualityPanel />}
      {rightTab === 'notes' && <NotesPanel />}
    </div>
  );

  // <lg: collapsible overlay sliding over the center column
  if (!desktop) {
    if (!overlayOpen) return null;
    return (
      <aside
        className="absolute inset-y-0 right-0 z-30 flex flex-col bg-ink-900 border-l border-line shadow-panel max-w-full pb-[env(safe-area-inset-bottom)]"
        style={{ width: device === 'phone' ? '100%' : `min(${width}px, 85vw)` }}
        role="dialog"
        aria-label="Inspector and tools panel"
      >
        <div className="cf-drawer-head">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-paper-dim">
            {TABS.find((t) => t.id === rightTab)?.label ?? 'Inspector'}
          </span>
          <button className="icon-btn" onClick={onOverlayClose} aria-label="Close inspector panel">
            <X size={16} />
          </button>
        </div>
        <div
          data-side="left"
          className={`resize-handle${dragging ? ' dragging' : ''}`}
          onPointerDown={onHandlePointerDown}
          onDoubleClick={onOverlayClose}
          title="Drag to resize · double-click to close"
        >
          <button
            className="resize-chev"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onOverlayClose}
            title="Close inspector panel"
          >
            <ChevronsRight size={12} />
          </button>
        </div>
        {strip()}
        {body}
      </aside>
    );
  }

  // ≥lg collapsed: slim 40px icon rail — click any icon to restore that tab
  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 flex flex-col items-center gap-0.5 bg-ink-900 border-l border-line py-1.5 min-h-0">
        <button className="icon-btn" onClick={() => setCollapsed(false)} title="Expand inspector panel">
          <ChevronsLeft size={14} />
        </button>
        <div className="w-5 h-px bg-line my-0.5" />
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = rightTab === t.id;
          const badge = badgeFor(t.id);
          return (
            <button
              key={t.id}
              onClick={() => { setRightTab(t.id); setCollapsed(false); }}
              title={t.label}
              className={`relative flex items-center justify-center rounded-md p-1.5 transition-colors ${active ? 'bg-ink-700 text-signal' : 'text-paper-dim hover:text-paper hover:bg-ink-800'}`}
            >
              <Icon size={15} />
              {badge > 0 && (
                <span className="absolute top-0 right-0 min-w-[10px] h-[10px] rounded-full bg-heat text-ink-950 text-[8px] font-bold flex items-center justify-center">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </aside>
    );
  }

  // ≥lg: in-flow resizable panel (desktop default, unchanged widths)
  return (
    <aside className="relative shrink-0 flex flex-col bg-ink-900 min-h-0" style={{ width }}>
      <div
        data-side="left"
        className={`resize-handle${dragging ? ' dragging' : ''}`}
        onPointerDown={onHandlePointerDown}
        onDoubleClick={() => setCollapsed(true)}
        title="Drag to resize · double-click to collapse"
      >
        <button
          className="resize-chev"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCollapsed(true)}
          title="Collapse to icon rail"
        >
          <ChevronsRight size={12} />
        </button>
      </div>
      {strip()}
      {body}
    </aside>
  );
}
