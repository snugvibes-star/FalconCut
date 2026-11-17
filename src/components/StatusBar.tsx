/** Bottom chrome: project stats, playhead timecode, save/agent/zoom status.
 * Pure read-only mirror of store state — never mutates the document. */
import { useStore } from '../state/store';
import { projectDuration } from '../../engine';

const ZOOM_BASE = 80; // px/s default — 100%

const fmtMMSS = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const fmtTC = (t: number, fps: number) => {
  const total = Math.max(0, Math.floor(t * fps));
  const f = total % fps;
  const s = Math.floor(total / fps) % 60;
  const m = Math.floor(total / (fps * 60));
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
};

export function StatusBar() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const selection = useStore((s) => s.selection);
  const zoom = useStore((s) => s.zoom);
  const saveStatus = useStore((s) => s.saveStatus);
  const session = useStore((s) => s.session);
  const lint = useStore((s) => s.lint);
  const fps = project.settings.fps || 30;

  return (
    <footer className="h-6 shrink-0 flex items-center gap-4 px-3 bg-ink-950 border-t border-line text-[10px] font-mono text-paper-faint overflow-x-auto whitespace-nowrap">
      <span className="tabular-nums shrink-0">{project.clips.length} clips · {fmtMMSS(projectDuration(project))}</span>
      <span className="tabular-nums hidden md:inline shrink-0" title="Playhead timecode">TC {fmtTC(playhead, fps)}</span>
      {selection.length > 0 && <span className="text-paper-dim tabular-nums hidden md:inline shrink-0">{selection.length} selected</span>}
      {lint && (
        <span
          className={`tabular-nums hidden sm:inline shrink-0 px-1.5 rounded ${
            lint.score >= 90 ? 'text-heat-green' : lint.score >= 70 ? 'text-heat-amber' : 'text-heat'
          }`}
          title={lint.reasons.join(' ')}
        >
          Quality {lint.score}
        </span>
      )}

      <span className="flex-1 min-w-2" />

      <span className="flex items-center gap-1.5 shrink-0" title={saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : 'Saved'}>
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            saveStatus === 'saving' ? 'bg-heat-amber animate-pulse-dot'
            : saveStatus === 'error' ? 'bg-heat'
            : 'bg-signal'
          }`}
        />
        <span className={saveStatus === 'error' ? 'text-heat' : ''}>
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : 'Saved'}
        </span>
      </span>
      <span className={`hidden md:inline shrink-0 ${session ? 'text-heat-green' : ''}`}>{session ? 'Agent connected' : 'Local'}</span>
      <span className="tabular-nums hidden md:inline shrink-0">Zoom {Math.round((zoom / ZOOM_BASE) * 100)}%</span>
    </footer>
  );
}
