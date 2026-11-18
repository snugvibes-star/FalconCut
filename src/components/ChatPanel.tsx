import { useEffect, useRef, useState } from 'react';
import { Send, Bot, User, Check, X, Loader2, Sparkles, RotateCcw, KeyRound, Settings2 } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { hasAI } from '../../ai/client';
import type { ProjectDiff } from '../../engine';

function DiffView({ diff }: { diff: ProjectDiff }) {
  return (
    <div className="mt-2 rounded-lg border border-line bg-ink-850 p-2 text-[11px]">
      <div className="text-paper-dim mb-1">{diff.summary}</div>
      <div className="flex flex-wrap gap-1.5">
        {diff.added.length > 0 && <span className="chip bg-heat-green/15 text-heat-green">+{diff.added.length} added</span>}
        {diff.removed.length > 0 && <span className="chip bg-heat/15 text-heat">−{diff.removed.length} removed</span>}
        {diff.modified.length > 0 && <span className="chip bg-pulse/15 text-pulse">~{diff.modified.length} modified</span>}
        {diff.settingsChanged.length > 0 && <span className="chip bg-mind/15 text-mind">settings</span>}
      </div>
      {(diff.added.length + diff.removed.length + diff.modified.length) > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-paper-faint max-h-28 overflow-y-auto">
          {diff.added.slice(0, 6).map((c) => <li key={'a' + c.id} className="truncate">+ {c.name}</li>)}
          {diff.removed.slice(0, 6).map((c) => <li key={'r' + c.id} className="truncate">− {c.name}</li>)}
          {diff.modified.slice(0, 6).map((c) => <li key={'m' + c.id} className="truncate">~ {c.name} ({c.fields.join(', ')})</li>)}
        </ul>
      )}
    </div>
  );
}

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const plan = useStore((s) => s.plan);
  const planRunning = useStore((s) => s.planRunning);
  const aiBusy = useStore((s) => s.aiBusy);
  const aiSettings = useStore((s) => s.aiSettings);
  const autopilot = useStore((s) => s.autopilot);
  const session = useStore((s) => s.session);
  const versions = useStore((s) => s.versions);
  const ui = useUI();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const connected = hasAI(aiSettings);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.length, plan, planRunning]);

  const send = async () => {
    const t = text.trim();
    if (!t || aiBusy) return;
    setText('');
    await useStore.getState().sendChat(t);
  };

  const revertRun = () => {
    const before = versions.find((v) => v.name === 'Before AI run');
    if (before) { useStore.getState().restoreVersion(before.id); ui.toast('Reverted AI run', 'success'); }
    else ui.toast('Nothing to revert', 'info');
  };

  const suggestions = ['Make this a fast-paced TikTok', 'Remove dead air and add captions', 'Clean up the audio and add a hook title'];

  return (
    <div className="flex flex-col h-full">
      <div className="p-2.5 border-b border-line">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            {connected ? (
              <div className="flex items-center gap-1.5 text-[11px] text-heat-green"><Sparkles size={12} /> AI connected · {aiSettings.model}</div>
            ) : (
              <button className="flex items-center gap-1.5 text-[11px] text-heat-amber hover:underline" onClick={() => ui.open('settings')}>
                <KeyRound size={12} /> No AI configured — rules-only mode. Add a key (OpenAI, OpenRouter, Gemini) or a local model endpoint.
              </button>
            )}
          </div>
          <button className="icon-btn shrink-0" title="AI settings — change provider, endpoint, API key or model" onClick={() => ui.open('settings')}>
            <Settings2 size={13} />
          </button>
        </div>
        <div className="text-[10px] text-paper-faint mt-1">{autopilot ? 'Autopilot: plans run automatically' : 'Review mode: you approve each plan'}{session?.connected ? ' · agent live' : ''}</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
        {chat.length === 0 && (
          <div className="text-center py-6">
            <Bot size={26} className="mx-auto mb-2 text-mind opacity-70" />
            <p className="text-xs text-paper-dim mb-3">Tell the AI what you want. It plans tool calls you can review — the editing skill is built into CutFlow, so even a small model works.</p>
            <div className="space-y-1">
              {suggestions.map((sug) => (
                <button key={sug} className="w-full text-left text-[11px] text-paper-dim hover:text-paper bg-ink-850 hover:bg-ink-800 border border-line rounded-lg px-2.5 py-1.5" onClick={() => setText(sug)}>{sug}</button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center ${m.role === 'user' ? 'bg-signal/20 text-signal' : m.role === 'assistant' ? 'bg-mind/20 text-mind' : 'bg-ink-700 text-paper-faint'}`}>
              {m.role === 'user' ? <User size={12} /> : <Bot size={12} />}
            </div>
            <div className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs ${m.role === 'user' ? 'bg-signal/15 text-paper' : m.role === 'system' ? 'bg-heat/10 text-heat-amber' : 'bg-ink-800 text-paper-dim'}`}>
              <div className="whitespace-pre-wrap">{m.text}</div>
              {m.diff && <DiffView diff={m.diff} />}
              {m.diff && !m.diff.identical && (
                <button className="mt-1.5 flex items-center gap-1 text-[10px] text-paper-faint hover:text-heat" onClick={revertRun}><RotateCcw size={10} /> Revert this run</button>
              )}
            </div>
          </div>
        ))}

        {plan && !planRunning && (
          <div className="rounded-xl border border-mind/40 bg-mind/5 p-2.5 animate-fade-in">
            <div className="flex items-center gap-1.5 text-xs text-mind font-medium mb-1.5"><Sparkles size={13} /> Plan ({plan.source === 'ai' ? 'AI' : 'rules'}) · {plan.steps.length} steps</div>
            <ol className="space-y-1 mb-2">
              {plan.steps.map((st, i) => (
                <li key={i} className="text-[11px] text-paper-dim flex gap-1.5">
                  <span className="text-paper-faint font-mono">{i + 1}.</span>
                  <span><span className="font-mono text-signal">{st.tool}</span>{st.why ? <span className="text-paper-faint"> — {st.why}</span> : null}</span>
                </li>
              ))}
            </ol>
            <div className="flex gap-1.5">
              <button className="btn-signal flex-1 py-1 text-xs" onClick={() => useStore.getState().approvePlan()}><Check size={13} /> Run plan</button>
              <button className="btn-solid flex-1 py-1 text-xs" onClick={() => useStore.getState().rejectPlan()}><X size={13} /> Reject</button>
            </div>
          </div>
        )}

        {(aiBusy || planRunning) && (
          <div className="flex items-center gap-2 text-xs text-mind px-1"><Loader2 size={14} className="animate-spin" /> {planRunning ? 'Running tools…' : 'Thinking…'}</div>
        )}
        <div ref={endRef} />
      </div>

      <div className="p-2.5 border-t border-line">
        <div className="flex gap-1.5">
          <textarea
            className="field resize-none text-xs flex-1" rows={2} value={text} placeholder="Describe the edit you want…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          />
          <button className="btn-mind self-end px-2.5" onClick={() => void send()} disabled={aiBusy || !text.trim()} title="Send"><Send size={15} /></button>
        </div>
        {chat.length > 0 && <button className="text-[10px] text-paper-faint hover:text-paper mt-1.5" onClick={() => useStore.getState().clearChat()}>Clear conversation</button>}
      </div>
    </div>
  );
}