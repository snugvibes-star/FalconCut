import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const pub = join(root, 'public');

const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as {
  icons: { src: string; sizes: string; purpose?: string }[];
  shortcuts?: { url: string; icons?: { src: string }[] }[];
};
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(pub, 'sw.js'), 'utf8');

const publicPath = (src: string) => join(pub, src.replace(/^\//, ''));

describe('shipped assets (publish guard)', () => {
  it('manifest icons all exist on disk with a declared size', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4);
    for (const icon of manifest.icons) {
      expect(existsSync(publicPath(icon.src)), `${icon.src} is missing`).toBe(true);
      expect(icon.sizes).toMatch(/^(\d+x\d+|any)$/);
    }
    // A maskable icon is required for Android home-screen installs.
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    // 192 and 512 "any" are the two Chrome requires for installability.
    const anySizes = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes);
    expect(anySizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('every icon referenced by index.html exists', () => {
    const hrefs = [...indexHtml.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const href of hrefs) {
      expect(existsSync(publicPath(href)), `${href} is missing`).toBe(true);
    }
    // iOS needs an apple-touch-icon and a tab needs a real favicon.
    expect(hrefs.some((h) => /apple-touch-icon/.test(h))).toBe(true);
    expect(hrefs.some((h) => /favicon/.test(h))).toBe(true);
  });

  it('the service worker only precaches files that exist', () => {
    const list = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)?.[1] ?? '';
    const assets = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(5);
    for (const a of assets) {
      if (a === '/' || a === '/index.html') continue; // app shell is generated at build time
      expect(existsSync(publicPath(a)), `${a} is precached but missing`).toBe(true);
    }
  });

  it('shortcut icons resolve too', () => {
    for (const s of manifest.shortcuts ?? []) {
      for (const icon of s.icons ?? []) expect(existsSync(publicPath(icon.src))).toBe(true);
    }
  });
});
