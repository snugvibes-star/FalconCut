/** Undo/redo history. Each entry is a project snapshot + label; groups = one entry. */
import type { Project } from './types';
import type { Action } from './actions';
import { applyActions } from './actions';

export interface HistoryEntry { project: Project; label: string; at: number }

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  current: Project;
  limit = 120;

  constructor(initial: Project) { this.current = initial; }

  apply(actions: Action[], label: string, coalesceKey?: string): Project {
    if (!actions.length) return this.current;
    const next = applyActions(this.current, actions);
    const now = Date.now();
    // A continuous gesture (slider drag) reuses one undo entry while the key
    // matches and changes arrive quickly; the first change parks the pre-drag
    // snapshot, later ones just advance current.
    if (coalesceKey && this.lastKey === coalesceKey && now - this.lastAt < 1200 && this.past.length) {
      this.current = next;
      this.lastAt = now;
      return next;
    }
    this.past.push({ project: this.current, label, at: now });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    this.lastKey = coalesceKey ?? null;
    this.lastAt = now;
    return next;
  }

  reset(project: Project): void {
    this.past = [];
    this.future = [];
    this.current = project;
    this.lastKey = null;
  }

  /** Replace the whole document as one undoable step (version restore, import). */
  replace(project: Project, label: string): Project {
    this.past.push({ project: this.current, label, at: Date.now() });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = project;
    this.lastKey = null;
    return project;
  }

  undo(): { project: Project; label: string } | null {
    const e = this.past.pop();
    if (!e) return null;
    this.future.push({ project: this.current, label: e.label, at: Date.now() });
    this.current = e.project;
    this.lastKey = null;
    return { project: e.project, label: e.label };
  }

  redo(): { project: Project; label: string } | null {
    const e = this.future.pop();
    if (!e) return null;
    this.past.push({ project: this.current, label: e.label, at: Date.now() });
    this.current = e.project;
    this.lastKey = null;
    return { project: e.project, label: e.label };
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past[this.past.length - 1]?.label ?? ''; }
  get redoLabel() { return this.future[this.future.length - 1]?.label ?? ''; }
  get depth() { return this.past.length; }
}