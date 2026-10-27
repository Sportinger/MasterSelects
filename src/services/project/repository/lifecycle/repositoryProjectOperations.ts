import type { RepositoryLocation } from '../storageWorkerProtocol';
import { RepositoryError } from '../contracts';
import { encodeProjectDomains, PROJECT_ENTITY_KEY } from '../domains/projectDomains';
import { createRepositoryProject, type NewProjectComposition } from './defaultProject';
import { prepareNewRepository, prepareRepositoryOpen, backendForLocation, type RepositoryOpenOptions } from './repositoryLocations';
import { openEditorRepository, getActiveRepositorySession, repositoryWorkspaceId, flushEditorRepository } from './editorRepositoryLifecycle';
import { splitProjectWorkspace } from './workspaceProjection';
import { recoverRepository } from '../persistence/recovery';
import { prepareArchive } from '../archive/selectiveArchive';
import { captureRuntimeArchiveSources } from '../archive/runtimeSources';
import { backupRepository } from '../archive/repositoryBackup';
import { acquireProjectRoot } from '../../core/projectRootAccess';
import { resolveBrowserStore } from '../../core/browserStorageRoot';

export async function openRepositoryProject(location: RepositoryLocation, options: RepositoryOpenOptions = {}) {
  const current = getActiveRepositorySession();
  if (current && current.location.kind === location.kind) {
    const same = location.kind === 'fsa' && current.location.kind === 'fsa' ? await location.handle.isSameEntry(current.location.handle)
      : location.kind !== 'fsa' && current.location.kind !== 'fsa' && location.path === current.location.path
        && (location.kind !== 'opfs' || current.location.kind !== 'opfs' || resolveBrowserStore(location.store) === resolveBrowserStore(current.location.store));
    if (same) return current;
  }
  return openEditorRepository(onProgress => prepareRepositoryOpen(location, repositoryWorkspaceId, onProgress, options));
}
export async function createRepositoryAt(location: RepositoryLocation, name: string, preserveCurrent = false, composition?: NewProjectComposition) {
  const previous = getActiveRepositorySession();
  const session = await openEditorRepository(async () => {
    const prepared = await prepareNewRepository(location, repositoryWorkspaceId);
    if (preserveCurrent && previous) {
      prepared.options.descriptor.lineageId = previous.descriptor.lineageId;
      prepared.prepareTarget = async () => {
        const source = await backendForLocation(previous.location); const target = await backendForLocation(location);
        const recovered = await recoverRepository(source, previous.descriptor);
        if (!recovered.head) throw new RepositoryError('corrupt', 'Current project has no confirmed state to duplicate');
        const owner = await target.acquireOwner(prepared.options.descriptor.repositoryId);
        if (!owner) throw new RepositoryError('ownership', 'Duplicate target is unavailable');
        try { await prepareArchive(source, previous.descriptor, recovered.head, target, owner, {
          targetRepositoryId: prepared.options.descriptor.repositoryId, history: { kind: 'all' }, journals: 'all',
          workspace: Object.keys(previous.coordinator.receipt().views).map(viewKey => ({ workspaceId: repositoryWorkspaceId, viewKey })), media: 'linked',
        }); } finally { await owner.release(); }
      };
    } else {
      const project = createRepositoryProject(name, composition); const encoded = encodeProjectDomains(project);
      prepared.initialize = { entities: encoded.entities, workspace: Object.fromEntries(splitProjectWorkspace(encoded.workspace).map(part => [part.key, part.value])), journals: encoded.journals };
    }
    return prepared;
  });
  if (preserveCurrent && previous) await renameRepositoryProject(name);
  return session;
}
export async function renameRepositoryProject(name: string): Promise<boolean> {
  const session = getActiveRepositorySession(); const root = session?.coordinator.getProjection().entities.get(PROJECT_ENTITY_KEY);
  const trimmed = name.trim(); const value = root?.value;
  if (!session || !root || !trimmed || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  // Only the root entity changes. Re-encoding the whole decoded project would reject repository-internal
  // adjuncts such as the $sourceIdentity proof of verified media, which broke Save As and Save permanently.
  const token = session.coordinator.begin('Rename project', 'user');
  try { session.coordinator.write(token, PROJECT_ENTITY_KEY, { ...root, value: { ...value, name: trimmed } });
    const committed = session.coordinator.commit(token); await session.coordinator.flush(committed.receipt); return true;
  } catch (error) { try { session.coordinator.cancel(token); } catch { /* Committed operations remain recoverable. */ } throw error; }
}
export async function createIndependentProjectBackup(): Promise<boolean> {
  const session = getActiveRepositorySession(); if (!session) return false;
  // Picker is reached only from an explicit user Backup action.
  const handle = await acquireProjectRoot('fsa'); if (!handle) return false;
  await flushEditorRepository();
  const source = await backendForLocation(session.location); const target = await backendForLocation({ kind: 'fsa', handle });
  const recovered = await recoverRepository(source, session.descriptor);
  if (!recovered.head) throw new RepositoryError('corrupt', 'No confirmed project state for backup');
  const owner = await target.acquireOwner('backup-' + session.descriptor.repositoryId);
  if (!owner) throw new RepositoryError('ownership', 'Backup target unavailable');
  try { await backupRepository(source, session.descriptor, recovered.head, target, owner, {
    media: 'self-contained', resolveSources: captureRuntimeArchiveSources(session),
    views: Object.keys(session.coordinator.receipt().views).map(viewKey => ({ workspaceId: repositoryWorkspaceId, viewKey })),
  }); return true; } finally { await owner.release(); }
}
export function repositoryHasUnsavedChanges(): boolean {
  const status = getActiveRepositorySession()?.coordinator.getStatus();
  return Boolean(status && (status.error || status.appliedSequence > status.confirmedSequence));
}
