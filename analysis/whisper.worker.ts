/**
 * Whisper transcription worker (transformers.js, WASM).
 * The model downloads once from Hugging Face and is cached by the browser.
 * Audio stays on this device. Chunked transcription gives real progress and
 * keeps memory bounded on longer videos.
 */
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
// Multithreaded WASM needs cross-origin isolation + SharedArrayBuffer. Use it
// only when genuinely available; otherwise force the reliable single-thread path.
try {
  const threads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && navigator.hardwareConcurrency > 2
    ? Math.min(2, navigator.hardwareConcurrency - 1) : 1;
  (env as any).backends.onnx.wasm.numThreads = threads;
} catch { (env as any).backends.onnx.wasm.numThreads = 1; }

let asr: any = null;
let currentModel = '';

const post = (msg: any) => (self as unknown as Worker).postMessage(msg);

async function runChunk(audio: Float32Array, id: string): Promise<{ out: any; estimated: boolean; mode: 'word' | 'chunk' | 'text' }> {
  if (!asr) throw new Error('Model not loaded');
  try {
    const out = await asr(audio, { return_timestamps: 'word' });
    return { out, estimated: false, mode: 'word' };
  } catch (wordErr: any) {
    const message = String(wordErr?.message ?? wordErr);
    if (!/cross.?attention|output_attentions|timestamp/i.test(message)) throw wordErr;
    try {
      // Segment timestamps need cross-attention too, but some exports support
      // these even when word alignment is unavailable.
      const out = await asr(audio, { return_timestamps: true });
      post({ type: 'progress', id, file: 'timing', pct: 0.6, note: 'Word timestamps unavailable — using segment timing' });
      return { out, estimated: true, mode: 'chunk' };
    } catch {
      // Final fallback: this checkpoint has no usable timestamp head at all.
      // Return the recognized text; the client distributes timing and labels
      // every word as estimated so it can be corrected manually.
      post({ type: 'progress', id, file: 'timing', pct: 0.7, note: 'Model has no timestamp head — estimating word timing from text' });
      const out = await asr(audio);
      return { out, estimated: true, mode: 'text' };
    }
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id } = e.data;
  try {
    if (type === 'load') {
      const model: string = e.data.model || 'onnx-community/whisper-tiny.en';
      if (asr && currentModel === model) { post({ type: 'ready', id }); return; }
      asr = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: any) => {
          if (p.status === 'progress' || p.status === 'downloading') {
            post({ type: 'progress', id, file: p.file, loaded: p.loaded, total: p.total, pct: p.total ? p.loaded / p.total : 0, note: 'Downloading model' });
          } else if (p.status === 'ready' || p.status === 'done') {
            post({ type: 'progress', id, file: p.file, pct: 1, note: 'Model ready' });
          }
        },
      } as any);
      currentModel = model;
      post({ type: 'ready', id });
    } else if (type === 'transcribe_chunk') {
      const { audio, offset } = e.data;
      const { out, estimated, mode } = await runChunk(audio as Float32Array, id);
      post({ type: 'chunk_result', id, out, offset, estimated, mode });
    } else if (type === 'transcribe') {
      // Backwards-compatible single-shot path for other callers.
      const { out, estimated, mode } = await runChunk(e.data.audio as Float32Array, id);
      post({ type: 'result', id, out, estimated, mode });
    }
  } catch (err: any) {
    post({ type: 'error', id, message: String(err?.message ?? err) });
  }
};
