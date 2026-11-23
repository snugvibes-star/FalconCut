import { useId, useMemo, useState } from 'react';
import { GitCompareArrows, History, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useStore, type Version, type ProjectDiff } from '../state/store';
import { useUI } from '../state/ui';

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mind focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900';

function VersionDiff({ diff }: { diff: ProjectDiff }) {
  const changes = [...diff.added, ...diff.removed, ...diff.modified];
  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2 text-[11px]">
      <p className="text-mind font-medium">Snapshot → current edit</p>
      <p className="text-paper-dim">
        {diff.identical ? 'No changes detected in compared fields.' : diff.summary || 'Project metadata changed.'}
      </p>
      <div className="font-mono text-paper-dim">{diff.durationBefore.toFixed(2)}s → {diff.durationAfter.toFixed(2)}s</div>
      {changes.length > 0 && (
        <ul className="space-y-1.5" aria-label="Clip changes">
          {changes.map((change) => (
            <li key={`${change.kind}-${change.id}`} className="rounded-md bg-ink-850 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className={`capitalize ${change.kind === 'added' ? 'text-signal' : change.kind === 'removed' ? 'text-heat' : 'text-mind'}`}>{change.kind}</span>
                <span className="font-mono text-paper-dim">{change.start.toFixed(2)}s</span>
              </div>
              <p className="break-words text-paper">{change.name}</p>
              {change.fields.length > 0 && <p className="break-words text-paper-dim">{change.fields.join(', ')}</p>}
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-1 text-paper-dim">
        {(diff.markersAdded > 0 || diff.markersRemoved > 0) && <li>Markers: {diff.markersAdded} added, {diff.markersRemoved} removed</li>}
        {diff.tacksAdded > 0 && <li>Notes: {diff.tacksAdded} net added</li>}
        {diff.settingsChanged.length > 0 && <li>Settings: {diff.settingsChanged.join(', ')}</li>}
        {diff.rulesChanged && <li>Editing rules changed</li>}
        {diff.stylePackChanged && <li>Style pack changed</li>}
      </ul>
      <p className="text-paper-dim">Partial comparison: clip fields, settings, rules, style pack, marker counts and net added notes. Media, track changes and note replies or status are not compared.</p>
    </div>
  );
}

export function VersionsPanel() {
  const project = useStore((s) => s.project);
  const versions = useStore((s) => s.versions);
  const score = useStore((s) => s.lint.score);
  const diffVersion = useStore((s) => s.diffVersion);
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState('');
  const [compareId, setCompareId] = useState<string | null>(null);
  const id = useId();
  const currentVersions = versions.filter((version) => version.project.id === project.id);
  const comparedVersion = currentVersions.find((version) => version.id === compareId);
  const comparedId = comparedVersion?.id;
  const diff = useMemo(() => comparedId ? diffVersion(comparedId) : null, [comparedId, diffVersion, project, versions]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      useStore.getState().snapshot(trimmed);
      setName('');
      toast(`Snapshot “${trimmed}” saved for this session`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save snapshot', 'error');
    }
  };

  const restore = (version: Version) => {
    if (!window.confirm(`Restore “${version.name}”? This replaces the current edit and saves a “Before restore” snapshot.`)) return;
    try {
      const store = useStore.getState();
      store.pause();
      store.restoreVersion(version.id);
      toast(`Restored “${version.name}”`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not restore snapshot', 'error');
    }
  };

  const remove = (version: Version) => {
    if (!window.confirm(`Delete snapshot “${version.name}”? This cannot be undone. The current edit will not change.`)) return;
    try {
      useStore.getState().deleteVersion(version.id);
      if (compareId === version.id) setCompareId(null);
      toast('Snapshot deleted', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not delete snapshot', 'error');
    }
  };

  return (
    <section className="p-2.5 space-y-3" aria-labelledby={`${id}-heading`}>
      <header className="flex items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="flex items-center gap-1.5 font-display text-sm font-semibold"><History size={15} aria-hidden="true" /> Versions</h2>
        <span className="text-[11px] text-paper-dim">Current lint <span className="font-mono text-signal">{score}/100</span></span>
      </header>
      <form className="panel p-2.5 space-y-2" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <div>
          <label htmlFor={`${id}-name`} className="label">Snapshot name</label>
          <input id={`${id}-name`} className={`field text-xs ${focus}`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Before tightening the intro" required />
        </div>
        <button type="submit" className={`btn-signal w-full text-xs ${focus}`} disabled={!name.trim()}><Plus size={13} aria-hidden="true" /> Save snapshot</button>
        <p className="text-[11px] leading-relaxed text-paper-dim">Snapshots are saved on this device with their project and survive reloads. The latest 40 are kept per project. Press Ctrl+S for a manual checkpoint.</p>
      </form>
      <div className="flex items-center justify-between gap-2 text-[11px] text-paper-dim">
        <h3 className="font-medium">Snapshots for this project</h3>
        <span className="font-mono">{currentVersions.length}</span>
      </div>
      {currentVersions.length === 0 ? (
        <p className="panel p-3 text-xs text-paper-dim">No snapshots yet. Save one before experimenting so you can compare or restore your edit.</p>
      ) : (
        <ul className="space-y-2">
          {currentVersions.map((version) => {
            const expanded = version.id === comparedId;
            const comparisonId = `${id}-compare-${version.id}`;
            return (
              <li key={version.id} className={`panel p-2.5 ${expanded ? 'border-mind/50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="min-w-0 break-words text-xs font-medium">{version.name}</h4>
                  <span className="shrink-0 font-mono text-[11px] text-signal" aria-label={`Snapshot lint score ${version.score} out of 100`}>{version.score}/100</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-paper-dim">
                  <time dateTime={new Date(version.at).toISOString()}>{new Date(version.at).toLocaleString()}</time>
                  <span className={version.source === 'ai' ? 'text-mind' : ''}>{version.source === 'ai' ? 'AI' : version.source === 'auto' ? 'Automatic' : 'Manual'}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" className={`btn-solid px-2 py-1 text-[11px] ${focus}`} aria-label={`Compare “${version.name}” with current edit`} aria-expanded={expanded} aria-controls={comparisonId} onClick={() => setCompareId(expanded ? null : version.id)}><GitCompareArrows size={12} aria-hidden="true" /> {expanded ? 'Hide comparison' : 'Compare'}</button>
                  <button type="button" className={`btn-solid px-2 py-1 text-[11px] ${focus}`} aria-label={`Restore snapshot “${version.name}”`} onClick={() => restore(version)}><RotateCcw size={12} aria-hidden="true" /> Restore</button>
                  <button type="button" className={`btn-ghost px-2 py-1 text-[11px] hover:text-heat ${focus}`} aria-label={`Delete snapshot “${version.name}”`} onClick={() => remove(version)}><Trash2 size={12} aria-hidden="true" /> Delete</button>
                </div>
                <div id={comparisonId} hidden={!expanded}>{expanded && diff && <VersionDiff diff={diff} />}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
