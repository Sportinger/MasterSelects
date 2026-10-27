import type { RepositoryBackend, RepositoryDescriptor } from '../contracts';
import { RepositoryError } from '../contracts';
import type { RepositoryLocation, RepositoryOpenProgress } from '../storageWorkerProtocol';
import { createFsaRepositoryBackend } from '../backends/fsaBackend';
import { createOpfsRepositoryBackend } from '../backends/opfsBackend';
import { getBrowserStorageRoot, getBrowserStorageRootOf, resolveBrowserStore, type BrowserStorageKind } from '../../core/browserStorageRoot';
import { createNativeRepositoryBackend } from '../backends/nativeBackend';
import { NativeHelperClient } from '../../../nativeHelper/NativeHelperClient';
import { readJson } from '../archive/streamIO';
import { findCompletedBackup, completedBackupSource } from '../archive/backupCompletion';
import { prepareArchive } from '../archive/selectiveArchive';
import { newRepositoryDescriptor } from './RepositoryLifecycle';
import { assertLegacyImportComplete, findLegacyPackage, hasResumableInPlaceImport, importBindings, isLegacyProjectBackend, prepareLegacyImport } from './legacyImportPreparation';
import type { ReadOnlyProjectSource } from '../import/legacySource';
import { directorySource } from '../import/sourceReaders';
import { createEditorRepositoryActivation } from '../transaction/editorProjectionActivation';
import type { PreparedRepository } from './RepositoryLifecycle';

export async function backendForLocation(location: RepositoryLocation): Promise<RepositoryBackend> {
  if (location.kind === 'fsa') return createFsaRepositoryBackend(location.handle);
  if (location.kind === 'opfs') return createOpfsRepositoryBackend(location.path, location.store);
  return createNativeRepositoryBackend(location.path, NativeHelperClient);
}
/**
 * Opening a folder probes it twice in quick succession (isLegacyProjectLocation, then prepareRepositoryOpen).
 * Those read-only probes share one backend for a few seconds: one permission query instead of two, and its
 * handle and descriptor caches. Safe because a probe backend is never used to write (prepareNewRepository,
 * restores and conversions create their own) and its caches only hold runtime handles and final bytes of
 * write-once files (see directoryFileCache.ts); a revoked permission still fails the next folder call.
 */
const probeBackends = new WeakMap<FileSystemDirectoryHandle, { backend: Promise<RepositoryBackend>; expires: number }>();
const PROBE_BACKEND_MS = 10_000;
/**
 * The probe caches the descriptor as a write-once file, which holds only while the folder's project stays
 * the same. So the shared backend is handed over exactly once: prepareRepositoryOpen consumes it (the next
 * open of the folder probes afresh, also after a 'descriptor identity changed' failure), and creating a
 * project drops it. A folder whose project was replaced outside the app is then never read from a stale
 * descriptor of the previous one.
 */
function probeBackendForLocation(location: RepositoryLocation, consume = false): Promise<RepositoryBackend> {
  if (location.kind !== 'fsa') return backendForLocation(location);
  const now = Date.now(); const known = probeBackends.get(location.handle);
  if (known && known.expires > now) {
    if (consume) probeBackends.delete(location.handle);
    return known.backend;
  }
  const backend = backendForLocation(location);
  if (consume) { probeBackends.delete(location.handle); return backend; }
  probeBackends.set(location.handle, { backend, expires: now + PROBE_BACKEND_MS });
  backend.catch(() => { if (probeBackends.get(location.handle)?.backend === backend) probeBackends.delete(location.handle); });
  return backend;
}
/** Drops the shared read-only probe of a folder (its project was created or replaced). */
export function forgetProbeBackend(location: RepositoryLocation): void {
  if (location.kind === 'fsa') probeBackends.delete(location.handle);
}
/** Old-format folders are converted into a new repository instead of being opened in place. */
export async function isLegacyProjectLocation(location: RepositoryLocation): Promise<boolean> {
  return isLegacyProjectBackend(await probeBackendForLocation(location));
}
export async function directoryForOpfs(path: string, store?: BrowserStorageKind): Promise<FileSystemDirectoryHandle> {
  let root = await (store ? getBrowserStorageRootOf(store) : getBrowserStorageRoot());
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..') throw new RepositoryError('corrupt', 'Invalid OPFS project path');
    root = await root.getDirectoryHandle(part, { create: true });
  }
  return root;
}
/** Opening must not create a browser-storage folder: a missing project is reported, not replaced by an empty one. */
export async function opfsLocationExists(path: string, store?: BrowserStorageKind): Promise<boolean> {
  let directory = await (store ? getBrowserStorageRootOf(store) : getBrowserStorageRoot());
  try {
    for (const part of path.split('/')) {
      if (!part || part === '.' || part === '..') return false;
      directory = await directory.getDirectoryHandle(part);
    }
    return true;
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) return false;
    throw error;
  }
}
/** Removes a nested browser-storage folder (staging, never a top-level project); a missing folder is already gone. */
export async function removeOpfsLocation(path: string, store?: BrowserStorageKind): Promise<void> {
  const parts = path.split('/'); const leaf = parts.pop();
  if (!leaf || !parts.length || [leaf, ...parts].some(part => !part || part === '.' || part === '..')) throw new RepositoryError('corrupt', 'Only nested browser-storage folders can be removed');
  let parent = await (store ? getBrowserStorageRootOf(store) : getBrowserStorageRoot());
  try {
    for (const part of parts) parent = await parent.getDirectoryHandle(part);
    await parent.removeEntry(leaf, { recursive: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return;
    throw error;
  }
}
export async function prepareNewRepository(location: RepositoryLocation, workspaceId: string): Promise<PreparedRepository> {
  // A project is about to be created here: an earlier probe of this folder describes what was there before.
  forgetProbeBackend(location);
  const backend = await backendForLocation(location);
  // Three independent read-only probes: issued together, they cost one provider round trip instead of three.
  const [descriptorFile, legacyFile, page] = await Promise.all([backend.stat('project.msrepo.json'), backend.stat('project.json'), backend.list('', undefined, 128)]);
  if (descriptorFile || legacyFile) throw new RepositoryError('conflict', 'Project directory already contains a project');
  if (page.paths.some(path => !path.includes('/') && path.toLowerCase().endsWith('.msproj'))) throw new RepositoryError('conflict', 'Directory already contains a project archive');
  const descriptor = newRepositoryDescriptor();
  // No main-thread prepareTarget: the storage worker writes the descriptor itself when the folder has none,
  // under the exclusive writer it acquires anyway, and refuses to create one without it ('Creating a
  // repository requires an exclusive writer'); writeNew refuses an existing descriptor. Writing it here as
  // well cost a second lock acquisition, a write with read-back and the worker's re-read of the same file
  // (about nine sequential folder calls on a phone) for the same guarantees.
  return { options: { descriptor, location, workspaceId, activation: createEditorRepositoryActivation(), nativeClient: NativeHelperClient } };
}

export interface RepositoryOpenOptions {
  /** Separate folder for an old-format project; by default (or when it is the same folder) it converts in place. */
  legacyTarget?: RepositoryLocation;
  /** Cancels a running conversion or archive restore; its staging is removed. */
  signal?: AbortSignal;
}
async function sameLocation(left: RepositoryLocation, right: RepositoryLocation): Promise<boolean> {
  if (left.kind === 'fsa' && right.kind === 'fsa') return left.handle.isSameEntry(right.handle);
  if (left.kind !== right.kind || left.kind === 'fsa' || right.kind === 'fsa') return false;
  if (left.kind === 'opfs' && right.kind === 'opfs' && resolveBrowserStore(left.store) !== resolveBrowserStore(right.store)) return false;
  const normalize = (path: string) => path.replaceAll('\\', '/').replace(/\/$/, '');
  return normalize(left.path) === normalize(right.path);
}
/** Existing repository validation never invokes an old lifecycle loader or writes to its source. */
export async function prepareRepositoryOpen(location: RepositoryLocation, workspaceId: string, onProgress?: (progress: RepositoryOpenProgress) => void, options: RepositoryOpenOptions = {}): Promise<PreparedRepository> {
  // Yield at actual preparation boundaries so the browser can paint the reported stage.
  const report = async (phase: 'source') => {
    onProgress?.({ phase });
    if (onProgress) await new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  await report('source');
  const backend = await probeBackendForLocation(location, true);
  // The read-only probes of a repository folder are independent, so they are issued together (one provider
  // round trip chain instead of five on phones). The descriptor, import bindings and backup receipts are
  // read speculatively: each is only consulted on the branch that needed it before, in the same order,
  // and a speculative failure on a branch that does not use it is ignored.
  const descriptorFile = backend.stat('project.msrepo.json');
  const bindings = importBindings(backend);
  const descriptorRead = readJson<RepositoryDescriptor>(backend, 'project.msrepo.json', 65536);
  const backupRead = descriptorRead.then(descriptor => findCompletedBackup(backend, descriptor));
  for (const speculative of [bindings, descriptorRead, backupRead]) speculative.catch(() => {});
  // An in-place conversion that stopped midway resumes from the same folder instead of opening half-built.
  if (await descriptorFile && !await hasResumableInPlaceImport(backend, await bindings)) {
    const descriptor = await descriptorRead;
    if (descriptor.format !== 'masterselects-repository' || descriptor.formatVersion !== 1) throw new RepositoryError('unsupported', 'Unsupported repository format');
    const completed = await backupRead;
    if (completed) {
      const restoreId = crypto.randomUUID();
      const restoredLocation: RepositoryLocation = { kind: 'opfs', path: 'repository-backup-restores/' + restoreId };
      const restored = await backendForLocation(restoredLocation);
      const restoredDescriptor: RepositoryDescriptor = { ...descriptor, repositoryId: crypto.randomUUID() };
      const owner = await restored.acquireOwner(restoredDescriptor.repositoryId);
      if (!owner) throw new RepositoryError('ownership', 'Backup restore target is already owned');
      try {
        await prepareArchive(completedBackupSource(backend, completed), descriptor, completed.commit, restored, owner,
          { targetRepositoryId: restoredDescriptor.repositoryId, history: { kind: 'all' }, journals: 'all', workspace: completed.workspace, media: 'linked' });
      } finally { await owner.release(); }
      return { options: { descriptor: restoredDescriptor, location: restoredLocation, workspaceId, activation: createEditorRepositoryActivation() } };
    }
    await assertLegacyImportComplete(backend, await bindings);
    return { options: { descriptor, location, workspaceId, activation: createEditorRepositoryActivation(), nativeClient: NativeHelperClient } };
  }
  // Only old project files convert; anything else (e.g. an empty folder) is not a project to import.
  if (!await backend.stat('project.json') && !await findLegacyPackage(backend)) {
    throw new RepositoryError('unsupported', 'This folder does not contain a MasterSelects project (no project.msrepo.json, project.json or .msproj file).');
  }
  let source: ReadOnlyProjectSource;
  if (location.kind === 'native') source = { sourceId: backend.locationId, locationId: backend.locationId,
    stat: path => backend.stat(path), read: (path, offset, length, signal) => backend.read(path, offset, length, signal),
    list: (prefix, cursor, limit, signal) => backend.list(prefix, cursor, limit, signal) };
  else source = directorySource(location.kind === 'fsa' ? location.handle : await directoryForOpfs(location.path, location.store), backend.locationId, backend.locationId);
  // Old files are only read; the repository is added beside them unless a separate folder was chosen.
  const target = options.legacyTarget ?? location;
  const inPlace = target === location || await sameLocation(target, location);
  const imported = await prepareLegacyImport({ source, sourceHandle: location.kind === 'fsa' ? location.handle : null, target: inPlace ? location : target, inPlace,
    workspaceId, backendFor: backendForLocation, removeStaging: path => removeOpfsLocation(path), signal: options.signal, onProgress: progress => onProgress?.(progress) });
  return { options: { descriptor: imported.descriptor, location: imported.location, workspaceId, activation: createEditorRepositoryActivation() } };
}
