import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useUI, type Toast } from '../state/ui';

const APPEARANCE: Record<Toast['kind'], { label: string; color: string; Icon: typeof Info }> = {
  info: { label: 'Info', color: 'text-pulse', Icon: Info },
  success: { label: 'Success', color: 'text-signal', Icon: CheckCircle2 },
  error: { label: 'Error', color: 'text-heat', Icon: AlertCircle },
};

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);

  return (
    <section aria-label="Notifications" aria-live="polite" aria-relevant="additions text" aria-atomic={false}
      className="pointer-events-none fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-[calc(1rem+env(safe-area-inset-right,0px))] z-[60] w-[calc(100%-2rem)] max-w-sm space-y-2">
      {toasts.map((toast) => {
        const { label, color, Icon } = APPEARANCE[toast.kind];
        return (
          <div key={toast.id} className="panel pointer-events-auto flex items-start gap-2.5 bg-ink-850 p-3 shadow-panel">
            <Icon size={17} className={`mt-0.5 shrink-0 ${color}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide ${color}`}>{label}</p>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-paper">{toast.text}</p>
            </div>
            <button type="button" className="icon-btn shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
              onClick={() => dismiss(toast.id)} aria-label={`Dismiss ${label.toLowerCase()} notification`}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </section>
  );
}
