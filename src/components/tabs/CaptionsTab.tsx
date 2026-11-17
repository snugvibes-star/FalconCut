/** Caption studio: style cards with live CSS previews of the real TextStyle,
 * an advanced per-field style editor, and an editable caption list. Every
 * control maps to a real engine action (set_text_style / set_text /
 * split_clip / add_text / remove_clip). */
import { useEffect, useState } from 'react';
import { Loader2, Download, Copy, Trash2, Scissors, Plus, ChevronDown } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { commit, Section, Hint, DragSlider } from './shared';
import { defaultTextStyle, type CaptionStyleId, type TextStyle } from '../../../engine';
import { projectSRT, downloadBlob } from '../../../exporter/artifacts';

const STYLES: CaptionStyleId[] = ['clean', 'karaoke', 'bold-keywords', 'word-pop'];
const ANIMATIONS: TextStyle['animation'][] = ['none', 'pop', 'fade', 'rise', 'typewriter'];
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

function StylePreview({ style }: { style: TextStyle }) {
  const fs = Math.max(9, Math.min(26, style.fontSize * 400)); // fontSize fraction, scaled to card
  const stroke = Math.min(fs * 0.45, fs * style.outlineWidth * 2); // canvas lineWidth = fs*ow*2
  const wordPop = style.preset === 'karaoke' || style.preset === 'word-pop' || style.preset === 'bold-keywords';
  const bg = style.bgColor !== 'transparent' ? style.bgColor : undefined;
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
          maxWidth: '92%',
          textAlign: style.align,
          fontFamily: 'Inter Variable, sans-serif',
        }}
      >
        <span
          className="inline-block leading-tight"
          style={{
            fontSize: fs,
            fontWeight: style.fontWeight,
            color: style.color,
            letterSpacing: `${style.letterSpacing}em`,
            textTransform: style.uppercase ? 'uppercase' : 'none',
            WebkitTextStrokeWidth: stroke > 0.2 ? `${stroke.toFixed(1)}px` : 0,
            WebkitTextStrokeColor: style.outlineColor,
            paintOrder: 'stroke fill',
            textShadow: style.shadow ? `0 ${(fs * 0.05).toFixed(1)}px ${(fs * 0.16).toFixed(1)}px rgba(0,0,0,0.75)` : 'none',
            background: bg,
            padding: bg ? `${(style.bgPadding * 0.8).toFixed(2)}em ${(style.bgPadding * 1).toFixed(2)}em` : undefined,
            borderRadius: bg ? `${(fs * 0.22).toFixed(0)}px` : undefined,
          }}
        >
          <span>Sam</span>
          {wordPop ? <span style={{ color: style.highlightColor }}>ple</span> : <span>ple</span>}
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
  const [style, setStyle] = useState<CaptionStyleId>('clean');
  const [busy, setBusy] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const ui = useUI();

  const captions = project.clips.filter((c) => c.text?.role === 'caption').sort((a, b) => a.start - b.start);
  const selectedCaption = captions.find((c) => selection.includes(c.id));
  // Advanced editor targets: the selected caption clip if one is selected, else all caption clips.
  const targets = selectedCaption ? [selectedCaption] : captions;
  const currentStyle = targets[0]?.text?.style;
  const appliesLabel = selectedCaption
    ? 'Applies to: selected caption clip'
    : captions.length
      ? `Applies to: all ${captions.length} caption clips`
      : 'No caption clips to style';

  const generate = async () => {
    setBusy(true);
    try {
      const r = await useStore.getState().applyTool('add_captions', { style });
      ui.toast(r.summary || 'Captions generated', 'success');
    } catch (e) {
      ui.toast(`Caption generation failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportSRT = () => {
    const srt = projectSRT(project);
    if (!srt.trim()) { ui.toast('No captions to export', 'error'); return; }
    downloadBlob(new Blob([srt], { type: 'text/plain' }), `${project.name || 'captions'}.srt`);
    ui.toast('SRT downloaded', 'success');
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

  const restyle = (preset: CaptionStyleId) => {
    setStyle(preset);
    const patch = defaultTextStyle(preset);
    const actions = captions.map((c) => ({ type: 'set_text_style' as const, clipId: c.id, patch }));
    if (actions.length) commit(actions, `Restyle captions: ${preset}`);
  };

  const patchStyle = (patch: Partial<TextStyle>, label: string, key?: string) => {
    if (!targets.length) return;
    commit(targets.map((c) => ({ type: 'set_text_style' as const, clipId: c.id, patch })), label, key);
  };

  const seekTo = (clipId: string, start: number) => {
    useStore.getState().setPlayhead(start);
    useStore.getState().select([clipId]);
  };

  const splitCaption = (c: (typeof captions)[number]) =>
    commit([{ type: 'split_clip', clipId: c.id, time: c.start + c.duration / 2 }], 'Split caption');

  const deleteCaption = (c: (typeof captions)[number]) =>
    commit([{ type: 'remove_clip', clipId: c.id, ripple: true }], 'Delete caption');

  const addCaption = () =>
    commit([{
      type: 'add_text', start: playhead, duration: 2, text: 'New caption', role: 'caption', preset: style,
    }], 'Add caption');

  const srt = projectSRT(project);

  return (
    <div>
      <Section title="Generate">
        <button className="btn-signal w-full justify-center text-xs" disabled={busy} onClick={() => void generate()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Generate captions
        </button>
        <p className="text-[11px] text-paper-faint">Requires analyzed audio with transcript. Style select below also re-styles existing captions.</p>
      </Section>

      <Section title="Style">
        <div className="grid grid-cols-2 gap-1.5">
          {STYLES.map((s) => (
            <button key={s} onClick={() => restyle(s)}
              title={`Use style "${s}" for new captions and re-style existing captions`}
              className={`rounded-lg border overflow-hidden text-left transition-all ${style === s ? 'ring-2 ring-signal border-transparent' : 'border-line hover:border-line-bright'}`}>
              <div className="aspect-video">
                <StylePreview style={defaultTextStyle(s)} />
              </div>
              <div className={`px-2 py-1 text-[11px] font-medium ${style === s ? 'text-signal' : 'text-paper-dim'}`}>{s}</div>
            </button>
          ))}
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

      <Section title={`Captions (${captions.length})`} action={
        <button className="icon-btn" title="Add caption at playhead (2s)" onClick={addCaption}><Plus size={14} /></button>
      }>
        {captions.length === 0 && <Hint>No captions yet. Generate above (requires analyzed audio with transcript), or add one at the playhead.</Hint>}
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
                <CaptionTextInput clipId={c.id} text={c.text?.text ?? ''} />
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
          <button className="btn-solid justify-center text-xs" title="Copy SRT to clipboard" disabled={!srt.trim()} onClick={() => void copySRT()}>
            <Copy size={14} />
          </button>
        </div>
      </Section>
    </div>
  );
}

/** Editable caption text: drafts locally, commits set_text on blur/Enter. */
function CaptionTextInput({ clipId, text }: { clipId: string; text: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [text, clipId]);
  const commitEdit = () => {
    if (draft != null && draft !== text) commit([{ type: 'set_text', clipId, text: draft }], 'Edit caption');
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
