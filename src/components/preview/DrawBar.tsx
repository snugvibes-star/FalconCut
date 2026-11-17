/**
 * Preview tool rail: the select/arrow tool plus the drawing tools. Picking a
 * tool switches the preview overlay into that mode (see OverlayEditor). Stroke
 * settings (color / size / opacity / fill / sticker glyph) live in UI state and
 * feed the engine's DrawingStroke when the gesture is committed.
 */
import {
  MousePointer2, Brush, PenTool, Highlighter, Eraser, Minus, ArrowUpRight,
  Square, RectangleHorizontal, Circle, Hexagon, Smile, Eye,
} from 'lucide-react';
import { useUI, type PreviewTool } from '../../state/ui';

const TOOLS: { tool: PreviewTool; icon: typeof Brush; label: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select / move overlays (V)' },
  { tool: 'brush', icon: Brush, label: 'Brush — freehand draw' },
  { tool: 'pen', icon: PenTool, label: 'Pen — crisp strokes' },
  { tool: 'highlighter', icon: Highlighter, label: 'Highlighter — translucent' },
  { tool: 'eraser', icon: Eraser, label: 'Eraser — remove drawn strokes' },
  { tool: 'line', icon: Minus, label: 'Line' },
  { tool: 'arrow', icon: ArrowUpRight, label: 'Arrow' },
  { tool: 'rect', icon: Square, label: 'Rectangle' },
  { tool: 'rect-round', icon: RectangleHorizontal, label: 'Rounded rectangle' },
  { tool: 'ellipse', icon: Circle, label: 'Ellipse' },
  { tool: 'polygon', icon: Hexagon, label: 'Polygon — freehand closed shape' },
  { tool: 'sticker', icon: Smile, label: 'Sticker — click to place an emoji' },
];

const SHAPE_TOOLS: PreviewTool[] = ['rect', 'rect-round', 'ellipse', 'polygon'];
const STICKERS = ['✨', '🔥', '❤️', '😂', '👍', '🎉', '💯', '⚡', '😮', '🤯'];

export function DrawBar() {
  const draw = useUI((s) => s.draw);
  const setDrawTool = useUI((s) => s.setDrawTool);
  const patchDraw = useUI((s) => s.patchDraw);
  const railVisible = useUI((s) => s.railVisible);
  const setRailVisible = useUI((s) => s.setRailVisible);
  const drawing = railVisible && draw.tool !== 'select';

  // Fully hidden: nothing renders on the video. A small docked icon outside
  // the canvas (rendered by Preview) brings the rail back.
  if (!railVisible) return null;

  return (
    <>
      <div className="absolute left-1.5 top-1.5 z-10 flex flex-col gap-0.5 p-1 rounded-xl bg-ink-900/90 backdrop-blur border border-line shadow-panel">
        {/* header row: hide button — while visible, the rail floats on the video */}
        <div className="flex items-center justify-center pb-0.5 border-b border-line/60 mb-0.5">
          <button
            className="icon-btn p-1"
            onClick={() => setRailVisible(false)}
            title="Hide draw tools (a small icon appears beside the video)"
          >
            <Eye size={14} />
          </button>
        </div>
        {railVisible && TOOLS.map((t) => {
          const Icon = t.icon;
          const active = draw.tool === t.tool;
          return (
            <button
              key={t.tool}
              onClick={() => setDrawTool(t.tool)}
              title={t.label}
              className={`flex items-center justify-center rounded-lg p-1.5 transition-colors ${active ? 'bg-ink-700 text-signal' : 'text-paper-dim hover:text-paper hover:bg-ink-800'}`}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>

      {drawing && (
        <div className="absolute left-12 top-1.5 z-10 flex items-center gap-2 px-2 py-1 rounded-lg bg-ink-900/90 backdrop-blur border border-line shadow-panel text-[10px] text-paper-dim">
          <label className="flex items-center gap-1 cursor-pointer" title="Stroke color">
            <input
              type="color"
              className="w-5 h-5 rounded cursor-pointer bg-transparent border border-line"
              value={draw.color}
              onChange={(e) => patchDraw({ color: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1" title="Stroke width (project px)">
            <span className="tabular-nums w-4 text-right text-paper">{draw.size}</span>
            <input type="range" min={1} max={40} step={1} value={draw.size} className="w-20 accent-signal" onChange={(e) => patchDraw({ size: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-1" title="Stroke opacity">
            <span className="tabular-nums w-8 text-right text-paper">{Math.round(draw.opacity * 100)}%</span>
            <input type="range" min={5} max={100} step={5} value={Math.round(draw.opacity * 100)} className="w-16 accent-signal" onChange={(e) => patchDraw({ opacity: Number(e.target.value) / 100 })} />
          </label>
          {SHAPE_TOOLS.includes(draw.tool) && (
            <button
              className={`px-1.5 py-0.5 rounded-md border transition-colors ${draw.fill ? 'border-signal/60 text-signal bg-signal/10' : 'border-line text-paper-dim hover:text-paper'}`}
              onClick={() => patchDraw({ fill: !draw.fill })}
              title="Fill shapes with the stroke color"
            >
              Fill
            </button>
          )}
          {draw.tool === 'sticker' && (
            <div className="flex items-center gap-0.5" title="Sticker emoji">
              {STICKERS.map((s) => (
                <button
                  key={s}
                  className={`w-5 h-5 flex items-center justify-center rounded-md text-xs leading-none transition-colors ${draw.char === s ? 'bg-ink-700 ring-1 ring-signal/60' : 'hover:bg-ink-800'}`}
                  onClick={() => patchDraw({ char: s })}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
