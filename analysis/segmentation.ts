/** Worker client for local still-image background removal. */
export interface SegmentationProgress { value: number }

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: Uint8ClampedArray & { width: number; height: number; channels: number }) => void; reject: (e: Error) => void }>();
let onProgress: ((p: SegmentationProgress) => void) | null = null;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./segmentation.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<any>) => {
    const msg = e.data;
    if (msg.type === 'progress') { onProgress?.({ value: msg.value }); return; }
    if (msg.type === 'error') {
      pending.forEach((p) => p.reject(new Error(msg.message)));
      pending.clear();
      return;
    }
    if (msg.type === 'done') {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (!p) return;
      const data = new Uint8ClampedArray(msg.buffer) as Uint8ClampedArray & { width: number; height: number; channels: number };
      data.width = msg.width; data.height = msg.height; data.channels = msg.channels;
      p.resolve(data);
    }
  };
  return worker;
}

export async function loadBackgroundModel(progress?: (p: SegmentationProgress) => void): Promise<void> {
  onProgress = progress ?? null;
  if (!ready) {
    ready = new Promise<void>((resolve, reject) => {
      const w = ensureWorker();
      const onReady = (e: MessageEvent<any>) => {
        if (e.data?.type !== 'ready') return;
        w.removeEventListener('message', onReady);
        resolve();
      };
      w.addEventListener('message', onReady);
      w.postMessage({ type: 'load' });
    });
  }
  return ready;
}

/** Returns an RGBA cutout. Only still images are supported — video mattes
 * would need per-frame inference and a re-encode, which is deliberately out of
 * scope here. */
export async function removeBackground(blob: Blob): Promise<Uint8ClampedArray & { width: number; height: number; channels: number }> {
  if (!ready) await loadBackgroundModel();
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: 'process', blob, id });
  });
}
