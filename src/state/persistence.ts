/**
 * Local-only storage. Media blobs live in IndexedDB on the user's device and
 * never leave it. Project documents are persisted here too (see project store
 * below). Nothing in this module talks to a network.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '../../engine/types';

interface CutFlowDB extends DBSchema {
  blobs: { key: string; value: Blob };
  projects: { key: string; value: Project; indexes: { updatedAt: number } };
}

const DB_NAME = 'cutflow';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CutFlowDB>> | null = null;

function db(): Promise<IDBPDatabase<CutFlowDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CutFlowDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        if (!d.objectStoreNames.contains('projects')) {
          const s = d.createObjectStore('projects', { keyPath: 'id' });
          s.createIndex('updatedAt', 'updatedAt');
        }
      },
    });
  }
  return dbPromise;
}

/* ---------------- media blobs ---------------- */

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await (await db()).put('blobs', blob, key);
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await db()).get('blobs', key);
}

export async function deleteBlob(key: string): Promise<void> {
  await (await db()).delete('blobs', key);
}

export async function listBlobKeys(): Promise<string[]> {
  return (await db()).getAllKeys('blobs');
}

/** Delete blobs no project references anymore (failed imports, removed media,
 * deleted projects). Conservative: only touches keys that look like media. */
export async function garbageCollectBlobs(): Promise<number> {
  const projects = await listProjects();
  const referenced = new Set<string>();
  for (const p of projects) {
    for (const m of p.media ?? []) if (m.blobKey) referenced.add(m.blobKey);
  }
  const keys = await listBlobKeys();
  let deleted = 0;
  for (const k of keys) {
    if (!referenced.has(k) && k.startsWith('media_')) { await deleteBlob(k); deleted++; }
  }
  return deleted;
}

/* ---------------- project documents ---------------- */

export async function saveProject(project: Project): Promise<void> {
  await (await db()).put('projects', project);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return (await db()).get('projects', id);
}

export async function deleteProject(id: string): Promise<void> {
  await (await db()).delete('projects', id);
}

export async function listProjects(): Promise<Project[]> {
  const all = await (await db()).getAllFromIndex('projects', 'updatedAt');
  return all.reverse(); // most recently updated first
}