/**
 * Procedural generator media: deterministic animated clips used by the
 * built-in demo project and tests. No files, no network — fully offline.
 */
import type { GeneratorSpec } from './types';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawGenerator(ctx: Ctx2D, spec: GeneratorSpec, t: number, w: number, h: number) {
  const colors = spec.colors?.length ? spec.colors : ['#101828', '#1E3A5F'];
  const speed = spec.speed || 1;
  const tt = t * speed;
  ctx.save();
  if (spec.kind === 'solid') {
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
  } else if (spec.kind === 'gradient') {
    const angle = tt * 0.25;
    const x = Math.cos(angle) * w, y = Math.sin(angle) * h;
    const g = ctx.createLinearGradient(w / 2 - x / 2, h / 2 - y / 2, w / 2 + x / 2, h / 2 + y / 2);
    colors.forEach((c, i) => g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const rnd = mulberry(spec.seed);
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 5; i++) {
      const px = (rnd() + tt * 0.02 * (i + 1)) % 1.2 - 0.1;
      const py = rnd();
      const r = (0.12 + rnd() * 0.2) * Math.min(w, h);
      const rg = ctx.createRadialGradient(px * w, py * h, 0, px * w, py * h, r);
      rg.addColorStop(0, colors[(i + 1) % colors.length]);
      rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
  } else if (spec.kind === 'particles') {
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    const rnd = mulberry(spec.seed);
    for (let i = 0; i < 60; i++) {
      const bx = rnd(), by = rnd(), sp = 0.02 + rnd() * 0.08, sz = 1 + rnd() * 3;
      const x = ((bx + tt * sp) % 1) * w;
      const y = ((by + Math.sin(tt * sp * 6 + i) * 0.03 + 1) % 1) * h;
      ctx.globalAlpha = 0.25 + rnd() * 0.6;
      ctx.fillStyle = colors[1 + (i % (colors.length - 1))] ?? colors[0];
      ctx.beginPath();
      ctx.arc(x, y, sz * (Math.min(w, h) / 400), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (spec.kind === 'waves') {
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    for (let l = 0; l < 4; l++) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      const amp = h * (0.05 + l * 0.03);
      const base = h * (0.45 + l * 0.13);
      for (let x = 0; x <= w; x += 8) {
        const y = base + Math.sin(x / (w / (3 + l)) * Math.PI * 2 + tt * (0.8 + l * 0.3) + l * 2) * amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = colors[(l + 1) % colors.length];
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (spec.label) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `600 ${Math.round(h * 0.05)}px "Space Grotesk Variable", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.label, w / 2, h / 2);
  }
  ctx.restore();
}