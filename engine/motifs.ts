/**
 * Motifs: parameterized motion graphics rendered on canvas.
 * AI creates them with add_motif; humans tune params in the inspector.
 * All animation is a pure function of (localT, duration, params).
 */
import type { MotifData } from './types';
import { ease } from './easing';
import { roundRect } from './captions';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const MOTIF_DEFAULTS: Record<MotifData['type'], Record<string, number | string>> = {
  'title-reveal': { text: 'YOUR TITLE', sub: '', color: '#FFFFFF', accent: '#C6F24E', x: 0.5, y: 0.42, size: 0.09, speed: 1 },
  'lower-third': { name: 'Speaker Name', role: 'Role / Company', color: '#FFFFFF', accent: '#38BDF8', x: 0.06, y: 0.78, size: 0.045, speed: 1 },
  'bar-chart': { title: 'Growth', values: '12,28,45,71', labels: 'Q1,Q2,Q3,Q4', color: '#C6F24E', accent: '#38BDF8', x: 0.5, y: 0.5, size: 0.5, speed: 1 },
  'ring-progress': { value: 78, label: 'COMPLETE', color: '#C6F24E', track: '#1C2336', x: 0.5, y: 0.5, size: 0.32, speed: 1 },
  'count-up': { from: 0, to: 10000, prefix: '', suffix: '+', label: 'users', color: '#FFFFFF', accent: '#C6F24E', x: 0.5, y: 0.5, size: 0.1, speed: 1 },
  burst: { text: 'NEW', color: '#0B0E16', accent: '#C6F24E', x: 0.5, y: 0.3, size: 0.12, speed: 1, rays: 12 },
};

const num = (p: Record<string, number | string>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : parseFloat(String(p[k] ?? d)) || d);
const str = (p: Record<string, number | string>, k: string, d: string) => String(p[k] ?? d);

export function drawMotif(ctx: Ctx2D, motif: MotifData, localT: number, duration: number, W: number, H: number) {
  const p = { ...MOTIF_DEFAULTS[motif.type], ...motif.params };
  const speed = num(p, 'speed', 1);
  const t = localT * speed;
  const inP = ease('easeOutExpo', Math.min(1, t / 0.5));
  const outP = duration - localT < 0.35 ? ease('easeIn', (duration - localT) / 0.35) : 1;
  const alpha = Math.min(inP === 0 ? 0 : 1, outP) * Math.min(1, t / 0.15 + 0.2);
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));
  const x = num(p, 'x', 0.5) * W, y = num(p, 'y', 0.5) * H;
  const accent = str(p, 'accent', '#C6F24E');
  const color = str(p, 'color', '#FFFFFF');

  switch (motif.type) {
    case 'title-reveal': {
      const size = num(p, 'size', 0.09) * H;
      ctx.translate(x, y);
      const text = str(p, 'text', 'TITLE');
      ctx.font = `800 ${size}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const chars = text.split('');
      const total = ctx.measureText(text).width;
      let cx = -total / 2;
      chars.forEach((ch, i) => {
        const cw = ctx.measureText(ch).width;
        const cp = ease('easeOutBack', Math.min(1, Math.max(0, (t - i * 0.04) / 0.4)));
        ctx.save();
        ctx.globalAlpha *= cp;
        ctx.translate(cx + cw / 2, (1 - cp) * size * 0.6);
        ctx.fillStyle = color;
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = size * 0.1;
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        cx += cw;
      });
      const barP = ease('easeOutExpo', Math.min(1, Math.max(0, (t - 0.3) / 0.5)));
      ctx.fillStyle = accent;
      ctx.fillRect((-total / 2) * barP, size * 0.72, total * barP, size * 0.06);
      const sub = str(p, 'sub', '');
      if (sub) {
        ctx.globalAlpha *= ease('easeOut', Math.min(1, Math.max(0, (t - 0.55) / 0.4)));
        ctx.font = `500 ${size * 0.3}px "Inter Variable", system-ui, sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(sub, 0, size * 1.15);
      }
      break;
    }
    case 'lower-third': {
      const size = num(p, 'size', 0.045) * H;
      const slide = (1 - ease('easeOutExpo', Math.min(1, t / 0.45))) * -W * 0.3;
      ctx.translate(x + slide, y);
      ctx.font = `700 ${size}px "Space Grotesk Variable", system-ui, sans-serif`;
      const name = str(p, 'name', 'Name');
      const role = str(p, 'role', '');
      const nw = ctx.measureText(name).width;
      ctx.font = `500 ${size * 0.62}px "Inter Variable", system-ui, sans-serif`;
      const rw = role ? ctx.measureText(role).width : 0;
      const bw = Math.max(nw, rw) + size * 1.4;
      const bh = size * (role ? 2.5 : 1.7);
      ctx.fillStyle = 'rgba(10,13,20,0.82)';
      roundRect(ctx, 0, -bh / 2, bw, bh, size * 0.18);
      ctx.fill();
      ctx.fillStyle = accent;
      roundRect(ctx, 0, -bh / 2, size * 0.16, bh, size * 0.08);
      ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${size}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.fillText(name, size * 0.6, role ? -size * 0.42 : 0);
      if (role) {
        ctx.font = `500 ${size * 0.62}px "Inter Variable", system-ui, sans-serif`;
        ctx.fillStyle = accent;
        ctx.fillText(role, size * 0.6, size * 0.55);
      }
      break;
    }
    case 'bar-chart': {
      const size = num(p, 'size', 0.5) * Math.min(W, H);
      const values = str(p, 'values', '1,2,3').split(',').map((v) => parseFloat(v) || 0);
      const labels = str(p, 'labels', '').split(',');
      const title = str(p, 'title', '');
      const max = Math.max(1, ...values);
      ctx.translate(x, y);
      const bw = size / values.length;
      const barW = bw * 0.56;
      if (title) {
        ctx.font = `700 ${size * 0.11}px "Space Grotesk Variable", system-ui, sans-serif`;
        ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(title, 0, -size * 0.62);
      }
      values.forEach((v, i) => {
        const bp = ease('easeOutBack', Math.min(1, Math.max(0, (t - 0.15 - i * 0.12) / 0.6)));
        const bh = (v / max) * size * bp;
        const bx = -size / 2 + i * bw + (bw - barW) / 2;
        const g = ctx.createLinearGradient(0, size * 0.4 - bh, 0, size * 0.4);
        g.addColorStop(0, accent); g.addColorStop(1, color === '#FFFFFF' ? accent : color);
        ctx.fillStyle = g;
        roundRect(ctx, bx, size * 0.4 - bh, barW, Math.max(1, bh), barW * 0.14);
        ctx.fill();
        ctx.font = `600 ${size * 0.075}px "Inter Variable", system-ui, sans-serif`;
        ctx.fillStyle = color; ctx.textAlign = 'center';
        if (bp > 0.5) ctx.fillText(String(Math.round(v * bp)), bx + barW / 2, size * 0.4 - bh - size * 0.06);
        if (labels[i]) { ctx.fillStyle = 'rgba(232,237,247,0.7)'; ctx.fillText(labels[i], bx + barW / 2, size * 0.5); }
      });
      break;
    }
    case 'ring-progress': {
      const size = num(p, 'size', 0.32) * Math.min(W, H);
      const target = num(p, 'value', 75);
      const prog = ease('easeOutExpo', Math.min(1, t / 1.2)) * target;
      ctx.translate(x, y);
      ctx.lineWidth = size * 0.09;
      ctx.lineCap = 'round';
      ctx.strokeStyle = str(p, 'track', '#1C2336');
      ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = color === '#FFFFFF' ? accent : color;
      ctx.beginPath(); ctx.arc(0, 0, size / 2, -Math.PI / 2, -Math.PI / 2 + (prog / 100) * Math.PI * 2); ctx.stroke();
      ctx.font = `800 ${size * 0.26}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(prog)}%`, 0, -size * 0.03);
      ctx.font = `600 ${size * 0.08}px "Inter Variable", system-ui, sans-serif`;
      ctx.fillStyle = accent;
      ctx.fillText(str(p, 'label', ''), 0, size * 0.17);
      break;
    }
    case 'count-up': {
      const size = num(p, 'size', 0.1) * H;
      const from = num(p, 'from', 0), to = num(p, 'to', 100);
      const v = from + (to - from) * ease('easeOutExpo', Math.min(1, t / 1.4));
      ctx.translate(x, y + (1 - inP) * size * 0.4);
      ctx.font = `800 ${size}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = size * 0.08;
      ctx.fillText(`${str(p, 'prefix', '')}${Math.round(v).toLocaleString()}${str(p, 'suffix', '')}`, 0, 0);
      ctx.shadowColor = 'transparent';
      ctx.font = `600 ${size * 0.26}px "Inter Variable", system-ui, sans-serif`;
      ctx.fillStyle = accent;
      ctx.fillText(str(p, 'label', ''), 0, size * 0.75);
      break;
    }
    case 'burst': {
      const size = num(p, 'size', 0.12) * H;
      const rays = Math.round(num(p, 'rays', 12));
      const pop = ease('easeOutBack', Math.min(1, t / 0.45));
      const rot = t * 0.15;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = accent;
      ctx.beginPath();
      for (let i = 0; i < rays * 2; i++) {
        const r = (i % 2 === 0 ? size : size * 0.62) * pop;
        const a = (i / (rays * 2)) * Math.PI * 2;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.rotate(-rot);
      ctx.font = `800 ${size * 0.42}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.fillStyle = str(p, 'color', '#0B0E16');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha *= pop;
      ctx.fillText(str(p, 'text', 'NEW'), 0, 0);
      break;
    }
  }
  ctx.restore();
}