import { useMemo, useState } from 'react';
import { Loader2, Play, Save, Trash2 } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { Section, Hint } from './shared';
import {
  BUILTIN_TEMPLATES, addSavedTemplate, buildTemplateActions, captureSelection,
  loadSavedTemplateData, removeSavedTemplate, toTemplate,
  type SavedTemplateData, type Template, type TemplateCategory,
} from '../../../tools/templateTools';

const CATEGORIES: ('All' | TemplateCategory)[] = [
  'All', 'Social', 'YouTube', 'Product', 'Slideshow', 'Podcast', 'Travel', 'Music', 'Saved',
];

export function TemplatesTab() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const ui = useUI();
  const [category, setCategory] = useState<'All' | TemplateCategory>('All');
  const [saved, setSaved] = useState<SavedTemplateData[]>(() => loadSavedTemplateData());
  const [busy, setBusy] = useState<string | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [draftName, setDraftName] = useState('');

  const templates = useMemo<Template[]>(
    () => [...BUILTIN_TEMPLATES, ...saved.map(toTemplate)],
    [saved],
  );
  const visible = category === 'All' ? templates : templates.filter((t) => t.category === category);

  /** Every card resolves to real actions through the same runTool() path that
   * applyTool() uses, then commits them as ONE undo step. */
  const apply = async (t: Template) => {
    if (t.source === 'saved' && !selection.length) {
      ui.toast('Select the clips to apply this saved recipe to.', 'info');
      return;
    }
    setBusy(t.id);
    try {
      const result = await buildTemplateActions(project, t, t.source === 'saved' ? selection : undefined);
      if (!result.actions.length) {
        ui.toast(result.summary, 'info');
        return;
      }
      const ok = useStore.getState().commit(result.actions, `Template: ${t.name}`, 'human');
      if (!ok) throw new Error('The edit could not be committed (a clip may be locked).');
      const note = result.warnings.length ? ` Note: ${result.warnings[0]}` : '';
      ui.toast(`${t.name} applied — ${result.actions.length} action(s), one undo step.${note}`, 'success');
    } catch (e) {
      ui.toast(`Template failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveSelection = () => {
    if (!selection.length) {
      ui.toast('Select clips on the timeline first — recipes save editing, not media.', 'info');
      return;
    }
    const data = captureSelection(project, selection, draftName);
    if (!data) {
      ui.toast('Those clips are no longer in the project.', 'error');
      return;
    }
    setSaved(addSavedTemplate(data));
    setDraftName('');
    setShowSave(false);
    setCategory('Saved');
    ui.toast(`Saved "${data.name}" — ${data.clipRecipes.length} clip recipe(s), no media stored.`, 'success');
  };

  const remove = (id: string) => {
    setSaved(removeSavedTemplate(id));
    ui.toast('Saved template removed.', 'info');
  };

  return (
    <div>
      <Section title="Templates" action={
        <button className="rounded-md border border-line bg-ink-850 hover:border-signal/40 text-[10px] text-paper-dim hover:text-paper px-1.5 py-0.5 flex items-center gap-1"
          onClick={() => setShowSave((v) => !v)} title="Save the selected clips' editing recipe">
          <Save size={11} className="text-signal" /> Save selection
        </button>
      }>
        {showSave && (
          <div className="flex gap-1">
            <input className="field flex-1 min-w-0 py-1 text-xs" placeholder="Recipe name"
              value={draftName} onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveSelection(); }} />
            <button className="rounded-md border border-signal/40 bg-ink-800 hover:bg-ink-700 text-[10px] text-paper px-2"
              onClick={saveSelection}>Save</button>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button key={c}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${category === c
                ? 'border-signal/50 bg-ink-800 text-paper'
                : 'border-line bg-ink-850 text-paper-faint hover:text-paper hover:border-signal/30'}`}
              onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {visible.map((t) => (
            <div key={t.id} className="rounded-lg border border-line bg-ink-850 hover:bg-ink-800 hover:border-signal/40 p-2 transition-colors">
              <button className="w-full text-left" disabled={busy != null} onClick={() => void apply(t)} title={t.description}>
                <div className="flex items-center gap-1.5 text-xs text-paper font-medium">
                  {busy === t.id
                    ? <Loader2 size={12} className="animate-spin text-mind shrink-0" />
                    : <Play size={12} className="text-signal shrink-0" />}
                  <span className="truncate">{t.name}</span>
                  <span className="ml-auto text-[9px] text-paper-faint border border-line rounded px-1 shrink-0">{t.aspect}</span>
                </div>
                <div className="text-[10px] text-paper-faint mt-0.5 leading-snug">{t.description}</div>
                <div className="text-[9px] text-mind mt-1">Apply → one undo step</div>
              </button>
              {t.source === 'saved' && (
                <button className="mt-1 text-[9px] text-paper-faint hover:text-red-400 flex items-center gap-1"
                  onClick={() => remove(t.id)} title="Delete this saved recipe">
                  <Trash2 size={10} /> Delete saved recipe
                </button>
              )}
            </div>
          ))}
        </div>
        {visible.length === 0 && <p className="text-[11px] text-paper-faint">No templates in this category yet.</p>}
        <p className="text-[11px] text-paper-faint">Runs real editing tools on your current clips; the whole template is one undo step.</p>
      </Section>
      <Hint>30 built-in recipes cover social cuts, YouTube, product ads, slideshows, podcasts, travel and music. Saved recipes store text/style/effects/transforms only — never media.</Hint>
    </div>
  );
}
