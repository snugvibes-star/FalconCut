/**
 * FalconCut project schema. The ENTIRE project is this one JSON document.
 * Any AI can read it, and every change happens through engine/actions.ts.
 * All times are seconds. Timeline time = position in the final video.
 * Source time (inPoint) = position inside the original media file.
 */

export type Aspect = '16:9' | '9:16' | '1:1' | '4:5';
export type TrackKind = 'video' | 'audio' | 'text';
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'easeOutBack' | 'easeOutExpo';

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  aspect: Aspect;
  background: string;
  sampleRate: number;
}

export interface GeneratorSpec {
  kind: 'gradient' | 'particles' | 'waves' | 'solid';
  colors: string[];
  speed: number;
  seed: number;
  label?: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image' | 'generator';
  duration: number; // images: still duration used by default (e.g. 5)
  width: number;
  height: number;
  hasAudio: boolean;
  /** IndexedDB blob key for file media; absent for generators. */
  blobKey?: string;
  mime?: string;
  size?: number;
  generator?: GeneratorSpec;
  thumbnail?: string; // dataURL
  tags?: string[];
  source: 'file' | 'demo' | 'stock' | 'reference';
}

export interface Transform {
  x: number; // px offset from center at project resolution
  y: number;
  scale: number; // 1 = cover-fit
  rotation: number; // degrees
  /** Skew in degrees (true 2D affine shear). skewX slants horizontally as y
   * grows; skewY slants vertically as x grows. 0 = none. */
  skewX: number;
  skewY: number;
  opacity: number; // 0..1
  cropL: number; // 0..0.45 fractions of source
  cropR: number;
  cropT: number;
  cropB: number;
}

export type EffectType =
  | 'color' | 'blur' | 'sharpen' | 'vignette' | 'chromaKey' | 'negate' | 'normalize' | 'lut'
  | 'eq' | 'gate' | 'deess' | 'denoise' | 'compressor' | 'limiter' | 'echo' | 'pan';

/** Canvas globalCompositeOperation blend modes, 1:1 with the CSS list. */
export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
export const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export interface Keyframe {
  id: string;
  /** Property path: transform.x|y|scale|rotation|opacity, volume, effects.<id>.<param> */
  path: string;
  time: number; // clip-local seconds
  value: number;
  easing: Easing;
}

export interface Fades { in: number; out: number }

export interface WordStyle {
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  opacity?: number;
  letterSpacing?: number;
  outlineColor?: string;
  outlineWidth?: number;
  shadow?: boolean;
  bgColor?: string;
  highlightColor?: string;
}

export interface CaptionWord { w: string; start: number; end: number; keyword?: boolean; filler?: boolean; style?: WordStyle; timingEstimated?: boolean }

export type CaptionStyleId = 'clean' | 'karaoke' | 'bold-keywords' | 'word-pop';

/** Word-highlight transition styles used by the caption studio. */
export type HighlightAnim = 'instant' | 'slide' | 'pop' | 'scale' | 'fade' | 'wipe' | 'color' | 'bar' | 'glitch';

export type TextAnimationType = 'none' | 'fade' | 'pop' | 'typewriter' | 'slide' | 'bounce' | 'zoom' | 'blur' | 'glitch' | 'wave' | 'shake' | 'karaoke';

export interface TextAnimation {
  type: TextAnimationType;
  unit?: 'text' | 'word' | 'character';
  duration?: number; // seconds for the whole phase (loop: one cycle)
  delay?: number; // seconds from clip start, or before clip end for out
  stagger?: number; // seconds between units; fitted inside duration
  easing?: Easing;
  amount?: number; // intensity multiplier, default 1
  direction?: 'left' | 'right' | 'up' | 'down'; // slide motion direction
}

export interface TextPoint { x: number; y: number } // project-normalized coordinates
export type TextPath =
  | { type: 'arc'; center: TextPoint; radius: number; startAngle: number; endAngle: number; offset?: number }
  | { type: 'polyline'; points: TextPoint[]; offset?: number };
// Arc radius is a fraction of min(project width, height); angles are degrees.
// Path offset is a fraction of path length; glyphs follow the tangent. No cubic paths.

export interface TextStyle {
  preset: CaptionStyleId;
  fontFamily: string;
  fontStyle?: 'normal' | 'italic';
  caseMode?: 'none' | 'upper' | 'lower';
  fontSize: number; // fraction of project height, e.g. 0.045
  fontWeight: number;
  color: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number; // fraction of font size
  bgColor: string; // 'transparent' or rgba
  bgPadding: number;
  align: 'left' | 'center' | 'right';
  x: number; // 0..1 anchor of text block center
  y: number; // 0..1
  maxLines: number;
  maxWidth: number; // fraction of project width
  animation: 'none' | 'pop' | 'fade' | 'rise' | 'typewriter' | 'slide' | 'bounce' | 'zoom' | 'blur' | 'glitch' | 'wave' | 'shake' | 'pulse' | 'fade-in' | 'fade-out';
  shadow: boolean;
  uppercase: boolean;
  letterSpacing: number;
  // Blur & Glow effects
  glow: { enabled: boolean; color: string; radius: number; intensity: number };
  blur: { enabled: boolean; amount: number; direction: 'left' | 'right' | 'up' | 'down'; edgeSoftness: number };
  backgroundBlur: number; // blur behind the text block
  textOpacity: number; // 0..1 overall text opacity override
  sharpness: number; // 0..1 sharpness multiplier
  // Motion / animation config (applied to clip-level)
  motion: { type: 'none' | 'fade' | 'pop' | 'slide' | 'bounce' | 'zoom' | 'typewriter' | 'continuous'; duration?: number; delay?: number; easing?: Easing; speed?: number; direction?: 'left' | 'right' | 'up' | 'down'; loop?: boolean };
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  /** Name of the visual caption preset this style came from (editable after applying). */
  presetId?: string;
  /** Reveal one word at a time using each word's own start time (speech sync). */
  revealWords: boolean;
  /** Extra spacing between words, fraction of a normal space (1 = default). */
  wordSpacing: number;
  /** Line height multiplier (1.22 default). */
  lineSpacing: number;
  /** Active-word highlight configuration. All fields are persisted in the project. */
  highlight: {
    enabled: boolean;
    anim: HighlightAnim;
    bgColor: string;
    textColor: string;
    padding: number; // fraction of font size
    radius: number; // fraction of font size
    opacity: number; // 0..1
    speed: number; // transition seconds
    glow: number; // glow blur in font-size fractions
    shadow: number; // drop-shadow blur in font-size fractions
    prevColor?: string; // styling of the previously spoken word
    nextColor?: string; // styling of the upcoming word
    offset?: number; // shift highlight timing relative to speech (seconds)
  };
}

export interface TextData {
  text: string;
  style: TextStyle;
  words?: CaptionWord[]; // clip-local times, for karaoke / word-pop
  role: 'caption' | 'title' | 'hook';
}

export type MotifType = 'title-reveal' | 'lower-third' | 'bar-chart' | 'ring-progress' | 'count-up' | 'burst';

export interface MotifData {
  type: MotifType;
  params: Record<string, number | string>;
}

export type TransitionType =
  | 'crossfade' | 'dip-black' | 'dip-white' | 'wipe-left' | 'slide-left' | 'zoom-in'
  // Blend transitions: the incoming clip is composited over the previous clip
  // with the named globalCompositeOperation (1:1 with canvas blend modes).
  | 'blend-multiply' | 'blend-screen' | 'blend-overlay' | 'blend-soft-light'
  | 'blend-hard-light' | 'blend-difference' | 'blend-exclusion' | 'blend-lighten'
  | 'blend-darken' | 'blend-color-dodge' | 'blend-color-burn'
  | 'blend-hue' | 'blend-saturation' | 'blend-color' | 'blend-luminosity';

export interface Transition {
  type: TransitionType;
  duration: number;
}

/** One point of a speed ramp: `t` is clip-local seconds, `speed` the effective
 * multiplier there. Between points the speed interpolates LINEARLY (true
 * time-remap); before the first / after the last point the edge speed holds. */
export interface SpeedPoint { t: number; speed: number }

export type DrawTool =
  | 'brush' | 'pen' | 'highlighter' | 'eraser'
  | 'line' | 'arrow' | 'rect' | 'rect-round' | 'ellipse' | 'polygon'
  | 'sticker';

/** One drawing primitive, in PROJECT pixels (1920×1080 space for 16:9). A
 * drawing clip is an independent overlay layer — strokes are never burned
 * into the underlying video. `color` doubles as the sticker text color and
 * `char` carries the sticker glyph (emoji). */
export interface DrawingStroke {
  tool: DrawTool;
  points: [number, number][];
  color: string;
  size: number; // stroke width in px (sticker: font size in px)
  opacity: number; // 0..1
  fill?: string; // shape fill; omit or 'none' = outline only
  radius?: number; // corner radius for rect-round
  char?: string; // sticker glyph
}

export interface DrawingData { strokes: DrawingStroke[] }

export interface Clip {
  id: string;
  trackId: string;
  mediaId?: string; // absent for text/motif/drawing clips
  kind: 'media' | 'text' | 'motif' | 'drawing';
  start: number; // timeline
  duration: number; // timeline
  inPoint: number; // source
  speed: number;
  /** Speed ramp (time remap). When present it overrides `speed` between its
   * points; video rendering + preview use the true piecewise map. */
  speedPoints?: SpeedPoint[];
  /** Play the consumed source segment BACKWARD (ends at `inPoint`). The
   * preview scrubs the element (browsers cannot play a video element
   * backward); the audio graph plays a genuinely reversed buffer. */
  reversed?: boolean;
  /** Keep the original pitch when the clip speed is changed (preview + export). */
  preservePitch?: boolean;
  /** Blend mode of this layer against everything under it (canvas
   * globalCompositeOperation). 'normal'/absent = plain over. */
  blendMode?: BlendMode;
  transform: Transform;
  fit: 'cover' | 'contain' | 'fill';
  volume: number; // linear gain 0..4
  fades: Fades;
  effects: Effect[];
  keyframes: Keyframe[];
  text?: TextData;
  motif?: MotifData;
  drawing?: DrawingData;
  transitionIn?: Transition;
  transitionOut?: Transition;
  groupId?: string;
  label?: string; // color label for organization
  locked?: boolean;
  name?: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  /** Solo this track's audio: when any track of a kind is soloed, only soloed tracks of that kind are heard. */
  solo?: boolean;
  height?: number;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
  kind: 'user' | 'scene' | 'broll' | 'beat' | 'chapter' | 'retake';
}

export interface TackReply { author: 'user' | 'ai'; text: string; at: number }

export interface Tack {
  id: string;
  time: number;
  clipId?: string;
  author: 'user' | 'ai';
  text: string;
  replies: TackReply[];
  resolved: boolean;
  createdAt: number;
}

/* ---------------- Analysis (Phase 2) ---------------- */

export interface TranscriptWord { word: string; start: number; end: number; conf?: number; estimated?: boolean }
export interface TranscriptSegment { start: number; end: number; text: string; words: TranscriptWord[]; speaker?: string }
export interface SilenceSpan { start: number; end: number }
export interface FillerHit { start: number; end: number; text: string; wordIndices: [number, number] }
export interface RetakeGroup { attempts: { start: number; end: number; text: string }[]; bestIndex: number; start: number; end: number }
export interface FaceSample { t: number; x: number; y: number; w: number; h: number; conf: number }
export interface LoudnessPoint { t: number; rms: number; peak: number }

export interface MediaAnalysis {
  mediaId: string;
  duration: number;
  transcript?: { segments: TranscriptSegment[]; words: TranscriptWord[]; language?: string; model: string; complete: boolean };
  silences: SilenceSpan[];
  fillers: FillerHit[];
  retakes: RetakeGroup[];
  scenes: number[]; // cut times in source seconds
  faces: FaceSample[];
  faceMethod: 'FaceDetector' | 'skin-heuristic' | 'none';
  loudness: LoudnessPoint[]; // 10 Hz envelope
  integratedLoudness: number; // ~LUFS (K-weighted, gated)
  truePeak: number;
  speechRatio: number; // 0..1 fraction classified as speech
  isMusic: boolean;
  beats: number[]; // beat times
  bpm: number;
  emphasis: number[]; // source times of emphasized moments
  keywords: string[];
  analyzedAt: number;
  flags: string[]; // honest notes, e.g. 'transcript-pending'
}

export interface Analysis {
  byMedia: Record<string, MediaAnalysis>;
  settings: { silenceThresholdDb: number; silenceMinMs: number };
  storyboard: string;
  updatedAt: number;
}

/* ---------------- Style packs & rules (Phase 4) ---------------- */

export interface StylePack {
  id: string;
  name: string;
  videoType: string;
  description: string;
  builtIn: boolean;
  pacing: { avgShotSec: number; maxStaticSec: number; deadAirMaxMs: number; breathKeepMs: number };
  captions: { enabled: boolean; style: CaptionStyleId; color: string; highlightColor: string; fontSize: number; y: number; maxCharsPerLine: number; safeMargin: number };
  zoom: { enabled: boolean; maxScale: number; minIntervalSec: number; durationSec: number };
  transitions: { enabled: boolean; style: Transition['type']; maxPerMinute: number; durationSec: number };
  music: { level: number; duckLevel: number; duckAttackMs: number; duckReleaseMs: number };
  audio: { targetLoudness: number; gateThresholdDb: number };
  color: string; // preset name
  hook: { enabled: boolean; maxSec: number; fontSize: number };
  broll: { enabled: boolean; minStretchSec: number };
  donts: string[];
}

export interface Rule {
  id: string;
  text: string; // original plain-words note
  kind: 'caption-color' | 'caption-y' | 'caption-size' | 'max-zoom' | 'no-zoom' | 'no-transitions' | 'music-level' | 'color-preset' | 'caption-style' | 'no-captions' | 'dead-air' | 'note';
  value?: string | number;
  enabled: boolean;
  origin: 'user' | 'learned';
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  schemaVersion: 1;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  media: MediaAsset[];
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  tacks: Tack[];
  /** Imported color LUTs (.cube). Table is size³ RGB float triples flattened
   * (red fastest), serialized as plain numbers so project JSON round-trips. */
  luts?: Lut[];
  analysis?: Analysis;
  stylePackId: string;
  customPacks: StylePack[];
  rules: Rule[];
}

/** A 3D color LUT parsed from a .cube file. */
export interface Lut {
  id: string;
  name: string;
  /** LUT_3D_SIZE (cube edge length, typically 17/33/65). */
  size: number;
  /** size³ × 3 floats, red fastest (matches .cube row order). */
  table: number[];
}

/* ---------------- Defaults ---------------- */

export const ASPECT_SIZES: Record<Aspect, [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
};

export const defaultTransform = (): Transform => ({ x: 0, y: 0, scale: 1, rotation: 0, skewX: 0, skewY: 0, opacity: 1, cropL: 0, cropR: 0, cropT: 0, cropB: 0 });

export const defaultTextStyle = (preset: CaptionStyleId = 'clean'): TextStyle => ({
  preset,
  fontFamily: 'Inter Variable',
  fontStyle: 'normal',
  caseMode: 'none',
  fontSize: preset === 'word-pop' ? 0.075 : 0.046,
  fontWeight: 800,
  color: '#FFFFFF',
  highlightColor: '#C6F24E',
  outlineColor: '#000000',
  outlineWidth: 0.035,
  bgColor: preset === 'clean' ? 'rgba(0,0,0,0.45)' : 'transparent',
  bgPadding: 0.35,
  align: 'center',
  x: 0.5,
  y: preset === 'word-pop' ? 0.5 : 0.8,
  maxLines: 2,
  maxWidth: 0.86,
  animation: preset === 'word-pop' ? 'pop' : 'none',
  shadow: true,
  uppercase: preset === 'word-pop' || preset === 'bold-keywords',
  letterSpacing: 0,
  glow: { enabled: false, color: '#00FFFF', radius: 0.08, intensity: 0.5 },
  blur: { enabled: false, amount: 0.03, direction: 'right', edgeSoftness: 0.5 },
  backgroundBlur: 0,
  textOpacity: 1,
  sharpness: 1,
  motion: { type: 'none', duration: 0.4, delay: 0, easing: 'easeOut', speed: 1, direction: 'up', loop: false },
  presetId: 'default',
  revealWords: false,
  wordSpacing: 1,
  lineSpacing: 1.22,
  highlight: {
    enabled: false,
    anim: 'instant',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    padding: 0.18,
    radius: 0.12,
    opacity: 0.9,
    speed: 0.12,
    glow: 0,
    shadow: 0,
    offset: 0,
  },
});

let uidCounter = 0;
export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Deterministic ID mode: while applying an action, IDs created internally
 * (split halves, ripple remainders, default clip ids) are derived from the
 * action content + project id. Replaying the same actions on the same
 * project therefore produces IDENTICAL ids — preview, undo and AI action
 * groups stay consistent.
 */
let detState: { rnd: () => number; n: number } | null = null;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function enterDeterministicIds(seedStr: string) {
  let a = fnv1a(seedStr);
  const rnd = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  detState = { rnd, n: 0 };
}

export function exitDeterministicIds() { detState = null; }

export function detUid(prefix = 'id'): string {
  if (!detState) return uid(prefix);
  return `${prefix}_d${Math.floor(detState.rnd() * 1e12).toString(36)}${(detState.n++).toString(36)}`;
}

export function createProject(name = 'Untitled project', aspect: Aspect = '16:9'): Project {
  const [w, h] = ASPECT_SIZES[aspect];
  const now = Date.now();
  return {
    id: uid('proj'),
    name,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    settings: { width: w, height: h, fps: 30, aspect, background: '#000000', sampleRate: 48000 },
    media: [],
    tracks: [
      { id: uid('trk'), kind: 'video', name: 'V1', locked: false, muted: false, hidden: false },
      { id: uid('trk'), kind: 'text', name: 'Text', locked: false, muted: false, hidden: false },
      { id: uid('trk'), kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false },
    ],
    clips: [],
    markers: [],
    tacks: [],
    stylePackId: 'talking-head',
    customPacks: [],
    rules: [],
  };
}

export function projectDuration(p: Project): number {
  let d = 0;
  for (const c of p.clips) d = Math.max(d, c.start + c.duration);
  return d;
}

export function clipsOnTrack(p: Project, trackId: string): Clip[] {
  return p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export function activeClips(p: Project, t: number): Clip[] {
  return p.clips.filter((c) => t >= c.start && t < c.start + c.duration);
}

/* ---------------- Speed ramps (piecewise time remap) ---------------- */

/** Sorted ramp points, or null when the clip runs at a constant speed. */
export function speedPointsOf(clip: Clip): SpeedPoint[] | null {
  if (!clip.speedPoints || clip.speedPoints.length === 0) return null;
  return [...clip.speedPoints].sort((a, b) => a.t - b.t);
}

/** Instantaneous speed at clip-local time `localT` (linear interp between
 * ramp points; edge speeds hold outside them). */
export function speedAtLocal(clip: Clip, localT: number): number {
  const pts = speedPointsOf(clip);
  if (!pts) return clip.speed;
  if (localT <= pts[0].t) return pts[0].speed;
  const last = pts[pts.length - 1];
  if (localT >= last.t) return last.speed;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (localT >= a.t && localT <= b.t) {
      const f = b.t - a.t < 1e-9 ? 0 : (localT - a.t) / (b.t - a.t);
      return a.speed + (b.speed - a.speed) * f;
    }
  }
  return last.speed;
}

/** Forward-integrated source position for clip-local time (honors the speed
 * ramp by integrating the piecewise-linear speed). This is the direction-agnostic
 * part: `sourceTimeOf` flips it for reversed clips. */
export function forwardSourceTime(clip: Clip, localT: number): number {
  const pts = speedPointsOf(clip);
  if (!pts) return clip.inPoint + localT * clip.speed;
  const last = pts[pts.length - 1];
  let consumed = 0;
  // leading constant-speed zone (before the first ramp point)
  if (localT <= pts[0].t) return clip.inPoint + localT * pts[0].speed;
  consumed += pts[0].t * pts[0].speed;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (localT < b.t) {
      const f = b.t - a.t < 1e-9 ? 0 : (localT - a.t) / (b.t - a.t);
      consumed += ((a.speed + (b.speed - a.speed) * f / 2) * (localT - a.t));
      return clip.inPoint + consumed;
    }
    consumed += ((a.speed + b.speed) / 2) * (b.t - a.t);
  }
  // trailing constant-speed zone
  if (localT > last.t) consumed += (localT - last.t) * last.speed;
  return clip.inPoint + consumed;
}

/** Total source seconds this clip consumes over its full duration. */
export function consumedSource(clip: Clip): number {
  return forwardSourceTime(clip, clip.duration) - clip.inPoint;
}

/** Source position (seconds inside the original media) for a timeline time —
 * honors the speed ramp, and runs BACKWARD (from the consumed segment's end
 * toward `inPoint`) when the clip is reversed. */
export function sourceTimeOf(clip: Clip, timelineT: number): number {
  const localT = Math.max(0, timelineT - clip.start);
  const fwd = forwardSourceTime(clip, localT);
  if (!clip.reversed) return fwd;
  // Reversed: play the consumed segment from its END toward inPoint. With a
  // ramp the same integration applies — only the direction flips.
  const endPos = clip.inPoint + consumedSource(clip);
  return endPos - (fwd - clip.inPoint);
}

/** Average speed over the whole clip = total consumed source / duration.
 * Audio playback under a ramp uses this (a constant-rate AudioBufferSource
 * cannot follow a piecewise ramp), so ramped clips' audio matches at the
 * clip edges with some drift inside — flagged honestly in the checklist. */
export function avgSpeed(clip: Clip): number {
  const pts = speedPointsOf(clip);
  if (!pts) return clip.speed;
  if (clip.duration <= 1e-6) return clip.speed;
  return (sourceTimeOf(clip, clip.start + clip.duration) - clip.inPoint) / clip.duration;
}

export function findClip(p: Project, id: string): Clip | undefined {
  return p.clips.find((c) => c.id === id);
}

export function getMedia(p: Project, id?: string): MediaAsset | undefined {
  return id ? p.media.find((m) => m.id === id) : undefined;
}