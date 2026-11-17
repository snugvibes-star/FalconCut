import { useEffect, useState } from 'react';
import type { Project } from '../../engine/types';
import { deleteProject, listProjects } from '../state/persistence';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { Dialog } from './Dialog';

export function ProjectsDialog() {
  const currentId = useStore((s) => s.project.id);
  const close = useUI((s) => s.close);
  const toast = useUI((s) => s.toast);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState(currentId);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'open' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void listProjects().then((items) => {
      if (cancelled) return;
      setProjects(items);
      setSelectedId((id) => items.some((project) => project.id === id) ? id : items[0]?.id ?? '');
    }).catch((e: unknown) => {
      if (!cancelled) setError(`Could not load local projects. ${e instanceof Error ? e.message : 'Check browser storage permissions and retry.'}`);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reload]);

  const selected = projects.find((project) => project.id === selectedId);
  const onClose = () => { if (!busy) close('projects'); };

  const openSelected = async () => {
    if (!selected || busy || loading || selected.id === useStore.getState().project.id) return;
    setBusy('open');
    setError('');
    try {
      await useStore.getState().openProject(selected.id);
      if (useStore.getState().project.id !== selected.id) throw new Error('The project was not found. Refresh the list and choose another project.');
      toast(`Opened ${selected.name}.`, 'success');
      close('projects');
    } catch (e) {
      setError(`Could not open project. ${e instanceof Error ? e.message : 'Try again.'}`);
    } finally {
      setBusy(null);
    }
  };

  const deleteSelected = async () => {
    if (!selected || busy || loading || selected.id === useStore.getState().project.id) return;
    if (!window.confirm(`Delete "${selected.name}"? This removes only the saved project document and cannot be undone. Media files will be kept on this device.`)) return;
    // Recheck the active document immediately before deleting it.
    if (selected.id === useStore.getState().project.id) return;
    setBusy('delete');
    setError('');
    try {
      await deleteProject(selected.id);
      setProjects((items) => items.filter((project) => project.id !== selected.id));
      setSelectedId('');
      toast(`Deleted ${selected.name}. Media files were kept.`, 'success');
    } catch (e) {
      setError(`Could not delete project. ${e instanceof Error ? e.message : 'Try again.'}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title="Local projects" onClose={onClose}>
      <div className="space-y-3" aria-busy={loading || Boolean(busy)}>
        <p className="text-xs leading-relaxed text-paper-dim">Projects are stored in this browser on this device. Save or export your current project before opening another one.</p>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-sm font-semibold">Saved projects</h3>
          <button type="button" className="btn-solid text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" disabled={loading || Boolean(busy)} onClick={() => setReload((value) => value + 1)}>Refresh list</button>
        </div>
        {error && <p role="alert" className="panel border-heat/30 bg-heat/10 p-3 text-xs leading-relaxed text-heat">{error}</p>}
        {loading ? <p role="status" className="py-6 text-center text-xs text-paper-dim">Loading local projects…</p> : projects.length ? (
          <fieldset disabled={Boolean(busy)} className="space-y-2">
            <legend className="sr-only">Choose a saved project</legend>
            {projects.map((project) => (
              <label key={project.id} className={`panel flex cursor-pointer items-start gap-3 p-3 transition-colors focus-within:ring-1 focus-within:ring-signal ${selectedId === project.id ? 'border-signal/50 bg-signal/5' : 'bg-ink-850 hover:border-line-bright'}`}>
                <input type="radio" name="saved-project" value={project.id} checked={selectedId === project.id}
                  onChange={() => setSelectedId(project.id)} className="mt-0.5 shrink-0 accent-signal" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-sm font-medium text-paper">{project.name}</span>
                    {project.id === currentId && <span className="chip bg-signal/10 text-signal">Current</span>}
                  </span>
                  <span className="mt-1 block text-[11px] text-paper-dim">{project.settings.aspect} · {project.media.length} media · {project.clips.length} clips</span>
                  <span className="mt-1 block text-[11px] text-paper-dim">Updated {new Date(project.updatedAt).toLocaleString()}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : !error ? <p className="panel bg-ink-850 p-4 text-xs leading-relaxed text-paper-dim">No saved projects yet. Start editing; local autosave will add your project here. Then refresh this list.</p> : null}
        <p className="text-[11px] leading-relaxed text-paper-dim">The current project cannot be deleted. Deleting another project keeps all media blobs, including files shared with other projects.</p>
        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
          <button type="button" className="btn-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-heat"
            disabled={loading || Boolean(busy) || !selected || selected.id === currentId} onClick={() => void deleteSelected()}
            title={selected?.id === currentId ? 'Open another project before deleting this one' : 'Delete the selected project document'}>
            {busy === 'delete' ? 'Deleting…' : 'Delete project'}
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" disabled={Boolean(busy)} onClick={onClose}>Close</button>
            <button type="button" className="btn-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
              disabled={loading || Boolean(busy) || !selected || selected.id === currentId} onClick={() => void openSelected()}>
              {busy === 'open' ? 'Opening…' : 'Open project'}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
