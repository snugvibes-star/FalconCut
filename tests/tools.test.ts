import { describe, it, expect, beforeAll } from 'vitest';
import { produce } from 'immer';
import { createProject, applyActions, projectDuration, uid } from '../engine';
import type { MediaAsset, MediaAnalysis, Project, TranscriptWord } from '../engine/types';
import { validateActions, type Action } from '../engine/actions';
import { runTool, TOOLS, toolManifest, toolsPromptText, uiCommandCatalog } from '../tools/registry';
import { lintProject } from '../quality/lint';
import { effectivePack, parseNote, rulesFromNote } from '../styles/rules';
import { BUILT_IN_PACKS, getPack } from '../styles/packs';

class FakeCtx {
  ops: string[] = []; canvas: { width: number; height: number };
  filter = 'none'; globalAlpha = 1; fillStyle = ''; strokeStyle = ''; lineWidth = 1; font = ''; textAlign = ''; textBaseline = ''; lineJoin = ''; lineCap = ''; shadowColor = ''; shadowBlur = 0; shadowOffsetY = 0;
  constructor(c: any) { this.canvas = c; }
  save() {} restore() {} setTransform() {} scale() {} translate() {} rotate() {}
  fillRect() {} clearRect() {} strokeRect() {} beginPath() {} closePath() {} rect() {} clip() {} arc() {} arcTo() {} moveTo() {} lineTo() {} fill() {} stroke() {}
  fillText() {} strokeText() {} drawImage() {} setLineDash() {}
  measureText(t: string) { return { width: t.length * 10 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  getImageData(_x: number, _y: number, w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData() {}
}
class FakeOffscreen { width: number; height: number; ctx: FakeCtx; constructor(w: number, h: number) { this.width = w; this.height = h; this.ctx = new FakeCtx(this); } getContext() { return this.ctx; } }
beforeAll(() => { (globalThis as any).OffscreenCanvas = FakeOffscreen; });

const W = (word: string, start: number, end: number): TranscriptWord => ({ word, start, end });

function fixture(): Project {
  let p = createProject('Fixture', '16:9');
  const video: MediaAsset = { id: 'vid1', name: 'talk.mp4', type: 'video', duration: 30, width: 1920, height: 1080, hasAudio: true, source: 'file' };
  const music: MediaAsset = { id: 'mus1', name: 'bed.mp3', type: 'audio', duration: 60, width: 0, height: 0, hasAudio: true, source: 'file' };
  p = applyActions(p, [{ type: 'add_media', asset: video }, { type: 'add_media', asset: music }]);
  p = applyActions(p, [{ type: 'add_clip', clip: { trackId: p.tracks[0].id, mediaId: 'vid1', start: 0, duration: 30, inPoint: 0 } }]);

  const words: TranscriptWord[] = [
    W('hello', 0.2, 0.6), W('world', 0.7, 1.1),
    W('um', 2.5, 2.8), W('this', 2.9, 3.2), W('is', 3.3, 3.5), W('a', 3.6, 3.7), W('test', 3.8, 4.2),
    W('this', 5.4, 5.7), W('is', 5.8, 6.0), W('a', 6.1, 6.2), W('test', 6.3, 6.8),
    W('and', 7.0, 7.2), W('more', 7.3, 7.6), W('words', 7.7, 8.1), W('here', 8.2, 8.6),
    W('the', 9.0, 9.2), W('secret', 9.3, 9.8), W('is', 9.9, 10.1), W('consistency', 10.2, 11.0),
  ];
  const loudness = [];
  for (let t = 0; t < 30; t += 0.1) {
    const inSpeech = words.some((w) => t >= w.start - 0.05 && t <= w.end + 0.05);
    loudness.push({ t: Math.round(t * 10) / 10, rms: inSpeech ? 0.18 : 0.0008, peak: inSpeech ? 0.5 : 0.002 });
  }
  const faces = [];
  for (let t = 0; t < 30; t += 0.5) faces.push({ t, x: 0.62, y: 0.4, w: 0.2, h: 0.3, conf: 0.8 });
  const ma: MediaAnalysis = {
    mediaId: 'vid1', duration: 30,
    transcript: { segments: [{ start: 0.2, end: 11, text: words.map((w) => w.word).join(' '), words, speaker: 'Speaker A' }], words, model: 'test', complete: true },
    silences: [{ start: 1.1, end: 2.5 }, { start: 4.2, end: 5.4 }, { start: 11.0, end: 14.0 }],
    fillers: [{ start: 2.5, end: 2.8, text: 'um', wordIndices: [2, 2] }],
    retakes: [{ attempts: [{ start: 2.9, end: 4.2, text: 'this is a test' }, { start: 5.4, end: 6.8, text: 'this is a test' }], bestIndex: 1, start: 2.9, end: 5.4 }],
    scenes: [10, 20], faces, faceMethod: 'FaceDetector',
    loudness, integratedLoudness: -26, truePeak: 0.5, speechRatio: 0.8, isMusic: false,
    beats: [], bpm: 0, emphasis: [9.3, 5.4], keywords: ['secret', 'consistency', 'test'],
    analyzedAt: Date.now(), flags: [],
  };
  const mus: MediaAnalysis = {
    mediaId: 'mus1', duration: 60, silences: [], fillers: [], retakes: [], scenes: [], faces: [], faceMethod: 'none',
    loudness: Array.from({ length: 600 }, (_, i) => ({ t: i / 10, rms: 0.12, peak: 0.4 })),
    integratedLoudness: -18, truePeak: 0.4, speechRatio: 0.1, isMusic: true,
    beats: Array.from({ length: 120 }, (_, i) => i * 0.5), bpm: 120, emphasis: [], keywords: [], analyzedAt: Date.now(), flags: [],
  };
  p = produce(p, (d) => {
    d.analysis = { byMedia: { vid1: ma, mus1: mus }, settings: { silenceThresholdDb: -38, silenceMinMs: 600 }, storyboard: '', updatedAt: Date.now() };
  });
  return p;
}

describe('caption provenance', () => {
  it('regeneration removes only AI captions, never hand-typed ones', async () => {
    const base = fixture();
    const trackId = base.tracks.find((t) => t.kind === 'text')!.id;
    const p = applyActions(base, [
      { type: 'add_text', trackId, start: 1, duration: 2, text: 'manual', role: 'caption', source: 'manual' },
      { type: 'add_text', trackId, start: 3, duration: 2, text: 'generated', role: 'caption', source: 'ai' },
    ]);
    const manual = p.clips.find((c) => c.text?.text === 'manual')!;
    const generated = p.clips.find((c) => c.text?.text === 'generated')!;
    const r = await runTool(p, 'add_captions', {});
    const removed = r.actions.filter((a) => a.type === 'remove_clip').map((a: any) => a.clipId);
    expect(removed).toContain(generated.id);
    expect(removed).not.toContain(manual.id);
  });
});

describe('tool registry', () => {
  it('exposes a manifest with descriptions + examples for every tool', () => {
    const m = toolManifest();
    expect(m.length).toBeGreaterThanOrEqual(20);
    for (const t of m) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.example.input).toBeDefined();
    }
  });

  it('advertises human labels, groups and visible UI commands to agents', () => {
    const m = toolManifest();
    expect(m.length).toBe(TOOLS.length);
    for (const t of m) {
      expect(typeof t.label).toBe('string');
      expect(t.label!.length).toBeGreaterThan(0);
      expect(t.group).toBeTruthy();
      expect(Array.isArray(t.aliases)).toBe(true);
    }
    const prompt = toolsPromptText();
    expect(prompt).toContain('human label');
    expect(prompt).toContain('VISIBLE EDITOR COMMANDS');
    expect(uiCommandCatalog().some((c) => c.id === 'undo')).toBe(true);
  });

  it('includes the UI control tool for human command labels', () => {
    expect(TOOLS.some((t) => t.name === 'ui_action' && t.kind === 'control')).toBe(true);
  });

  it('rejects unknown tools with a helpful error', async () => {
    await expect(runTool(fixture(), 'does_not_exist')).rejects.toThrow(/Unknown tool/);
  });
});

describe('cut tools', () => {
  it('remove_dead_air produces valid ripple cuts and never touches words', async () => {
    const p = fixture();
    const r = await runTool(p, 'remove_dead_air', { max_pause_ms: 600 });
    expect(r.actions.length).toBeGreaterThan(0);
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    expect(projectDuration(after)).toBeLessThan(30);
    // remaining clips must not start/end inside a word (source mapping)
    const ma = p.analysis!.byMedia.vid1;
    for (const c of after.clips.filter((x) => x.kind === 'media' && x.mediaId === 'vid1')) {
      const srcStart = c.inPoint, srcEnd = c.inPoint + c.duration * c.speed;
      for (const w of ma.transcript!.words) {
        expect(srcStart > w.start + 0.04 && srcStart < w.end - 0.04).toBe(false);
        expect(srcEnd > w.start + 0.04 && srcEnd < w.end - 0.04).toBe(false);
      }
    }
  });

  it('remove_fillers cuts the um', async () => {
    const p = fixture();
    const r = await runTool(p, 'remove_fillers');
    expect(r.stats?.fillers).toBe(1);
    expect(validateActions(p, r.actions)).toEqual([]);
  });

  it('cut_retakes keeps the last take', async () => {
    const p = fixture();
    const r = await runTool(p, 'cut_retakes');
    expect(r.stats?.groups).toBe(1);
    const after = applyActions(p, r.actions);
    expect(after.tacks.some((t) => t.text.includes('best take'))).toBe(true);
    expect(validateActions(p, r.actions)).toEqual([]);
  });
});

describe('caption + motion tools', () => {
  it('add_captions creates safe-zone cues with word timing', async () => {
    const p = fixture();
    const r = await runTool(p, 'add_captions', { style: 'karaoke' });
    expect(r.stats?.cues).toBeGreaterThan(0);
    const after = applyActions(p, r.actions);
    const caps = after.clips.filter((c) => c.kind === 'text');
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.text!.style.maxLines).toBeLessThanOrEqual(2);
      expect(c.text!.style.y).toBeLessThanOrEqual(0.86);
      expect(c.text!.words?.length).toBeGreaterThan(0);
    }
    expect(validateActions(p, r.actions)).toEqual([]);
  });

  it('add_captions tight density caps line length and drops fillers', async () => {
    const p = fixture();
    const r = await runTool(p, 'add_captions', { density: 'tight', remove_fillers: true });
    expect(r.stats?.cues).toBeGreaterThan(0);
    expect(r.stats?.maxLines).toBe(1);
    expect(r.stats?.fillersRemoved).toBeGreaterThan(0);
    const after = applyActions(p, r.actions);
    const caps = after.clips.filter((c) => c.kind === 'text' && c.text?.role === 'caption');
    for (const c of caps) expect(c.text!.text).not.toMatch(/\bum\b/i);
    expect(validateActions(p, r.actions)).toEqual([]);
  });

  it('add_captions without a transcript leaves existing captions alone', async () => {
    let p = createProject('No transcript', '16:9');
    p = applyActions(p, [{ type: 'add_text', start: 0, duration: 2, text: 'keep me', role: 'caption' }]);
    const r = await runTool(p, 'add_captions', {});
    expect(r.actions).toEqual([]);
    expect(r.summary).toMatch(/No transcript/i);
    expect(applyActions(p, r.actions).clips.some((c) => c.text?.role === 'caption')).toBe(true);
  });

  it('restyle + shift + fix_caption_timing act on generated captions', async () => {
    const p = fixture();
    const gen = await runTool(p, 'add_captions', { style: 'clean' });
    let after = applyActions(p, gen.actions);
    const styled = await runTool(after, 'restyle_captions', { style: 'karaoke', font_size: 0.06, y: 0.7, uppercase: true });
    expect(styled.actions.length).toBeGreaterThan(0);
    expect(validateActions(after, styled.actions)).toEqual([]);
    after = applyActions(after, styled.actions);
    for (const c of after.clips.filter((x) => x.text?.role === 'caption')) {
      expect(c.text!.style.preset).toBe('karaoke');
      expect(c.text!.style.y).toBeCloseTo(0.7);
      expect(c.text!.style.uppercase).toBe(true);
    }
    const firstStart = Math.min(...after.clips.filter((c) => c.text?.role === 'caption').map((c) => c.start));
    const shifted = await runTool(after, 'shift_captions', { offset: 0.5 });
    expect(validateActions(after, shifted.actions)).toEqual([]);
    after = applyActions(after, shifted.actions);
    const newStart = Math.min(...after.clips.filter((c) => c.text?.role === 'caption').map((c) => c.start));
    expect(newStart).toBeCloseTo(firstStart + 0.5, 1);
  });

  it('fix_caption_timing splits an over-long caption', async () => {
    let p = fixture();
    p = applyActions(p, [{ type: 'add_text', start: 0, duration: 20, text: 'one long caption that stays on screen far too long', role: 'caption' }]);
    const r = await runTool(p, 'fix_caption_timing', { max_seconds: 5 });
    expect(r.stats?.split).toBe(1);
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    const caps = after.clips.filter((c) => c.text?.role === 'caption');
    expect(caps.length).toBeGreaterThan(1);
    for (const c of caps) expect(c.duration).toBeLessThanOrEqual(5.05);
  });

  it('import_captions parses SRT into editable caption clips', async () => {
    const p = fixture();
    const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond cue';
    const r = await runTool(p, 'import_captions', { srt });
    expect(r.stats?.cues).toBe(2);
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    const caps = after.clips.filter((c) => c.text?.role === 'caption').sort((a, b) => a.start - b.start);
    expect(caps.map((c) => c.text!.text)).toEqual(['Hello there', 'Second cue']);
    expect(caps[0].start).toBeCloseTo(1);
  });

  it('manage_track duplicates a track with its clips', async () => {
    const p = fixture();
    const trackId = p.tracks[0].id;
    const r = await runTool(p, 'manage_track', { operation: 'duplicate', track_id: trackId });
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    expect(after.tracks.length).toBe(p.tracks.length + 1);
    const dup = after.tracks.find((t) => t.name.endsWith('copy'))!;
    expect(after.clips.filter((c) => c.trackId === dup.id).length).toBe(p.clips.filter((c) => c.trackId === trackId).length);
  });

  it('zoom respects max-zoom rule and alternates', async () => {
    let p = fixture();
    p = applyActions(p, [{ type: 'add_rule', rule: { text: 'never zoom more than 110 percent', kind: 'max-zoom', value: 1.1 } }]);
    const r = await runTool(p, 'zoom_on_emphasis');
    const after = applyActions(p, r.actions);
    const kfs = after.clips.flatMap((c) => c.keyframes.filter((k) => k.path === 'transform.scale'));
    expect(kfs.length).toBeGreaterThan(0);
    for (const k of kfs) expect(k.value).toBeLessThanOrEqual(1.1001);
  });

  it('reframe to 9:16 adds face-follow pans', async () => {
    const p = fixture();
    const r = await runTool(p, 'reframe', { aspect: '9:16' });
    const after = applyActions(p, r.actions);
    expect(after.settings.aspect).toBe('9:16');
    expect(after.settings.width).toBe(1080);
    const pans = after.clips.flatMap((c) => c.keyframes.filter((k) => k.path === 'transform.x'));
    expect(pans.length).toBeGreaterThan(0);
    // face at x=0.62 (right of center) -> pan should be negative (move left edge right)
    expect(pans.some((k) => k.value < 0)).toBe(true);
  });

  it('add_transitions only at scene changes', async () => {
    let p = fixture();
    const id = p.clips[0].id;
    p = applyActions(p, [{ type: 'split_clip', clipId: id, time: 5 }, { type: 'split_clip', clipId: id, time: 10.02 }]);
    const r = await runTool(p, 'add_transitions');
    // boundary at 5s is NOT a scene change (scenes at 10,20); boundary ~10 is
    expect(r.actions.length).toBeLessThanOrEqual(1);
  });
});

describe('audio tools', () => {
  it('add_music ducks under speech', async () => {
    const p = fixture();
    const r = await runTool(p, 'add_music', { mediaId: 'mus1' });
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    const mc = after.clips.find((c) => c.mediaId === 'mus1')!;
    const duckKfs = mc.keyframes.filter((k) => k.path === 'volume');
    expect(duckKfs.length).toBeGreaterThan(4);
    const min = Math.min(...duckKfs.map((k) => k.value));
    const max = Math.max(...duckKfs.map((k) => k.value));
    expect(min).toBeLessThan(max * 0.7);
  });

  it('balance_audio raises quiet speech toward target', async () => {
    const p = fixture();
    const r = await runTool(p, 'balance_audio');
    const after = applyActions(p, r.actions);
    const vc = after.clips.find((c) => c.mediaId === 'vid1')!;
    expect(vc.volume).toBeGreaterThan(1); // -26 LUFS -> -16 needs ~3.16x, peak-limited to ~1.94
    expect(vc.volume * 0.5).toBeLessThanOrEqual(1);
    expect(vc.effects.some((e) => e.type === 'gate')).toBe(true);
  });
});

describe('style packs + rules', () => {
  it('ships at least 6 built-in packs', () => {
    expect(BUILT_IN_PACKS.length).toBeGreaterThanOrEqual(6);
  });

  it('parses plain-words notes into rules', () => {
    const rules = rulesFromNote('captions always yellow, never zoom more than 110 percent');
    expect(rules.some((r) => r.kind === 'caption-color' && r.value === '#FFD400')).toBe(true);
    expect(rules.some((r) => r.kind === 'max-zoom' && r.value === 1.1)).toBe(true);
    const pack = effectivePack(getPack({ stylePackId: 'talking-head', customPacks: [] }), rules);
    expect(pack.captions.color).toBe('#FFD400');
    expect(pack.zoom.maxScale).toBeLessThanOrEqual(1.1);
  });

  it('keeps unparseable notes for the AI', () => {
    const rules = rulesFromNote('make it feel like a rainy Sunday morning');
    expect(rules[0].kind).toBe('note');
  });
});

describe('quality checker', () => {
  it('detects flash clips, mid-word cuts, caption overlap and small text', async () => {
    let p = fixture();
    const id = p.clips[0].id;
    // flash clip
    p = applyActions(p, [{ type: 'split_clip', clipId: id, time: 15 }]);
    p = applyActions(p, [{ type: 'split_clip', clipId: p.clips.find((c) => c.start === 15)!.id, time: 15.08 }]);
    // mid-word cut at source 9.5 (inside "secret" 9.3-9.8)
    const main = p.clips.find((c) => c.start === 0)!;
    p = applyActions(p, [{ type: 'split_clip', clipId: main.id, time: 9.5 }]);
    // overlapping tiny captions
    p = applyActions(p, [
      { type: 'add_text', start: 1, duration: 2, text: 'one', style: { fontSize: 0.02, y: 0.97 } },
      { type: 'add_text', start: 2.5, duration: 2, text: 'two' },
    ]);
    const report = lintProject(p);
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain('flash_clip');
    expect(codes).toContain('mid_word_cut');
    expect(codes).toContain('caption_overlap');
    expect(codes).toContain('caption_small');
    expect(codes).toContain('caption_safe_zone');
    expect(report.score).toBeLessThan(80);
    expect(report.checked.length).toBeGreaterThan(8);
  });

  it('auto_fix reduces issues and stays valid', async () => {
    let p = fixture();
    const id = p.clips[0].id;
    p = applyActions(p, [{ type: 'split_clip', clipId: id, time: 15 }]);
    p = applyActions(p, [{ type: 'split_clip', clipId: p.clips.find((c) => c.start === 15)!.id, time: 15.08 }]);
    const before = lintProject(p);
    const r = await runTool(p, 'auto_fix');
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    const afterReport = lintProject(after);
    expect(afterReport.issues.length).toBeLessThan(before.issues.length);
  });

  it('auto_edit runs the full pipeline as valid actions', async () => {
    const p = fixture();
    const r = await runTool(p, 'auto_edit', { video_type: 'talking head' });
    expect(r.actions.length).toBeGreaterThan(10);
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    expect(after.clips.some((c) => c.kind === 'text')).toBe(true);
    expect(projectDuration(after)).toBeLessThan(30);
    const report = lintProject(after);
    expect(report.score).toBeGreaterThanOrEqual(60);
  }, 30000);
});

describe('action determinism', () => {
  it('generates identical ids when the same group is replayed', () => {
    const p = fixture();
    const id = p.clips[0].id;
    const actions: Action[] = [
      { type: 'split_clip', clipId: id, time: 12 },
      { type: 'ripple_delete_range', start: 2, end: 3 },
      { type: 'split_clip', clipId: id, time: 6 },
    ];
    const a = applyActions(p, actions);
    const b = applyActions(p, actions);
    expect(a.clips.map((c) => c.id).sort()).toEqual(b.clips.map((c) => c.id).sort());
    expect(validateActions(p, actions)).toEqual([]);
  });

  it('keeps tool crossfade actions valid after ripple splits', async () => {
    const p = fixture();
    const r = await runTool(p, 'remove_dead_air', { max_pause_ms: 600 });
    expect(r.actions.length).toBeGreaterThan(0);
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    // every set_fades must target a clip that still exists
    for (const act of r.actions) {
      if (act.type === 'set_fades') expect(after.clips.some((c) => c.id === act.clipId)).toBe(true);
    }
  });
});

describe('region + clip assistant tools', () => {
  it('crop_region crops in place (non-destructive) with valid actions', async () => {
    const p = fixture();
    const id = p.clips[0].id;
    const r = await runTool(p, 'crop_region', { clip_id: id, x: 0.25, y: 0.1, width: 0.5, height: 0.8 });
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    const c = after.clips.find((x) => x.id === id)!;
    expect(c.transform.cropL).toBeCloseTo(0.25);
    expect(c.transform.cropT).toBeCloseTo(0.1);
    expect(c.mediaId).toBe('vid1');
  });

  it('crop_region extract adds an independent clip and leaves the original intact', async () => {
    const p = fixture();
    const id = p.clips[0].id;
    const r = await runTool(p, 'crop_region', { clip_id: id, x: 0, y: 0, width: 0.5, height: 0.5, unit: 'fraction', extract: true });
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    const added = after.clips.filter((c) => c.id !== id);
    expect(added.length).toBe(1);
    expect(added[0].mediaId).toBe('vid1');
    expect(added[0].transform.cropR).toBeCloseTo(0.5);
    expect(after.clips.find((x) => x.id === id)!.transform.cropL).toBe(0);
  });

  it('add_marker / duplicate_clip / reverse_clip / set_clip_look all apply cleanly', async () => {
    const p = fixture();
    const id = p.clips[0].id;
    const m = await runTool(p, 'add_marker', { time: 5, label: 'Hook' });
    const d = await runTool(p, 'duplicate_clip', { clip_id: id });
    const rv = await runTool(p, 'reverse_clip', { clip_id: id, reverse: true });
    const lk = await runTool(p, 'set_clip_look', { clip_id: id, opacity: 0.5, fade_in: 0.2, fade_out: 0.2, label: 'blue', blend_mode: 'screen' });
    for (const r of [m, d, rv, lk]) expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, [...m.actions, ...d.actions, ...rv.actions, ...lk.actions]);
    expect(after.markers.some((x) => x.label === 'Hook' && Math.abs(x.time - 5) < 1e-6)).toBe(true);
    expect(after.clips.filter((c) => c.mediaId === 'vid1').length).toBe(2);
    const src = after.clips.find((c) => c.id === id)!;
    expect(src.reversed).toBe(true);
    expect(src.transform.opacity).toBeCloseTo(0.5);
    expect(src.fades.in).toBeCloseTo(0.2);
    expect(src.fades.out).toBeCloseTo(0.2);
    expect(src.label).toBe('blue');
    expect(src.blendMode).toBe('screen');
  });

  it('remove_section ripples the timeline and keeps captions', async () => {
    const p = fixture();
    const before = projectDuration(p);
    const r = await runTool(p, 'remove_section', { start: 10, end: 20 });
    expect(validateActions(p, r.actions)).toEqual([]);
    const after = applyActions(p, r.actions);
    expect(projectDuration(after)).toBeCloseTo(before - 10, 3);
  });
});