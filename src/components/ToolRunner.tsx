import { useMemo, useState } from 'react';
import { X, Eye, Check, Loader2, AlertTriangle } from 'lucide-react';
import { TOOL_MAP, toolLabel } from '../../tools/registry';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import type { ToolResult } from '../../tools/registry';

export function ToolRunner({ toolName, onClose }: { toolName: string; onClose: () => void }) {
  const def = TOOL_MAP.get(toolName);
  const ui = useUI();
  const [params, setParams] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    if (def) for (const [k, v] of Object.entries(def.params)) if (v.default !== undefined) init[k] = v.default;
    return init;
  });
  const [preview, setPreview] = useState<ToolResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);

  const entries = useMemo(() => def ? Object.entries(def.params) : [], [def]);
  if (!def) return null;

  const set = (k: string, v: unknown) => setParams((p) => ({ ...p, [k]: v }));

  const doPreview = async () => {
    setBusy('preview');
    try { setPreview(await useStore.getState().previewTool(toolName, params)); }
    catch (e) { ui.toast((e as Error).message, 'error'); }
    finally { setBusy(null); }
  };
  const doApply = async () => {
    setBusy('apply');
    try {
      const r = await useStore.getState().applyTool(toolName, params);
      ui.toast(r.summary || `${toolName} applied`, 'success');
      onClose();
    } catch (e) { ui.toast((e as Error).message, 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="panel w-full max-w-lg shadow-panel animate-fade-in max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-4 border-b border-line">
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-semibold text-paper text-sm">{toolLabel(def.name)}</h3>
            <p className="text-xs text-paper-dim mt-1">{def.description}</p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3">
          {entries.length === 0 && <p className="text-xs text-paper-faint">No parameters — runs with professional defaults.</p>}
          {entries.map(([k, spec]) => (
            <div key={k}>
              <label className="label">{k}{spec.optional ? ' (optional)' : ''}</label>
              {spec.type === 'enum' ? (
                <select className="field cursor-pointer" value={String(params[k] ?? spec.default ?? '')} onChange={(e) => set(k, e.target.value)}>
                  {!spec.optional && spec.default === undefined && <option value="">Choose…</option>}
                  {spec.enum?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : spec.type === 'boolean' ? (
                <label className="flex items-center gap-2 text-sm text-paper-dim cursor-pointer">
                  <input type="checkbox" checked={Boolean(params[k] ?? spec.default ?? false)} onChange={(e) => set(k, e.target.checked)} className="accent-signal w-4 h-4" />
                  Enable
                </label>
              ) : spec.type === 'number' ? (
                <input type="number" className="field" value={String(params[k] ?? spec.default ?? '')} step="any" onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))} />
              ) : (
                <input type="text" className="field" value={String(params[k] ?? spec.default ?? '')} onChange={(e) => set(k, e.target.value)} placeholder={spec.desc} />
              )}
              <p className="text-[11px] text-paper-faint mt-1">{spec.desc}</p>
            </div>
          ))}

          <div className="text-[11px] text-paper-faint italic border-l-2 border-line pl-2">Example: {JSON.stringify(def.example.input)} — {def.example.why}</div>

          {preview && (
            <div className="panel p-3 bg-ink-850">
              <div className="text-xs text-paper mb-1">{preview.summary}</div>
              <div className="text-[11px] text-paper-dim">{preview.actions.length} action{preview.actions.length === 1 ? '' : 's'}{preview.stats ? ` · ${JSON.stringify(preview.stats)}` : ''}</div>
              {preview.warnings?.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-heat-amber mt-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 p-3 border-t border-line">
          <button className="btn-solid flex-1" onClick={doPreview} disabled={busy !== null}>
            {busy === 'preview' ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />} Preview
          </button>
          <button className="btn-signal flex-1" onClick={doApply} disabled={busy !== null}>
            {busy === 'apply' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Apply
          </button>
        </div>
      </div>
    </div>
  );
}