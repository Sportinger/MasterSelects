import type { RepositoryBackend, RepositoryDescriptor } from '../contracts';
import { RepositoryError } from '../contracts';
import type { RepositoryLocation, RepositoryOpenProgress } from '../storageWorkerProtocol';
import { createFsaRepositoryBackend } from '../backends/fsaBackend';
import { createOpfsRepositoryBackend } from '../backends/opfsBackend';
import { createNativeRepositoryBackend } from '../backends/nativeBackend';
import { NativeHelperClient } from '../../../nativeHelper/NativeHelperClient';
import { readJson, writeJson } from '../archive/streamIO';
import { findCompletedBackup, completedBackupSource } from '../archive/backupCompletion';
import { prepareArchive } from '../archive/selectiveArchive';
import { newRepositoryDescriptor } from './RepositoryLifecycle';
import { assertLegacyImportComplete, isLegacyProjectBackend, prepareLegacyImport } from './legacyImportPreparation';
import type { ReadOnlyProjectSource } from '../import/legacySource';
import { directorySource } from '../import/sourceReaders';
import { createEditorRepositoryActivation } from '../transaction/editorProjectionActivation';
import type { PreparedRepository } from './RepositoryLifecycle';

export async function backendForLocation(location: RepositoryLocation): Promise<RepositoryBackend> {
  if (location.kind === 'fsa') return createFsaRepositoryBackend(location.handle);
  if (location.kind === 'opfs') return createOpfsRepositoryBackend(location.path);
  return createNativeRepositoryBackend(location.path, NativeHelperClient);
}
/** Old-format folders are converted into a new repository instead of being opened in place. */
export async function isLegacyProjectLocation(location: RepositoryLocation): Promise<boolean> {
  return isLegacyProjectBackend(await backendForLocation(location));
}
export async function directoryForOpfs(path: string): Promise<FileSystemDirectoryHandle> {
  let root = await navigator.storage.getDirectory();
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..') throw new RepositoryError('corrupt', 'Invalid OPFS project path');
    root = await root.getDirectoryHandle(part, { create: true });
  }
  return root;
}
export async function prepareNewRepository(location: RepositoryLocation, workspaceId: string): Promise<PreparedRepository> {
  const backend = await backendForLocation(location);
  if (await backend.stat('project.msrepo.json') || await backend.stat('project.json')) throw new RepositoryError('conflict', 'Project directory already contains a project');
  const page = await backend.list('', undefined, 128);
  if (page.paths.some(path => !path.includes('/') && path.toLowerCase().endsWith('.msproj'))) throw new RepositoryError('conflict', 'Directory already contains a project archive');
  const descriptor = newRepositoryDescriptor();
  return { options: { descriptor, location, workspaceId, activation: createEditorRepositoryActivation(), nativeClient: NativeHelperClient },
    async prepareTarget() {
      const owner = await backend.acquireOwner(descriptor.repositoryId);
      if (!owner) throw new RepositoryError('ownership', 'New target is read-only or already owned');
      try { await writeJson(backend, 'project.msrepo.json', descriptor); } finally { await owner.release(); }
    } };
}

export interface RepositoryOpenOptions {
  /** Folder for converting an old-format project; without it the conversion stays in browser storage. */
  legacyTarget?: RepositoryLocation;
}
/** Existing repository validation never invokes an old lifecycle loader or writes to its source. */
export async function prepareRepositoryOpen(location: RepositoryLocation, workspaceId: string, onProgress?: (progress: RepositoryOpenProgress) => void, options: RepositoryOpenOptions = {}): Promise<PreparedRepository> {
  // Yield at actual preparation boundaries so the browser can paint the reported stage.
  const report = async (phase: 'source') => {
    onProgress?.({ phase });
    if (onProgress) await new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  await report('source');
  const backend = await backendForLocation(location);
  if (await backend.stat('project.msrepo.json')) {
    const descriptor = await readJson<RepositoryDescriptor>(backend, 'project.msrepo.json', 65536);
    if (descriptor.format !== 'masterselects-repository' || descriptor.formatVersion !== 1) throw new RepositoryError('unsupported', 'Unsupported repository format');
    const completed = await findCompletedBackup(backend, descriptor);
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
    await assertLegacyImportComplete(backend);
    return { options: { descriptor, location, workspaceId, activation: createEditorRepositoryActivation(), nativeClient: NativeHelperClient } };
  }
  let source: ReadOnlyProjectSource;
  if (location.kind === 'native') source = { sourceId: backend.locationId, locationId: backend.locationId,
    stat: path => backend.stat(path), read: (path, offset, length, signal) => backend.read(path, offset, length, signal),
    list: (prefix, cursor, limit, signal) => backend.list(prefix, cursor, limit, signal) };
  else source = directorySource(location.kind === 'fsa' ? location.handle : await directoryForOpfs(location.path), backend.locationId, backend.locationId);
  // Legacy sources are read only; the converted repository goes to the chosen folder.
  const imported = await prepareLegacyImport({ source, sourceHandle: location.kind === 'fsa' ? location.handle : null, target: options.legacyTarget ?? null,
    workspaceId, backendFor: backendForLocation, onProgress: progress => onProgress?.(progress) });
  return { options: { descriptor: imported.descriptor, location: imported.location, workspaceId, activation: createEditorRepositoryActivation() } };
}
