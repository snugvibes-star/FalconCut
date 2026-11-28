/**
 * Local-only storage. Media blobs live in IndexedDB on the user's device and
 * never leave it. Project documents are persisted here too (see project store
 * below). Nothing in this module talks to a network.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '../../engine/types';

/** A version snapshot, stored alongside (but separately from) its project so
 * a reload or a project switch cannot destroy the user's rollback points. */
export interface StoredVersion {
  id: string;
  projectId: string;
  name: string;
  at: number;
  project: Project;
  thumbnail?: string;
  score: number;
  source: 'manual' | 'ai' | 'auto';
}

interface FalconCutDB extends DBSchema {
  blobs: { key: string; value: Blob };
  projects: { key: string; value: Project; indexes: { updatedAt: number } };
}

/** Snapshots live in their own database so adding them never forces a version
 * upgrade (and a potential blocked upgrade) on existing users' main DB. */
interface VersionsDB extends DBSchema {
  versions: { key: string; value: StoredVersion; indexes: { projectId: string } };
}

/* Storage identity is intentionally the pre-rename id: it is never shown in
 * the UI, and changing it would orphan every project and media blob already
 * saved on this device. */
const DB_NAME = 'cutflow';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FalconCutDB>> | null = null;

function db(): Promise<IDBPDatabase<FalconCutDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FalconCutDB>(DB_NAME, DB_VERSION, {
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
export async function garbageCollectBlobs(extraProjects: Project[] = []): Promise<number> {
  const projects = [...await listProjects(), ...extraProjects];
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

/* ---------------- version snapshots ---------------- */

const VERSIONS_DB_NAME = 'cutflow-versions';
let versionsDbPromise: Promise<IDBPDatabase<VersionsDB>> | null = null;

function versionsDb(): Promise<IDBPDatabase<VersionsDB>> {
  if (!versionsDbPromise) {
    versionsDbPromise = openDB<VersionsDB>(VERSIONS_DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('versions')) {
          const s = d.createObjectStore('versions', { keyPath: 'id' });
          s.createIndex('projectId', 'projectId');
        }
      },
    });
  }
  return versionsDbPromise;
}

export async function saveVersion(version: StoredVersion): Promise<void> {
  const database = await versionsDb();
  await database.put('versions', version);
  // Keep the store bounded (the store also caps the in-memory list at 40).
  const all = await database.getAllFromIndex('versions', 'projectId', version.projectId);
  if (all.length > 40) {
    const stale = all.sort((a, b) => a.at - b.at).slice(0, all.length - 40);
    for (const v of stale) await database.delete('versions', v.id);
  }
}

export async function loadVersions(projectId: string): Promise<StoredVersion[]> {
  const all = await (await versionsDb()).getAllFromIndex('versions', 'projectId', projectId);
  return all.sort((a, b) => b.at - a.at).slice(0, 40);
}

export async function deleteVersionRecord(id: string): Promise<void> {
  await (await versionsDb()).delete('versions', id);
}