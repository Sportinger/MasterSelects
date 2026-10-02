import { Logger } from '../logger';
import { backendForLocation, directoryForOpfs, prepareRepositoryOpen } from './repository/lifecycle/repositoryLocations';
import { createRepositoryAt } from './repository/lifecycle/repositoryProjectOperations';
import { getActiveRepositoryDirectory, getActiveRepositorySession, repositoryWorkspaceId } from './repository/lifecycle/editorRepositoryLifecycle';
import { prepareArchive } from './repository/archive/selectiveArchive';
import { recoverRepository } from './repository/persistence/recovery';
import { RepositoryError } from './repository/contracts';
const log = Logger.create('AndroidProjectAutoRestore');
const READY_PROJECT_KEY = 'ms-android-auto-restore-project';
const knownMirrorHandles = new WeakSet<FileSystemDirectoryHandle>();
function supported() {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? '';
  return /android/i.test(platform + ' ' + navigator.userAgent) && typeof navigator.storage?.getDirectory === 'function';
}
/** Snapshot duplication never overwrites an earlier recovery copy or the picked source. */
export async function prepareAndroidProjectAutoRestore(source: FileSystemDirectoryHandle, onFileCopied?: (path: string) => void): Promise<FileSystemDirectoryHandle | null> {
  if (!supported()) return null;
  if (knownMirrorHandles.has(source)) return source;
  const path = source.name + ' (Android ' + crypto.randomUUID() + ')';
  const active = getActiveRepositorySession(); const directory = getActiveRepositoryDirectory();
  if (active && directory && await source.isSameEntry(directory)) {
    await createRepositoryAt({ kind: 'opfs', path }, source.name, true);
  } else {
    const prepared = await prepareRepositoryOpen({ kind: 'fsa', handle: source }, repositoryWorkspaceId);
    const backend = await backendForLocation(prepared.options.location);
    const recovery = await recoverRepository(backend, prepared.options.descriptor);
    if (!recovery.head) throw new RepositoryError('corrupt', 'Android recovery source has no confirmed project');
    const target = await backendForLocation({ kind: 'opfs', path }); const id = crypto.randomUUID();
    const owner = await target.acquireOwner(id); if (!owner) throw new RepositoryError('ownership', 'Android recovery target is owned');
    try { await prepareArchive(backend, prepared.options.descriptor, recovery.head, target, owner,
      { targetRepositoryId: id, history: { kind: 'all' }, journals: 'all', workspace: [], media: 'linked' }); }
    finally { await owner.release(); }
  }
  const handle = await directoryForOpfs(path); knownMirrorHandles.add(handle); onFileCopied?.('Confirmed project repository'); return handle;
}
export function markAndroidProjectAutoRestoreReady(handle: FileSystemDirectoryHandle): void {
  if (!supported()) return; knownMirrorHandles.add(handle); localStorage.setItem(READY_PROJECT_KEY, handle.name);
}
export function isAndroidAutoRestoreProjectHandle(handle: FileSystemDirectoryHandle | null): boolean { return Boolean(handle && knownMirrorHandles.has(handle)); }
export async function getAndroidProjectAutoRestoreHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!supported()) return null; const path = localStorage.getItem(READY_PROJECT_KEY); if (!path) return null;
  try { const root = await navigator.storage.getDirectory(); const handle = await root.getDirectoryHandle(path, { create: false });
    knownMirrorHandles.add(handle); return handle; }
  catch (error) { log.warn('Stored Android repository is unavailable', error); localStorage.removeItem(READY_PROJECT_KEY); return null; }
}
export async function restoreAndroidProjectAutomatically(loadProject: (handle: FileSystemDirectoryHandle) => Promise<boolean>): Promise<boolean> {
  const handle = await getAndroidProjectAutoRestoreHandle(); if (!handle) return false;
  const restored = await loadProject(handle); if (!restored) localStorage.removeItem(READY_PROJECT_KEY); return restored;
}
