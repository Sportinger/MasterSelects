import type { BlobReference, JsonValue } from '../contracts';
import type { RepositorySession } from '../RepositorySession';
import { RepositoryError } from '../contracts';
import { getRepositoryStore, withRepositoryHydration } from '../transaction/storeMutationBoundary';
import type { MediaState } from '../../../../stores/mediaStore/types';
import type { TimelineStore } from '../../../../stores/timeline/types';
import { scheduleMediaSourceArtifactProjectionForClips } from '../../../mediaArtifacts/mediaSourceArtifacts';
import { setProjectLoadProgress, completeProjectLoadProgress, failProjectLoadProgress } from '../../load/loadProgress';
import { editorRepositoryLifecycle as createLifecycle, isSupersededScratchOpen, type PreparedRepository, type PrepareRepository, type RepositoryOpenKind } from './RepositoryLifecycle';
import { startProjectLoadMeasurement } from '../../load/projectLoadTelemetry';
import { Logger } from '../../../logger';
import { activateRepositoryProjection } from '../transaction/editorProjectionActivation';
import { startScheduledLinkedMediaConnection } from '../transaction/editorLinkedMediaConnection';
import { captureEditorProjectDomains, flushEditorRepositoryViews, readEditorRepositoryWorkspace, installEditorRepositorySession, getEditorRepositorySourceVersion, applyEditorRepositoryResult } from '../transaction/editorRepositorySession';
import { holdEditorContentPublication, publishEditorContentProjection } from '../transaction/editorPublication';
import { createRepositoryDomainPublication } from '../artifacts/createRepositoryDomainPublication';
import { prepareArtifactSourceVersion } from '../artifacts/prepareArtifactSourceVersion';
import { setRepositoryDomainPublication } from '../artifacts/RepositoryDomainPublication';
import { createWorkerRepositoryArtifactStore } from '../artifacts/WorkerRepositoryArtifactStore';
import { decodeAggregate, entityKey } from '../domains/jsonBoundary';
import { decodeProjectDomains } from '../domains/projectDomains';
import { PROJECT_FOLDERS } from '../../core/constants';
import type { ProjectFile } from '../../types/project.types';
import { directoryForOpfs } from './repositoryLocations';
import { splitProjectWorkspace, readProjectWorkspace } from './workspaceProjection';
import { retryTransientStorage } from '../../core/browserStorageFailure';
import { finishProjectMediaCopiesBeforeSwitch } from '../../mediaCopy/projectSwitchCopyWait';
import { reportInterruptedProjectMediaCopies } from '../../mediaCopy/pendingProjectCopyMarker';

let installedCleanup = (import.meta.hot?.data?.repositoryInstalledCleanup as (() => void) | undefined) ?? null;
let projectWorkspace: JsonValue = (import.meta.hot?.data?.repositoryWorkspace as JsonValue | undefined) ?? {};
let activeDirectory = (import.meta.hot?.data?.repositoryDirectory as FileSystemDirectoryHandle | undefined) ?? null;
const publications = (import.meta.hot?.data?.repositoryPublications as WeakMap<RepositorySession, ReturnType<typeof createRepositoryDomainPublication>> | undefined) ?? new WeakMap<RepositorySession, ReturnType<typeof createRepositoryDomainPublication>>();
const workspaceId = (() => {
  // Render workers import this module through shared code but never open a repository.
  if (typeof sessionStorage === 'undefined') return crypto.randomUUID();
  // One workspace per browser, not per tab: saved media locations, layout and playhead live in it, and
  // a closed tab must not orphan them. Only one tab owns a repository for writing at a time.
  const key = 'ms.repository.workspace';
  const read = (storage: Storage) => { try { return storage.getItem(key); } catch { return null; } };
  const id = read(localStorage) ?? read(sessionStorage) ?? crypto.randomUUID();
  for (const storage of [localStorage, sessionStorage]) { try { storage.setItem(key, id); } catch { /* storage unavailable */ } }
  return id;
})();
export const repositoryWorkspaceId = workspaceId;
function publicationFor(session: RepositorySession) {
  let host = publications.get(session); if (host) return host;
  host = createRepositoryDomainPublication({ coordinator: session.coordinator, artifacts: createWorkerRepositoryArtifactStore(session),
    readJournal: id => session.client.request<JsonValue | null>({ type: 'journal-read', id }),
    sourceVersion: target => getEditorRepositorySourceVersion(session, target),
    prepareSourceVersion: target => {
      const mediaId = target.endsWith('.json') ? target.slice(0, -5) : target;
      return prepareArtifactSourceVersion(session, mediaId, {
        isActive: () => lifecycle.getSession() === session,
        readVersion: () => getEditorRepositorySourceVersion(session, target),
        readFile: () => (getRepositoryStore('media')?.getState() as MediaState | undefined)
          ?.files.find(file => file.id === mediaId)?.file,
      });
    },
    applyResult: (domain, target, version, manifest, reference) => applyEditorRepositoryResult(session, domain, target, version, manifest, reference),
    async readLegacyFile(folder, name) {
      const path = PROJECT_FOLDERS[folder] + '/' + name;
      const entities = session.coordinator.getProjection().entities;
      const key = entityKey('legacyFile', 'project', path); if (!entities.has(key)) return null;
      const value = decodeAggregate(key, entities) as unknown as { identity: BlobReference; sourcePath: string; sourceId: string };
      const semantic = entityKey('legacySidecar', value.sourceId, path);
      if (path.endsWith('.json') && entities.has(semantic)) {
        const sidecar = decodeAggregate(semantic, entities) as { value: JsonValue };
        return new File([JSON.stringify(sidecar.value)], name, { type: 'application/json' });
      }
      const blob = await session.client.request<Blob | null>({ type: 'blob-read', reference: value.identity });
      if (!blob) throw new RepositoryError('corrupt', `Required legacy file ${path} is missing`);
      return new File([blob], name, { type: blob.type });
    },
  }); publications.set(session, host); return host;
}
const log = Logger.create('EditorRepositoryLifecycle');
/** Set when a project open cancelled the background scratch open; a failed open brings it back. */
let scratchSuperseded = false;
const lifecycle = createLifecycle({
  measure: startProjectLoadMeasurement,
  progress(progress) {
    withRepositoryHydration(() => {
      if (progress.phase === 'ready') {
        completeProjectLoadProgress();
        startScheduledLinkedMediaConnection();
        // A copy into this project that a closed page interrupted is reported now (after hydration: it writes a view).
        queueMicrotask(reportInterruptedProjectMediaCopies);
        const timeline = getRepositoryStore('timeline')?.getState() as TimelineStore | undefined;
        if (timeline) scheduleMediaSourceArtifactProjectionForClips(timeline.clips);
        return;
      }
      if (progress.phase === 'failed') { failProjectLoadProgress(new Error(progress.error ?? 'Project could not be opened')); return; }
      const stages = {
        opening: { phase: 'opening', percent: 8, message: 'Opening saved project' },
        source: { phase: 'opening', percent: 10, message: 'Reading selected project' },
        importing: { phase: 'opening', percent: 12, message: 'Importing legacy project' },
        recovery: { phase: 'opening', percent: 25, message: 'Restoring project history' },
        projection: { phase: 'media', percent: 60, message: 'Reading saved project' },
        activation: { phase: 'timeline', percent: 80, message: 'Restoring editor' },
      } as const;
      setProjectLoadProgress({ ...stages[progress.phase], blocking: true,
        detail: !progress.processedRecords ? undefined : progress.phase === 'recovery' ? `${progress.processedRecords.toLocaleString()} saved items recovered`
          : progress.phase === 'importing' ? `${progress.processedRecords.toLocaleString()} project files converted` : undefined });
    });
  },
  async beforeReceipt(session) {
    if (session.opening.writable) await (await import('../../projectSave')).syncStoresToProject();
    await flushEditorRepositoryViews();
  },
  async barrier() {
    const release = holdEditorContentPublication();
    return { release() { const projection = lifecycle.getSession()?.coordinator.getProjection();
      publishEditorContentProjection({ generation: projection?.generation ?? 0, revisionId: projection?.revisionId ?? null }); release(); } };
  },
  async activate(session, workspace) {
    const old = lifecycle.getSession(); setRepositoryDomainPublication(publicationFor(session));
    try { const merged = await readEditorRepositoryWorkspace(session, workspace ?? {});
      await activateRepositoryProjection(session, merged); projectWorkspace = merged;
      activeDirectory = session.location.kind === 'fsa' ? session.location.handle : session.location.kind === 'opfs' ? await directoryForOpfs(session.location.path, session.location.store) : null;
      if (session.location.kind === 'opfs' && !session.location.path.startsWith('repository-scratch/')) sessionStorage.setItem('ms.repository.last-opfs-path', session.location.path);
      else sessionStorage.removeItem('ms.repository.last-opfs-path');
    }
    catch (error) { setRepositoryDomainPublication(old ? publicationFor(old) : null); throw error; }
  },
  install(session) {
    installedCleanup?.(); installedCleanup = null;
    if (session) { installedCleanup = installEditorRepositorySession(session, { workspace: projectWorkspace }); setRepositoryDomainPublication(publicationFor(session)); }
    else { setRepositoryDomainPublication(null); activeDirectory = null; }
  },
});
export function getActiveRepositoryDirectory(): FileSystemDirectoryHandle | null { return activeDirectory; }
export function getActiveRepositorySession(): RepositorySession | null { return lifecycle.getSession(); }
export function subscribeRepositoryLifecycle(listener: () => void): () => void { return lifecycle.subscribe(listener); }
export const getRepositoryLifecycleState = () => lifecycle.getState();
export async function openEditorRepository(prepare: PrepareRepository, kind: RepositoryOpenKind = 'open'): Promise<RepositorySession> {
  // Copies still running into the current project are recorded there first, never dropped by the switch.
  await finishProjectMediaCopiesBeforeSwitch();
  try { const session = await lifecycle.open(prepare, kind); scratchSuperseded = false; return session; }
  catch (error) {
    // The open cancelled the scratch workspace and then failed itself: edits made now need it again.
    if (scratchSuperseded && !lifecycle.getSession()) {
      scratchSuperseded = false;
      void ensureEditorScratchRepository().catch(scratchError => log.warn('Scratch recovery could not be reopened after a failed project open', scratchError));
    }
    throw error;
  }
}
export async function closeEditorRepository(): Promise<void> { await finishProjectMediaCopiesBeforeSwitch(); await lifecycle.close(); }
export async function flushEditorRepository(): Promise<boolean> {
  if (!getActiveRepositorySession()?.opening.writable) throw new RepositoryError('ownership', 'Read-only project cannot publish a save');
  await lifecycle.flush({ retry: true, measure: true }); return true;
}
export async function retryEditorRepository(): Promise<void> { await lifecycle.flush({ retry: true }); }
export function readEditorRepositoryProject(): ProjectFile | null {
  const session = getActiveRepositorySession(); if (!session) return null;
  return decodeProjectDomains(session.coordinator.getProjection().entities, projectWorkspace);
}
export async function flushEditorWorkspace(project: ProjectFile): Promise<void> {
  const session = getActiveRepositorySession(); if (!session || !session.opening.writable) return;
  const encoded = captureEditorProjectDomains(project); projectWorkspace = encoded.workspace;
  for (const part of splitProjectWorkspace(encoded.workspace)) await session.updateView(part.key, part.value);
}
export async function reactivateEditorRepository(): Promise<void> {
  const session = getActiveRepositorySession(); if (session) await activateRepositoryProjection(session, await readEditorRepositoryWorkspace(session, await readProjectWorkspace(session) ?? {}));
}

export function isScratchRepository(): boolean { const session = getActiveRepositorySession(); return session?.location.kind === 'opfs' && session.location.path.startsWith('repository-scratch/'); }
export async function ensureEditorScratchRepository(): Promise<void> {
  if (getActiveRepositorySession()) return;
  // Open-or-create is idempotent (an existing descriptor reopens), so one retry is safe.
  await retryTransientStorage(() => lifecycle.ensureScratch(scratchPrepare), 'Opening scratch recovery').catch(error => {
    if (!isSupersededScratchOpen(error)) throw error;
    // The person opened or created a project meanwhile; it replaces the scratch workspace.
    scratchSuperseded = true; log.info('Scratch recovery open gave way to a project open');
  });
}
async function scratchPrepare(): Promise<PreparedRepository> {
  const unsupported = () => new RepositoryError('unsupported', 'Browser recovery is unavailable. Update your browser before creating or editing projects.');
  if (typeof navigator.storage?.getDirectory !== 'function') throw unsupported();
  const { backendForLocation, prepareNewRepository, prepareRepositoryOpen } = await import('./repositoryLocations');
  const location = { kind: 'opfs' as const, path: 'repository-scratch/' + repositoryWorkspaceId };
  // OPFS without writable streams stays read-only; the IndexedDB fallback can always write.
  const backend = await backendForLocation(location);
  if (!backend.capabilities.immutableWrites) throw unsupported();
  if (await backend.stat('project.msrepo.json')) return prepareRepositoryOpen(location, repositoryWorkspaceId);
  const prepared = await prepareNewRepository(location, repositoryWorkspaceId);
  const { createRepositoryProject } = await import('./defaultProject');
  const domains = captureEditorProjectDomains(createRepositoryProject('Untitled Project'));
  prepared.initialize = { entities: domains.entities, journals: domains.journals,
    workspace: Object.fromEntries(splitProjectWorkspace(domains.workspace).map(part => [part.key, part.value])) };
  return prepared;
}
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.repositoryInstalledCleanup = installedCleanup; data.repositoryWorkspace = projectWorkspace;
    data.repositoryDirectory = activeDirectory; data.repositoryPublications = publications; });
  import.meta.hot.accept();
}
