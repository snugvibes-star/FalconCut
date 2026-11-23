import { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { useUI } from './state/ui';
import { usePlayback } from './hooks/usePlayback';
import { useKeyboard } from './hooks/useKeyboard';
import { TopBar } from './components/TopBar';
import { MediaLibrary } from './components/MediaLibrary';
import { Preview } from './components/Preview';
import { RightPanel } from './components/RightPanel';
import { Timeline } from './components/Timeline';
import { StatusBar } from './components/StatusBar';
import { ColorPage } from './components/color/ColorPage';
import { AudioPage } from './components/audio/AudioPage';
import { ConnectDialog } from './components/ConnectDialog';
import { ExportDialog } from './components/ExportDialog';
import { CommandPalette } from './components/CommandPalette';
import { SettingsDialog } from './components/SettingsDialog';
import { AnalysisDialog } from './components/AnalysisDialog';
import { ProjectsDialog } from './components/ProjectsDialog';
import { NewProjectDialog } from './components/NewProjectDialog';
import { Toasts } from './components/Toasts';
import { connectAgentBridge } from './api/agentBridge';

export default function App() {
  const ready = useStore((s) => s.ready);
  const dialogs = useUI((s) => s.dialogs);
  const workspace = useUI((s) => s.workspace);
  const focusMode = useUI((s) => s.focusMode);
  const density = useUI((s) => s.density);
  usePlayback();
  useKeyboard();
  const sessionToken = useStore((s) => s.session?.token);

  useEffect(() => {
    const session = useStore.getState().session;
    if (!session) return;
    const bridge = connectAgentBridge(session, {
      onError: (message) => useStore.getState().logActivity(message),
    });
    return () => bridge.disconnect();
  }, [sessionToken]);

  useEffect(() => {
    const onBeforeUnload = () => { useStore.getState().pool.pauseAll(); useStore.getState().revokeSession(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // A window resize can change the device class (desktop → phone). Re-clamp the
  // saved timeline height so the preview never collapses on a smaller screen.
  useEffect(() => {
    const onResize = () => {
      const ui = useUI.getState();
      ui.setTimelineHeight(ui.timelineHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Panel overlays (<lg only): default closed; toggled from the TopBar.
  const [leftOverlay, setLeftOverlay] = useState(false);
  const [rightOverlay, setRightOverlay] = useState(false);
  const closeOverlays = () => { setLeftOverlay(false); setRightOverlay(false); };

  // Only one drawer can own the screen on tablet/phone, and switching
  // workspaces must never leave a stale drawer floating over the new page.
  useEffect(() => { closeOverlays(); }, [workspace]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (leftOverlay || rightOverlay) {
        closeOverlays();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leftOverlay, rightOverlay]);

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center bg-ink-950">
        <div className="text-center">
          <div className="font-display text-2xl font-semibold text-signal mb-2">FalconCut</div>
          <div className="text-paper-dim text-sm">Loading your workspace…</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-[100dvh] flex flex-col bg-ink-950 text-paper ${density === 'compact' ? 'cf-density-compact' : ''}`}>
      <TopBar
        leftOpen={leftOverlay}
        rightOpen={rightOverlay}
        onToggleLeft={() => { setRightOverlay(false); setLeftOverlay((v) => !v); }}
        onToggleRight={() => { setLeftOverlay(false); setRightOverlay((v) => !v); }}
      />
      <div className="cf-spectrum shrink-0" />
      {workspace === 'edit' ? (
        focusMode ? (
          /* Theater mode: the preview owns the whole window above the status bar. */
          <>
            <div className="flex-1 flex min-h-0 relative">
              <div className="flex-1 min-w-0 flex flex-col bg-ink-950">
                <Preview />
              </div>
            </div>
            <Timeline />
          </>
        ) : (
        <>
          <div className="flex-1 flex min-h-0 relative gap-px bg-line">
            <MediaLibrary
              overlayOpen={leftOverlay}
              onOverlayClose={() => setLeftOverlay(false)}
            />
            <div className="flex-1 min-w-0 flex flex-col bg-ink-950">
              <Preview />
            </div>
            <RightPanel
              overlayOpen={rightOverlay}
              onOverlayClose={() => setRightOverlay(false)}
            />
            {/* scrim behind overlay panels (<lg only); click outside closes */}
            {(leftOverlay || rightOverlay) && (
              <div
                className="absolute inset-0 z-20 bg-ink-950/60 lg:hidden"
                onClick={closeOverlays}
              />
            )}
          </div>
          <Timeline />
        </>
        )
      ) : workspace === 'color' ? (
        <div className="flex-1 min-h-0 flex flex-col bg-ink-950">
          <ColorPage />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col bg-ink-950">
          <AudioPage />
        </div>
      )}
      <StatusBar />

      {dialogs.connect && <ConnectDialog />}
      {dialogs.export && <ExportDialog />}
      {dialogs.palette && <CommandPalette />}
      {dialogs.settings && <SettingsDialog />}
      {dialogs.analysis && <AnalysisDialog />}
      {dialogs.projects && <ProjectsDialog />}
      {dialogs.newProject && <NewProjectDialog />}
      <Toasts />
    </div>
  );
}