/** UI-only state: which panel/dialog is open, and transient toasts. Kept
 * separate from the project store so view changes never touch the document. */
import { create } from 'zustand';
import { uid, type DrawTool } from '../../engine';

export type RightTab = 'inspector' | 'audio' | 'ai' | 'versions' | 'quality' | 'notes' | 'markers';
export type LeftTab = 'media' | 'audio' | 'text' | 'stickers' | 'effects' | 'transitions' | 'filters' | 'templates' | 'captions' | 'adjustment' | 'tools' | 'styles' | 'stock';
export type Dialog = 'connect' | 'export' | 'palette' | 'settings' | 'analysis' | 'projects' | 'newProject' | 'aiControl';
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

/** Default accent — matches the CSS :root fallbacks exactly. */
export const DEFAULT_ACCENT = '#4C9AFF';

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
  /** Hex accent color for the whole UI ('#RRGGBB'); absent = default blue. */
  accent?: string;
}

export const TIMELINE_H_MIN = 160;
/** Device-aware cap: a desktop 70% timeline carried over to a phone would
 * leave the preview only a few pixels tall, which is a retention killer. */
export const deviceClass = (): 'phone' | 'tablet' | 'desktop' => {
  if (typeof window === 'undefined') return 'desktop'; // Node/Vitest imports
  return window.innerWidth < 640 ? 'phone' : window.innerWidth < 1024 ? 'tablet' : 'desktop';
};
const timelineHMax = () => Math.round((typeof window === 'undefined' ? 900 : window.innerHeight) * (
  deviceClass() === 'phone' ? 0.38 : deviceClass() === 'tablet' ? 0.5 : 0.7
));
const timelineKey = () => `timelineHeight:${deviceClass()}`;

const clampTimelineHeight = (h: number) =>
  Math.round(Math.max(TIMELINE_H_MIN, Math.min(timelineHMax(), h)));

const sanitizeZoom = (z: unknown): 'fit' | number => {
  if (typeof z === 'number' && Number.isFinite(z) && z > 0.05 && z <= 8) return z;
  return 'fit';
};

const sanitizeWorkspace = (w: unknown): Workspace =>
  w === 'color' || w === 'audio' ? w : 'edit';

const sanitizeAccent = (a: unknown): string => {
  if (typeof a !== 'string') return DEFAULT_ACCENT;
  const t = a.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(t)) return DEFAULT_ACCENT;
  // Canonicalize the default (case-insensitive) so comparisons against
  // DEFAULT_ACCENT always succeed.
  return t === DEFAULT_ACCENT.toLowerCase() ? DEFAULT_ACCENT : t;
};

/** Push an accent into the CSS variables the tailwind `signal` tokens read.
 * The default accent removes the overrides so the :root values (the original
 * palette, exact) win again. */
export function applyAccent(hex: string) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const clean = sanitizeAccent(hex);
  if (clean === DEFAULT_ACCENT) {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-dim');
    root.style.removeProperty('--accent-dark');
    return;
  }
  const n = parseInt(clean.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (v: number, f: number) => Math.round(v * f);
  root.style.setProperty('--accent', `${r} ${g} ${b}`);
  root.style.setProperty('--accent-dim', `${mix(r, 0.66)} ${mix(g, 0.66)} ${mix(b, 0.66)}`);
  root.style.setProperty('--accent-dark', `${mix(r, 0.22)} ${mix(g, 0.22)} ${mix(b, 0.22)}`);
}

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

// Restore a saved accent before first paint (no-op for the default blue).
if (prefs.accent) applyAccent(prefs.accent);

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
  /** UI accent color (hex). Persisted; drives the tailwind `signal` tokens. */
  accent: string;
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
  setAccent: (hex: string) => void;
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
  dialogs: { connect: false, export: false, palette: false, settings: false, analysis: false, projects: false, newProject: false, aiControl: false },
  toasts: [],
  focusMode: false,
  previewZoom: sanitizeZoom(prefs.previewZoom),
  railVisible: prefs.railVisible !== false,
  timelineHeight: (() => {
    const stored = (prefs as Record<string, unknown>)[timelineKey()];
    return clampTimelineHeight(typeof stored === 'number' && Number.isFinite(stored) ? stored : 240);
  })(),
  snap: prefs.snap !== false,
  density: prefs.density === 'compact' ? 'compact' : 'comfortable',
  timelineCollapsed: prefs.timelineCollapsed === true,
  previewRate: typeof prefs.previewRate === 'number' && [0.25, 0.5, 1, 1.5, 2].includes(prefs.previewRate) ? prefs.previewRate : 1,
  accent: sanitizeAccent(prefs.accent),
  draw: { tool: 'select', color: '#4C9AFF', size: 8, opacity: 1, fill: false, char: '✨' },
  setDrawTool: (t) => set((s) => ({ draw: { ...s.draw, tool: t } })),
  patchDraw: (patch) => set((s) => ({ draw: { ...s.draw, ...patch } })),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setPreviewZoom: (z) => { set({ previewZoom: z }); persistUI({ previewZoom: z }); },
  setRailVisible: (v) => { set({ railVisible: v }); persistUI({ railVisible: v }); },
  setTimelineHeight: (h) => { const clamped = clampTimelineHeight(h); set({ timelineHeight: clamped }); persistUI({ [timelineKey()]: clamped } as Partial<UIPrefs>); },
  setSnap: (v) => { set({ snap: v }); persistUI({ snap: v }); },
  setDensity: (v) => { set({ density: v }); persistUI({ density: v }); },
  setTimelineCollapsed: (v) => { set({ timelineCollapsed: v }); persistUI({ timelineCollapsed: v }); },
  setPreviewRate: (v) => { set({ previewRate: v }); persistUI({ previewRate: v }); },
  setAccent: (hex) => {
    const clean = sanitizeAccent(hex);
    set({ accent: clean });
    applyAccent(clean);
    // Storing the default clears the custom key so :root stays authoritative.
    if (clean === DEFAULT_ACCENT) {
      try {
        const { accent: _drop, ...rest } = loadPrefs();
        localStorage.setItem(PREFS_KEY, JSON.stringify(rest));
      } catch { /* ignore */ }
    } else persistUI({ accent: clean });
  },
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

/** Re-read the saved height when the device class changes (resize/rotate).
 * Deliberately does NOT persist: user-set heights for each class stay intact. */
export function reloadTimelineHeightForDevice() {
  const stored = (loadPrefs() as Record<string, unknown>)[timelineKey()];
  useUI.setState({
    timelineHeight: clampTimelineHeight(typeof stored === 'number' && Number.isFinite(stored) ? stored : 240),
  });
}