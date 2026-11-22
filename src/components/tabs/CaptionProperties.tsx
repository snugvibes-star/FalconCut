/** Advanced caption properties shared by presets, manual and AI captions. */
import { defaultTextStyle, type TextStyle } from '../../../engine';
import { DragSlider, Section, Hint } from './shared';

const DefaultTextStyle = defaultTextStyle();

interface Props {
  style: TextStyle;
  onPatch: (patch: Partial<TextStyle>, label: string) => void;
  onPatchHighlight: (patch: Partial<TextStyle['highlight']>) => void;
}

const FONTS = ['Inter Variable', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Verdana', 'system-ui'];
const EASINGS: NonNullable<TextStyle['motion']['easing']>[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack', 'easeOutExpo'];

export function CaptionProperties({ style, onPatch, onPatchHighlight }: Props) {
  const hl = style.highlight ?? DefaultTextStyle.highlight;
  const glow = style.glow ?? DefaultTextStyle.glow;
  const blur = style.blur ?? DefaultTextStyle.blur;
  const motion = style.motion ?? DefaultTextStyle.motion;

  return (
    <>
      <Section title="Typography & font">
        <label className="block">
          <span className="label">Font family</span>
          <select className="field py-1 text-xs" value={style.fontFamily} onChange={(e) => onPatch({ fontFamily: e.target.value }, 'Caption font family')}>
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <div>
          <span className="label">Font style</span>
          <div className="flex gap-1">
            {(['normal', 'italic'] as const).map((s) => (
              <button key={s} className={`chip flex-1 justify-center border capitalize ${style.fontStyle === s ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}
                onClick={() => onPatch({ fontStyle: s }, 'Caption font style')}>{s}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Case</span>
          <div className="flex gap-1">
            {(['none', 'upper', 'lower'] as const).map((c) => (
              <button key={c} className={`chip flex-1 justify-center border capitalize ${style.caseMode === c ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}
                onClick={() => onPatch({ caseMode: c }, 'Caption case')}>{c}</button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Appearance & effects">
        <DragSlider label="Text opacity" value={style.textOpacity ?? 1} min={0} max={1} step={0.01}
          fmt={(v) => v.toFixed(2)} onCommit={(v) => onPatch({ textOpacity: v }, 'Caption text opacity')} />
        <DragSlider label="Sharpness" value={style.sharpness ?? 1} min={0} max={1} step={0.01}
          fmt={(v) => v.toFixed(2)} onCommit={(v) => onPatch({ sharpness: v }, 'Caption sharpness')} />
        <DragSlider label="Background blur" value={style.backgroundBlur ?? 0} min={0} max={1} step={0.01}
          fmt={(v) => v.toFixed(2)} onCommit={(v) => onPatch({ backgroundBlur: v }, 'Caption background blur')} />
        <button className={`chip w-full justify-center border ${glow.enabled ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}
          onClick={() => onPatch({ glow: { ...glow, enabled: !glow.enabled } }, 'Caption glow')}>
          Glow {glow.enabled ? 'on' : 'off'}
        </button>
        <div className="flex gap-2">
          <label className="flex-1"><span className="label">Glow color</span>
            <input type="color" className="w-full h-7 rounded border border-line bg-ink-850 cursor-pointer" value={glow.color}
              onChange={(e) => onPatch({ glow: { ...glow, color: e.target.value } }, 'Glow color')} /></label>
          <div className="flex-1">
            <DragSlider label="Glow radius" value={glow.radius} min={0} max={0.5} step={0.01} fmt={(v) => v.toFixed(2)}
              onCommit={(v) => onPatch({ glow: { ...glow, radius: v } }, 'Glow radius')} />
          </div>
        </div>
        <DragSlider label="Glow intensity" value={glow.intensity} min={0} max={2} step={0.01} fmt={(v) => v.toFixed(2)}
          onCommit={(v) => onPatch({ glow: { ...glow, intensity: v } }, 'Glow intensity')} />
        <button className={`chip w-full justify-center border ${blur.enabled ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}
          onClick={() => onPatch({ blur: { ...blur, enabled: !blur.enabled } }, 'Caption blur')}>
          Soft text blur {blur.enabled ? 'on' : 'off'}
        </button>
        <DragSlider label="Blur amount" value={blur.amount} min={0} max={0.3} step={0.005} fmt={(v) => v.toFixed(3)}
          onCommit={(v) => onPatch({ blur: { ...blur, amount: v } }, 'Blur amount')} />
        <div>
          <span className="label">Blur direction</span>
          <div className="flex gap-1">
            {(['left', 'right', 'up', 'down'] as const).map((d) => (
              <button key={d} className={`chip flex-1 justify-center border capitalize ${blur.direction === d ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}
                onClick={() => onPatch({ blur: { ...blur, direction: d } }, 'Blur direction')}>{d}</button>
            ))}
          </div>
        </div>
        <DragSlider label="Edge softness" value={blur.edgeSoftness} min={0} max={1} step={0.01} fmt={(v) => v.toFixed(2)}
          onCommit={(v) => onPatch({ blur: { ...blur, edgeSoftness: v } }, 'Edge softness')} />
      </Section>

      <Section title="Active-word styling">
        <div className="flex gap-2">
          <label className="flex-1"><span className="label">Previous word</span>
            <input type="color" className="w-full h-7 rounded border border-line bg-ink-850 cursor-pointer" value={hl.prevColor ?? '#94A3B8'}
              onChange={(e) => onPatchHighlight({ prevColor: e.target.value })} /></label>
          <label className="flex-1"><span className="label">Next word</span>
            <input type="color" className="w-full h-7 rounded border border-line bg-ink-850 cursor-pointer" value={hl.nextColor ?? '#FFFFFF'}
              onChange={(e) => onPatchHighlight({ nextColor: e.target.value })} /></label>
        </div>
        <DragSlider label="Highlight timing offset" value={hl.offset ?? 0} min={-1} max={1} step={0.01}
          fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}s`} onCommit={(v) => onPatchHighlight({ offset: v })} />
        <Hint>Previous/next word colors apply when the highlight reveals upcoming or recently spoken words. The offset shifts highlighting earlier or later than speech without changing the words themselves.</Hint>
      </Section>

      <Section title="Animation detail">
        <DragSlider label="Motion duration" value={motion.duration ?? 0.4} min={0.1} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}s`}
          onCommit={(v) => onPatch({ motion: { ...motion, duration: v } }, 'Motion duration')} />
        <DragSlider label="Motion delay" value={motion.delay ?? 0} min={0} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}s`}
          onCommit={(v) => onPatch({ motion: { ...motion, delay: v } }, 'Motion delay')} />
        <DragSlider label="Speed" value={motion.speed ?? 1} min={0.1} max={4} step={0.05} fmt={(v) => `${v.toFixed(2)}×`}
          onCommit={(v) => onPatch({ motion: { ...motion, speed: v } }, 'Motion speed')} />
        <div>
          <span className="label">Easing</span>
          <div className="flex flex-wrap gap-1">
            {EASINGS.map((e) => (
              <button key={e} className={`chip border ${motion.easing === e ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim'}`}
                onClick={() => onPatch({ motion: { ...motion, easing: e } }, 'Motion easing')}>{e}</button>
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}
