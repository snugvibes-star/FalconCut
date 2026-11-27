/**
 * Every edit in FalconCut is one of these small action objects.
 * Humans (UI) and AI (tools) both go through applyActions().
 * A list of actions applied together becomes ONE undo step.
 * The ACTION_SCHEMA export below is written for AI models to read.
 */
import { produce } from 'immer';
import {
  Clip, Effect, Keyframe, Lut, Marker, MediaAsset, MediaAnalysis, Project, Rule, SpeedPoint, StylePack, Tack, Track,
  Transform, Transition, TextData, MotifData, DrawingStroke, defaultTransform, defaultTextStyle,
  detUid, enterDeterministicIds, exitDeterministicIds, getMedia, speedAtLocal, speedPointsOf, sourceTimeOf,
} from './types';

export type Action =
  | { type: 'add_media'; asset: MediaAsset }
  | { type: 'add_lut'; lut: Lut }
  | { type: 'remove_lut'; lutId: string }
  | { type: 'remove_media'; mediaId: string }
  | { type: 'add_track'; track: Partial<Track> & { kind: Track['kind'] }; index?: number }
  | { type: 'remove_track'; trackId: string }
  | { type: 'set_track'; trackId: string; patch: Partial<Pick<Track, 'name' | 'locked' | 'muted' | 'hidden' | 'solo' | 'height'>> }
  | { type: 'move_track'; trackId: string; toIndex: number }
  | { type: 'add_clip'; clip: Partial<Clip> & { trackId: string; start: number; duration: number }; ripple?: boolean; /** unique seed so repeated copies never collide on the same generated id */ nonce?: string }
  | { type: 'remove_clip'; clipId: string; ripple?: boolean }
  | { type: 'split_clip'; clipId: string; time: number }
  | { type: 'trim_clip'; clipId: string; start?: number; duration?: number; inPoint?: number }
  | { type: 'move_clip'; clipId: string; start?: number; trackId?: string }
  | { type: 'set_speed'; clipId: string; speed: number }
  | { type: 'set_speed_ramp'; clipId: string; points: SpeedPoint[] }
  | { type: 'set_transform'; clipId: string; patch: Partial<Transform> }
  | { type: 'set_clip_props'; clipId: string; patch: Partial<Pick<Clip, 'volume' | 'fit' | 'label' | 'name' | 'locked' | 'groupId' | 'blendMode' | 'reversed' | 'preservePitch' | 'mask' | 'audioTrackId'>> }
  | { type: 'set_fades'; clipId: string; fadeIn?: number; fadeOut?: number }
  | { type: 'add_effect'; clipId: string; effect: Partial<Effect> & { type: Effect['type'] } }
  | { type: 'remove_effect'; clipId: string; effectId: string }
  | { type: 'set_effect'; clipId: string; effectId: string; params?: Record<string, number | string | boolean>; enabled?: boolean }
  | { type: 'move_effect'; clipId: string; effectId: string; direction: -1 | 1 }
  | { type: 'add_keyframe'; clipId: string; path: string; time: number; value: number; easing?: Keyframe['easing'] }
  | { type: 'update_keyframe'; clipId: string; keyframeId: string; time?: number; value?: number; easing?: Keyframe['easing'] }
  | { type: 'remove_keyframe'; clipId: string; keyframeId: string }
  | { type: 'clear_keyframes'; clipId: string; path?: string }
  | { type: 'add_text'; trackId?: string; start: number; duration: number; text: string; style?: Partial<TextData['style']>; words?: TextData['words']; role?: TextData['role']; source?: TextData['source']; preset?: TextData['style']['preset'] }
  | { type: 'set_text'; clipId: string; text?: string; words?: TextData['words'] }
  | { type: 'set_text_style'; clipId: string; patch: Partial<TextData['style']> }
  | { type: 'add_motif'; trackId?: string; start: number; duration: number; motif: MotifData }
  | { type: 'set_motif'; clipId: string; params: Record<string, number | string> }
  | { type: 'add_drawing'; trackId?: string; start: number; duration: number; strokes: DrawingStroke[]; id?: string }
  | { type: 'set_drawing'; clipId: string; strokes: DrawingStroke[] }
  | { type: 'set_transition'; clipId: string; edge: 'in' | 'out'; transition?: Transition }
  | { type: 'ripple_delete_range'; start: number; end: number; trackIds?: string[]; shiftMarkers?: boolean }
  | { type: 'insert_gap'; time: number; duration: number; trackIds?: string[] }
  | { type: 'group_clips'; clipIds: string[] }
  | { type: 'ungroup'; groupId: string }
  | { type: 'add_marker'; marker: Partial<Marker> & { time: number; label: string } }
  | { type: 'update_marker'; markerId: string; patch: Partial<Pick<Marker, 'time' | 'label' | 'color' | 'kind'>> }
  | { type: 'remove_marker'; markerId: string }
  | { type: 'add_tack'; tack: Partial<Tack> & { time: number; text: string } }
  | { type: 'reply_tack'; tackId: string; author: 'user' | 'ai'; text: string }
  | { type: 'resolve_tack'; tackId: string; resolved: boolean }
  | { type: 'remove_tack'; tackId: string }
  | { type: 'set_transcript'; mediaId: string; transcript: MediaAnalysis['transcript'] }
  | { type: 'set_settings'; patch: Partial<Project['settings']> }
  | { type: 'set_style_pack'; packId: string }
  | { type: 'upsert_pack'; pack: StylePack }
  | { type: 'add_rule'; rule: Partial<Rule> & { text: string; kind: Rule['kind'] } }
  | { type: 'set_rule'; ruleId: string; patch: Partial<Rule> }
  | { type: 'remove_rule'; ruleId: string }
  | { type: 'rename_project'; name: string };

/** Plain-English schema for AI models. Keep descriptions short and concrete. */
export const ACTION_SCHEMA: Record<Action['type'], string> = {
  add_media: 'Register an imported media file (video/audio/image) in the project. Params: asset object.',
  add_lut: 'Register an imported color LUT (.cube). Params: lut object.',
  remove_lut: 'Delete a LUT and every effect that references it. Params: lutId.',
  remove_media: 'Remove a media asset and every clip that uses it. Params: mediaId.',
  add_track: 'Add a timeline track. kind: video | audio | text. Higher video tracks draw on top.',
  remove_track: 'Delete a track and all clips on it.',
  set_track: 'Change track name/locked/muted/hidden.',
  move_track: 'Move a track up or down in the track order.',
  add_clip: 'Place media on a track. start/duration are timeline seconds, inPoint is where to start inside the source file. ripple: true inserts instead of overwriting (following clips shift right).',
  remove_clip: 'Delete a clip. ripple=true also closes the gap on its track.',
  split_clip: 'Cut one clip into two at a timeline time. Both halves keep playing the same source.',
  trim_clip: 'Change a clip start/duration/inPoint. Trimming the left edge moves inPoint to keep the picture stable.',
  move_clip: 'Move a clip to a new timeline start or another track.',
  set_speed: 'Change playback speed (0.25..4). Duration adjusts automatically; pitch is preserved on export. Clears any speed ramp.',
  set_speed_ramp: 'Time remap: piecewise-linear speed curve. points = [{t, speed}] with t in clip-local seconds, speed 0.1..8. Video is truly remapped; audio under a ramp plays at the ramp average speed. Media clips only.',
  set_transform: 'Set position x/y (px from center), scale (1=fit), rotation (deg), opacity (0..1), crop fractions.',
  set_clip_props: 'Set volume (linear gain), fit mode, color label, name, lock, group, blendMode (normal/multiply/screen/overlay/darken/lighten/color-dodge/color-burn/hard-light/soft-light/difference/exclusion/hue/saturation/color/luminosity), reversed (play the source backward), audioTrackId (select one audio language track from the media; omit to use the file default).',
  set_fades: 'Audio+video fade in/out seconds. Tiny 0.015s fades at cuts prevent audio pops.',
  add_effect: 'Add an effect: color, blur, sharpen, vignette, chromaKey, eq, gate, deess, denoise.',
  remove_effect: 'Remove an effect by id.',
  set_effect: 'Update effect params or enable/disable it.',
  move_effect: 'Move an effect one step up/down in the stacking order. Params: clipId, effectId, direction (-1 or 1).',
  add_keyframe: 'Animate a property. path like transform.scale or volume. time is clip-local seconds.',
  update_keyframe: 'Move or edit an existing keyframe. Params: clipId, keyframeId, time?, value?, easing?.',
  remove_keyframe: 'Delete one keyframe.',
  clear_keyframes: 'Remove all keyframes of a clip (optionally only one path).',
  add_text: 'Add a text/caption clip. preset: clean | karaoke | bold-keywords | word-pop. words[] enables karaoke timing.',
  set_text: 'Change text content or word timings of a text clip.',
  set_text_style: 'Change font size (fraction of height), colors, position x/y (0..1), outline, animation.',
  add_motif: 'Add a parameterized motion graphic: title-reveal, lower-third, bar-chart, ring-progress, count-up, burst.',
  set_motif: 'Update motif parameters (text, colors, values, speed...).',
  add_drawing: 'Add an editable drawing overlay layer (brush/pen/highlighter/eraser/line/arrow/rect/rect-round/ellipse/polygon/sticker). strokes = DrawingStroke[] in project pixels; sticker strokes carry char (emoji) and size.',
  set_drawing: 'Replace the strokes of an existing drawing clip (add, erase or reshape strokes in one undo step).',
  set_transition: 'Set transition at clip edge. Omit transition to remove. Types: crossfade, dip-black, dip-white, wipe-left, slide-left, zoom-in, plus blend transitions blend-multiply, blend-screen, blend-overlay, blend-soft-light, blend-hard-light, blend-difference, blend-exclusion, blend-lighten, blend-darken, blend-color-dodge, blend-color-burn, blend-hue, blend-saturation, blend-color, blend-luminosity.',
  ripple_delete_range: 'Delete a time range and close the gap. Affects given tracks (default all) and shifts markers/tacks.',
  insert_gap: 'Insert empty time at a position, pushing later clips right.',
  group_clips: 'Group clips so they move/select together.',
  ungroup: 'Break a clip group so clips move independently again.',
  add_marker: 'Add a timeline marker (kind: user, scene, broll, beat, chapter, retake).',
  update_marker: 'Edit an existing marker: patch any of time, label, color, kind. Params: markerId, patch.',
  remove_marker: 'Delete a timeline marker by its id.',
  add_tack: 'Leave a note pinned to a moment (and optionally a clip) for the human or AI.',
  reply_tack: 'Reply to a tack as the user or the AI.',
  resolve_tack: 'Mark a tack resolved or reopen it.',
  remove_tack: 'Delete a tack and all of its replies.',
  set_transcript: 'Store a local transcription result for a media asset so caption tools can use it. Params: mediaId, transcript.',
  set_settings: 'Change width/height/fps/aspect/background.',
  set_style_pack: 'Switch the active style pack (editing taste preset).',
  upsert_pack: 'Create or update a custom style pack.',
  add_rule: 'Save a permanent editing rule from plain words (e.g. captions always yellow).',
  set_rule: 'Edit or enable/disable a rule.',
  remove_rule: 'Delete a saved editing rule permanently.',
  rename_project: 'Rename the project.',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function normalizeClip(p: Project, partial: Partial<Clip> & { trackId: string; start: number; duration: number }): Clip {
  const media = getMedia(p, partial.mediaId);
  const kind: Clip['kind'] = partial.kind ?? (partial.text ? 'text' : partial.motif ? 'motif' : partial.drawing ? 'drawing' : 'media');
  // Same-track overlap makes media clips invisibly stack under each other (the
  // one drawn later swallows clicks), so a new media clip landing on occupied
  // space is clamped into the nearest free gap instead. Text/motif clips are
  // overlay layers and may legitimately share the text track.
  const dur = Math.max(0.04, partial.duration);
  let start = Math.max(0, partial.start);
  if (kind === 'media') {
    const others = p.clips.filter((c) => c.trackId === partial.trackId).sort((a, b) => a.start - b.start);
    if (others.some((o) => start < o.start + o.duration - 1e-6 && o.start < start + dur - 1e-6)) {
      const gaps: { lo: number; hi: number }[] = [];
      let prevEnd = 0;
      for (const o of others) {
        if (o.start - prevEnd >= dur - 1e-6) gaps.push({ lo: prevEnd, hi: Math.max(prevEnd, o.start - dur) });
        prevEnd = Math.max(prevEnd, o.start + o.duration);
      }
      gaps.push({ lo: prevEnd, hi: Infinity });
      let bestD = Infinity;
      for (const g of gaps) {
        const c = Math.min(Math.max(start, g.lo), g.hi);
        const d = Math.abs(c - start);
        if (d < bestD - 1e-9) { bestD = d; start = c; }
      }
      start = Math.max(0, start);
    }
  }
  return {
    id: partial.id ?? detUid('clip'),
    trackId: partial.trackId,
    mediaId: partial.mediaId,
    kind,
    start,
    duration: dur,
    inPoint: Math.max(0, partial.inPoint ?? 0),
    speed: clamp(partial.speed ?? 1, 0.1, 8),
    transform: { ...defaultTransform(), ...(partial.transform ?? {}) },
    fit: partial.fit ?? 'cover',
    volume: partial.volume ?? 1,
    fades: partial.fades ?? { in: 0, out: 0 },
    effects: (partial.effects ?? []).map((f) => ({ ...f, id: f.id || detUid('fx') })),
    keyframes: (partial.keyframes ?? []).map((k) => ({ ...k, id: k.id || detUid('kf') })),
    text: partial.text,
    motif: partial.motif,
    drawing: partial.drawing,
    speedPoints: partial.speedPoints,
    reversed: partial.reversed ?? false,
    preservePitch: partial.preservePitch,
    audioTrackId: partial.audioTrackId,
    blendMode: partial.blendMode,
    transitionIn: partial.transitionIn,
    transitionOut: partial.transitionOut,
    groupId: partial.groupId,
    label: partial.label,
    locked: partial.locked,
    name: partial.name ?? (media ? media.name : kind === 'text' ? (partial.text?.text ?? '').slice(0, 24) : kind === 'drawing' ? 'Drawing' : 'Motif'),
  };
}

function shiftFollowing(p: Project, trackIds: string[] | null, from: number, delta: number, includeAt: boolean) {
  for (const c of p.clips) {
    if (trackIds && !trackIds.includes(c.trackId)) continue;
    if (includeAt ? c.start >= from - 1e-6 : c.start > from + 1e-6) c.start = Math.max(0, c.start + delta);
  }
}

/** Split a piecewise speed ramp at clip-local `leftDur`: the left half keeps
 * the earlier points plus a boundary point, the right half is re-anchored at
 * 0 with the same boundary speed, so the ramp continues seamlessly. */
function splitSpeedPoints(c: Clip, leftDur: number): { left?: SpeedPoint[]; right?: SpeedPoint[] } {
  const pts = speedPointsOf(c);
  if (!pts) return {};
  const sAt = speedAtLocal(c, leftDur);
  const left = pts.filter((pt) => pt.t < leftDur - 1e-6).map((pt) => ({ ...pt }));
  if (!left.length || left[0].t > 1e-6) left.unshift({ t: 0, speed: pts[0].speed });
  left.push({ t: leftDur, speed: sAt });
  const right = pts.filter((pt) => pt.t > leftDur + 1e-6).map((pt) => ({ t: pt.t - leftDur, speed: pt.speed }));
  right.unshift({ t: 0, speed: sAt });
  return { left, right };
}

/** Apply ONE action, returning a new project (structural sharing via immer). */
export function applyAction(project: Project, action: Action): Project {
  enterDeterministicIds(`${project.id}|${JSON.stringify(action)}`);
  try {
    return produce(project, (p) => {
    const clip = (id: string) => p.clips.find((c) => c.id === id);
    switch (action.type) {
      case 'add_media': {
        if (!p.media.some((m) => m.id === action.asset.id)) p.media.push(action.asset);
        break;
      }
      case 'add_lut': {
        p.luts = p.luts ?? [];
        if (!p.luts.some((l) => l.id === action.lut.id)) p.luts.push(action.lut);
        break;
      }
      case 'remove_lut': {
        p.luts = (p.luts ?? []).filter((l) => l.id !== action.lutId);
        // Effects referencing a removed LUT are dropped so renders never see a dangling id.
        for (const c of p.clips) c.effects = c.effects.filter((e) => !(e.type === 'lut' && e.params.lut === action.lutId));
        break;
      }
      case 'set_transcript': {
        if (!p.analysis) p.analysis = {
          byMedia: {}, settings: { silenceThresholdDb: -38, silenceMinMs: 600 }, storyboard: '', updatedAt: Date.now(),
        };
        const existing = p.analysis.byMedia[action.mediaId];
        p.analysis.byMedia[action.mediaId] = existing ?? {
          mediaId: action.mediaId, duration: 0, silences: [], fillers: [], retakes: [], scenes: [], faces: [],
          faceMethod: 'none', loudness: [], integratedLoudness: 0, truePeak: 0, speechRatio: 0,
          isMusic: false, beats: [], bpm: 0, emphasis: [], keywords: [], analyzedAt: Date.now(), flags: [],
        };
        p.analysis.byMedia[action.mediaId].transcript = action.transcript;
        p.analysis.byMedia[action.mediaId].analyzedAt = Date.now();
        p.analysis.updatedAt = Date.now();
        break;
      }
      case 'remove_media': {
        p.media = p.media.filter((m) => m.id !== action.mediaId);
        p.clips = p.clips.filter((c) => c.mediaId !== action.mediaId);
        if (p.analysis) delete p.analysis.byMedia[action.mediaId];
        break;
      }
      case 'add_track': {
        const t: Track = { id: action.track.id ?? detUid('trk'), kind: action.track.kind, name: action.track.name ?? (action.track.kind === 'video' ? `V${p.tracks.filter((x) => x.kind === 'video').length + 1}` : action.track.kind === 'audio' ? `A${p.tracks.filter((x) => x.kind === 'audio').length + 1}` : 'Text'), locked: false, muted: false, hidden: false };
        if (action.index != null) p.tracks.splice(action.index, 0, t); else p.tracks.unshift(t);
        break;
      }
      case 'remove_track': {
        p.tracks = p.tracks.filter((t) => t.id !== action.trackId);
        p.clips = p.clips.filter((c) => c.trackId !== action.trackId);
        break;
      }
      case 'set_track': {
        const t = p.tracks.find((x) => x.id === action.trackId);
        if (t) Object.assign(t, action.patch);
        break;
      }
      case 'move_track': {
        // Reorder tracks (z-order + track header order). Clips follow their
        // track id, so nothing else has to move.
        const i = p.tracks.findIndex((x) => x.id === action.trackId);
        if (i < 0) break;
        const [t] = p.tracks.splice(i, 1);
        const to = Math.max(0, Math.min(p.tracks.length, Math.round(action.toIndex)));
        p.tracks.splice(to, 0, t);
        break;
      }
      case 'add_clip': {
        // Ripple insert: shift everything on the target track that starts at
        // or after the insert point right by the new clip's duration, so the
        // new clip lands exactly where asked instead of being clamped into a
        // far-away gap. Callers must have split any clip SPANNING the point
        // first (the freeze-frame flow does).
        if (action.ripple) {
          const insDur = Math.max(0.04, action.clip.duration);
          const at = action.clip.start;
          for (const c of p.clips) if (c.trackId === action.clip.trackId && c.start >= at - 1e-6) c.start += insDur;
        }
        p.clips.push(normalizeClip(p, action.clip));
        break;
      }
      case 'remove_clip': {
        const c = clip(action.clipId);
        if (!c) break;
        const { start, duration, trackId } = c;
        p.clips = p.clips.filter((x) => x.id !== action.clipId);
        if (action.ripple) {
          for (const o of p.clips) if (o.trackId === trackId && o.start >= start + duration - 1e-6) o.start = Math.max(0, o.start - duration);
        }
        break;
      }
      case 'split_clip': {
        const c = clip(action.clipId);
        if (!c) break;
        const t = action.time;
        // Guard against undefined/NaN times (bad AI or UI input) — a NaN split
        // would otherwise write a corrupt half-clip into the project.
        if (!Number.isFinite(t)) break;
        if (t <= c.start + 0.02 || t >= c.start + c.duration - 0.02) break;
        const leftDur = t - c.start;
        const right = JSON.parse(JSON.stringify(c)) as Clip;
        right.id = detUid('clip');
        right.start = t;
        right.duration = c.duration - leftDur;
        right.inPoint = c.inPoint; // split anchor — flipped below for reversed
        const srcAtSplit = sourceTimeOf(c, t); // ramp-aware consumed-source split
        if (c.reversed) {
          // Reversed clips anchor at their consumed segment's END (inPoint).
          // The LEFT piece (this clip) takes the mapped source position; the
          // right piece keeps the copied anchor and plays toward it.
          c.inPoint = srcAtSplit;
        } else {
          right.inPoint = srcAtSplit;
        }
        right.fades = { in: 0, out: c.fades.out };
        right.transitionIn = undefined;
        right.keyframes = c.keyframes.filter((k) => k.time >= leftDur - 1e-6).map((k) => ({ ...k, id: detUid('kf'), time: k.time - leftDur }));
        right.speedPoints = splitSpeedPoints(c, leftDur).right;
        if (right.text?.words) right.text.words = right.text.words.filter((w) => w.end > leftDur).map((w) => ({ ...w, start: Math.max(0, w.start - leftDur), end: w.end - leftDur }));
        c.duration = leftDur;
        c.fades = { in: c.fades.in, out: 0 };
        c.transitionOut = undefined;
        c.keyframes = c.keyframes.filter((k) => k.time <= leftDur + 1e-6);
        c.speedPoints = splitSpeedPoints(c, leftDur).left;
        if (c.text?.words) c.text.words = c.text.words.filter((w) => w.start < leftDur);
        p.clips.push(right);
        break;
      }
      case 'trim_clip': {
        const c = clip(action.clipId);
        if (!c) break;
        const media = getMedia(p, c.mediaId);
        if (action.start != null) {
          const delta = action.start - c.start;
          // Forward clips re-anchor at the mapped source position. Reversed
          // clips anchor at the segment end (inPoint), so trimming the head
          // only shortens the run — the anchor must NOT move.
          if (c.kind === 'media' && !c.reversed) c.inPoint = Math.max(0, sourceTimeOf(c, action.start));
          c.start = Math.max(0, action.start);
          c.duration = Math.max(0.04, c.duration - delta);
        }
        if (action.inPoint != null) c.inPoint = Math.max(0, action.inPoint);
        if (action.duration != null) c.duration = Math.max(0.04, action.duration);
        if (media && c.kind === 'media' && media.type !== 'image') {
          const maxDur = (media.duration - c.inPoint) / c.speed;
          c.duration = Math.min(c.duration, Math.max(0.04, maxDur));
        }
        c.keyframes = c.keyframes.filter((k) => k.time <= c.duration + 0.001);
        break;
      }
      case 'move_clip': {
        const c = clip(action.clipId);
        if (!c) break;
        if (action.start != null) c.start = Math.max(0, action.start);
        if (action.trackId) {
          const target = p.tracks.find((t) => t.id === action.trackId);
          // Compat rule (matches the Timeline drag check): audio assets only
          // on audio tracks, video/image on video tracks, text/motif on text.
          const wantKind = c.kind === 'media'
            ? (getMedia(p, c.mediaId)?.type === 'audio' ? 'audio' : 'video')
            : 'text'; // text/motif/drawing are overlay layers
          if (target && target.kind === wantKind) c.trackId = action.trackId;
        }
        break;
      }
      case 'set_speed': {
        const c = clip(action.clipId);
        if (!c || c.kind !== 'media') break;
        const speed = clamp(action.speed, 0.1, 8);
        // Ramp-aware: the source the clip consumes today (under any ramp).
        const usedSource = sourceTimeOf(c, c.start + c.duration) - c.inPoint;
        const ratio = usedSource / (c.duration * speed);
        c.speed = speed;
        c.duration = usedSource / speed;
        c.speedPoints = undefined; // a constant speed replaces the ramp
        for (const k of c.keyframes) k.time *= ratio;
        if (c.text?.words) for (const w of c.text.words) { w.start *= ratio; w.end *= ratio; }
        c.fades = { in: c.fades.in * ratio, out: c.fades.out * ratio };
        break;
      }
      case 'set_speed_ramp': {
        const c = clip(action.clipId);
        if (!c || c.kind !== 'media') break;
        const pts = [...action.points]
          .filter((pt) => Number.isFinite(pt.t) && Number.isFinite(pt.speed) && pt.t >= 0)
          .sort((a, b) => a.t - b.t)
          .map((pt) => ({ t: pt.t, speed: clamp(pt.speed, 0.1, 8) }));
        c.speedPoints = pts.length ? pts : undefined;
        break;
      }
      case 'set_transform': {
        const c = clip(action.clipId);
        if (c) Object.assign(c.transform, action.patch);
        break;
      }
      case 'set_clip_props': {
        const c = clip(action.clipId);
        if (!c) break;
        const patch = { ...action.patch };
        // An AI/tool action can supply a stale or fabricated track id. An
        // invalid id would make preview silent and abort export, so drop it.
        if ('audioTrackId' in patch && patch.audioTrackId != null) {
          const asset = getMedia(p, c.mediaId);
          if (!asset?.audioTracks?.some((t) => t.id === patch.audioTrackId)) delete patch.audioTrackId;
        }
        Object.assign(c, patch);
        break;
      }
      case 'set_fades': {
        const c = clip(action.clipId);
        if (!c) break;
        if (action.fadeIn != null) c.fades.in = clamp(action.fadeIn, 0, c.duration / 2);
        if (action.fadeOut != null) c.fades.out = clamp(action.fadeOut, 0, c.duration / 2);
        break;
      }
      case 'add_effect': {
        const c = clip(action.clipId);
        if (c) c.effects.push({ id: action.effect.id ?? detUid('fx'), type: action.effect.type, enabled: action.effect.enabled ?? true, params: action.effect.params ?? {} });
        break;
      }
      case 'remove_effect': {
        const c = clip(action.clipId);
        if (c) {
          c.effects = c.effects.filter((e) => e.id !== action.effectId);
          c.keyframes = c.keyframes.filter((k) => !k.path.startsWith(`effects.${action.effectId}.`));
        }
        break;
      }
      case 'set_effect': {
        const c = clip(action.clipId);
        const e = c?.effects.find((x) => x.id === action.effectId);
        if (e) {
          if (action.params) Object.assign(e.params, action.params);
          if (action.enabled != null) e.enabled = action.enabled;
        }
        break;
      }
      case 'move_effect': {
        const c = clip(action.clipId);
        if (c) {
          const i = c.effects.findIndex((x) => x.id === action.effectId);
          const j = i + action.direction;
          if (i >= 0 && j >= 0 && j < c.effects.length) {
            [c.effects[i], c.effects[j]] = [c.effects[j], c.effects[i]];
          }
        }
        break;
      }
      case 'add_keyframe': {
        const c = clip(action.clipId);
        if (!c) break;
        const existing = c.keyframes.find((k) => k.path === action.path && Math.abs(k.time - action.time) < 0.005);
        if (existing) { existing.value = action.value; existing.easing = action.easing ?? existing.easing; }
        else c.keyframes.push({ id: detUid('kf'), path: action.path, time: clamp(action.time, 0, c.duration), value: action.value, easing: action.easing ?? 'easeInOut' });
        break;
      }
      case 'update_keyframe': {
        const c = clip(action.clipId);
        const k = c?.keyframes.find((x) => x.id === action.keyframeId);
        if (k) {
          if (action.time != null) k.time = Math.max(0, action.time);
          if (action.value != null) k.value = action.value;
          if (action.easing) k.easing = action.easing;
        }
        break;
      }
      case 'remove_keyframe': {
        const c = clip(action.clipId);
        if (c) c.keyframes = c.keyframes.filter((k) => k.id !== action.keyframeId);
        break;
      }
      case 'clear_keyframes': {
        const c = clip(action.clipId);
        if (c) c.keyframes = action.path ? c.keyframes.filter((k) => k.path !== action.path) : [];
        break;
      }
      case 'add_text': {
        const trackId = action.trackId ?? p.tracks.find((t) => t.kind === 'text' && !t.locked)?.id ?? p.tracks.find((t) => t.kind === 'text')?.id;
        if (!trackId) break;
        const preset = action.preset ?? 'clean';
        const style = { ...defaultTextStyle(preset), ...(action.style ?? {}) };
        p.clips.push(normalizeClip(p, {
          trackId, start: action.start, duration: action.duration, kind: 'text',
          text: { text: action.text, style, words: action.words, role: action.role ?? 'caption', source: action.source },
        }));
        break;
      }
      case 'set_text': {
        const c = clip(action.clipId);
        if (c?.text) {
          if (action.text != null) c.text.text = action.text;
          if (action.words != null) c.text.words = action.words;
        }
        break;
      }
      case 'set_text_style': {
        const c = clip(action.clipId);
        if (c?.text) Object.assign(c.text.style, action.patch);
        break;
      }
      case 'add_motif': {
        const trackId = action.trackId ?? p.tracks.find((t) => t.kind === 'text')?.id ?? p.tracks.find((t) => t.kind === 'video')?.id;
        if (!trackId) break;
        p.clips.push(normalizeClip(p, { trackId, start: action.start, duration: action.duration, kind: 'motif', motif: action.motif, name: action.motif.type }));
        break;
      }
      case 'set_motif': {
        const c = clip(action.clipId);
        if (c?.motif) Object.assign(c.motif.params, action.params);
        break;
      }
      case 'add_drawing': {
        const trackId = action.trackId ?? p.tracks.find((t) => t.kind === 'text' && !t.locked)?.id ?? p.tracks.find((t) => t.kind === 'text')?.id ?? p.tracks.find((t) => t.kind === 'video')?.id;
        if (!trackId) break;
        p.clips.push(normalizeClip(p, { trackId, start: action.start, duration: action.duration, kind: 'drawing', drawing: { strokes: action.strokes }, id: action.id, name: 'Drawing' }));
        break;
      }
      case 'set_drawing': {
        const c = clip(action.clipId);
        if (c?.drawing) c.drawing = { strokes: action.strokes };
        else if (c) c.drawing = { strokes: action.strokes };
        break;
      }
      case 'set_transition': {
        const c = clip(action.clipId);
        if (!c) break;
        if (action.edge === 'in') c.transitionIn = action.transition;
        else c.transitionOut = action.transition;
        break;
      }
      case 'ripple_delete_range': {
        const { start, end } = action;
        const len = end - start;
        if (len <= 0) break;
        const ids = action.trackIds ?? null;
        for (const c of [...p.clips]) {
          if (ids && !ids.includes(c.trackId)) continue;
          const cEnd = c.start + c.duration;
          if (cEnd <= start + 1e-6 || c.start >= end - 1e-6) continue;
          if (c.start >= start - 1e-6 && cEnd <= end + 1e-6) {
            p.clips = p.clips.filter((x) => x.id !== c.id);
          } else if (c.start < start && cEnd > end) {
            // range strictly inside clip: split out the middle
            const right = JSON.parse(JSON.stringify(c)) as Clip;
            right.id = detUid('clip');
            const leftDur = start - c.start;
            right.start = start; // will shift below
            right.duration = cEnd - end;
            right.inPoint = c.inPoint; // split anchor — flipped below for reversed
            const srcAtEnd = sourceTimeOf(c, end); // ramp-aware consumed-source split
            const srcAtStart = sourceTimeOf(c, start);
            if (c.reversed) {
              // Reversed: left/middle piece anchors at the mapped position;
              // the right piece keeps the copied end anchor.
              c.inPoint = srcAtStart;
            } else {
              right.inPoint = srcAtEnd;
            }
            right.keyframes = c.keyframes.filter((k) => k.time >= end - c.start).map((k) => ({ ...k, id: detUid('kf'), time: k.time - (end - c.start) }));
            right.speedPoints = splitSpeedPoints(c, start - c.start).right;
            right.fades = { in: 0.015, out: c.fades.out };
            right.transitionIn = undefined;
            c.duration = leftDur;
            c.fades = { in: c.fades.in, out: 0.015 };
            c.transitionOut = undefined;
            c.keyframes = c.keyframes.filter((k) => k.time <= leftDur);
            c.speedPoints = splitSpeedPoints(c, leftDur).left;
            p.clips.push(right);
          } else if (c.start < start) {
            c.duration = start - c.start;
            c.fades.out = Math.min(c.fades.out || 0.015, c.duration / 2);
            c.keyframes = c.keyframes.filter((k) => k.time <= c.duration);
          } else {
            // Head-shave: for forward clips advance inPoint past the cut; for
            // reversed clips the end anchor is `inPoint` itself — untouched.
            const srcCut = c.kind === 'media' && !c.reversed ? sourceTimeOf(c, end) - c.inPoint : 0;
            const cut = end - c.start;
            c.start = start;
            c.duration = cEnd - end;
            if (c.kind === 'media' && !c.reversed) c.inPoint += srcCut;
            c.fades.in = Math.min(c.fades.in || 0.015, c.duration / 2);
            c.keyframes = c.keyframes.filter((k) => k.time >= cut).map((k) => ({ ...k, time: k.time - cut }));
          }
        }
        shiftFollowing(p, ids, end, -len, true);
        if (action.shiftMarkers !== false) {
          p.markers = p.markers.filter((m) => m.time < start || m.time >= end);
          for (const m of p.markers) if (m.time >= end) m.time -= len;
          for (const t of p.tacks) if (t.time >= end) t.time = Math.max(start, t.time - len);
          p.tacks = p.tacks.filter((t) => t.time < start || t.time >= end);
        }
        break;
      }
      case 'insert_gap': {
        shiftFollowing(p, action.trackIds ?? null, action.time, action.duration, true);
        for (const m of p.markers) if (m.time >= action.time) m.time += action.duration;
        for (const t of p.tacks) if (t.time >= action.time) t.time += action.duration;
        break;
      }
      case 'group_clips': {
        const gid = detUid('grp');
        for (const c of p.clips) if (action.clipIds.includes(c.id)) c.groupId = gid;
        break;
      }
      case 'ungroup': {
        for (const c of p.clips) if (c.groupId === action.groupId) c.groupId = undefined;
        break;
      }
      case 'add_marker': {
        p.markers.push({ id: action.marker.id ?? detUid('mk'), time: action.marker.time, label: action.marker.label, color: action.marker.color ?? '#38BDF8', kind: action.marker.kind ?? 'user' });
        break;
      }
      case 'update_marker': {
        const m = p.markers.find((x) => x.id === action.markerId);
        if (m) {
          if (action.patch.time !== undefined && Number.isFinite(action.patch.time)) m.time = Math.max(0, action.patch.time);
          if (action.patch.label !== undefined) m.label = action.patch.label;
          if (action.patch.color !== undefined) m.color = action.patch.color;
          if (action.patch.kind !== undefined) m.kind = action.patch.kind;
        }
        break;
      }
      case 'remove_marker': {
        p.markers = p.markers.filter((m) => m.id !== action.markerId);
        break;
      }
      case 'add_tack': {
        p.tacks.push({ id: action.tack.id ?? detUid('tack'), time: action.tack.time, clipId: action.tack.clipId, author: action.tack.author ?? 'user', text: action.tack.text, replies: [], resolved: false, createdAt: Date.now() });
        break;
      }
      case 'reply_tack': {
        const t = p.tacks.find((x) => x.id === action.tackId);
        if (t) t.replies.push({ author: action.author, text: action.text, at: Date.now() });
        break;
      }
      case 'resolve_tack': {
        const t = p.tacks.find((x) => x.id === action.tackId);
        if (t) t.resolved = action.resolved;
        break;
      }
      case 'remove_tack': {
        p.tacks = p.tacks.filter((t) => t.id !== action.tackId);
        break;
      }
      case 'set_settings': {
        Object.assign(p.settings, action.patch);
        break;
      }
      case 'set_style_pack': {
        p.stylePackId = action.packId;
        break;
      }
      case 'upsert_pack': {
        const i = p.customPacks.findIndex((x) => x.id === action.pack.id);
        if (i >= 0) p.customPacks[i] = action.pack; else p.customPacks.push(action.pack);
        break;
      }
      case 'add_rule': {
        p.rules.push({ id: action.rule.id ?? detUid('rule'), text: action.rule.text, kind: action.rule.kind, value: action.rule.value, enabled: action.rule.enabled ?? true, origin: action.rule.origin ?? 'user', createdAt: Date.now() });
        break;
      }
      case 'set_rule': {
        const r = p.rules.find((x) => x.id === action.ruleId);
        if (r) Object.assign(r, action.patch);
        break;
      }
      case 'remove_rule': {
        p.rules = p.rules.filter((r) => r.id !== action.ruleId);
        break;
      }
      case 'rename_project': {
        p.name = action.name;
        break;
      }
    }
    p.updatedAt = Date.now();
    });
  } finally {
    exitDeterministicIds();
  }
}

/** Apply a group of actions as ONE undo step (caller manages history). */
export function applyActions(project: Project, actions: Action[]): Project {
  let p = project;
  for (const a of actions) p = applyAction(p, a);
  return p;
}

/** Validate actions against the current project; returns errors (empty = ok). */
export function validateActions(project: Project, actions: Action[]): string[] {
  const errors: string[] = [];
  let p = project;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (!ACTION_SCHEMA[a.type]) { errors.push(`action ${i}: unknown type ${a.type}`); continue; }
    if ('clipId' in a && !p.clips.some((c) => c.id === (a as { clipId: string }).clipId)) {
      // clip may be created earlier in this same group
      const createdEarlier = actions.slice(0, i).some((x) => x.type === 'add_clip' && x.clip.id === (a as { clipId: string }).clipId);
      if (!createdEarlier && a.type !== 'split_clip') errors.push(`action ${i} (${a.type}): clip ${(a as { clipId: string }).clipId} not found`);
    }
    try { p = applyAction(p, a); } catch (e) { errors.push(`action ${i} (${a.type}): ${(e as Error).message}`); }
  }
  return errors;
}