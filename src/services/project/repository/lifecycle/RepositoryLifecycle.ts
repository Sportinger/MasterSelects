import type { EntityDTO, JsonValue, OperationReceipt, RepositoryDescriptor } from '../contracts';
import { RepositoryError } from '../contracts';
import { readProjectWorkspace } from './workspaceProjection';
import type { RepositoryOpenProgress } from '../storageWorkerProtocol';
import { RepositorySession, type RepositorySessionOptions } from '../RepositorySession';

export interface PreparedRepository {
  options: RepositorySessionOptions;
  prepareTarget?: () => Promise<void>;
  initialize?: { entities: ReadonlyMap<string, EntityDTO>; workspace: Record<string, JsonValue>; journals: Array<{ id: string; value: JsonValue }> };
}
export type PrepareRepository = (onProgress: (progress: RepositoryOpenProgress) => void) => Promise<PreparedRepository>;
export interface LifecycleHooks {
  /** Suspend content producers and defer job result binding, then await accepted producers. */
  barrier(): Promise<{ release(): void }>;
  activate(session: RepositorySession, workspace: JsonValue | null): Promise<void>;
  install(session: RepositorySession | null): void;
  beforeReceipt?(session: RepositorySession): Promise<void>;
  progress?(progress: RepositoryOpenProgress): void;
}
export interface RepositoryLifecycleState { session: RepositorySession | null; switching: boolean; error: string | null; }

/** One HMR-stable owner serializes every open, close, scratch handoff and explicit save. */
export class RepositoryLifecycle {
  private active: RepositorySession | null = null;
  private scratchOpening: Promise<RepositorySession> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private switching = false;
  private error: string | null = null;
  private hooks: LifecycleHooks;
  constructor(hooks: LifecycleHooks) {
    this.hooks = hooks;}
  updateHooks(hooks: LifecycleHooks): void { this.hooks = hooks; }
  getSession(): RepositorySession | null { return this.active; }
  getState(): RepositoryLifecycleState { return { session: this.active, switching: this.switching, error: this.error }; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify(): void { for (const listener of this.listeners) listener(); }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const job = this.chain.then(action, action); this.chain = job.catch(() => {}); return job;
  }
  ensureScratch(prepare: () => Promise<PreparedRepository>): Promise<RepositorySession> {
    if (this.active) return Promise.resolve(this.active);
    if (this.scratchOpening) return this.scratchOpening;
    this.scratchOpening = this.open(prepare, true).finally(() => { this.scratchOpening = null; }); return this.scratchOpening;
  }
  open(prepare: PrepareRepository, onlyIfEmpty = false): Promise<RepositorySession> {
    return this.enqueue(async () => {
      if (onlyIfEmpty && this.active) return this.active;
      // Source reading/validation and target staging do not replace the active mapping.

      this.hooks.progress?.({ phase: 'opening' });
      const prepared = await prepare(progress => this.hooks.progress?.(progress));

      const previous = this.active;
      if (previous) { await this.hooks.beforeReceipt?.(previous); }
      const barrier = await this.hooks.barrier();
      this.switching = true; this.error = null; this.notify();
      let candidate: RepositorySession | null = null;
      const switchTarget = async () => {
        await prepared.prepareTarget?.();
        candidate = await RepositorySession.open({ ...prepared.options, onOpenProgress: progress => {
          prepared.options.onOpenProgress?.(progress); this.hooks.progress?.(progress);
        } });
        if (prepared.initialize) {
          if (!candidate.opening.writable) throw new RepositoryError('ownership', 'New repository target is read-only');
          await candidate.initialize(prepared.initialize.entities, 'Created project');
          for (const journal of prepared.initialize.journals) candidate.coordinator.appendJournal(journal.id, journal.value);
          for (const [key, value] of Object.entries(prepared.initialize.workspace)) await candidate.updateView(key, value);
          await candidate.coordinator.flush(candidate.coordinator.receipt());
        }
        const workspace = await readProjectWorkspace(candidate);
        this.hooks.progress?.({ phase: 'activation' }); await this.hooks.activate(candidate, workspace);
        this.hooks.install(candidate); this.active = candidate; this.hooks.progress?.({ phase: 'ready' });
      };
      try {
        if (previous) {
          await previous.coordinator.handoff(switchTarget);
        } else await switchTarget();
        // Activation succeeded. Close the old owner only after the complete replacement exists.
        await previous?.close().catch(error => {
          // The new session is committed; a retired owner cleanup failure cannot roll it back.
          this.error = `Previous project cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
        });
        return this.active!;
      } catch (error) {
        await (candidate as RepositorySession | null)?.close().catch(() => {});
        this.error = error instanceof Error ? error.message : String(error);
        if (previous) {
          this.hooks.install(previous); this.active = previous;
          try { await this.hooks.activate(previous, await readProjectWorkspace(previous)); }
          catch (reactivation) {
            // Never keep a writable owner whose editor state was not restored from it: later
            // edits would persist foreign or placeholder content into that project.
            this.hooks.install(null); this.active = null;
            await previous.close().catch(() => {});
            this.error = `Previous project could not be restored: ${reactivation instanceof Error ? reactivation.message : String(reactivation)}`;
          }
        }
        throw error;
      } finally { this.switching = false; barrier.release(); this.notify(); }
    }).catch(error => {
      this.error = error instanceof Error ? error.message : String(error);
      this.hooks.progress?.({ phase: 'failed', error: this.error }); this.notify();
      throw error;
    });
  }
  flush(): Promise<OperationReceipt | null> {
    return this.enqueue(async () => {
      const session = this.active; if (!session) return null;
      await this.hooks.beforeReceipt?.(session);
      const receipt = session.coordinator.receipt(); await session.coordinator.flush(receipt);
      return receipt;
    });
  }
  close(): Promise<void> {
    return this.enqueue(async () => {
      const previous = this.active; if (!previous) return;
      await this.hooks.beforeReceipt?.(previous);
      const barrier = await this.hooks.barrier(); this.switching = true; this.notify();
      try {
        await previous.close(); this.hooks.install(null); this.active = null; this.error = null;
      } catch (error) { this.error = error instanceof Error ? error.message : String(error); throw error; }
      finally { this.switching = false; barrier.release(); this.notify(); }
    });
  }
}

export function newRepositoryDescriptor(repositoryId = crypto.randomUUID(), lineageId = crypto.randomUUID()): RepositoryDescriptor {
  return { format: 'masterselects-repository', formatVersion: 1, repositoryId, lineageId,
    requiredReaderCapabilities: [], requiredWriterCapabilities: [] };
}

let lifecycle = import.meta.hot?.data?.repositoryLifecycle as RepositoryLifecycle | undefined;
export function editorRepositoryLifecycle(hooks: LifecycleHooks): RepositoryLifecycle {
  if (lifecycle) lifecycle.updateHooks(hooks); else lifecycle = new RepositoryLifecycle(hooks);
  return lifecycle;
}
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.repositoryLifecycle = lifecycle; });
  import.meta.hot.accept();
}
