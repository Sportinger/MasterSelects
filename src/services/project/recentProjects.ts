import { Logger } from '../logger';
import { projectDB } from '../projectDB';
import type { ProjectFile } from './types';

const log = Logger.create('RecentProjects');

const RECENT_PROJECTS_KEY = 'ms-recent-projects';
const RECENT_PROJECT_HANDLE_PREFIX = 'recentProject:';
const MAX_RECENT_PROJECTS = 12;

export const RECENT_PROJECTS_CHANGED_EVENT = 'masterselects-recent-projects-changed';

export type RecentProjectBackend = 'fsa' | 'native';

export interface RecentProjectEntry {
  id: string;
  name: string;
  backend: RecentProjectBackend;
  lastOpenedAt: number;
  updatedAt?: string;
  handleKey?: string;
  path?: string;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeNativePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function getNameFromPath(path: string): string {
  const parts = normalizeNativePath(path).split('/').filter(Boolean);
  return parts.at(-1) ?? 'Project';
}

function createRecentId(): string {
  return `recent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecentProjectEntry(value: unknown): value is RecentProjectEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Partial<RecentProjectEntry>;
  if (typeof entry.id !== 'string' || typeof entry.name !== 'string') {
    return false;
  }

  if (entry.backend !== 'fsa' && entry.backend !== 'native') {
    return false;
  }

  if (typeof entry.lastOpenedAt !== 'number' || !Number.isFinite(entry.lastOpenedAt)) {
    return false;
  }

  if (entry.backend === 'fsa') {
    return typeof entry.handleKey === 'string';
  }

  return typeof entry.path === 'string' && entry.path.length > 0;
}

function dispatchRecentProjectsChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(RECENT_PROJECTS_CHANGED_EVENT));
}

function readRecentProjects(): RecentProjectEntry[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(RECENT_PROJECTS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isRecentProjectEntry)
      .toSorted((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .slice(0, MAX_RECENT_PROJECTS);
  } catch (error) {
    log.warn('Failed to read recent projects', error);
    return [];
  }
}

function writeRecentProjects(entries: RecentProjectEntry[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const normalized = entries
    .toSorted((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, MAX_RECENT_PROJECTS);

  try {
    storage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(normalized));
    dispatchRecentProjectsChanged();
  } catch (error) {
    log.warn('Failed to write recent projects', error);
  }
}

async function deleteFsaHandle(handleKey: string | undefined): Promise<void> {
  if (!handleKey) {
    return;
  }

  try {
    await projectDB.deleteHandle(handleKey);
  } catch (error) {
    log.debug('Failed to delete recent project handle', { handleKey, error });
  }
}

async function isSameDirectoryHandle(
  left: FileSystemDirectoryHandle,
  right: FileSystemHandle | null,
): Promise<boolean> {
  if (!right || right.kind !== 'directory') {
    return false;
  }

  try {
    return await left.isSameEntry(right);
  } catch {
    return false;
  }
}

async function findFsaEntry(
  entries: RecentProjectEntry[],
  handle: FileSystemDirectoryHandle,
): Promise<RecentProjectEntry | null> {
  for (const entry of entries) {
    if (entry.backend !== 'fsa' || !entry.handleKey) {
      continue;
    }

    const storedHandle = await projectDB.getStoredHandle(entry.handleKey);
    if (await isSameDirectoryHandle(handle, storedHandle)) {
      return entry;
    }
  }

  return null;
}

function upsertEntry(entries: RecentProjectEntry[], nextEntry: RecentProjectEntry): RecentProjectEntry[] {
  return [
    nextEntry,
    ...entries.filter((entry) => entry.id !== nextEntry.id),
  ];
}

function pruneRemovedEntries(before: RecentProjectEntry[], after: RecentProjectEntry[]): RecentProjectEntry[] {
  const keptIds = new Set(after.map((entry) => entry.id));
  return before.filter((entry) => !keptIds.has(entry.id));
}

async function persistEntries(entries: RecentProjectEntry[]): Promise<void> {
  const sorted = entries.toSorted((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  const kept = sorted.slice(0, MAX_RECENT_PROJECTS);
  const removed = pruneRemovedEntries(sorted, kept);

  await Promise.all(removed.map((entry) => entry.backend === 'fsa'
    ? deleteFsaHandle(entry.handleKey)
    : Promise.resolve()));

  writeRecentProjects(kept);
}

export function getRecentProjects(): RecentProjectEntry[] {
  return readRecentProjects();
}

export function getRecentProject(id: string): RecentProjectEntry | null {
  return getRecentProjects().find((entry) => entry.id === id) ?? null;
}

export async function addRecentFsaProject(
  handle: FileSystemDirectoryHandle,
  projectData: ProjectFile | null,
): Promise<void> {
  const entries = getRecentProjects();
  const existing = await findFsaEntry(entries, handle);
  const id = existing?.id ?? createRecentId();
  const handleKey = existing?.handleKey ?? `${RECENT_PROJECT_HANDLE_PREFIX}${id}`;

  try {
    await projectDB.storeHandle(handleKey, handle);
  } catch (error) {
    log.warn('Failed to store recent project handle', error);
    return;
  }

  const nextEntry: RecentProjectEntry = {
    id,
    name: projectData?.name || handle.name || 'Project',
    backend: 'fsa',
    handleKey,
    updatedAt: projectData?.updatedAt,
    lastOpenedAt: Date.now(),
  };

  await persistEntries(upsertEntry(entries, nextEntry));
}

export async function addRecentNativeProject(
  path: string,
  projectData: ProjectFile | null,
): Promise<void> {
  const normalizedPath = normalizeNativePath(path);
  if (!normalizedPath) {
    return;
  }

  const entries = getRecentProjects();
  const existing = entries.find((entry) => entry.backend === 'native' && entry.path === normalizedPath);
  const nextEntry: RecentProjectEntry = {
    id: existing?.id ?? createRecentId(),
    name: projectData?.name || getNameFromPath(normalizedPath),
    backend: 'native',
    path: normalizedPath,
    updatedAt: projectData?.updatedAt,
    lastOpenedAt: Date.now(),
  };

  await persistEntries(upsertEntry(entries, nextEntry));
}

export async function removeRecentFsaProject(handle: FileSystemDirectoryHandle): Promise<void> {
  const entries = getRecentProjects();
  const entry = await findFsaEntry(entries, handle);
  if (!entry) {
    return;
  }

  await removeRecentProject(entry.id);
}

export async function removeRecentNativeProject(path: string): Promise<void> {
  const normalizedPath = normalizeNativePath(path);
  const entry = getRecentProjects()
    .find((candidate) => candidate.backend === 'native' && candidate.path === normalizedPath);

  if (!entry) {
    return;
  }

  await removeRecentProject(entry.id);
}

export async function removeRecentProject(id: string): Promise<void> {
  const entries = getRecentProjects();
  const removed = entries.find((entry) => entry.id === id);

  if (removed?.backend === 'fsa') {
    await deleteFsaHandle(removed.handleKey);
  }

  writeRecentProjects(entries.filter((entry) => entry.id !== id));
}

export async function clearRecentProjects(): Promise<void> {
  const entries = getRecentProjects();
  await Promise.all(entries.map((entry) => entry.backend === 'fsa'
    ? deleteFsaHandle(entry.handleKey)
    : Promise.resolve()));
  writeRecentProjects([]);
}
