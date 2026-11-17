/**
 * Whisper transcription worker (transformers.js, WASM).
 * The model downloads once from HuggingFace and is cached by the browser.
 * Word-level timestamps via whisper alignment. No audio ever leaves the device.
 */
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

let asr: any = null;
let currentModel = '';

const post = (msg: any) => (self as unknown as Worker).postMessage(msg);

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
            post({ type: 'progress', id, file: p.file, loaded: p.loaded, total: p.total, pct: p.total ? p.loaded / p.total : 0 });
          } else if (p.status === 'ready' || p.status === 'done') {
            post({ type: 'progress', id, file: p.file, pct: 1 });
          }
        },
      } as any);
      currentModel = model;
      post({ type: 'ready', id });
    } else if (type === 'transcribe') {
      if (!asr) throw new Error('Model not loaded');
      const audio: Float32Array = e.data.audio;
      const out = await asr(audio, {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
        ...(e.data.language ? { language: e.data.language, task: 'transcribe' } : {}),
      });
      post({ type: 'result', id, out });
    }
  } catch (err: any) {
    post({ type: 'error', id, message: String(err?.message ?? err) });
  }
};