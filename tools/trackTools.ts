/**
 * Track management for the assistant: add, update, duplicate or delete a
 * track. Duplicate copies every clip on the track (effects, keyframes and
 * fades included) as one undo step.
 */
import { uid, type Action, type Clip, type Track } from '../engine';
import type { ToolContext, ToolResult } from './cutTools';

export type TrackOperation = 'add' | 'update' | 'duplicate' | 'delete';

export interface ManageTrackParams {
  operation: TrackOperation;
  track_id?: string;
  kind?: Track['kind'];
  name?: string;
  index?: number;
  muted?: boolean;
  solo?: boolean;
  locked?: boolean;
  hidden?: boolean;
  height?: number;
}

const findTrack = (ctx: ToolContext, rawId: string | undefined) => {
  const id = String(rawId ?? '').trim();
  return ctx.project.tracks.find((t) => t.id === id) ?? ctx.project.tracks.find((t) => t.id.toLowerCase() === id.toLowerCase());
};

export function manageTrack(ctx: ToolContext, params: ManageTrackParams): ToolResult {
  const p = ctx.project;
  const op = params.operation;
  if (op === 'add') {
    const kind = params.kind ?? 'video';
    const count = p.tracks.filter((t) => t.kind === kind).length + 1;
    const name = params.name?.trim() || `${kind === 'video' ? 'V' : kind === 'audio' ? 'A' : 'T'}${count}`;
    const id = uid('trk');
    const index = params.index === undefined ? undefined : Math.max(0, Math.min(p.tracks.length, Number(params.index)));
    return {
      actions: [{ type: 'add_track', track: { id, kind, name }, index }],
      summary: `Added ${kind} track “${name}”.`,
      stats: { trackId: id, kind },
    };
  }

  const track = findTrack(ctx, params.track_id);
  if (!track) return { actions: [], summary: `No track with id “${params.track_id}”.`, warnings: ['Read the TRACKS block and use the exact track id.'] };

  if (op === 'update') {
    const patch: Partial<Pick<Track, 'name' | 'locked' | 'muted' | 'hidden' | 'solo' | 'height'>> = {};
    if (params.name !== undefined) patch.name = String(params.name).trim() || track.name;
    if (params.muted !== undefined) patch.muted = !!params.muted;
    if (params.solo !== undefined) patch.solo = !!params.solo;
    if (params.locked !== undefined) patch.locked = !!params.locked;
    if (params.hidden !== undefined) patch.hidden = !!params.hidden;
    if (params.height !== undefined) patch.height = Math.max(32, Math.min(160, Number(params.height)));
    if (!Object.keys(patch).length) return { actions: [], summary: 'Nothing to update — pass name, muted, solo, locked, hidden or height.' };
    return {
      actions: [{ type: 'set_track', trackId: track.id, patch }],
      summary: `Updated track “${track.name}”: ${Object.keys(patch).join(', ')}.`,
      stats: { trackId: track.id },
    };
  }

  if (op === 'duplicate') {
    const idx = p.tracks.findIndex((t) => t.id === track.id);
    const newId = uid('trk');
    const clips = p.clips.filter((c) => c.trackId === track.id);
    const actions: Action[] = [{
      type: 'add_track',
      track: { id: newId, kind: track.kind, name: `${track.name} copy`, height: track.height },
      index: idx + 1,
    }];
    for (const c of clips) {
      const copy = JSON.parse(JSON.stringify(c)) as Record<string, unknown> & { trackId: string };
      copy.id = undefined;
      copy.trackId = newId;
      copy.keyframes = (c.keyframes as { id: string }[]).map((k) => ({ ...k, id: undefined }));
      copy.effects = (c.effects as { id: string }[]).map((e) => ({ ...e, id: undefined }));
      actions.push({ type: 'add_clip', clip: copy as unknown as Clip });
    }
    return {
      actions,
      summary: `Duplicated track “${track.name}” with ${clips.length} clip${clips.length === 1 ? '' : 's'}.`,
      stats: { trackId: newId, clips: clips.length },
    };
  }

  const clips = p.clips.filter((c) => c.trackId === track.id).length;
  return {
    actions: [{ type: 'remove_track', trackId: track.id }],
    summary: `Deleted track “${track.name}”${clips ? ` and its ${clips} clip${clips === 1 ? '' : 's'}` : ''}.`,
    stats: { clips },
  };
}
