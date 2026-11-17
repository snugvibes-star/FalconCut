import { useStore } from '../../state/store';
import { commit, DragSlider, Section, Hint, useSelectedClip } from './shared';

export function AdjustmentTab() {
  const project = useStore((s) => s.project);
  const clip = useSelectedClip();

  if (!clip) return <Hint>Select a clip to adjust its transform and crop.</Hint>;
  const id = clip.id;
  const tf = clip.transform;

  const set = (patch: Record<string, number>, label: string, key: string) =>
    commit([{ type: 'set_transform', clipId: id, patch }], label, key);

  return (
    <div>
      <Section title="Transform">
        <DragSlider label="Opacity" value={tf.opacity} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} commitKey={`${id}:op`}
          onCommit={(v) => set({ opacity: v }, 'Opacity', `${id}:op`)} />
        <DragSlider label="Scale" value={tf.scale} min={0.2} max={3} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} commitKey={`${id}:scale`}
          onCommit={(v) => set({ scale: v }, 'Scale', `${id}:scale`)} />
        <DragSlider label="Position X" value={tf.x} min={-project.settings.width} max={project.settings.width} step={1} fmt={(v) => `${Math.round(v)}px`} commitKey={`${id}:x`}
          onCommit={(v) => set({ x: v }, 'Move X', `${id}:x`)} />
        <DragSlider label="Position Y" value={tf.y} min={-project.settings.height} max={project.settings.height} step={1} fmt={(v) => `${Math.round(v)}px`} commitKey={`${id}:y`}
          onCommit={(v) => set({ y: v }, 'Move Y', `${id}:y`)} />
        <DragSlider label="Rotation" value={tf.rotation} min={-180} max={180} step={1} fmt={(v) => `${Math.round(v)}°`} commitKey={`${id}:rot`}
          onCommit={(v) => set({ rotation: v }, 'Rotate', `${id}:rot`)} />
      </Section>

      <Section title="Crop">
        <DragSlider label="Left" value={tf.cropL} min={0} max={0.45} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} commitKey={`${id}:cL`}
          onCommit={(v) => set({ cropL: v }, 'Crop left', `${id}:cL`)} />
        <DragSlider label="Right" value={tf.cropR} min={0} max={0.45} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} commitKey={`${id}:cR`}
          onCommit={(v) => set({ cropR: v }, 'Crop right', `${id}:cR`)} />
        <DragSlider label="Top" value={tf.cropT} min={0} max={0.45} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} commitKey={`${id}:cT`}
          onCommit={(v) => set({ cropT: v }, 'Crop top', `${id}:cT`)} />
        <DragSlider label="Bottom" value={tf.cropB} min={0} max={0.45} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} commitKey={`${id}:cB`}
          onCommit={(v) => set({ cropB: v }, 'Crop bottom', `${id}:cB`)} />
        <p className="text-[11px] text-paper-faint">Crops are fractions of the source frame. Values commit once per drag.</p>
      </Section>
    </div>
  );
}
