import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const pub = join(root, 'public');

const rawManifest = readFileSync(join(pub, 'manifest.webmanifest'), 'utf8');
const manifest = JSON.parse(rawManifest) as {
  name: string;
  short_name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
  shortcuts?: { url: string; icons?: { src: string }[] }[];
};
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(pub, 'sw.js'), 'utf8');

/** Icon `src` may carry a cache-busting query (?v=2); the file on disk does not. */
const publicPath = (src: string) => join(pub, src.replace(/^\/+/, '').replace(/[?#].*$/, ''));
const urlPath = (src: string) => src.replace(/[?#].*$/, '');

describe('shipped assets (publish guard)', () => {
  it('manifest is valid JSON with no duplicate keys', () => {
    // A duplicated key (e.g. two "shortcuts" blocks) is technically parseable
    // but browsers and tooling warn, and it hides the first copy. Count only
    // top-level keys (two-space indent) so nested "name"/"icons" are not hits.
    const topKeys = [...rawManifest.matchAll(/^ {2}"([^"]+)"\s*:/gm)].map((m) => m[1]);
    const seen = new Set<string>();
    for (const key of topKeys) {
      expect(seen.has(key), `duplicate manifest key "${key}"`).toBe(false);
      seen.add(key);
    }
  });

  it('has everything a browser needs to install it', () => {
    expect(manifest.name.length).toBeGreaterThan(3);
    expect(manifest.short_name.length).toBeGreaterThan(1);
    expect(manifest.id).toBe('/');
    expect(manifest.start_url.startsWith('/')).toBe(true);
    expect(manifest.scope).toBe('/');
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
  });

  it('manifest icons all exist on disk with a declared size', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4);
    for (const icon of manifest.icons) {
      expect(existsSync(publicPath(icon.src)), `${icon.src} is missing`).toBe(true);
      expect(icon.sizes).toMatch(/^(\d+x\d+|any)$/);
      expect(icon.type).toMatch(/^image\//);
    }
    const any = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes);
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable').map((i) => i.sizes);
    // Chrome requires 192 + 512 "any" for installability.
    expect(any).toEqual(expect.arrayContaining(['192x192', '512x512']));
    // Android builds the adaptive launcher icon from BOTH maskable sizes;
    // with only 512 it falls back to shrinking the plain icon in a white circle.
    expect(maskable).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('every icon referenced by index.html exists', () => {
    const hrefs = [...indexHtml.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const href of hrefs) {
      expect(existsSync(publicPath(href)), `${href} is missing`).toBe(true);
    }
    expect(hrefs.some((h) => /apple-touch-icon/.test(h))).toBe(true);
    expect(hrefs.some((h) => /favicon/.test(h))).toBe(true);
  });

  it('the in-app brand mark referenced by LogoMark exists', () => {
    const logo = readFileSync(join(root, 'src/components/brand/LogoMark.tsx'), 'utf8');
    const src = logo.match(/src="\/([^"?]+)/)?.[1];
    expect(src, 'LogoMark must render a real image file').toBeTruthy();
    expect(existsSync(join(pub, src!)), `/${src} is missing`).toBe(true);
    // It must not silently fall back to a hand-built SVG mark.
    expect(/<svg/.test(logo)).toBe(false);
  });

  it('the service worker only precaches files that exist', () => {
    const list = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)?.[1] ?? '';
    const assets = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(5);
    for (const a of assets) {
      if (a === '/' || a === '/index.html') continue; // app shell is generated at build time
      expect(existsSync(publicPath(a)), `${a} is precached but missing`).toBe(true);
    }
    // The shell version must be bumped whenever the precache list changes, or
    // users keep the old manifest and the old home-screen icon forever.
    expect(sw).toMatch(/const VERSION = 'cutflow-v\d+'/);
  });

  it('shortcut icons resolve too', () => {
    for (const s of manifest.shortcuts ?? []) {
      for (const icon of s.icons ?? []) expect(existsSync(publicPath(icon.src))).toBe(true);
    }
  });
});
