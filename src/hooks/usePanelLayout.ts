/** Panel shell sizing: persisted width per side + pointer-drag resize.
 * Shell-only concern — reads/writes localStorage 'cutflow.panelWidths'
 * and never touches the project document or the UI store. */
import { useCallback, useRef, useState } from 'react';

const STORAGE_KEY = 'cutflow.panelWidths';

export type PanelSide = 'left' | 'right';

function loadPanelWidths(): Partial<Record<PanelSide, number>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<PanelSide, number>>) : {};
  } catch {
    return {};
  }
}

function savePanelWidth(side: PanelSide, width: number) {
  try {
    const widths = loadPanelWidths();
    widths[side] = Math.round(width);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* storage unavailable — width just won't persist */
  }
}

/**
 * Persisted, clamped panel width with pointer-drag resizing.
 * - Loads from localStorage on mount (falls back to `fallback`).
 * - `onHandlePointerDown` wires a `resize-handle` element: pointer drag
 *   adjusts width (sign depends on side), release persists it.
 */
export function usePanelWidth(side: PanelSide, min: number, max: number, fallback: number) {
  const [width, setWidth] = useState(() => {
    const saved = loadPanelWidths()[side];
    return typeof saved === 'number' && saved > 0
      ? Math.min(max, Math.max(min, saved))
      : fallback;
  });
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthRef.current;
      setDragging(true);
      const onMove = (ev: PointerEvent) => {
        const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
        setWidth(Math.min(max, Math.max(min, startWidth + delta)));
      };
      const onUp = () => {
        setDragging(false);
        savePanelWidth(side, widthRef.current);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [side, min, max],
  );

  return { width, dragging, onHandlePointerDown };
}
