/**
 * On-demand local background removal for STILL IMAGES.
 * Model: Xenova/modnet q8 (~25 MB) via the already-installed transformers.js
 * WASM runtime. No API key, no upload. Model is fetched once and cached by the
 * browser; results are never faked while it is still loading.
 */
import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
let pipe: any = null;

type LoadMsg = { type: 'load' };
type ProcessMsg = { type: 'process'; blob: Blob; id: number };
type Msg = LoadMsg | ProcessMsg;

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      if (!pipe) {
        pipe = await pipeline('background-removal', 'Xenova/modnet', {
          dtype: 'q8', device: 'wasm',
          progress_callback: (p: any) => {
            if (p?.status === 'progress' && typeof p.progress === 'number') {
              (self as unknown as Worker).postMessage({ type: 'progress', value: p.progress });
            }
          },
        } as any) as any;
      }
      (self as unknown as Worker).postMessage({ type: 'ready' });
      return;
    }
    if (!pipe) throw new Error('Background removal model is not loaded yet.');
    const out = await (pipe as any)(msg.blob);
    const img = Array.isArray(out) ? out[0] : out;
    const buffer = img.data.buffer.slice(0);
    (self as unknown as Worker).postMessage({
      type: 'done', id: msg.id, width: img.width, height: img.height, channels: img.channels, buffer,
    }, [buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
