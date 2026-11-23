import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Shared dialog shell. Uses a managed overlay instead of the browser top layer
 * so toasts (export progress, "copied", errors) stay visible while a dialog is
 * open — showModal() puts the dialog above every normal z-index, hiding them.
 */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const [viewportH, setViewportH] = useState(() => window.visualViewport?.height ?? window.innerHeight);

  useEffect(() => {
    const el = ref.current!;
    el.show();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    const vv = window.visualViewport;
    const onResize = () => setViewportH(vv?.height ?? window.innerHeight);
    vv?.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      vv?.removeEventListener('resize', onResize);
      el.close();
    };
  }, []);

  /* Virtual keyboard: 100dvh does not shrink on iOS/Android, so cap the dialog
     to the visible viewport and keep its action rows scrollable. */
  const maxH = Math.max(180, Math.min(window.innerHeight * 0.9, viewportH - 16));
  const onCancel = (e: React.SyntheticEvent) => { e.preventDefault(); onClose(); };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <dialog ref={ref} aria-labelledby={titleId} onCancel={onCancel}
        className="fixed inset-0 m-auto p-0 w-[min(94vw,640px)] overflow-hidden rounded-xl border border-line bg-ink-900 text-paper shadow-panel z-50"
        style={{ maxHeight: maxH }}>
        <div className="flex flex-col" style={{ maxHeight: maxH }}>
          <div className="cf-dialog-head flex items-center justify-between gap-2 p-4 border-b border-line bg-ink-900 z-10 shrink-0">
            <h2 id={titleId} className="font-display text-lg font-semibold truncate">{title}</h2>
            <button className="icon-btn shrink-0" aria-label={`Close ${title}`} onClick={onClose}><X size={18} /></button>
          </div>
          {/* The body owns the scroll: headers and action rows stay reachable on
              short phone viewports instead of the dialog clipping its own footer. */}
          <div className="cf-dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        </div>
      </dialog>
    </>
  );
}
