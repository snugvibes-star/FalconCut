import { useStore } from '../state/store';
import { toolManifest, toolsPromptText, type ToolResult } from '../../tools/registry';
import { validateActions } from '../../engine/actions';
import type { Action } from '../../engine/actions';
import type { Analysis, Project } from '../../engine/types';
import type { LintReport } from '../../quality/lint';

export interface CutflowAPI {
  readonly version: string;
  listTools(): ReturnType<typeof toolManifest>;
  toolsPrompt(): string;
  getProject(): Project;
  getAnalysis(): Analysis | undefined;
  getStoryboard(): string;
  getLint(): LintReport;
  getPlayhead(): number;
  setPlayhead(t: number): void;
  runTool(name: string, params?: Record<string, unknown>): Promise<ToolResult>;
  applyTool(name: string, params?: Record<string, unknown>): Promise<ToolResult>;
  applyActions(actions: Action[], label?: string): void;
  undo(): void;
  redo(): void;
  onChange(cb: (project: Project) => void): () => void;
}

const clone = <T,>(v: T): T => v === undefined ? v : JSON.parse(JSON.stringify(v)) as T;

export function createCutflowAPI(authorize: () => void = () => {}): CutflowAPI {
  const state = () => { authorize(); return useStore.getState(); };
  return {
    version: '1.0.0',
    listTools: () => { authorize(); return toolManifest(); },
    toolsPrompt: () => { authorize(); return toolsPromptText(); },
    getProject: () => clone(state().project),
    getAnalysis: () => clone(state().project.analysis),
    getStoryboard: () => state().project.analysis?.storyboard ?? '',
    getLint: () => clone(state().lint),
    getPlayhead: () => state().playhead,
    setPlayhead: (t) => { if (!Number.isFinite(t)) throw new Error('Time must be finite.'); state().setPlayhead(t); },
    runTool: async (name, params) => {
      const result = await state().previewTool(name, params, 'ai');
      authorize();
      return result;
    },
    applyTool: async (name, params) => {
      const before = state().project;
      const result = await state().previewTool(name, params, 'ai');
      const current = state();
      if (current.project !== before) throw new Error('Project changed. Preview the tool again.');
      if (result.actions.length) {
        current.snapshot(`Before ${name}`, 'ai');
        current.commit(result.actions, name, 'ai');
      }
      return result;
    },
    applyActions: (actions, label = 'Agent edit') => {
      // External/agent payloads are untrusted: validate against the engine's
      // own schema before they touch the project (throws with all errors).
      const s0 = state();
      const errors = validateActions(s0.project, actions);
      if (errors.length) throw new Error(`Invalid actions rejected:\n${errors.join('\n')}`);
      s0.snapshot(`Before ${label}`, 'ai');
      s0.commit(actions, label, 'ai');
    },
    undo: () => state().undo(),
    redo: () => state().redo(),
    onChange: (cb) => {
      let last = state().project;
      return useStore.subscribe((s) => {
        if (s.project !== last) { last = s.project; cb(clone(s.project)); }
      });
    },
  };
}

declare global {
  interface Window { cutflow?: CutflowAPI }
}

export function installCutflowAPI(): CutflowAPI {
  const api = createCutflowAPI();
  if (typeof window !== 'undefined') window.cutflow = api;
  return api;
}
