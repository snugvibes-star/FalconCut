import { describe, it, expect, beforeAll } from 'vitest';
import {
  createProject, applyAction, applyActions, uid, projectDuration, sourceTimeOf, avgSpeed, strokeBounds,
  History, renderFrame, evalKeyframes, buildCues, parseSRT, cueCps, defaultTextStyle, defaultTransform, ACTION_SCHEMA, clearGenCache,
} from '../engine';
import type { Action } from '../engine/actions';
import type { MediaAsset, Project } from '../engine/types';

/* Recording canvas: lets us verify renderer determinism in Node. */
class FakeCtx {
  ops: string[] = [];
  canvas: { width: number; height: number };
  filter = 'none'; globalAlpha = 1; fillStyle = ''; strokeStyle = ''; lineWidth = 1;
  font = ''; textAlign = ''; textBaseline = ''; lineJoin = ''; lineCap = '';
  shadowColor = ''; shadowBlur = 0; shadowOffsetY = 0;
  constructor(c: { width: number; height: number }) { this.canvas = c; }
  private rec(name: string, ...args: unknown[]) { this.ops.push(`${name}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(',')})`); }
  save() { this.rec('save'); } restore() { this.rec('restore'); }
  globalCompositeOperation = 'source-over';
  setTransform(...a: number[]) { this.rec('setTransform', ...a); }
  scale(...a: number[]) { this.rec('scale', ...a); }
  translate(...a: number[]) { this.rec('translate', ...a); }
  rotate(...a: number[]) { this.rec('rotate', ...a); }
  fillRect(...a: number[]) { this.rec('fillRect', ...a, this.fillStyle); }
  clearRect(...a: number[]) { this.rec('clearRect', ...a); }
  strokeRect(...a: number[]) { this.rec('strokeRect', ...a); }
  beginPath() { this.rec('beginPath'); } closePath() { this.rec('closePath'); }
  rect(...a: number[]) { this.rec('rect', ...a); }
  clip() { this.rec('clip'); }
  arc(...a: number[]) { this.rec('arc', ...a); }
  arcTo(...a: number[]) { this.rec('arcTo', ...a); }
  ellipse(...a: number[]) { this.rec('ellipse', ...a); }
  quadraticCurveTo(...a: number[]) { this.rec('quadTo', ...a); }
  moveTo(...a: number[]) { this.rec('moveTo', ...a); }
  lineTo(...a: number[]) { this.rec('lineTo', ...a); }
  fill() { this.rec('fill', this.fillStyle); } stroke() { this.rec('stroke'); }
  fillText(t: string, ...a: number[]) { this.rec('fillText', t, ...a, this.fillStyle, this.font); }
  strokeText(t: string, ...a: number[]) { this.rec('strokeText', t, ...a); }
  drawImage(_src: unknown, ...a: number[]) { this.rec('drawImage', ...a); }
  measureText(t: string) { return { width: t.length * 10 }; }
  createLinearGradient(...a: number[]) { this.rec('lg', ...a); return { addColorStop: (o: number, c: string) => this.rec('stop', o, c) }; }
  createRadialGradient(...a: number[]) { this.rec('rg', ...a); return { addColorStop: (o: number, c: string) => this.rec('stop', o, c) }; }
  getImageData(_x: number, _y: number, w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData() { this.rec('putImageData'); }
  setLineDash(a: number[]) { this.rec('dash', ...a); }
}
class FakeOffscreen {
  width: number; height: number; ctx: FakeCtx;
  static all: FakeOffscreen[] = [];
  constructor(w: number, h: number) { this.width = w; this.height = h; this.ctx = new FakeCtx(this); FakeOffscreen.all.push(this); }
  getContext() { return this.ctx; }
}
beforeAll(() => { (globalThis as any).OffscreenCanvas = FakeOffscreen; });

const genAsset = (id: string, dur = 10): MediaAsset => ({
  id, name: 'gen', type: 'generator', duration: dur, width: 640, height: 360, hasAudio: false,
  generator: { kind: 'gradient', colors: ['#101828', '#38BDF8'], speed: 1, seed: 7 }, source: 'demo',
});

function baseProject(): Project {
  let p = createProject('Test', '16:9');
  p = applyAction(p, { type: 'add_media', asset: genAsset('m1') });
  p = applyAction(p, { type: 'add_clip', clip: { trackId: p.tracks[0].id, mediaId: 'm1', start: 0, duration: 8, inPoint: 1 } });
  return p;
}

describe('actions', () => {
  it('every action type has a plain-English description', () => {
    for (const [k, v] of Object.entries(ACTION_SCHEMA)) expect(v.length, k).toBeGreaterThan(15);
  });

  it('split keeps source continuity', () => {
    const p = baseProject();
    const c = p.clips[0];
    const p2 = applyAction(p, { type: 'split_clip', clipId: c.id, time: 3 });
    expect(p2.clips.length).toBe(2);
    const [a, b] = [...p2.clips].sort((x, y) => x.start - y.start);
    expect(a.duration).toBeCloseTo(3);
    expect(b.start).toBeCloseTo(3);
    expect(b.inPoint).toBeCloseTo(1 + 3);
    expect(sourceTimeOf(b, 4)).toBeCloseTo(5);
    expect(projectDuration(p2)).toBeCloseTo(8);
  });

  it('split refuses near edges', () => {
    const p = baseProject();
    const p2 = applyAction(p, { type: 'split_clip', clipId: p.clips[0].id, time: 0.001 });
    expect(p2.clips.length).toBe(1);
  });

  it('set_speed rescales duration and keyframes', () => {
    let p = baseProject();
    const id = p.clips[0].id;
    p = applyAction(p, { type: 'add_keyframe', clipId: id, path: 'transform.scale', time: 2, value: 1.2 });
    p = applyAction(p, { type: 'set_speed', clipId: id, speed: 2 });
    const c = p.clips[0];
    expect(c.duration).toBeCloseTo(4);
    expect(c.keyframes[0].time).toBeCloseTo(1);
  });

  it('ripple_delete_range cuts inside a clip and shifts the rest', () => {
    let p = baseProject();
    p = applyAction(p, { type: 'add_marker', marker: { time: 7, label: 'x' } });
    p = applyAction(p, { type: 'ripple_delete_range', start: 2, end: 4 });
    const c = p.clips.find((x) => x.start === 0)!;
    expect(c.duration).toBeCloseTo(2);
    const right = p.clips.find((x) => x.id !== c.id)!;
    expect(right.start).toBeCloseTo(2);
    expect(right.inPoint).toBeCloseTo(1 + 4);
    expect(projectDuration(p)).toBeCloseTo(6);
    expect(p.markers[0].time).toBeCloseTo(5);
  });

  it('trim left edge keeps picture stable', () => {
    const p = baseProject();
    const p2 = applyAction(p, { type: 'trim_clip', clipId: p.clips[0].id, start: 1 });
    const c = p2.clips[0];
    expect(c.start).toBe(1);
    expect(c.inPoint).toBeCloseTo(2);
    expect(c.duration).toBeCloseTo(7);
  });

  it('group applies as one undo step', () => {
    const p = baseProject();
    const h = new History(p);
    const id = h.current.clips[0].id;
    const actions: Action[] = [
      { type: 'split_clip', clipId: id, time: 4 },
      { type: 'set_transform', clipId: id, patch: { scale: 1.1 } },
      { type: 'add_marker', marker: { time: 4, label: 'cut' } },
    ];
    h.apply(actions, 'grouped edit');
    expect(h.current.clips.length).toBe(2);
    expect(h.depth).toBe(1);
    h.undo();
    expect(h.current.clips.length).toBe(1);
    expect(h.current.markers.length).toBe(0);
    expect(h.current.clips[0].transform.scale).toBe(1);
    h.redo();
    expect(h.current.clips.length).toBe(2);
  });

  it('add_text creates styled caption clip with words', () => {
    let p = baseProject();
    p = applyAction(p, { type: 'add_text', start: 0.5, duration: 2, text: 'hello world', preset: 'karaoke', words: [{ w: 'hello', start: 0, end: 0.6 }, { w: 'world', start: 0.7, end: 1.4 }] });
    const t = p.clips.find((c) => c.kind === 'text')!;
    expect(t.text!.style.preset).toBe('karaoke');
    expect(t.text!.words!.length).toBe(2);
  });

  it('keyframes replace at same time', () => {
    let p = baseProject();
    const id = p.clips[0].id;
    p = applyAction(p, { type: 'add_keyframe', clipId: id, path: 'volume', time: 1, value: 0.5 });
    p = applyAction(p, { type: 'add_keyframe', clipId: id, path: 'volume', time: 1.001, value: 0.2 });
    expect(p.clips[0].keyframes.length).toBe(1);
    expect(p.clips[0].keyframes[0].value).toBe(0.2);
  });
});

describe('speed ramps', () => {
  it('sourceTimeOf integrates the piecewise-linear speed', () => {
    let p = baseProject();
    const id = p.clips[0].id;
    p = applyAction(p, { type: 'set_speed_ramp', clipId: id, points: [{ t: 0, speed: 1 }, { t: 4, speed: 2 }, { t: 8, speed: 1 }] });
    const c = p.clips[0];
    expect(sourceTimeOf(c, 0)).toBeCloseTo(1);
    expect(sourceTimeOf(c, 2)).toBeCloseTo(3.5); // avg speed 1.25 over 2s
    expect(sourceTimeOf(c, 4)).toBeCloseTo(7);
    expect(sourceTimeOf(c, 6)).toBeCloseTo(10.5);
    expect(sourceTimeOf(c, 8)).toBeCloseTo(13);
    expect(avgSpeed(c)).toBeCloseTo(1.5);
  });

  it('constant speed still maps linearly when no ramp is set', () => {
    const c = baseProject().clips[0];
    expect(sourceTimeOf(c, 3)).toBeCloseTo(4); // inPoint 1 + 3s * speed 1
  });

  it('set_speed clears the ramp', () => {
    let p = baseProject();
    const id = p.clips[0].id;
    p = applyAction(p, { type: 'set_speed_ramp', clipId: id, points: [{ t: 0, speed: 1 }, { t: 4, speed: 3 }] });
    p = applyAction(p, { type: 'set_speed', clipId: id, speed: 2 });
    expect(p.clips[0].speedPoints).toBeUndefined();
    expect(p.clips[0].speed).toBe(2);
  });

  it('split keeps the ramp continuous across the cut', () => {
    let p = baseProject();
    const id = p.clips[0].id;
    p = applyAction(p, { type: 'set_speed_ramp', clipId: id, points: [{ t: 0, speed: 1 }, { t: 8, speed: 2 }] });
    const before = sourceTimeOf(p.clips[0], 5);
    p = applyAction(p, { type: 'split_clip', clipId: id, time: 3 });
    const right = p.clips.find((c) => c.start === 3)!;
    expect(sourceTimeOf(right, 5)).toBeCloseTo(before);
    const left = p.clips.find((c) => c.start === 0)!;
    // Continuity: at the cut the left clip ends exactly where the right begins.
    expect(sourceTimeOf(left, 3)).toBeCloseTo(right.inPoint);
  });

  it('blendMode is settable via set_clip_props and blend transitions exist in the schema', () => {
    let p = baseProject();
    const id = p.clips[0].id;
    p = applyAction(p, { type: 'set_clip_props', clipId: id, patch: { blendMode: 'screen' } });
    expect(p.clips[0].blendMode).toBe('screen');
    expect(ACTION_SCHEMA.set_transition).toContain('blend-multiply');
    expect(ACTION_SCHEMA.set_speed_ramp).toBeTruthy();
  });
});

describe('drawing clips', () => {
  const strokes = [
    { tool: 'brush' as const, points: [[100, 100], [150, 160], [200, 180]] as [number, number][], color: '#ff0000', size: 6, opacity: 1 },
    { tool: 'sticker' as const, points: [[400, 300]] as [number, number][], color: '#000000', size: 80, opacity: 1, char: '🔥' },
  ];

  it('add_drawing creates an overlay drawing clip on the text track', () => {
    let p = baseProject();
    p = applyAction(p, { type: 'add_drawing', start: 1, duration: 3, strokes });
    const d = p.clips.find((c) => c.kind === 'drawing')!;
    expect(d.drawing!.strokes.length).toBe(2);
    expect(d.start).toBe(1);
    expect(d.trackId).toBe(p.tracks.find((t) => t.kind === 'text')!.id);
  });

  it('set_drawing replaces the strokes', () => {
    let p = baseProject();
    p = applyAction(p, { type: 'add_drawing', start: 1, duration: 3, strokes });
    const d = p.clips.find((c) => c.kind === 'drawing')!;
    p = applyAction(p, { type: 'set_drawing', clipId: d.id, strokes: [{ ...strokes[0], color: '#00ff00' }] });
    expect(p.clips.find((c) => c.id === d.id)!.drawing!.strokes[0].color).toBe('#00ff00');
  });

  it('drawing layers overlap freely (no same-track clamping)', () => {
    let p = baseProject();
    p = applyAction(p, { type: 'add_text', start: 0, duration: 4, text: 'title' });
    p = applyAction(p, { type: 'add_drawing', start: 0, duration: 4, strokes });
    const d = p.clips.find((c) => c.kind === 'drawing')!;
    expect(d.start).toBe(0);
  });

  it('strokeBounds covers stroke width and sticker glyphs', () => {
    const b = strokeBounds(strokes)!;
    expect(b.minX).toBeLessThanOrEqual(100 - 3);
    expect(b.maxY).toBeGreaterThanOrEqual(300 + 80 * 0.75);
  });

  it('renderFrame draws drawing clips without a resolver', () => {
    let p = baseProject();
    p = applyAction(p, { type: 'add_drawing', start: 0, duration: 4, strokes });
    FakeOffscreen.all = [];
    clearGenCache();
    const c = new FakeOffscreen(640, 360);
    renderFrame(p, 1, c.getContext() as any, null);
    const ops = c.ctx.ops.join('|') + FakeOffscreen.all.map((x) => x.ctx.ops.join('|')).join('|');
    expect(ops).toContain('quadTo'); // smoothed brush stroke
    expect(ops).toContain('fillText'); // sticker glyph
  });
});

describe('easing + keyframes', () => {
  it('interpolates with easing and clamps ends', () => {
    const kfs = [{ time: 0, value: 1, easing: 'linear' as const }, { time: 2, value: 2, easing: 'linear' as const }];
    expect(evalKeyframes(kfs, -1, 9)).toBe(1);
    expect(evalKeyframes(kfs, 1, 9)).toBeCloseTo(1.5);
    expect(evalKeyframes(kfs, 5, 9)).toBe(2);
    expect(evalKeyframes([], 1, 9)).toBe(9);
  });
});

describe('renderer determinism', () => {
  it('same t -> identical draw ops; different t -> different ops', () => {
    const p = baseProject();
    const draw = (t: number) => {
      FakeOffscreen.all = [];
      clearGenCache();
      const c = new FakeOffscreen(640, 360);
      renderFrame(p, t, c.getContext() as any, null);
      return FakeOffscreen.all.map((x) => x.ctx.ops.join('|')).join('||');
    };
    expect(draw(2)).toBe(draw(2));
    expect(draw(2)).not.toBe(draw(3));
  });

  it('renders text and motifs without a resolver', () => {
    let p = baseProject();
    p = applyAction(p, { type: 'add_text', start: 0, duration: 3, text: 'HELLO FALCONCUT', preset: 'word-pop' });
    p = applyAction(p, { type: 'add_motif', start: 0, duration: 3, motif: { type: 'ring-progress', params: { value: 80 } } });
    const c = new FakeOffscreen(640, 360);
    renderFrame(p, 1, c.getContext() as any, null);
    const ops = c.ctx.ops.join('|');
    expect(ops).toContain('fillText');
    expect(ops).toContain('arc');
  });

  it('crossfade draws previous clip during transition window', () => {
    let p = baseProject();
    const id = p.clips[0].id;
    p = applyAction(p, { type: 'split_clip', clipId: id, time: 4 });
    const second = p.clips.find((c) => c.start === 4)!;
    p = applyAction(p, { type: 'set_transition', clipId: second.id, edge: 'in', transition: { type: 'crossfade', duration: 0.5 } });
    const c = new FakeOffscreen(640, 360);
    renderFrame(p, 4.2, c.getContext() as any, null);
    const draws = c.ctx.ops.filter((o) => o.startsWith('drawImage'));
    expect(draws.length).toBeGreaterThanOrEqual(2);
  });
});

describe('captions', () => {
  it('builds cues with max 2 lines and shifted word times', () => {
    const words = 'this is a fairly long sentence that should wrap into multiple lines and cues'.split(' ').map((w, i) => ({ word: w, start: i * 0.3, end: i * 0.3 + 0.28 }));
    const cues = buildCues(words, 22, 2);
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) {
      expect(c.words[0].start).toBeGreaterThanOrEqual(0);
      expect(c.end).toBeGreaterThan(c.start);
      const lines = Math.ceil(c.text.length / 22);
      expect(lines).toBeLessThanOrEqual(2);
    }
  });

  it('caps cue length, drops fillers and honours the reading-speed ceiling', () => {
    const words = 'um hello there this is a long fast sentence with many words and more words after it'.split(' ').map((w, i) => ({ word: w, start: i * 0.18, end: i * 0.18 + 0.16 }));
    const cues = buildCues(words, 30, 2, 0.7, { maxCueSec: 2, targetCps: 16, removeFillers: true });
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.some((c) => /\bum\b/i.test(c.text))).toBe(false);
    for (const c of cues) expect(c.end - c.start).toBeLessThanOrEqual(2.6);
  });

  it('parses SRT and WebVTT cues, strips tags and decodes entities', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\nHello <i>world</i> &amp; friends\n\n2\n00:00:04.000 --> 00:00:05.250\nSecond line';
    const cues = parseSRT(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 3.5, text: 'Hello world & friends' });
    expect(cues[1].start).toBeCloseTo(4);
    expect(cues[1].end).toBeCloseTo(5.25);
    const vtt = 'WEBVTT\n\n00:00:02.000 --> 00:00:03.000 align:start\nVTT cue';
    expect(parseSRT(vtt)[0]).toMatchObject({ start: 2, end: 3, text: 'VTT cue' });
  });
});

describe('region crop / extraction', () => {
  it('renderer consumes cropL/R/T/B: only the selected source rect is drawn', () => {
    let p = baseProject(); // generator 640×360, project 1920×1080
    const id = p.clips[0].id;
    p = applyAction(p, { type: 'set_transform', clipId: id, patch: { cropL: 0.25, cropR: 0.25, cropT: 0.1, cropB: 0.2 } });
    FakeOffscreen.all = [];
    clearGenCache();
    const c = new FakeOffscreen(p.settings.width, p.settings.height);
    renderFrame(p, 2, c.getContext() as any, null);
    const draws = c.ctx.ops.filter((o) => o.startsWith('drawImage'));
    expect(draws.length).toBeGreaterThan(0);
    // sx = 0.25*640 = 160, sy = 0.1*360 = 36, sw = 0.5*640 = 320, sh = 0.7*360 = 252
    const src = draws[0].split('(')[1].split(')')[0].split(',').map(Number);
    expect(src[0]).toBeCloseTo(160);
    expect(src[1]).toBeCloseTo(36);
    expect(src[2]).toBeCloseTo(320);
    expect(src[3]).toBeCloseTo(252);
    // Nothing outside the region is sampled: no draw starts at the uncropped origin.
    expect(draws.some((d) => d.startsWith('drawImage(0.000,0.000'))).toBe(false);
  });

  it('crop is non-destructive and undoable (source reference preserved)', () => {
    let p = baseProject();
    const id = p.clips[0].id;
    const mediaId = p.clips[0].mediaId;
    const h = new History(p);
    h.apply([{ type: 'set_transform', clipId: id, patch: { cropL: 0.2, cropR: 0.3, cropT: 0, cropB: 0 } }], 'Crop region');
    const cropped = h.current.clips.find((c) => c.id === id)!;
    expect(cropped.transform.cropL).toBeCloseTo(0.2);
    expect(cropped.mediaId).toBe(mediaId); // same source, never re-encoded
    h.undo();
    const restored = h.current.clips.find((c) => c.id === id)!;
    expect(restored.transform.cropL).toBe(0);
    expect(restored.transform.cropR).toBe(0);
  });

  it('extract-as-new-clip: new independent clip + track, original untouched', () => {
    let p = baseProject();
    const src = p.clips[0];
    const newTrack = uid('trk');
    p = applyActions(p, [
      { type: 'add_track', track: { id: newTrack, kind: 'video', name: 'V2' }, index: 0 },
      {
        type: 'add_clip',
        clip: {
          trackId: newTrack, mediaId: src.mediaId, start: src.start, duration: src.duration,
          inPoint: src.inPoint, fit: 'fill',
          transform: { ...defaultTransform(), cropL: 0.1, cropR: 0.1, cropT: 0.2, cropB: 0.2 },
        },
      },
    ]);
    const original = p.clips.find((c) => c.id === src.id)!;
    const extracted = p.clips.find((c) => c.trackId === newTrack)!;
    expect(extracted).toBeTruthy();
    expect(extracted.mediaId).toBe(original.mediaId); // same source media
    expect(extracted.transform.cropL).toBeCloseTo(0.1);
    expect(extracted.transform.cropT).toBeCloseTo(0.2);
    expect(original.transform.cropL).toBe(0); // original not modified
    expect(p.tracks.find((t) => t.id === newTrack)?.kind).toBe('video');
  });

  it('auto-create-track + move is one undoable group with a shared track id', () => {
    let p = baseProject();
    const clip = p.clips[0];
    const newTrack = uid('trk');
    const h = new History(p);
    h.apply([
      { type: 'add_track', track: { id: newTrack, kind: 'video', name: 'V2' }, index: 0 },
      { type: 'move_clip', clipId: clip.id, start: 2, trackId: newTrack },
    ], 'Drop on new track');
    expect(h.depth).toBe(1);
    expect(h.current.clips.find((c) => c.id === clip.id)!.trackId).toBe(newTrack);
    h.undo();
    expect(h.current.tracks.some((t) => t.id === newTrack)).toBe(false);
    expect(h.current.clips.find((c) => c.id === clip.id)!.trackId).toBe(p.tracks[0].id);
  });
});