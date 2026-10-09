import { ReadonlyWorkspace } from './persistence/ReadonlyWorkspace';
import { readNavigationPreferences } from './persistence/navigationPreferences';
import { RepositoryError } from './contracts';
import type { EntityDTO, JsonValue, NavigationPayload, RepositoryDescriptor, RepositoryProjection, RepositoryRecord } from './contracts';
import type { RepositoryLocation, StorageOpenResult, RepositoryOpenProgress } from './storageWorkerProtocol';
import { StorageWorkerClient } from './persistence/StorageWorkerClient';
import { WorkerCoordinatorStorage } from './transaction/WorkerCoordinatorStorage';
import { ProjectTransactionCoordinator, type CoordinatorActivation } from './transaction/ProjectTransactionCoordinator';
import type { NativeRepositoryClient } from './backends/nativeBackend';

export interface RepositorySessionOptions {
  descriptor: RepositoryDescriptor; location: RepositoryLocation; workspaceId: string;
  activation: CoordinatorActivation; nativeClient?: NativeRepositoryClient; signal?: AbortSignal;
  onOpenProgress?: (progress: RepositoryOpenProgress) => void;
}
const openSessions: Set<RepositorySession> = import.meta.hot?.data?.openRepositorySessions ?? new Set();
if (import.meta.hot) import.meta.hot.dispose(data => { data.openRepositorySessions = openSessions; });
export function getOpenRepositorySessions(): readonly RepositorySession[] { return [...openSessions]; }

/** A single location/owner/session, prepared completely before editor activation. */
export class RepositorySession {
  private closed = false;
  private readerWorkspace: ReadonlyWorkspace | null = null;
  readonly descriptor: RepositoryDescriptor;
  readonly location: RepositoryLocation;
  readonly opening: StorageOpenResult;
  readonly client: StorageWorkerClient;
  readonly storage: WorkerCoordinatorStorage;
  readonly coordinator: ProjectTransactionCoordinator;
  private constructor(descriptor: RepositoryDescriptor, location: RepositoryLocation, opening: StorageOpenResult, client: StorageWorkerClient, storage: WorkerCoordinatorStorage, coordinator: ProjectTransactionCoordinator) {
    this.descriptor = descriptor; this.location = location; this.opening = opening; this.client = client; this.storage = storage; this.coordinator = coordinator;
      if (!opening.writable) this.readerWorkspace = new ReadonlyWorkspace(`${descriptor.repositoryId}:${opening.locationId}:${coordinator.workspaceId}`);
    }
  static async open(options: RepositorySessionOptions): Promise<RepositorySession> {
    const client = new StorageWorkerClient(options.nativeClient, options.onOpenProgress);
    try {

      const opening = await client.request<StorageOpenResult>({ type: 'open', location: options.location,
        descriptor: options.descriptor, workspaceId: options.workspaceId }, options.signal);

      const storage = new WorkerCoordinatorStorage(client, opening);
      const coordinator = new ProjectTransactionCoordinator(options.descriptor.repositoryId, options.workspaceId, storage, options.activation);
      options.onOpenProgress?.({ phase: 'projection' });
      const preferred = opening.recovery.heads[`navigation:${options.workspaceId}`];
      let cursor: NavigationPayload | null = null;
      for (const [key, reference] of Object.entries(opening.recovery.heads)) {
        if (!key.startsWith('navigation:') || (preferred && key !== `navigation:${options.workspaceId}`)) continue;

        const record = await client.request<RepositoryRecord>({ type: 'record', reference }, options.signal);
        if (record.kind !== 'navigation') throw new RepositoryError('corrupt', 'Workspace navigation head has the wrong record type');
        const candidate = record.payload as unknown as NavigationPayload;
        if (!cursor || candidate.sequence > cursor.sequence) cursor = candidate;
      }
      if (!opening.writable) {
        const local = storage.readReaderNavigation(options.workspaceId) as { revisionId?: string; redoPreferences?: Record<string, string>; sequence?: number } | null;
        if (local?.revisionId) {
          const revision = await client.request<import('./contracts').RevisionMetadata | null>({ type: 'revision', revisionId: local.revisionId }, options.signal);
          if (revision) cursor = { workspaceId: options.workspaceId, revisionId: revision.revisionId, revision: revision.reference, redoPreferences: local.redoPreferences ?? {}, sequence: local.sequence ?? 0 };
        }
      }
      if (cursor) {

        const projection = await client.request<RepositoryProjection>({ type: 'projection', reference: cursor.revision, generation: 1 }, options.signal);
        const redo = await readNavigationPreferences(cursor, reference => client.request<RepositoryRecord>({ type: 'record', reference }, options.signal));
        coordinator.restore(projection, opening.recovery.operationSequence, redo);

        await storage.bindProjection(cursor.revisionId, options.signal, cursor.revision);

      } else {
        coordinator.restore({ revisionId: null, generation: 0, entities: new Map() }, opening.recovery.operationSequence);
      }
      const session = new RepositorySession(options.descriptor, options.location, opening, client, storage, coordinator);
      openSessions.add(session); return session;
    } catch (error) { await client.close().catch(() => {}); throw error; }
  }
  async initialize(entities: ReadonlyMap<string, EntityDTO>, label = 'Project imported'): Promise<void> {
    if (this.coordinator.getProjection().revisionId !== null) throw new RepositoryError('conflict', 'Repository already contains project history');
    const token = this.coordinator.begin(label, 'import');
    try {
      for (const [key, entity] of entities) this.coordinator.write(token, key, entity);
      const committed = this.coordinator.commit(token);
      await this.coordinator.flush(committed.receipt);
    } catch (error) {
      // Logical commit must remain visible after disk failure; only an open token may cancel.
      try { this.coordinator.cancel(token); } catch { /* Already committed. */ }
      throw error;
    }
  }
  async updateView(key: string, value: JsonValue): Promise<number> {
    const sequence = this.readerWorkspace ? this.readerWorkspace.write(key, value) : await this.client.request<number>({ type: 'view-update', key, value });
    this.coordinator.noteView(key, sequence); return sequence;
  }
  /** Existing view keys for this workspace, or null for local read-only views (probe per key instead). */
  async viewKeys(): Promise<Set<string> | null> { return this.readerWorkspace ? null : new Set(await this.client.request<string[]>({ type: 'view-keys' })); }
  readView(key: string, previous = false): Promise<JsonValue | null> { const local = previous ? null : this.readerWorkspace?.read(key); if (local !== null && local !== undefined) return Promise.resolve(local); return this.client.request({ type: 'view-read', key, ...(previous ? { previous: true } : {}) }); }
  async close(): Promise<void> {
    if (this.closed) return;
    await this.coordinator.handoff(async () => { try { await this.storage.close(); } finally { this.closed = true; openSessions.delete(this); } });
  }
}
