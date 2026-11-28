import { describe, it, expect } from 'vitest';
import { createProject, applyAction } from '../engine';
import { buildProjectBundle, restoreProjectBundle, isProjectBundle } from '../src/state/projectBundle';

describe('portable project bundles', () => {
  it('embeds media, restores blobs and keeps the project document', async () => {
    let project = createProject('Bundle test', '16:9');
    project = applyAction(project, { type: 'add_media', asset: {
      id: 'asset_test', name: 'clip.mp4', type: 'video', duration: 2,
      width: 640, height: 360, hasAudio: false, blobKey: 'media_test',
      mime: 'video/mp4', size: 4, source: 'demo',
    } });
    const media = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' });
    const store = new Map<string, Blob>();
    store.set('media_test', media);
    const load = async (key: string) => store.get(key);
    const { blob, skipped } = await buildProjectBundle(project, load);
    expect(skipped).toEqual([]);
    expect(blob.size).toBeGreaterThan(100);

    const text = await blob.text();
    expect(isProjectBundle(JSON.parse(text))).toBe(true);

    const restoredStore = new Map<string, Blob>();
    const put = async (key: string, value: Blob) => { restoredStore.set(key, value); };
    const file = new File([blob], 'bundle.falconcut.json', { type: 'application/json' });
    const result = await restoreProjectBundle(file, put);
    expect(result.restored).toBe(1);
    expect(result.project.name).toBe('Bundle test');
    expect(Array.from(new Uint8Array(await restoredStore.get('media_test')!.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });

  it('skips oversized sources with a clear warning instead of failing', async () => {
    let project = createProject('Large', '16:9');
    project = applyAction(project, { type: 'add_media', asset: {
      id: 'asset_big', name: 'big.mp4', type: 'video', duration: 2,
      width: 640, height: 360, hasAudio: false, blobKey: 'media_big',
      mime: 'video/mp4', size: 2048, source: 'demo',
    } });
    const huge = new Blob([new Uint8Array(2048)]);
    const { skipped } = await buildProjectBundle(project, async () => huge, 1024);
    expect(skipped.some((s) => /too large/.test(s))).toBe(true);
  });
});
