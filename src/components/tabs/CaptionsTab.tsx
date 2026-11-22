/** Caption studio: style cards with live CSS previews of the real TextStyle,
 * an advanced per-field style editor, and an editable caption list. Every
 * control maps to a real engine action (set_text_style / set_text /
 * split_clip / add_text / remove_clip). */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Download, Copy, Trash2, Scissors, Plus, ChevronDown, Upload, WandSparkles } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { commit, Section, Hint, DragSlider } from './shared';
import { defaultTextStyle, type CaptionStyleId, type CaptionWord, type WordStyle, type TextStyle, type HighlightAnim } from '../../../engine';
import { projectSRT, projectVTT, downloadBlob } from '../../../exporter/artifacts';
import {
  TEXT_EFFECTS, TEXT_TRANSITIONS, CAPTION_PRESETS, CAPTION_COLORS, CAPTION_GRADIENTS,
  buildStyledText, effectPatch, transitionActions, presetTextStyle, presetActions, evenWords,
  type CinematicPresetId, type TextEffect, type TextTransition,
} from './textPresets';
import { AiCaptionPanel } from './AiCaptionPanel';
import { ManualCaptionTools } from './ManualCaptionTools';
import { CaptionProperties } from './CaptionProperties';

const SAVED_PRESETS_KEY = 'falconcut.captionPresets';

const DENSITIES = [
  { id: 'tight', label: 'Tight', hint: '1 line · ~3s · social' },
  { id: 'balanced', label: 'Balanced', hint: '2 lines · ~6s' },
  { id: 'relaxed', label: 'Relaxed', hint: '2 lines · ~9s · interview' },
] as const;
type Density = (typeof DENSITIES)[number]['id'];
const PRESET_SAMPLES: Record<CinematicPresetId, { text: string; hi: string }> = {
  default: { text: 'your story', hi: '' },
  tiktok: { text: 'your STORY', hi: 'STORY' },
  karaoke: { text: 'EVERY STORY', hi: 'STORY' },
  beast: { text: 'EVERY STORY', hi: 'STORY' },
  focus: { text: 'your STORY', hi: 'STORY' },
  mogul: { text: 'YOUR STORY', hi: 'STORY' },
  minimal: { text: 'your story', hi: '' },
  documentary: { text: 'your story', hi: '' },
  podcast: { text: 'your STORY', hi: 'STORY' },
  gaming: { text: 'YOUR STORY', hi: 'STORY' },
  cinematic: { text: 'your STORY', hi: 'STORY' },
};

const ANIMATIONS: TextStyle['animation'][] = [
  'none', 'fade', 'fade-in', 'fade-out', 'pop', 'rise', 'slide', 'bounce', 'zoom',
  'typewriter', 'blur', 'glitch', 'wave', 'shake', 'pulse',
];
const WEIGHTS: TextStyle['fontWeight'][] = [300, 400, 600, 700, 800, 900];

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const fmtSigned = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

/** Map a stored color ('#hex' or 'rgba(...)') to a hex an <input type=color> can show. */
function toHex(c: string): string {
  if (c.startsWith('#')) return c;
  const m = c.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    const [r, g, b] = m.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
  return '#000000';
}

/* ---------------- live style preview (CSS approximation of drawCaption) ---------------- */

export function StylePreview({ style, sample = 'your story', hi = 'story' }: {
  style: TextStyle; sample?: string; hi?: string;
}) {
  const fs = Math.max(9, Math.min(26, style.fontSize * 400)); // fontSize fraction, scaled to card
  const stroke = Math.min(fs * 0.1, fs * Math.min(0.06, style.outlineWidth) * 2); // subtle outline only
  const wordPop = style.preset === 'karaoke' || style.preset === 'word-pop' || style.preset === 'bold-keywords';
  const bg = style.bgColor !== 'transparent' ? style.bgColor : undefined;
  const words = sample.split(/\s+/).filter(Boolean);
  const baseStroke = {
    WebkitTextStrokeWidth: stroke > 0.2 ? `${stroke.toFixed(1)}px` : 0,
    WebkitTextStrokeColor: style.outlineColor,
    paintOrder: 'stroke fill' as const,
  };
  return (
    <div
      className="relative w-full h-full overflow-hidden rounded-lg"
      style={{ background: 'linear-gradient(160deg, #46586e 0%, #23262e 75%)' }}
    >
      <div
        className="absolute"
        style={{
          left: `${style.x * 100}%`,
          top: `${style.y * 100}%`,
          transform: 'translate(-50%, -50%)',
          maxWidth: '94%',
          textAlign: style.align,
        }}
      >
        <span
          className="inline-flex flex-wrap items-center justify-center gap-x-[0.25em] gap-y-0 leading-tight"
          style={{
            fontSize: fs,
            fontWeight: style.fontWeight,
            fontFamily: style.fontFamily,
            letterSpacing: `${style.letterSpacing}em`,
            textTransform: style.uppercase ? 'uppercase' : 'none',
            textShadow: style.shadow ? `0 ${(fs * 0.05).toFixed(1)}px ${(fs * 0.16).toFixed(1)}px rgba(0,0,0,0.75)` : 'none',
            background: bg,
            padding: bg ? `${(style.bgPadding * 0.8).toFixed(2)}em ${(style.bgPadding * 1).toFixed(2)}em` : undefined,
            borderRadius: bg ? `${(fs * 0.22).toFixed(0)}px` : undefined,
          }}
        >
          {words.map((word, i) => {
            const isHi = hi && word.toLowerCase() === hi.toLowerCase();
            const hiBg = isHi && style.highlight?.enabled ? style.highlight.bgColor : undefined;
            const hiOpaque = !!hiBg && hiBg !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(hiBg);
            const wordColor = isHi
              ? (style.highlight?.enabled ? (style.highlight.textColor || style.highlightColor) : (wordPop ? style.highlightColor : style.color))
              : style.color;
            const gradient = !isHi && wordColor.startsWith('linear-gradient(');
            return (
              <span key={i} style={{
                ...baseStroke,
                // A solid highlight already separates the word from the
                // background — stroking it as well looks like a heavy box.
                WebkitTextStrokeWidth: hiOpaque ? 0 : baseStroke.WebkitTextStrokeWidth,
                color: gradient ? 'transparent' : wordColor,
                backgroundImage: gradient ? wordColor : undefined,
                WebkitBackgroundClip: gradient ? 'text' : undefined,
                WebkitTextFillColor: gradient ? 'transparent' : undefined,
                background: hiBg,
                padding: hiBg ? `0 ${(style.highlight!.padding * 0.7).toFixed(2)}em` : undefined,
                borderRadius: hiBg ? `${(fs * style.highlight!.radius).toFixed(0)}px` : undefined,
                boxShadow: hiBg && style.highlight!.glow > 0
                  ? `0 0 ${(fs * style.highlight!.glow).toFixed(1)}px ${hiBg}` : undefined,
              }}>{word}</span>
            );
          })}
        </span>
      </div>
    </div>
  );
}

/* ---------------- main tab ---------------- */

export function CaptionsTab() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const playhead = useStore((s) => s.playhead);
  const [mode, setMode] = useState<'manual' | 'ai'>('manual');
  const [style, setStyle] = useState<CaptionStyleId>('clean');
  const [presetId, setPresetId] = useState<CinematicPresetId>('default');
  const [selectedWords, setSelectedWords] = useState<number[]>([]);
  const [presetName, setPresetName] = useState('');
  const [savedPresets, setSavedPresets] = useState<Record<string, TextStyle>>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_PRESETS_KEY) || '{}') as Record<string, TextStyle>; }
    catch { return {}; }
  });
  const [density, setDensity] = useState<Density>('balanced');
  const [cleanFillers, setCleanFillers] = useState(true);
  const [highlight, setHighlight] = useState(true);
  const [effect, setEffect] = useState<TextEffect>('shadow');
  const [transition, setTransition] = useState<TextTransition>('in');
  const [busy, setBusy] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ui = useUI();

  const captions = project.clips.filter((c) => c.text?.role === 'caption').sort((a, b) => a.start - b.start);
  const selectedCaption = captions.find((c) => selection.includes(c.id));
  // Advanced editor targets: the selected caption clip if one is selected, else all caption clips.
  const targets = selectedCaption ? [selectedCaption] : captions;
  const currentStyle = targets[0]?.text?.style ? {
    ...defaultTextStyle(targets[0].text.style.preset),
    ...targets[0].text.style,
    highlight: { ...defaultTextStyle().highlight, ...(targets[0].text.style.highlight ?? {}) },
  } : undefined;
  const appliesLabel = selectedCaption
    ? 'Applies to: selected caption clip'
    : captions.length
      ? `Applies to: all ${captions.length} caption clips`
      : 'No caption clips to style';

  const generate = async () => {
    setBusy(true);
    try {
      const r = await useStore.getState().applyTool('add_captions', {
        style,
        density,
        remove_fillers: cleanFillers,
        highlight_keywords: highlight,
      });
      ui.toast(r.summary || 'Captions generated', 'success');
    } catch (e) {
      ui.toast(`Caption generation failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Create a caption clip in a chosen style, directly on the video timeline.
   * It renders into the exported video — no subtitle download needed. */
  const addStyledCaption = (id: CinematicPresetId) => {
    const p = CAPTION_PRESETS.find((x) => x.id === id) ?? CAPTION_PRESETS[0];
    setPresetId(id);
    setStyle(p.styleId);
    setEffect(p.effect);
    setTransition(p.transition);
    const text = 'EVERY CONVERSATION HAS A STORY';
    const duration = 3.2;
    const { actions, clipId } = buildStyledText(project, {
      start: playhead, duration, text, role: 'caption',
      preset: p.styleId, effect: p.effect, transition: p.transition,
      presetId: id, words: evenWords(text, duration),
    });
    commit(actions, `Add ${p.label} caption`);
    if (clipId) useStore.getState().select([clipId]);
    setSelectedWords([]);
    ui.toast(`${p.label} caption added — word timing is editable and renders in export`, 'success');
  };

  /** Effect/transition chips: change the default for new captions and, when
   * one is selected, restyle it in the same undo step. */
  const applyLook = (params: { effect?: TextEffect; transition?: TextTransition }) => {
    if (params.effect) setEffect(params.effect);
    if (params.transition) setTransition(params.transition);
    if (!selectedCaption) return;
    const actions = [
      ...(params.effect ? [{ type: 'set_text_style' as const, clipId: selectedCaption.id, patch: effectPatch(style, params.effect, 'caption', project.settings.aspect) }] : []),
      ...(params.transition ? transitionActions(selectedCaption.id, params.transition) : []),
    ];
    if (actions.length) commit(actions, 'Caption look');
  };

  const importSubs = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const r = await useStore.getState().applyTool('import_captions', { srt: text });
      ui.toast(r.summary, r.actions.length ? 'success' : 'error');
    } catch (e) {
      ui.toast(`Import failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const exportSRT = () => {
    const srt = projectSRT(project);
    if (!srt.trim()) { ui.toast('No captions to export', 'error'); return; }
    downloadBlob(new Blob([srt], { type: 'text/plain' }), `${project.name || 'captions'}.srt`);
    ui.toast('SRT downloaded', 'success');
  };

  const exportVTT = () => {
    const vtt = projectVTT(project);
    if (!vtt.trim()) { ui.toast('No captions to export', 'error'); return; }
    downloadBlob(new Blob([vtt], { type: 'text/vtt' }), `${project.name || 'captions'}.vtt`);
    ui.toast('WebVTT downloaded', 'success');
  };

  const copySRT = async () => {
    const srt = projectSRT(project);
    if (!srt.trim()) { ui.toast('No captions to copy', 'error'); return; }
    try {
      await navigator.clipboard.writeText(srt);
      ui.toast('SRT copied to clipboard', 'success');
    } catch {
      ui.toast('Clipboard unavailable in this browser', 'error');
    }
  };

  const patchStyle = (patch: Partial<TextStyle>, label: string, key?: string) => {
    if (!targets.length) return;
    commit(targets.map((c) => ({ type: 'set_text_style' as const, clipId: c.id, patch })), label, key);
  };

  // Word timeline helpers — every edit is a real set_text action (undoable,
  // persisted, and rendered by drawCaption using the word's own timing).
  const captionWords: CaptionWord[] = selectedCaption
    ? (selectedCaption.text?.words?.length
      ? selectedCaption.text.words
      : evenWords(selectedCaption.text?.text ?? '', selectedCaption.duration))
    : [];
  const writeWords = (words: CaptionWord[], label: string) => {
    if (!selectedCaption) return;
    commit([{ type: 'set_text', clipId: selectedCaption.id, words }], label);
  };
  const toggleWord = (i: number, shift: boolean) => setSelectedWords((prev) => {
    if (shift) return prev.includes(i) ? prev.filter((n) => n !== i) : [...prev, i];
    return prev.length === 1 && prev[0] === i ? [] : [i];
  });
  const patchWords = (patch: WordStyle) => {
    writeWords(captionWords.map((w, i) => selectedWords.includes(i)
      ? { ...w, style: { ...(w.style ?? {}), ...patch } } : w), 'Word style');
  };
  const patchWordTiming = (i: number, field: 'start' | 'end', value: number) => {
    writeWords(captionWords.map((w, idx) => idx === i ? { ...w, [field]: value } : w), 'Word timing');
  };
  const patchHighlight = (patch: Partial<TextStyle['highlight']>) => {
    if (!currentStyle?.highlight) return;
    patchStyle({ highlight: { ...currentStyle.highlight, ...patch } }, 'Caption highlight');
  };

  const persistPresets = (next: Record<string, TextStyle>) => {
    setSavedPresets(next);
    try { localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const saveCurrentPreset = () => {
    const name = presetName.trim() || `My style ${Object.keys(savedPresets).length + 1}`;
    if (!currentStyle) { ui.toast('Add a caption first', 'info'); return; }
    persistPresets({ ...savedPresets, [name]: JSON.parse(JSON.stringify(currentStyle)) as TextStyle });
    setPresetName('');
    ui.toast(`Saved caption preset “${name}”`, 'success');
  };

  const seekTo = (clipId: string, start: number) => {
    useStore.getState().setPlayhead(start);
    useStore.getState().select([clipId]);
  };

  const splitCaption = (c: (typeof captions)[number]) =>
    commit([{ type: 'split_clip', clipId: c.id, time: c.start + c.duration / 2 }], 'Split caption');

  const deleteCaption = (c: (typeof captions)[number]) =>
    commit([{ type: 'remove_clip', clipId: c.id, ripple: true }], 'Delete caption');

  const addCaption = () => {
    const text = 'New caption';
    const { actions, clipId } = buildStyledText(project, {
      start: playhead, duration: 2, text, role: 'caption',
      preset: style, effect, transition, presetId, words: evenWords(text, 2),
    });
    commit(actions, 'Add caption');
    if (clipId) useStore.getState().select([clipId]);
  };

  const srt = projectSRT(project);

  return (
    <div>
      <Section title="Caption Studio — choose a workflow">
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => setMode('manual')}
            className={`rounded-lg border p-2 text-left transition-colors ${mode === 'manual' ? 'border-signal/60 bg-signal/10' : 'border-line hover:border-signal/40 bg-ink-850'}`}>
            <span className={`block text-xs font-semibold ${mode === 'manual' ? 'text-signal' : 'text-paper'}`}>Create captions manually</span>
            <span className="block text-[10px] text-paper-faint">Works immediately — no AI or downloads</span>
          </button>
          <button onClick={() => setMode('ai')}
            className={`rounded-lg border p-2 text-left transition-colors ${mode === 'ai' ? 'border-signal/60 bg-signal/10' : 'border-line hover:border-signal/40 bg-ink-850'}`}>
            <span className={`block text-xs font-semibold ${mode === 'ai' ? 'text-signal' : 'text-paper'}`}>Create captions with AI</span>
            <span className="block text-[10px] text-paper-faint">Local Whisper · on-demand models</span>
          </button>
        </div>
      </Section>
      {mode === 'manual' ? <ManualCaptionTools /> : <AiCaptionPanel />}
      <Section title="Generate">
        <button className="btn-signal w-full justify-center text-xs" disabled={busy} onClick={() => void generate()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Generate captions
        </button>
        <div className="grid grid-cols-3 gap-1">
          {DENSITIES.map((d) => (
            <button key={d.id} title={d.hint} onClick={() => setDensity(d.id)}
              className={`chip justify-center border ${density === d.id ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setCleanFillers((v) => !v)} title="Drop um / uh / hmm from caption text"
            className={`chip flex-1 justify-center border ${cleanFillers ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>
            Clean fillers {cleanFillers ? 'on' : 'off'}
          </button>
          <button onClick={() => setHighlight((v) => !v)} title="Colour keywords in karaoke / bold-keywords styles"
            className={`chip flex-1 justify-center border ${highlight ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>
            Keywords {highlight ? 'on' : 'off'}
          </button>
        </div>
      </Section>

      <Section title="Caption presets — click to add to video">
        <div className="grid grid-cols-2 gap-1.5">
          {CAPTION_PRESETS.map((p) => (
            <button key={p.id} onClick={() => addStyledCaption(p.id)}
              title={`Add ${p.label} caption at the playhead with word-by-word speech sync`}
              className={`rounded-lg border overflow-hidden text-left transition-all ${presetId === p.id ? 'ring-2 ring-signal border-transparent' : 'border-line hover:border-line-bright'}`}>
              <div className="aspect-video">
                <StylePreview style={presetTextStyle(p.id, 'caption', project.settings.aspect)}
                  sample={PRESET_SAMPLES[p.id].text} hi={PRESET_SAMPLES[p.id].hi} />
              </div>
              <div className="flex items-center justify-between px-2 py-1">
                <span className={`text-[11px] font-medium ${presetId === p.id ? 'text-signal' : 'text-paper-dim'}`}>{p.label}</span>
                <Plus size={12} className={presetId === p.id ? 'text-signal' : 'text-paper-faint'} />
              </div>
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button className="btn-ghost flex-1 justify-center text-[11px]" disabled={!selectedCaption}
            onClick={() => {
              if (!selectedCaption) return;
              commit(presetActions(selectedCaption.id, presetId, 'caption', project.settings.aspect, selectedCaption.text?.text, selectedCaption.duration, selectedCaption.text?.words?.length ?? 0), `Apply ${presetId} preset`);
              ui.toast('Preset applied to selected caption', 'success');
            }} title="Apply the selected preset to the selected caption">
            <WandSparkles size={13} /> Apply to selected
          </button>
          <button className="btn-ghost flex-1 justify-center text-[11px]" disabled={!captions.length}
            onClick={() => {
              const actions = captions.flatMap((c) => presetActions(c.id, presetId, 'caption', project.settings.aspect, c.text?.text, c.duration, c.text?.words?.length ?? 0));
              commit(actions, `Apply ${presetId} preset to all captions`);
              ui.toast(`${presetId} preset applied to ${captions.length} captions`, 'success');
            }} title="Apply the selected preset to every caption in the project">
            <WandSparkles size={13} /> Apply to all
          </button>
        </div>

        <div>
          <span className="label">Effect {selectedCaption ? '· selected caption' : '· new captions'}</span>
          <div className="flex flex-wrap gap-1">
            {TEXT_EFFECTS.map((e) => (
              <button key={e.id} title={e.hint} onClick={() => applyLook({ effect: e.id })}
                className={`chip border ${effect === e.id ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}>
                {e.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Transition {selectedCaption ? '· selected caption' : '· new captions'}</span>
          <div className="flex flex-wrap gap-1">
            {TEXT_TRANSITIONS.map((t) => (
              <button key={t.id} title={t.hint} onClick={() => applyLook({ transition: t.id })}
                className={`chip border ${transition === t.id ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => setAdvOpen((v) => !v)}
          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg border border-line text-[11px] font-medium text-paper-dim hover:text-paper hover:bg-ink-800">
          <span className="font-display">Advanced style</span>
          <ChevronDown size={14} className={`transition-transform ${advOpen ? 'rotate-180' : ''}`} />
        </button>
        {advOpen && (
          <div className="panel p-2.5 space-y-2.5 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-paper-faint">{appliesLabel}</span>
              {currentStyle && <span className="chip bg-ink-750 text-paper-dim">{currentStyle.preset}</span>}
            </div>
            {!currentStyle ? (
              <Hint>Generate or add a caption first to edit its style.</Hint>
            ) : (
              <>
                <DragSlider label="Font size" value={currentStyle.fontSize} min={0.02} max={0.12} step={0.001}
                  fmt={(v) => v.toFixed(3)}
                  onCommit={(v) => patchStyle({ fontSize: v }, 'Caption font size', `${targets[0].id}:fontSize`)} />
                <div>
                  <span className="label">Font weight</span>
                  <div className="flex gap-1">
                    {WEIGHTS.map((w) => (
                      <button key={w} onClick={() => patchStyle({ fontWeight: w }, 'Caption font weight', `${targets[0].id}:weight`)}
                        className={`chip flex-1 justify-center border transition-colors ${currentStyle.fontWeight === w ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}
                        style={{ fontWeight: w }}>{w}</button>
                    ))}
                  </div>
                </div>
                <DragSlider label="Letter spacing" value={currentStyle.letterSpacing} min={-0.02} max={0.3} step={0.005}
                  fmt={(v) => `${fmtSigned(v)}em`}
                  onCommit={(v) => patchStyle({ letterSpacing: v }, 'Caption letter spacing', `${targets[0].id}:ls`)} />
                <div className="flex gap-1.5">
                  <button onClick={() => patchStyle({ uppercase: !currentStyle.uppercase }, 'Caption uppercase', `${targets[0].id}:upper`)}
                    className={`chip border flex-1 justify-center ${currentStyle.uppercase ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>
                    Aa Uppercase {currentStyle.uppercase ? 'on' : 'off'}
                  </button>
                  <button onClick={() => patchStyle({ shadow: !currentStyle.shadow }, 'Caption shadow', `${targets[0].id}:shadow`)}
                    className={`chip border flex-1 justify-center ${currentStyle.shadow ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>
                    Shadow {currentStyle.shadow ? 'on' : 'off'}
                  </button>
                </div>
                <DragSlider label="Outline width" value={currentStyle.outlineWidth} min={0} max={0.4} step={0.01}
                  fmt={(v) => v.toFixed(2)}
                  onCommit={(v) => patchStyle({ outlineWidth: v }, 'Caption outline width', `${targets[0].id}:ow`)} />
                <div className="flex gap-2.5">
                  {([['Text', 'color'], ['Highlight', 'highlightColor'], ['Outline', 'outlineColor']] as const).map(([lbl, field]) => (
                    <div key={field} className="flex-1">
                      <span className="label">{lbl}</span>
                      <input type="color" className="w-full h-7 rounded-md border border-line bg-ink-850 cursor-pointer"
                        value={toHex(currentStyle[field])}
                        onChange={(e) => patchStyle({ [field]: e.target.value } as Partial<TextStyle>, `Caption ${lbl.toLowerCase()} color`, `${targets[0].id}:${field}`)} />
                    </div>
                  ))}
                </div>
                <div>
                  <span className="label">Quick text colors</span>
                  <div className="flex flex-wrap gap-1">
                    {CAPTION_COLORS.map((c) => (
                      <button key={c.value} title={c.name} onClick={() => patchStyle({ color: c.value }, 'Caption color')}
                        className={`w-5 h-5 rounded border-2 ${currentStyle.color.toLowerCase() === c.value.toLowerCase() ? 'border-signal' : 'border-line'}`}
                        style={{ background: c.value }} />
                    ))}
                  </div>
                </div>
                <div>
                  <span className="label">Gradient text</span>
                  <div className="flex flex-wrap gap-1">
                    {CAPTION_GRADIENTS.map((g) => (
                      <button key={g.value} title={g.name} onClick={() => patchStyle({ color: g.value }, 'Caption gradient')}
                        className={`chip border ${currentStyle.color === g.value ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}>
                        {g.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="label">Quick highlight colors</span>
                  <div className="flex flex-wrap gap-1">
                    {CAPTION_COLORS.slice(4, 18).map((c) => (
                      <button key={c.value} title={c.name} onClick={() => patchHighlight({ bgColor: c.value })}
                        className="w-5 h-5 rounded border-2 border-line hover:border-signal" style={{ background: c.value }} />
                    ))}
                  </div>
                </div>
                <div className="flex gap-1.5 items-end">
                  <div className="flex-1">
                    <span className="label">Background</span>
                    <input type="color" disabled={currentStyle.bgColor === 'transparent'}
                      className="w-full h-7 rounded-md border border-line bg-ink-850 cursor-pointer disabled:opacity-30"
                      value={toHex(currentStyle.bgColor)}
                      onChange={(e) => patchStyle({ bgColor: e.target.value }, 'Caption background color', `${targets[0].id}:bg`)} />
                  </div>
                  <button onClick={() => patchStyle({ bgColor: currentStyle.bgColor === 'transparent' ? 'rgba(0,0,0,0.45)' : 'transparent' }, 'Caption background transparent', `${targets[0].id}:bg`)}
                    className={`chip border ${currentStyle.bgColor === 'transparent' ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>
                    Transparent
                  </button>
                </div>
                <DragSlider label="Bg padding" value={currentStyle.bgPadding} min={0} max={1} step={0.01}
                  fmt={(v) => v.toFixed(2)}
                  onCommit={(v) => patchStyle({ bgPadding: v }, 'Caption bg padding', `${targets[0].id}:bgp`)} />
                <DragSlider label="Position Y" value={currentStyle.y} min={0.05} max={0.95} step={0.01}
                  fmt={(v) => v.toFixed(2)}
                  onCommit={(v) => patchStyle({ y: v }, 'Caption position Y', `${targets[0].id}:y`)} />
                <DragSlider label="Position X" value={currentStyle.x} min={0.1} max={0.9} step={0.01}
                  fmt={(v) => v.toFixed(2)}
                  onCommit={(v) => patchStyle({ x: v }, 'Caption position X', `${targets[0].id}:x`)} />
                <div>
                  <span className="label">Align</span>
                  <div className="flex gap-1">
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <button key={a} onClick={() => patchStyle({ align: a }, 'Caption align', `${targets[0].id}:align`)}
                        className={`chip flex-1 justify-center capitalize border ${currentStyle.align === a ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}>{a}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="label">Animation</span>
                  <div className="flex flex-wrap gap-1">
                    {ANIMATIONS.map((a) => (
                      <button key={a} onClick={() => patchStyle({ animation: a }, 'Caption animation', `${targets[0].id}:anim`)}
                        className={`chip border ${currentStyle.animation === a ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper hover:bg-ink-800'}`}>{a}</button>
                    ))}
                  </div>
                </div>
                <DragSlider label="Max width" value={currentStyle.maxWidth} min={0.2} max={1} step={0.01}
                  fmt={(v) => `${Math.round(v * 100)}%`}
                  onCommit={(v) => patchStyle({ maxWidth: v }, 'Caption max width', `${targets[0].id}:mw`)} />
              </>
            )}
          </div>
        )}
      </Section>

      <Section title="Word timeline — click a word, Shift-click for multiple" action={
        <button className="icon-btn" title="Distribute words evenly across the caption" disabled={!selectedCaption}
          onClick={() => selectedCaption && writeWords(evenWords(selectedCaption.text?.text ?? '', selectedCaption.duration), 'Reset word timing')}>
          <WandSparkles size={14} />
        </button>
      }>
        {!selectedCaption ? (
          <Hint>Select a caption below to edit its individual words and timing.</Hint>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {captionWords.map((w, i) => (
                <button key={i} onClick={(e) => toggleWord(i, e.shiftKey)}
                  title={`${w.w} · ${w.start.toFixed(2)}s → ${w.end.toFixed(2)}s`}
                  className={`chip border ${selectedWords.includes(i) ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>
                  {w.w}<span className="ml-1 text-[9px] text-paper-faint">{w.start.toFixed(1)}s</span>
                </button>
              ))}
            </div>
            {selectedWords.map((i) => {
              const w = captionWords[i];
              if (!w) return null;
              return (
                <div key={i} className="panel p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-paper">“{w.w}”</span>
                    <span className="text-[10px] text-paper-faint">{selectedWords.length} selected</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input type="color" className="w-9 h-7 rounded border border-line bg-ink-850 cursor-pointer"
                      value={toHex(w.style?.color ?? currentStyle?.color ?? '#FFFFFF')}
                      onChange={(e) => patchWords({ color: e.target.value })} title="Word color" />
                    {[400, 700, 900].map((wt) => (
                      <button key={wt} className={`chip border ${(w.style?.fontWeight ?? currentStyle?.fontWeight) === wt ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line'}`}
                        onClick={() => patchWords({ fontWeight: wt })} style={{ fontWeight: wt }}>{wt}</button>
                    ))}
                    <button className={`chip border ${w.style?.fontStyle === 'italic' ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line'}`}
                      onClick={() => patchWords({ fontStyle: w.style?.fontStyle === 'italic' ? 'normal' : 'italic' })}>Italic</button>
                  </div>
                  <DragSlider label="Word start" value={w.start} min={0} max={Math.max(0.1, selectedCaption.duration)} step={0.01}
                    fmt={(v) => `${v.toFixed(2)}s`} onCommit={(v) => patchWordTiming(i, 'start', Math.min(v, w.end - 0.01))} />
                  <DragSlider label="Word end" value={w.end} min={0} max={Math.max(0.1, selectedCaption.duration)} step={0.01}
                    fmt={(v) => `${v.toFixed(2)}s`} onCommit={(v) => patchWordTiming(i, 'end', Math.max(v, w.start + 0.01))} />
                </div>
              );
            })}
          </>
        )}
      </Section>

      <Section title="Highlight & typography">
        {!currentStyle ? (
          <Hint>Add a caption to customize its highlight and typography.</Hint>
        ) : (
          <>
            <button onClick={() => patchStyle({ revealWords: !currentStyle.revealWords }, 'Word-by-word reveal')}
              className={`chip w-full justify-center border ${currentStyle.revealWords ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}>
              Word-by-word reveal {currentStyle.revealWords ? 'on' : 'off'}
            </button>
            <button onClick={() => patchHighlight({ enabled: !currentStyle.highlight?.enabled })}
              className={`chip w-full justify-center border ${currentStyle.highlight?.enabled ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}>
              Active-word highlight {currentStyle.highlight?.enabled ? 'on' : 'off'}
            </button>
            <div>
              <span className="label">Highlight animation</span>
              <div className="flex flex-wrap gap-1">
                {(['instant', 'slide', 'pop', 'scale', 'fade', 'wipe', 'color', 'bar', 'glitch'] as HighlightAnim[]).map((a) => (
                  <button key={a} onClick={() => patchHighlight({ anim: a })}
                    className={`chip border capitalize ${currentStyle.highlight?.anim === a ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>{a}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-2.5">
              <div className="flex-1">
                <span className="label">Highlight bg</span>
                <input type="color" className="w-full h-7 rounded border border-line bg-ink-850 cursor-pointer"
                  value={toHex(currentStyle.highlight?.bgColor ?? '#FFEB00')}
                  onChange={(e) => patchHighlight({ bgColor: e.target.value })} />
              </div>
              <div className="flex-1">
                <span className="label">Highlight text</span>
                <input type="color" className="w-full h-7 rounded border border-line bg-ink-850 cursor-pointer"
                  value={toHex(currentStyle.highlight?.textColor ?? '#0B1220')}
                  onChange={(e) => patchHighlight({ textColor: e.target.value })} />
              </div>
            </div>
            {([
              ['Padding', 'padding', 0, 0.5, 0.01],
              ['Corner radius', 'radius', 0, 0.5, 0.01],
              ['Opacity', 'opacity', 0, 1, 0.01],
              ['Anim speed', 'speed', 0.02, 1, 0.01],
              ['Glow', 'glow', 0, 0.5, 0.01],
              ['Shadow', 'shadow', 0, 0.5, 0.01],
            ] as const).map(([label, key, min, max, step]) => (
              <DragSlider key={key} label={label} value={(currentStyle.highlight?.[key] as number) ?? 0} min={min} max={max} step={step}
                fmt={(v) => v.toFixed(2)} onCommit={(v) => patchHighlight({ [key]: v } as never)} />
            ))}
            <DragSlider label="Font size" value={currentStyle.fontSize} min={0.02} max={0.12} step={0.001}
              fmt={(v) => v.toFixed(3)} onCommit={(v) => patchStyle({ fontSize: v }, 'Caption font size', `${targets[0].id}:fs`)} />
            <DragSlider label="Line spacing" value={currentStyle.lineSpacing || 1.22} min={0.8} max={2} step={0.01}
              fmt={(v) => v.toFixed(2)} onCommit={(v) => patchStyle({ lineSpacing: v }, 'Caption line spacing')} />
            <DragSlider label="Word spacing" value={currentStyle.wordSpacing || 1} min={0.5} max={2} step={0.05}
              fmt={(v) => v.toFixed(2)} onCommit={(v) => patchStyle({ wordSpacing: v }, 'Caption word spacing')} />
            <DragSlider label="Outline" value={currentStyle.outlineWidth} min={0} max={0.4} step={0.01}
              fmt={(v) => v.toFixed(2)} onCommit={(v) => patchStyle({ outlineWidth: v }, 'Caption outline')} />
          </>
        )}
      </Section>

      {currentStyle && (
        <CaptionProperties style={currentStyle} onPatch={patchStyle} onPatchHighlight={patchHighlight} />
      )}

      <Section title="My caption presets">
        <div className="flex gap-1.5">
          <input className="field flex-1 min-w-0 !py-1 !px-2 text-xs" placeholder="Preset name"
            value={presetName} onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveCurrentPreset(); }} />
          <button className="btn-solid text-xs px-2" onClick={saveCurrentPreset}>Save</button>
        </div>
        {Object.keys(savedPresets).length === 0 && <Hint>Save the current caption look here to reuse it on any clip or project.</Hint>}
        {Object.entries(savedPresets).map(([name, saved]) => (
          <div key={name} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5">
            <button className="flex-1 min-w-0 text-left text-xs text-paper truncate"
              title="Apply to selected caption(s)" onClick={() => patchStyle(saved, `Apply preset ${name}`)}>{name}</button>
            <button className="icon-btn hover:text-heat" title={`Delete ${name}`}
              onClick={() => { const next = { ...savedPresets }; delete next[name]; persistPresets(next); }}><Trash2 size={13} /></button>
          </div>
        ))}
      </Section>

      <Section title={`Captions (${captions.length})`} action={
        <button className="icon-btn" title="Add caption at playhead (2s)" onClick={addCaption}><Plus size={14} /></button>
      }>
        {captions.length === 0 && <Hint>No captions yet. Click a style card above to add one to the video, or use the + button at the playhead.</Hint>}
        {captions.map((c) => {
          const isSel = selection.includes(c.id);
          return (
            <div key={c.id}
              className={`rounded-lg border transition-colors ${isSel ? 'border-signal/50 bg-signal/5' : 'border-line hover:bg-ink-800'}`}>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <button className="text-[10px] text-paper-faint hover:text-signal font-mono shrink-0" title="Seek to start and select"
                  onClick={() => seekTo(c.id, c.start)}>
                  {fmtTime(c.start)}
                </button>
                <CaptionTextInput clipId={c.id} text={c.text?.text ?? ''} duration={c.duration} />
                <span className="text-[10px] text-paper-faint font-mono shrink-0">{c.duration.toFixed(1)}s</span>
                {isSel && (
                  <button className="icon-btn shrink-0" title="Split at middle" onClick={() => splitCaption(c)}><Scissors size={13} /></button>
                )}
                <button className="icon-btn shrink-0 hover:text-heat" title="Delete caption" onClick={() => deleteCaption(c)}><Trash2 size={13} /></button>
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="Export">
        <div className="flex gap-1.5">
          <button className="btn-signal flex-1 justify-center text-xs" onClick={exportSRT}><Download size={14} /> Export SRT</button>
          <button className="btn-solid justify-center text-xs" title="Export WebVTT" onClick={exportVTT}><Download size={14} /> VTT</button>
          <button className="btn-solid justify-center text-xs" title="Copy SRT to clipboard" disabled={!srt.trim()} onClick={() => void copySRT()}>
            <Copy size={14} />
          </button>
        </div>
        <button className="btn-ghost w-full justify-center text-[11px]" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> Import SRT / VTT
        </button>
        <input ref={fileRef} type="file" accept=".srt,.vtt,text/plain" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSubs(f); }} />
        <p className="text-[10px] text-paper-faint">Import replaces existing captions — one undo step restores them.</p>
      </Section>
    </div>
  );
}

/** Editable caption text: drafts locally, commits set_text on blur/Enter. */
function CaptionTextInput({ clipId, text, duration }: { clipId: string; text: string; duration: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [text, clipId]);
  const commitEdit = () => {
    if (draft != null && draft !== text) {
      const existing = useStore.getState().project.clips.find((c) => c.id === clipId)?.text?.words ?? [];
      const parts = draft.trim().split(/\s+/).filter(Boolean);
      // Keep speech timing when only wording changed; rebuild it when the word
      // count changed so no stale words linger in the timeline.
      const words = existing.length === parts.length && parts.length > 0
        ? existing.map((w, i) => ({ ...w, w: parts[i] }))
        : evenWords(draft, duration);
      commit([{ type: 'set_text', clipId, text: draft, words }], 'Edit caption');
    }
    setDraft(null);
  };
  return (
    <input
      className="field flex-1 min-w-0 !py-1 !px-2 text-xs"
      value={draft ?? text}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitEdit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="Caption text"
    />
  );
}
