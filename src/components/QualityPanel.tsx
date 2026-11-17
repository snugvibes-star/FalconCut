import { useId, useRef, useState } from 'react';
import { ArrowRight, ShieldCheck, Wrench } from 'lucide-react';
import type { LintIssue } from '../../quality/lint';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mind focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900';
const severityStyle = { error: 'bg-heat/15 text-heat', warning: 'bg-heat-amber/15 text-heat-amber', info: 'bg-mind/15 text-mind' };
const subscoreLabels = { pacing: 'Pacing', audio: 'Audio', captions: 'Captions', hook: 'Hook', retention: 'Retention' } as const;
const hasFix = (issue: LintIssue) => Boolean(issue.fix?.actions?.length || issue.fix?.tool);

export function QualityPanel() {
  const lint = useStore((s) => s.lint);
  const project = useStore((s) => s.project);
  const toast = useUI((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);
  const [feedback, setFeedback] = useState<{ text: string; warnings: string[]; error: boolean } | null>(null);
  const id = useId();
  const mediaIds = new Set(project.clips.flatMap((clip) => clip.mediaId ? [clip.mediaId] : []));
  const usedMedia = project.media.filter((media) => mediaIds.has(media.id));
  const analyzed = usedMedia.filter((media) => project.analysis?.byMedia[media.id]);
  const speechSources = usedMedia.filter((media) => media.type === 'video' || media.type === 'audio');
  const transcribed = speechSources.filter((media) => project.analysis?.byMedia[media.id]?.transcript?.complete);
  const analysisFlags = analyzed.flatMap((media) => (project.analysis?.byMedia[media.id]?.flags ?? []).map((flag) => `${media.name}: ${flag}`));

  const seekIssue = (issue: LintIssue) => {
    const store = useStore.getState();
    const clip = store.project.clips.find((item) => item.id === issue.clipId);
    const time = issue.time ?? clip?.start;
    store.pause();
    store.select(clip ? [clip.id] : []);
    if (time !== undefined) store.setPlayhead(time);
  };

  const fix = async (issue?: LintIssue) => {
    if (running.current || (issue && !hasFix(issue))) return;
    running.current = true;
    setBusy(issue?.id ?? 'auto_fix');
    setFeedback(null);
    try {
      const store = useStore.getState();
      let text: string;
      let warnings: string[] = [];
      let changed = false;
      if (issue?.fix?.actions?.length) {
        store.commit(issue.fix.actions, issue.fix.label);
        text = `Applied: ${issue.fix.label}. Review the updated checks.`;
        changed = true;
      } else {
        const tool = issue?.fix?.tool;
        const result = await store.applyTool(tool?.name ?? 'auto_fix', tool?.params ?? (tool ? {} : { max_attempts: 3 }));
        changed = result.actions.length > 0;
        text = result.summary || (changed ? 'Fix actions applied. Review the updated checks.' : 'No changes applied.');
        warnings = result.warnings ?? [];
      }
      setFeedback({ text, warnings, error: false });
      toast(text, changed ? 'success' : 'info');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Could not apply quality fixes';
      setFeedback({ text, warnings: [], error: true });
      toast(text, 'error');
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  return (
    <section className="p-2.5 space-y-3" aria-labelledby={`${id}-heading`}>
      <header className="flex items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="flex items-center gap-1.5 font-display text-sm font-semibold"><ShieldCheck size={15} aria-hidden="true" /> Quality checks</h2>
        <span className="text-[10px] text-paper-dim">Rules, not a visual review</span>
      </header>
      <div className="panel p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="label">Lint score</div>
            <p className={`text-[11px] ${lint.readyToExport ? 'text-signal' : 'text-heat-amber'}`}>{lint.readyToExport ? 'Checker threshold met' : 'Checker threshold not met'}</p>
          </div>
          <div className="font-display text-2xl font-semibold text-signal" aria-label={`Lint score ${lint.score} out of 100`}>{lint.score}<span className="text-xs font-normal text-paper-dim"> / 100</span></div>
        </div>
        <p className="text-[11px] leading-relaxed text-paper-dim">Heuristics based on timeline data and available analysis. This is not a judgment of visual quality, audience retention or export success. Preview picture and sound yourself.</p>
        {project.clips.length === 0 && <p className="text-[11px] text-heat-amber">The timeline is empty. A high score does not mean there is an edit to export.</p>}
        <h3 className="label">Checker reasons</h3>
        <ul className="space-y-1 text-[11px] text-paper-dim">
          {lint.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
        </ul>
      </div>
      <div className="panel p-2.5">
        <h3 className="label">Heuristic subscores</h3>
        <dl className="divide-y divide-line">
          {(Object.keys(subscoreLabels) as (keyof typeof subscoreLabels)[]).map((key) => (
            <div key={key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 py-2 first:pt-1 last:pb-0">
              <dt className="text-xs font-medium">{subscoreLabels[key]}</dt>
              <dd className="font-mono text-xs text-mind">{lint.subscores[key].score}/100</dd>
              <dd className="col-span-2 mt-0.5 text-[11px] text-paper-dim">{lint.subscores[key].explanation}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="space-y-1.5">
        <button type="button" className={`btn-signal w-full text-xs ${focus}`} disabled={busy !== null || !lint.issues.some(hasFix)} onClick={() => void fix()}><Wrench size={13} aria-hidden="true" /> {busy === 'auto_fix' ? 'Applying auto-fixes…' : 'Auto-fix issues'}</button>
        <p className="text-[11px] text-paper-dim">Up to 3 passes; may change multiple clips. Review the result and use Undo if needed. Some issues may remain.</p>
      </div>
      {feedback && (
        <div className={`panel p-2.5 text-[11px] ${feedback.error ? 'border-heat/40 text-heat' : 'text-paper-dim'}`} role={feedback.error ? 'alert' : 'status'}>
          <p className="whitespace-pre-wrap break-words">{feedback.text}</p>
          {feedback.warnings.length > 0 && <ul className="mt-1.5 space-y-1 text-heat-amber">{feedback.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <h3 className="font-medium">Issues ({lint.issues.length})</h3>
        <span className="text-paper-dim">{lint.issues.filter((issue) => issue.severity === 'error').length} errors · {lint.issues.filter((issue) => issue.severity === 'warning').length} warnings</span>
      </div>
      {lint.issues.length === 0 ? (
        <p className="panel p-3 text-xs text-paper-dim">No issues reported by available checks. Review the coverage below before relying on this result.</p>
      ) : (
        <ul className="space-y-2" aria-busy={busy !== null}>
          {lint.issues.map((issue) => {
            const clip = project.clips.find((item) => item.id === issue.clipId);
            const time = issue.time ?? clip?.start;
            return (
              <li key={issue.id} className="panel p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={`chip capitalize ${severityStyle[issue.severity]}`}>{issue.severity}</span>
                  <span className="text-[10px] capitalize text-paper-dim">{issue.category}</span>
                </div>
                <p className="text-xs leading-relaxed break-words">{issue.message}</p>
                {time !== undefined && <button type="button" className={`btn-solid px-2 py-1 text-[11px] ${focus}`} onClick={() => seekIssue(issue)} aria-label={`Go to ${time.toFixed(2)} seconds${clip ? ` and select ${clip.name || clip.kind}` : ''}: ${issue.message}`}><ArrowRight size={12} aria-hidden="true" /> Go to {time.toFixed(2)}s{clip ? ' · select clip' : ''}</button>}
                {hasFix(issue) && (
                  <div className="space-y-1">
                    <button type="button" className={`btn-solid w-full px-2 py-1 text-[11px] text-signal ${focus}`} disabled={busy !== null} onClick={() => void fix(issue)}>{busy === issue.id ? 'Applying fix…' : issue.fix!.label}</button>
                    {issue.fix?.tool && <p className="text-[10px] text-paper-dim">Project-wide tool; may change other clips.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <details className="panel p-2.5" open>
        <summary className={`cursor-pointer rounded text-xs font-medium ${focus}`}>Check coverage and limits</summary>
        <div className="mt-2 space-y-2 text-[11px] text-paper-dim">
          <p>{analyzed.length}/{usedMedia.length} timeline media sources have analysis. {transcribed.length}/{speechSources.length} video/audio sources have a complete transcript.</p>
          <p>Missing or partial transcripts, audio measurements and scene data limit checks. Caption size/position and gap checks inspect timeline values, not rendered pixels. Hook and retention scores are rule proxies, not audience predictions.</p>
          <p>Registered checks (not proof each had enough data to run):</p>
          <ul className="flex flex-wrap gap-1" aria-label="Registered quality checks">{lint.checked.map((check) => <li key={check} className="rounded bg-ink-800 px-1.5 py-0.5">{check}</li>)}</ul>
          {analysisFlags.length > 0 && <ul className="space-y-1 break-words text-heat-amber" aria-label="Analysis limitations">{analysisFlags.map((flag, index) => <li key={index}>{flag}</li>)}</ul>}
        </div>
      </details>
    </section>
  );
}
