/** UI-only state: which panel/dialog is open, and transient toasts. Kept
 * separate from the project store so view changes never touch the document. */
import { create } from 'zustand';
import { uid, type DrawTool } from '../../engine';

export type RightTab = 'inspector' | 'audio' | 'ai' | 'versions' | 'quality' | 'notes';
export type LeftTab = 'media' | 'audio' | 'text' | 'stickers' | 'effects' | 'transitions' | 'filters' | 'templates' | 'captions' | 'adjustment' | 'tools' | 'styles' | 'stock';
export type Dialog = 'connect' | 'export' | 'palette' | 'settings' | 'analysis' | 'projects' | 'newProject';
export type Workspace = 'edit' | 'color' | 'audio';

export interface Toast { id: string; text: string; kind: 'info' | 'success' | 'error'; }

/** Active preview tool: 'select' manipulates overlays, 'crop' opens the
 * non-destructive source-frame crop workspace, anything else draws. */
export type PreviewTool = 'select' | 'crop' | DrawTool;
export interface DrawState {
  tool: PreviewTool;
  color: string;
  size: number;
  opacity: number;
  fill: boolean;
  char: string;
}

/* ---- persisted layout preferences (cutflow.ui.prefs) ----
 * Only user customizations survive reload — never transient state like
 * dialogs, toasts, focus mode or the in-progress draw gesture. */

const PREFS_KEY = 'cutflow.ui.prefs';

/** The customization fields persisted to localStorage. */
interface UIPrefs {
  railVisible: boolean;
  timelineHeight: number;
  previewZoom: 'fit' | number;
  workspace: Workspace;
  snap: boolean;
  density: 'compact' | 'comfortable';
  timelineCollapsed: boolean;
  previewRate: number;
}

export const TIMELINE_H_MIN = 160;
/** Timeline pane never grows past 70% of the viewport. */
const timelineHMax = () => Math.round(window.innerHeight * 0.7);

const clampTimelineHeight = (h: number) =>
  Math.round(Math.max(TIMELINE_H_MIN, Math.min(timelineHMax(), h)));

const sanitizeZoom = (z: unknown): 'fit' | number => {
  if (typeof z === 'number' && Number.isFinite(z) && z > 0.05 && z <= 8) return z;
  return 'fit';
};

const sanitizeWorkspace = (w: unknown): Workspace =>
  w === 'color' || w === 'audio' ? w : 'edit';

function loadPrefs(): Partial<UIPrefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<UIPrefs>;
  } catch { return {}; }
}

/** Merge `patch` into the persisted prefs; failures (private mode, quota) are ignored. */
function persistUI(patch: Partial<UIPrefs>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch { /* ignore */ }
}

const prefs = loadPrefs();

interface UIState {
  rightTab: RightTab;
  leftTab: LeftTab;
  workspace: Workspace;
  dialogs: Record<Dialog, boolean>;
  toasts: Toast[];
  /** Theater mode: preview fills the window, side panels + timeline hidden. */
  focusMode: boolean;
  /** Preview canvas zoom: 'fit' scales to the pane; a number is a fixed multiplier. */
  previewZoom: 'fit' | number;
  /** Whether the preview draw-tool rail is expanded (false = only the toggle shows). */
  railVisible: boolean;
  /** Bottom timeline pane height in px (user-resizable, persisted). */
  timelineHeight: number;
  /** Magnetic snapping for timeline drags (N toggles; Alt temporarily disables). */
  snap: boolean;
  /** Compact vs comfortable control density — useful on phones and tablets. */
  density: 'compact' | 'comfortable';
  /** Collapse the bottom timeline to give the preview more room on small devices. */
  timelineCollapsed: boolean;
  /** Preview-only playback rate. Never applied to clips or export. */
  previewRate: number;
  /** Direct-manipulation / drawing tool active on the preview. */
  draw: DrawState;
  setDrawTool: (t: PreviewTool) => void;
  patchDraw: (patch: Partial<DrawState>) => void;
  toggleFocusMode: () => void;
  setPreviewZoom: (z: 'fit' | number) => void;
  setRailVisible: (v: boolean) => void;
  setTimelineHeight: (h: number) => void;
  setSnap: (v: boolean) => void;
  setDensity: (v: 'compact' | 'comfortable') => void;
  setTimelineCollapsed: (v: boolean) => void;
  setPreviewRate: (v: number) => void;
  setRightTab: (t: RightTab) => void;
  setLeftTab: (t: LeftTab) => void;
  setWorkspace: (w: Workspace) => void;
  open: (d: Dialog) => void;
  close: (d: Dialog) => void;
  toggle: (d: Dialog) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: string) => void;
}

export const useUI = create<UIState>((set, get) => ({
  rightTab: 'inspector',
  leftTab: 'media',
  workspace: sanitizeWorkspace(prefs.workspace),
  dialogs: { connect: false, export: false, palette: false, settings: false, analysis: false, projects: false, newProject: false },
  toasts: [],
  focusMode: false,
  previewZoom: sanitizeZoom(prefs.previewZoom),
  railVisible: prefs.railVisible !== false,
  timelineHeight: typeof prefs.timelineHeight === 'number' && Number.isFinite(prefs.timelineHeight)
    ? clampTimelineHeight(prefs.timelineHeight)
    : 240,
  snap: prefs.snap !== false,
  density: prefs.density === 'compact' ? 'compact' : 'comfortable',
  timelineCollapsed: prefs.timelineCollapsed === true,
  previewRate: typeof prefs.previewRate === 'number' && [0.25, 0.5, 1, 1.5, 2].includes(prefs.previewRate) ? prefs.previewRate : 1,
  draw: { tool: 'select', color: '#4C9AFF', size: 8, opacity: 1, fill: false, char: '✨' },
  setDrawTool: (t) => set((s) => ({ draw: { ...s.draw, tool: t } })),
  patchDraw: (patch) => set((s) => ({ draw: { ...s.draw, ...patch } })),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setPreviewZoom: (z) => { set({ previewZoom: z }); persistUI({ previewZoom: z }); },
  setRailVisible: (v) => { set({ railVisible: v }); persistUI({ railVisible: v }); },
  setTimelineHeight: (h) => { const clamped = clampTimelineHeight(h); set({ timelineHeight: clamped }); persistUI({ timelineHeight: clamped }); },
  setSnap: (v) => { set({ snap: v }); persistUI({ snap: v }); },
  setDensity: (v) => { set({ density: v }); persistUI({ density: v }); },
  setTimelineCollapsed: (v) => { set({ timelineCollapsed: v }); persistUI({ timelineCollapsed: v }); },
  setPreviewRate: (v) => { set({ previewRate: v }); persistUI({ previewRate: v }); },
  setWorkspace: (w) => { set({ workspace: w }); persistUI({ workspace: w }); },
  setRightTab: (t) => set({ rightTab: t }),
  setLeftTab: (t) => set({ leftTab: t }),
  open: (d) => set((s) => ({ dialogs: { ...s.dialogs, [d]: true } })),
  close: (d) => set((s) => ({ dialogs: { ...s.dialogs, [d]: false } })),
  toggle: (d) => set((s) => ({ dialogs: { ...s.dialogs, [d]: !s.dialogs[d] } })),
  toast: (text, kind = 'info') => {
    const id = uid('toast');
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-4) }));
    setTimeout(() => get().dismiss(id), 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));