import { DEFAULT_ACCENT, useUI } from '../state/ui';

/** Preset accents are mid-bright so `text-ink-950` on accent buttons stays
 * readable across every swatch. */
const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'Signal blue', hex: '#4C9AFF' },
  { name: 'Sky', hex: '#38BDF8' },
  { name: 'Teal', hex: '#2DD4BF' },
  { name: 'Emerald', hex: '#34D399' },
  { name: 'Amber', hex: '#FBBF24' },
  { name: 'Rose', hex: '#FB7185' },
  { name: 'Violet', hex: '#A78BFA' },
  { name: 'Pink', hex: '#F472B6' },
];

/** Settings → Appearance: accent theme + control density, both persisted. */
export function AppearanceSection() {
  const accent = useUI((s) => s.accent);
  const setAccent = useUI((s) => s.setAccent);
  const density = useUI((s) => s.density);
  const setDensity = useUI((s) => s.setDensity);
  const toast = useUI((s) => s.toast);

  return (
    <section className="space-y-5" aria-label="Appearance">
      <div>
        <h2 className="label">Accent color</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-paper-dim">
          One accent drives buttons, focus rings, sliders, the playhead and selection highlights across the whole editor.
          Saved on this device.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((p) => {
            const active = accent.toLowerCase() === p.hex.toLowerCase();
            return (
              <button
                key={p.hex}
                type="button"
                title={p.name}
                aria-label={`Accent: ${p.name}`}
                aria-pressed={active}
                onClick={() => { setAccent(p.hex); toast(`Accent set to ${p.name}`, 'success'); }}
                className={`size-8 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${active ? 'border-paper scale-110' : 'border-ink-600'}`}
                style={{ background: p.hex }}
              />
            );
          })}
          <label
            className="ml-1 flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-paper-dim hover:text-paper cursor-pointer"
            title="Pick a custom accent"
          >
            <input
              type="color"
              value={accent}
              aria-label="Custom accent color"
              onChange={(e) => setAccent(e.target.value)}
              className="!w-6 !h-5"
            />
            Custom
          </label>
          <button
            type="button"
            className="btn-ghost text-xs py-1"
            disabled={accent === DEFAULT_ACCENT}
            onClick={() => { setAccent(DEFAULT_ACCENT); toast('Accent reset to default blue'); }}
          >
            Default
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2" aria-hidden>
          <span className="btn-signal text-xs pointer-events-none">Primary button</span>
          <span className="chip bg-signal/15 text-signal pointer-events-none">chip</span>
          <span className="text-signal text-xs pointer-events-none">accent text</span>
          <span className="h-2 w-16 rounded-full bg-signal/40 pointer-events-none" />
        </div>
      </div>

      <div>
        <h2 className="label">Control density</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-paper-dim">
          Compact fits more controls on tablets and small laptops; comfortable gives every control more breathing room.
        </p>
        <div className="mt-2.5 flex gap-1.5" role="group" aria-label="Control density">
          {(['comfortable', 'compact'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={density === d}
              className={density === d ? 'btn-signal text-xs py-1.5 capitalize' : 'btn-solid text-xs py-1.5 capitalize'}
              onClick={() => setDensity(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="panel bg-ink-850 p-3 text-[11px] leading-relaxed text-paper-dim">
        <h3 className="mb-1 font-display font-semibold text-paper">Also here</h3>
        Timeline height is dragged from the bar above the timeline (saved separately for phone, tablet and desktop),
        panel widths drag from their edges, and the preview has its own zoom and rate controls.
      </div>
    </section>
  );
}
