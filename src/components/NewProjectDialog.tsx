import { useState, type FormEvent } from 'react';
import { ASPECT_SIZES, type Aspect } from '../../engine/types';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { Dialog } from './Dialog';

const ASPECTS: { value: Aspect; label: string }[] = [
  { value: '16:9', label: '16:9 · Landscape' },
  { value: '9:16', label: '9:16 · Portrait' },
  { value: '1:1', label: '1:1 · Square' },
  { value: '4:5', label: '4:5 · Social portrait' },
];

export function NewProjectDialog() {
  const currentName = useStore((s) => s.project.name);
  const newProject = useStore((s) => s.newProject);
  const close = useUI((s) => s.close);
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState('Untitled project');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const onClose = () => { if (!busy) close('newProject'); };
  const [width, height] = ASPECT_SIZES[aspect];

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || busy) {
      if (!trimmedName) setError('Enter a project name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await newProject(trimmedName, aspect);
      toast(`Created ${trimmedName}.`, 'success');
      close('newProject');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a project. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <Dialog title="New project" onClose={onClose}>
      <form onSubmit={create} className="space-y-4">
        <div className="panel border-heat-amber/30 bg-heat-amber/5 p-3 text-xs leading-relaxed text-paper-dim">
          <h3 className="mb-1 font-display font-semibold text-heat-amber">Save your current work first</h3>
          <p>Creating a project switches away from <span className="break-words font-medium text-paper">{currentName}</span>. Wait for autosave to finish or export the current project before continuing. The new project's undo history cannot recover previous work.</p>
        </div>
        <div>
          <label className="label" htmlFor="new-project-name">Project name</label>
          <input id="new-project-name" className="field" required autoFocus value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Name your project" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="new-project-aspect">Aspect ratio</label>
          <select id="new-project-aspect" className="field" value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)} aria-describedby="new-project-size">
            {ASPECTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <p id="new-project-size" className="mt-2 font-mono text-[11px] text-paper-dim">{width} × {height} px</p>
        </div>
        {error && <p role="alert" className="text-xs text-heat">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          <button type="button" className="btn-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" onClick={onClose}>Back to editor</button>
          <button type="submit" className="btn-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" disabled={!name.trim() || busy}>{busy ? 'Saving & creating…' : 'Create project'}</button>
        </div>
      </form>
    </Dialog>
  );
}
