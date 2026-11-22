import { useState } from 'react';
import {
  Film, Music, Type, Smile, Sparkles, ArrowLeftRight, Aperture, LayoutTemplate,
  Captions as CaptionsIcon, SlidersHorizontal, Wand2, Palette, PackageOpen,
  ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { useUI, type LeftTab } from '../state/ui';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useDeviceClass } from '../hooks/useDeviceClass';
import { usePanelWidth } from '../hooks/usePanelLayout';
import { MediaTab } from './MediaTab';
import { ToolsTab } from './ToolsTab';
import { StylesTab } from './StylesTab';
import { AudioTab } from './tabs/AudioTab';
import { TextTab } from './tabs/TextTab';
import { StickersTab } from './tabs/StickersTab';
import { StockTab } from './tabs/StockTab';
import { EffectsTab } from './tabs/EffectsTab';
import { TransitionsTab } from './tabs/TransitionsTab';
import { FiltersTab } from './tabs/FiltersTab';
import { TemplatesTab } from './tabs/TemplatesTab';
import { CaptionsTab } from './tabs/CaptionsTab';
import { AdjustmentTab } from './tabs/AdjustmentTab';

const TABS: { id: LeftTab; label: string; icon: typeof Film }[] = [
  { id: 'media', label: 'Media', icon: Film },
  { id: 'stock', label: 'Stock', icon: PackageOpen },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'stickers', label: 'Stickers', icon: Smile },
  { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'transitions', label: 'Trans.', icon: ArrowLeftRight },
  { id: 'filters', label: 'Filters', icon: Aperture },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'captions', label: 'Captions', icon: CaptionsIcon },
  { id: 'adjustment', label: 'Adjust', icon: SlidersHorizontal },
  { id: 'tools', label: 'Tools', icon: Wand2 },
  { id: 'styles', label: 'Styles', icon: Palette },
];

const PANELS: Partial<Record<LeftTab, () => React.ReactNode>> = {
  audio: AudioTab,
  stock: StockTab,
  text: TextTab,
  stickers: StickersTab,
  effects: EffectsTab,
  transitions: TransitionsTab,
  filters: FiltersTab,
  templates: TemplatesTab,
  captions: CaptionsTab,
  adjustment: AdjustmentTab,
};

const MIN_W = 200;
const MAX_W = 420;
const DEFAULT_W = 288; // was w-72

interface MediaLibraryProps {
  /** <lg only: overlay panel visibility, owned by App */
  overlayOpen: boolean;
  onOverlayClose: () => void;
}

export function MediaLibrary({ overlayOpen, onOverlayClose }: MediaLibraryProps) {
  const leftTab = useUI((s) => s.leftTab);
  const setLeftTab = useUI((s) => s.setLeftTab);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const device = useDeviceClass();
  const [collapsed, setCollapsed] = useState(false);
  const { width, dragging, onHandlePointerDown } = usePanelWidth('left', MIN_W, MAX_W, DEFAULT_W);
  const Panel = PANELS[leftTab];

  const strip = (onPick?: () => void) => (
    <div className="grid grid-cols-6 gap-0.5 p-1 border-b border-line shrink-0">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = leftTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => { setLeftTab(t.id); onPick?.(); }}
            title={t.label}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-md py-1.5 text-[9px] font-medium leading-none transition-colors ${active ? 'bg-ink-700 text-paper' : 'text-paper-dim hover:text-paper hover:bg-ink-800'}`}
          >
            <Icon size={14} /> <span className="truncate w-full text-center px-0.5">{t.label}</span>
          </button>
        );
      })}
    </div>
  );

  const body = (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {leftTab === 'media' && <MediaTab />}
      {leftTab === 'tools' && <ToolsTab />}
      {leftTab === 'styles' && <StylesTab />}
      {Panel && <Panel />}
    </div>
  );

  // <lg: collapsible overlay sliding over the center column
  if (!desktop) {
    if (!overlayOpen) return null;
    return (
      <aside
        className="absolute inset-y-0 left-0 z-30 flex flex-col bg-ink-900 border-r border-line shadow-panel"
        style={{ width: device === 'phone' ? '100vw' : `min(${width}px, 85vw)` }}
      >
        {strip()}
        {body}
        <div
          data-side="right"
          className={`resize-handle${dragging ? ' dragging' : ''}`}
          onPointerDown={onHandlePointerDown}
          onDoubleClick={onOverlayClose}
          title="Drag to resize · double-click to close"
        >
          <button
            className="resize-chev"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onOverlayClose}
            title="Close media panel"
          >
            <ChevronsLeft size={12} />
          </button>
        </div>
      </aside>
    );
  }

  // ≥lg collapsed: slim 40px icon rail — click any icon to restore that tab
  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 flex flex-col items-center gap-0.5 bg-ink-900 border-r border-line py-1.5 min-h-0">
        <button className="icon-btn" onClick={() => setCollapsed(false)} title="Expand media panel">
          <ChevronsRight size={14} />
        </button>
        <div className="w-5 h-px bg-line my-0.5" />
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = leftTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setLeftTab(t.id); setCollapsed(false); }}
              title={t.label}
              className={`flex items-center justify-center rounded-md p-1.5 transition-colors ${active ? 'bg-ink-700 text-signal' : 'text-paper-dim hover:text-paper hover:bg-ink-800'}`}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </aside>
    );
  }

  // ≥lg: in-flow resizable panel (desktop default, unchanged widths)
  return (
    <aside className="relative shrink-0 flex flex-col bg-ink-900 min-h-0" style={{ width }}>
      {strip()}
      {body}
      <div
        data-side="right"
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
          <ChevronsLeft size={12} />
        </button>
      </div>
    </aside>
  );
}
