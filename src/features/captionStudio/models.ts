/**
 * Verified local caption model catalog for the browser transcription engine.
 *
 * FalconCut already runs Whisper locally through @huggingface/transformers in
 * `analysis/whisper.worker.ts` with `dtype: 'q8'` and `device: 'wasm'`. These
 * entries point at the REAL ONNX q8 artifacts used by that runtime, so the
 * displayed sizes are the actual model files rather than an archive size.
 *
 * Verified against the official onnx-community repositories on 2026-11-22.
 * Every individual file is strictly smaller than 70 MB. No model is fetched,
 * loaded, or initialised by importing this module — that only happens from an
 * explicit user action in the Caption Studio.
 */
import { transcriptClient, type WhisperModel } from '../../../analysis/transcript';

export interface ModelFile {
  path: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface LocalCaptionModel {
  id: WhisperModel;
  label: string;
  family: string;
  sizeClass: 'Tiny' | 'Base';
  languages: string;
  license: string;
  note: string;
  files: ModelFile[];
}

export const MODEL_SIZE_LIMIT = 70_000_000;
const HF = (repo: string, path: string) => `https://huggingface.co/${repo}/resolve/main/${path}`;

export const CAPTION_MODELS: LocalCaptionModel[] = [
  {
    id: 'onnx-community/whisper-tiny.en',
    label: 'Whisper Tiny EN (Q8)',
    family: 'Whisper · transformers.js WASM · q8',
    sizeClass: 'Tiny',
    languages: 'English only',
    license: 'MIT — OpenAI Whisper weights (onnx-community)',
    note: 'English-only checkpoint. Smallest download.',
    files: [
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 10_124_993, sha256: 'e93ec822f16a8fd264e7de972ad17d615ea7334b75a52d54c50c2e18dd503a25', url: HF('onnx-community/whisper-tiny.en', 'onnx/encoder_model_quantized.onnx') },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 30_718_858, sha256: 'c0592d0749413c960569e1c7fb806b060d5d18f3ebad4a95cbf9a77dc6e9be52', url: HF('onnx-community/whisper-tiny.en', 'onnx/decoder_model_merged_quantized.onnx') },
    ],
  },
  {
    id: 'onnx-community/whisper-tiny',
    label: 'Whisper Tiny (Q8)',
    family: 'Whisper · transformers.js WASM · q8',
    sizeClass: 'Tiny',
    languages: 'Multilingual (including Urdu)',
    license: 'MIT — OpenAI Whisper weights (onnx-community)',
    note: 'Smallest multilingual model. Supports auto language detection.',
    files: [
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 10_124_990, sha256: '2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19', url: HF('onnx-community/whisper-tiny', 'onnx/encoder_model_quantized.onnx') },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 30_719_241, sha256: '25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3', url: HF('onnx-community/whisper-tiny', 'onnx/decoder_model_merged_quantized.onnx') },
    ],
  },
  {
    id: 'onnx-community/whisper-base.en',
    label: 'Whisper Base EN (Q8)',
    family: 'Whisper · transformers.js WASM · q8',
    sizeClass: 'Base',
    languages: 'English only',
    license: 'MIT — OpenAI Whisper weights (onnx-community)',
    note: 'Larger English checkpoint. More context than Tiny.',
    files: [
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 23_201_320, sha256: '6e8001198c490bbae018c0044f630c2915efb826bad957006ce36152d0ab2a10', url: HF('onnx-community/whisper-base.en', 'onnx/encoder_model_quantized.onnx') },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 53_692_803, sha256: 'dd4761a3f7add26afda3512abff4706920404c2517e85a9f2ff090b0c0987909', url: HF('onnx-community/whisper-base.en', 'onnx/decoder_model_merged_quantized.onnx') },
    ],
  },
  {
    id: 'onnx-community/whisper-base',
    label: 'Whisper Base (Q8)',
    family: 'Whisper · transformers.js WASM · q8',
    sizeClass: 'Base',
    languages: 'Multilingual (including Urdu)',
    license: 'MIT — OpenAI Whisper weights (onnx-community)',
    note: 'Largest verified multilingual model under the per-file limit.',
    files: [
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 23_201_314, sha256: '5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46', url: HF('onnx-community/whisper-base', 'onnx/encoder_model_quantized.onnx') },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 53_693_315, sha256: 'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b', url: HF('onnx-community/whisper-base', 'onnx/decoder_model_merged_quantized.onnx') },
    ],
  },
];

export const modelBytes = (m: LocalCaptionModel) => m.files.reduce((n, f) => n + f.bytes, 0);
export const formatBytes = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

export function modelsWithinLimit(models: LocalCaptionModel[] = CAPTION_MODELS): boolean {
  return models.length >= 3 && models.length <= 5
    && models.every((m) => m.files.every((f) => f.bytes < MODEL_SIZE_LIMIT));
}

/* ---------------- installation state ---------------- */

const INSTALLED_KEY = 'falconcut.captionModels.installed';

export function installedModels(): string[] {
  try { return JSON.parse(localStorage.getItem(INSTALLED_KEY) || '[]') as string[]; }
  catch { return []; }
}

export function isModelInstalled(id: WhisperModel): boolean {
  return installedModels().includes(id);
}

function markInstalled(id: WhisperModel) {
  const ids = new Set(installedModels());
  ids.add(id);
  try { localStorage.setItem(INSTALLED_KEY, JSON.stringify([...ids])); } catch { /* storage blocked */ }
}

export interface InstallProgress { pct: number; note: string; file?: string; bytesPerSecond?: number }

/** Explicitly download/load a model through the real inference runtime. */
export async function installModel(
  model: LocalCaptionModel,
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  let last = { t: performance.now(), pct: 0 };
  await transcriptClient.load(model.id, (p) => {
    const now = performance.now();
    const dt = Math.max(1, now - last.t) / 1000;
    const bps = p.stage === 'download' && p.pct > last.pct
      ? (modelBytes(model) * (p.pct - last.pct)) / dt : undefined;
    last = { t: now, pct: p.pct };
    onProgress({ pct: p.pct, note: p.note ?? p.stage, file: p.note, bytesPerSecond: bps });
  });
  markInstalled(model.id);
}

export function cancelInstall() {
  transcriptClient.cancelAll();
}

/** Best-effort removal of the browser-cached model files. */
export async function deleteModel(id: WhisperModel): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        for (const req of keys) {
          if (req.url.includes(id)) await cache.delete(req);
        }
      }
    }
  } catch { /* Cache Storage may be unavailable — still clear our marker */ }
  const ids = installedModels().filter((x) => x !== id);
  try { localStorage.setItem(INSTALLED_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
  transcriptClient.forget(id);
}

export async function clearModelCache(): Promise<void> {
  for (const m of CAPTION_MODELS) await deleteModel(m.id);
}

export async function storageEstimate(): Promise<{ usage?: number; quota?: number }> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    return { usage: e.usage, quota: e.quota };
  }
  return {};
}
