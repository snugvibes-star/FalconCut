import { describe, it, expect } from 'vitest';
import { createProject, applyActions, type MediaAsset } from '../engine';
import { validateActions } from '../engine/actions';
import { runTool, TOOL_MAP, toolManifest, toolsPromptText } from '../tools/registry';

function captionsFixture() {
  let p = createProject('AI control', '9:16');
  p = applyActions(p, [
    { type: 'add_track', track: { kind: 'text', id: 'txt' } },
    { type: 'add_text', trackId: 'txt', start: 0, duration: 3, text: 'EVERY CONVERSATION HAS A STORY', role: 'caption', preset: 'clean',
      words: [
        { w: 'EVERY', start: 0, end: 0.4 }, { w: 'CONVERSATION', start: 0.4, end: 1.2 },
        { w: 'HAS', start: 1.2, end: 1.5 }, { w: 'A', start: 1.5, end: 1.7 }, { w: 'STORY', start: 1.7, end: 3 },
      ] },
    { type: 'add_text', trackId: 'txt', start: 4, duration: 2, text: 'second caption', role: 'caption', preset: 'clean' },
  ]);
  return p;
}

const newTools = [
  'set_caption_style_advanced', 'set_caption_highlight', 'set_caption_effects',
  'edit_caption_word', 'set_clip_look_advanced', 'set_project_settings_ai',
];

describe('AI transcription feeds normal caption generation', () => {
  it('stores a transcript that add_captions can consume', async () => {
    let p = createProject('Transcript', '9:16');
    const asset: MediaAsset = {
      id: 'vid1', name: 'talk.mp4', type: 'video', duration: 6, width: 1080, height: 1920,
      hasAudio: true, source: 'file',
    };
    p = applyActions(p, [
      { type: 'add_media', asset },
      { type: 'add_clip', clip: { trackId: p.tracks[0].id, mediaId: 'vid1', start: 0, duration: 6, inPoint: 0 } },
    ]);
    p = applyActions(p, [{
      type: 'set_transcript', mediaId: 'vid1',
      transcript: {
        segments: [{ start: 0, end: 2, text: 'hello world', words: [
          { word: 'hello', start: 0.1, end: 0.6 }, { word: 'world', start: 0.7, end: 1.2 },
        ] }],
        words: [
          { word: 'hello', start: 0.1, end: 0.6 }, { word: 'world', start: 0.7, end: 1.2, estimated: true },
        ],
        model: 'test', complete: true,
      },
    }]);
    expect(p.analysis?.byMedia.vid1.transcript?.complete).toBe(true);
    const result = await runTool(p, 'add_captions', {});
    expect(result.actions.some((a) => a.type === 'add_text')).toBe(true);
    expect(validateActions(p, result.actions)).toEqual([]);
    const after = applyActions(p, result.actions);
    const cap = after.clips.find((c) => c.text?.role === 'caption')!;
    expect(cap.text!.words?.[1].timingEstimated).toBe(true);
  });
});

describe('AI control tools', () => {
  it('registers all six tools with valid descriptions, examples and manifest entries', () => {
    for (const name of newTools) {
      const def = TOOL_MAP.get(name)!;
      expect(def).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.example.input).toBeDefined();
    }
    const manifest = toolManifest() as unknown;
    const names = Array.isArray(manifest)
      ? manifest.map((t: { name: string }) => t.name)
      : (manifest as { tools: { name: string }[] }).tools.map((t) => t.name);
    for (const name of newTools) expect(names).toContain(name);
    for (const name of newTools) expect(toolsPromptText()).toContain(name);
  });

  it('applies deep caption styling and highlight settings', async () => {
    const p = captionsFixture();
    const style = await runTool(p, 'set_caption_style_advanced', { preset_id: 'beast', font_family: 'Georgia', y: 0.55 });
    expect(validateActions(p, style.actions)).toEqual([]);
    let after = applyActions(p, style.actions);
    expect(after.clips[0].text!.style.fontFamily).toBe('Georgia');
    expect(after.clips[0].text!.style.presetId).toBe('beast');

    const hl = await runTool(after, 'set_caption_highlight', { enabled: true, anim: 'glitch', bg_color: '#FF2D95', offset: -0.05 });
    expect(validateActions(after, hl.actions)).toEqual([]);
    after = applyActions(after, hl.actions);
    expect(after.clips[0].text!.style.highlight.anim).toBe('glitch');
    expect(after.clips[0].text!.style.highlight.bgColor).toBe('#FF2D95');
    expect(after.clips[0].text!.style.highlight.offset).toBe(-0.05);
  });

  it('applies glow/blur effects and edits a single word', async () => {
    const p = captionsFixture();
    const fx = await runTool(p, 'set_caption_effects', { glow_enabled: true, glow_color: '#22D3EE', blur_enabled: true, text_opacity: 0.8 });
    expect(validateActions(p, fx.actions)).toEqual([]);
    const afterFx = applyActions(p, fx.actions);
    expect(afterFx.clips[0].text!.style.glow.enabled).toBe(true);
    expect(afterFx.clips[0].text!.style.blur.enabled).toBe(true);
    expect(afterFx.clips[0].text!.style.textOpacity).toBe(0.8);

    const word = await runTool(afterFx, 'edit_caption_word', { caption_index: 0, word_index: 4, color: '#C6F24E', end: 2.8, font_style: 'italic' });
    expect(validateActions(afterFx, word.actions)).toEqual([]);
    const afterWord = applyActions(afterFx, word.actions);
    expect(afterWord.clips[0].text!.words![4].style?.color).toBe('#C6F24E');
    expect(afterWord.clips[0].text!.words![4].end).toBe(2.8);
    expect(afterWord.clips[0].text!.words![4].style?.fontStyle).toBe('italic');
  });

  it('controls clip look and project settings', async () => {
    const p = captionsFixture();
    const look = await runTool(p, 'set_clip_look_advanced', { caption_index: undefined, blend_mode: 'screen', fade_in: 0.2, volume: 0.5 });
    expect(validateActions(p, look.actions)).toEqual([]);
    const settings = await runTool(p, 'set_project_settings_ai', { fps: 60, aspect: '16:9', background: '#101820' });
    expect(validateActions(p, settings.actions)).toEqual([]);
    const after = applyActions(p, settings.actions);
    expect(after.settings.fps).toBe(60);
    expect(after.settings.background).toBe('#101820');

    const reframe = await runTool(after, 'set_project_settings_ai', { aspect: '9:16' });
    const reframed = applyActions(after, reframe.actions);
    expect(reframed.settings.aspect).toBe('9:16');
    expect(reframed.settings.width).toBe(1080);
    expect(reframed.settings.height).toBe(1920);
  });
});
