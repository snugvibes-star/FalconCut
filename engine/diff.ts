/**
 * Pure project diff. Used by the timeline "Approve / Revert" view and by
 * version compare. Compares two project documents and reports what changed
 * in plain terms. No browser APIs — safe to unit test and run in Node.
 */
import type { Clip, Project } from './types';
import { projectDuration } from './types';

export type ChangeKind = 'added' | 'removed' | 'modified';

export interface ClipChange {
  id: string;
  kind: ChangeKind;
  name: string;
  clipKind: Clip['kind'];
  /** Names of the fields that changed (for 'modified'). */
  fields: string[];
  start: number;
  duration: number;
}

export interface ProjectDiff {
  added: ClipChange[];
  removed: ClipChange[];
  modified: ClipChange[];
  markersAdded: number;
  markersRemoved: number;
  tacksAdded: number;
  settingsChanged: string[];
  rulesChanged: boolean;
  stylePackChanged: boolean;
  durationBefore: number;
  durationAfter: number;
  summary: string;
  identical: boolean;
}

const COMPARE_FIELDS: (keyof Clip)[] = [
  'start', 'duration', 'inPoint', 'speed', 'trackId', 'volume', 'fit',
  'transform', 'fades', 'effects', 'keyframes', 'text', 'motif',
  'transitionIn', 'transitionOut', 'groupId', 'locked', 'name',
];

function changedFields(a: Clip, b: Clip): string[] {
  const out: string[] = [];
  for (const f of COMPARE_FIELDS) {
    const av = a[f], bv = b[f];
    if (typeof av === 'object' || typeof bv === 'object') {
      if (JSON.stringify(av ?? null) !== JSON.stringify(bv ?? null)) out.push(f);
    } else if (av !== bv) {
      out.push(f);
    }
  }
  return out;
}

function toChange(c: Clip, kind: ChangeKind, fields: string[] = []): ClipChange {
  return {
    id: c.id, kind, fields,
    name: c.name ?? (c.text?.text ? c.text.text.slice(0, 28) : c.kind),
    clipKind: c.kind, start: c.start, duration: c.duration,
  };
}

export function diffProjects(before: Project, after: Project): ProjectDiff {
  const beforeMap = new Map(before.clips.map((c) => [c.id, c]));
  const afterMap = new Map(after.clips.map((c) => [c.id, c]));
  const added: ClipChange[] = [];
  const removed: ClipChange[] = [];
  const modified: ClipChange[] = [];

  for (const c of after.clips) {
    const prev = beforeMap.get(c.id);
    if (!prev) added.push(toChange(c, 'added'));
    else {
      const fields = changedFields(prev, c);
      if (fields.length) modified.push(toChange(c, 'modified', fields));
    }
  }
  for (const c of before.clips) if (!afterMap.has(c.id)) removed.push(toChange(c, 'removed'));

  const beforeMarkers = new Set(before.markers.map((m) => m.id));
  const afterMarkers = new Set(after.markers.map((m) => m.id));
  let markersAdded = 0, markersRemoved = 0;
  for (const id of afterMarkers) if (!beforeMarkers.has(id)) markersAdded++;
  for (const id of beforeMarkers) if (!afterMarkers.has(id)) markersRemoved++;

  const settingsChanged: string[] = [];
  for (const k of Object.keys(after.settings) as (keyof Project['settings'])[]) {
    if (before.settings[k] !== after.settings[k]) settingsChanged.push(k);
  }

  const durationBefore = projectDuration(before);
  const durationAfter = projectDuration(after);
  const tacksAdded = Math.max(0, after.tacks.length - before.tacks.length);
  const rulesChanged = JSON.stringify(before.rules) !== JSON.stringify(after.rules);
  const stylePackChanged = before.stylePackId !== after.stylePackId;

  const parts: string[] = [];
  if (added.length) parts.push(`${added.length} added`);
  if (removed.length) parts.push(`${removed.length} removed`);
  if (modified.length) parts.push(`${modified.length} modified`);
  if (markersAdded) parts.push(`${markersAdded} markers`);
  if (settingsChanged.length) parts.push(`settings: ${settingsChanged.join(', ')}`);
  if (stylePackChanged) parts.push('style pack changed');
  const durDelta = durationAfter - durationBefore;
  if (Math.abs(durDelta) > 0.05) parts.push(`duration ${durationBefore.toFixed(1)}s → ${durationAfter.toFixed(1)}s`);

  const identical = !added.length && !removed.length && !modified.length && !markersAdded && !markersRemoved && !settingsChanged.length && !rulesChanged && !stylePackChanged && tacksAdded === 0;

  return {
    added, removed, modified, markersAdded, markersRemoved, tacksAdded,
    settingsChanged, rulesChanged, stylePackChanged, durationBefore, durationAfter,
    summary: identical ? 'No changes.' : parts.join(' · '),
    identical,
  };
}