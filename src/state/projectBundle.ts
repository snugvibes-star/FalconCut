/**
 * Portable single-file project bundles.
 *
 * A bundle is JSON containing the project document plus data URLs for its
 * media blobs. Small and medium projects can be moved to another device as one
 * file; very large sources are skipped with an explicit warning instead of
 * silently producing a bundle that cannot play.
 */
import type { Project } from '../../engine/types';

const BUNDLE_FORMAT = 'falconcut-bundle';
const BUNDLE_VERSION = 1;

export interface ProjectBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  project: Project;
  media: { blobKey: string; name: string; mime: string; dataUrl: string }[];
}

export interface BuiltBundle {
  blob: Blob;
  skipped: string[];
}

/** Base64 with chunked string building so large files do not hit call-stack limits. */
async function toDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

function fromDataUrl(url: string): Blob {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('Invalid media data URL in bundle.');
  const mime = /^data:([^;]+);base64/.exec(url.slice(0, comma))?.[1] ?? 'application/octet-stream';
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function buildProjectBundle(
  project: Project,
  loadBlob: (key: string) => Promise<Blob | undefined>,
  maxMediaBytes = 50 * 1024 * 1024,
): Promise<BuiltBundle> {
  const media: ProjectBundle['media'] = [];
  const skipped: string[] = [];
  for (const asset of project.media) {
    if (!asset.blobKey) continue;
    const blob = await loadBlob(asset.blobKey);
    if (!blob) { skipped.push(`${asset.name}: source blob missing locally`); continue; }
    if (blob.size > maxMediaBytes) { skipped.push(`${asset.name}: too large to embed (${Math.round(blob.size / 1e6)} MB)`); continue; }
    media.push({ blobKey: asset.blobKey, name: asset.name, mime: blob.type || asset.mime || 'application/octet-stream', dataUrl: await toDataUrl(blob) });
  }
  const bundle: ProjectBundle = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, project, media };
  return { blob: new Blob([JSON.stringify(bundle)], { type: 'application/json' }), skipped };
}

export async function restoreProjectBundle(
  file: File,
  putBlob: (key: string, blob: Blob) => Promise<void>,
): Promise<{ project: Project; restored: number }> {
  const parsed = JSON.parse(await file.text()) as Partial<ProjectBundle>;
  if (parsed.format !== BUNDLE_FORMAT || !parsed.project || !Array.isArray(parsed.media)) {
    throw new Error('This is not a FalconCut project bundle.');
  }
  if (parsed.version !== BUNDLE_VERSION) throw new Error(`Unsupported bundle version ${parsed.version}.`);
  let restored = 0;
  for (const item of parsed.media) {
    try { await putBlob(item.blobKey, fromDataUrl(item.dataUrl)); restored++; }
    catch { /* an unreadable item must not abort the rest of the project */ }
  }
  return { project: parsed.project as Project, restored };
}

export function isProjectBundle(value: unknown): boolean {
  return !!value && typeof value === 'object' && (value as ProjectBundle).format === BUNDLE_FORMAT;
}
