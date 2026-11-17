import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}
      className="m-auto p-0 w-[min(94vw,640px)] max-h-[90vh] rounded-xl border border-line bg-ink-900 text-paper shadow-panel backdrop:bg-ink-950/80 backdrop:backdrop-blur-sm">
      <div className="flex items-center justify-between p-4 border-b border-line sticky top-0 bg-ink-900 z-10">
        <h2 id={titleId} className="font-display text-lg font-semibold">{title}</h2>
        <button className="icon-btn" aria-label={`Close ${title}`} onClick={onClose}><X size={18} /></button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
