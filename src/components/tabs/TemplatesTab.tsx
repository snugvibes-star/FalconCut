import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { Section, Hint } from './shared';

const TEMPLATES: { name: string; videoType: string; desc: string }[] = [
  { name: 'Intro', videoType: 'youtube intro', desc: 'Punchy channel/studio opener with hook and zooms.' },
  { name: 'Vlog', videoType: 'vlog', desc: 'Casual cuts, dead-air removal, light zooms and captions.' },
  { name: 'Product', videoType: 'product promo', desc: 'Clean promo pacing with dip transitions and music ducking.' },
  { name: 'Reel', videoType: 'talking head', desc: 'Vertical-friendly talking-head cut with bold captions.' },
  { name: 'Slideshow', videoType: 'quote', desc: 'Calm photo-led pacing, crossfades and soft captions.' },
  { name: 'Quote', videoType: 'quote', desc: 'Minimal text-forward edit, slow zooms, no jump cuts.' },
  { name: 'Tutorial', videoType: 'tutorial', desc: 'Step-by-step pacing, clear captions, longer shot holds.' },
  { name: 'Podcast clip', videoType: 'podcast clip', desc: 'Multi-cam feel, filler-word cuts, punch-in zooms.' },
];

export function TemplatesTab() {
  const [busy, setBusy] = useState<string | null>(null);
  const ui = useUI();

  const run = async (t: (typeof TEMPLATES)[number]) => {
    setBusy(t.name);
    try {
      await useStore.getState().applyTool('auto_edit', { video_type: t.videoType });
      ui.toast(`${t.name} template applied — one undo step`, 'success');
    } catch (e) {
      ui.toast(`Template failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <Section title="Templates">
        <div className="grid grid-cols-2 gap-1.5">
          {TEMPLATES.map((t) => (
            <button key={t.name} className="rounded-lg border border-line bg-ink-850 hover:bg-ink-800 hover:border-signal/40 p-2 text-left transition-colors"
              onClick={() => void run(t)} disabled={busy != null} title={t.desc}>
              <div className="flex items-center gap-1.5 text-xs text-paper font-medium">
                {busy === t.name ? <Loader2 size={12} className="animate-spin text-mind" /> : <Play size={12} className="text-signal shrink-0" />}
                {t.name}
              </div>
              <div className="text-[10px] text-paper-faint mt-0.5 leading-snug">{t.desc}</div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-paper-faint">Runs the professional edit pipeline; one undo step.</p>
      </Section>
      <Hint>Each template maps to a built-in edit style pack (pacing, captions, transitions, music).</Hint>
    </div>
  );
}
