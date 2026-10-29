import type { EntityDTO, JsonValue, OperationReceipt, RepositoryDescriptor } from '../contracts';
import { RepositoryError } from '../contracts';
import { assembleProjectWorkspace, readProjectWorkspace } from './workspaceProjection';
import { RepositoryLoadTimer, type RepositoryLoadKind, type RepositoryLoadOutcome, type RepositoryLoadReport } from './repositoryLoadTimings';
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
  /**
   * Starts measuring one open, create, duplicate, scratch open or explicit save. The returned callback
   * receives the phase timings once it ended, or null when the operation turned out to be a no-op.
   */
  measure?(kind: RepositoryLoadKind): ((report: RepositoryLoadReport | null) => void) | undefined;
}
export type RepositoryOpenKind = Exclude<RepositoryLoadKind, 'scratch' | 'save'>;
/** Reason of the cancellation that ends a background scratch open when the person opens a project. */
export const SCRATCH_SUPERSEDED_MESSAGE = 'Background recovery workspace was superseded by a project open';
export function isSupersededScratchOpen(error: unknown): boolean {
  return error instanceof RepositoryError && error.code === 'cancelled' && error.message === SCRATCH_SUPERSEDED_MESSAGE;
}
export interface RepositoryLifecycleState { session: RepositorySession | null; switching: boolean; error: string | null; }

/** Marks a failure of `prepare`, before the active mapping was touched. */
class PrepareFailure {
  readonly cause: unknown;
  constructor(cause: unknown) { this.cause = cause; }
}
export function isCancellation(error: unknown): boolean {
  return error instanceof RepositoryError && error.code === 'cancelled' || error instanceof DOMException && error.name === 'AbortError';
}

/** One HMR-stable owner serializes every open, close, scratch handoff and explicit save. */
export class RepositoryLifecycle {
  private active: RepositorySession | null = null;
  private scratchOpening: Promise<RepositorySession> | null = null;
  private scratchAbort: AbortController | null = null;
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
  /**
   * Opens the per-browser scratch workspace when nothing is open. It is background recovery, not a
   * project the person asked for: a later open or create cancels it while it is still queued or reading
   * (see open), instead of waiting behind its whole open with "Reading saved project" on screen.
   */
  ensureScratch(prepare: () => Promise<PreparedRepository>): Promise<RepositorySession> {
    if (this.active) return Promise.resolve(this.active);
    if (this.scratchOpening) return this.scratchOpening;
    const controller = new AbortController(); this.scratchAbort = controller;
    this.scratchOpening = this.run(prepare, { kind: 'scratch', onlyIfEmpty: true, supersede: controller.signal }).finally(() => {
      this.scratchOpening = null; if (this.scratchAbort === controller) this.scratchAbort = null;
    });
    return this.scratchOpening;
  }
  open(prepare: PrepareRepository, kind: RepositoryOpenKind = 'open'): Promise<RepositorySession> {
    // Cancels a background scratch open that is queued or still reading. Once it writes a new scratch
    // repository or activates the editor it finishes first, so no half-created state is left behind.
    this.scratchAbort?.abort();
    return this.run(prepare, { kind });
  }
  private run(prepare: PrepareRepository, { kind, onlyIfEmpty = false, supersede }: { kind: RepositoryLoadKind; onlyIfEmpty?: boolean; supersede?: AbortSignal }): Promise<RepositorySession> {
    const timer = new RepositoryLoadTimer(kind); const report = this.hooks.measure?.(kind);
    const done = (outcome: RepositoryLoadOutcome | null) => {
      const result = outcome ? timer.finish(outcome) : null;
      try { report?.(result); } catch { /* Measuring never changes the outcome of an open. */ }
    };
    const superseded = () => supersede?.aborted === true;
    const cancelSuperseded = () => new RepositoryError('cancelled', SCRATCH_SUPERSEDED_MESSAGE);
    timer.enter('queue');
    return this.enqueue(async () => {
      if (onlyIfEmpty && this.active) { done(null); return this.active; }
      if (superseded()) throw new PrepareFailure(cancelSuperseded());
      // Source reading/validation and target staging do not replace the active mapping.
      timer.enter('prepare');
      this.hooks.progress?.({ phase: 'opening' });
      let prepared: PreparedRepository;
      try { prepared = await prepare(progress => this.hooks.progress?.(progress)); }
      catch (error) { throw new PrepareFailure(error); }
      if (superseded()) throw new PrepareFailure(cancelSuperseded());

      timer.enter('handoff');
      const previous = this.active;
      if (previous) { await this.hooks.beforeReceipt?.(previous); }
      const barrier = await this.hooks.barrier();
      this.switching = true; this.error = null; this.notify();
      let candidate: RepositorySession | null = null;
      // Reading an existing repository can stop at any request; creating one cannot.
      const abortable = supersede && !prepared.initialize ? supersede : undefined;
      const switchTarget = async () => {
        timer.enter('target');
        await prepared.prepareTarget?.();
        timer.enter('storage_open');
        candidate = await RepositorySession.open({ ...prepared.options, ...(abortable ? { signal: prepared.options.signal ?? abortable } : {}), onOpenProgress: progress => {
          // The first progress comes from the started worker: the time before it is its script load.
          timer.noteStorageWorkerStarted();
          if (progress.phase === 'projection') timer.enter('session_read');
          timer.noteRecords(progress.processedRecords);
          prepared.options.onOpenProgress?.(progress); this.hooks.progress?.(progress);
        } });
        timer.noteLocation(candidate.location); timer.writable = candidate.opening.writable;
        let workspace: JsonValue | null;
        if (prepared.initialize) {
          if (!candidate.opening.writable) throw new RepositoryError('ownership', 'New repository target is read-only');
          // One save point for the first revision, its journals and its views: the publication runs while
          // the views are handed over, and the written workspace is used as is instead of read back.
          timer.enter('initialize');
          await candidate.initialize(prepared.initialize.entities, 'Created project', { flush: false });
          for (const journal of prepared.initialize.journals) candidate.coordinator.appendJournal(journal.id, journal.value);
          for (const [key, value] of Object.entries(prepared.initialize.workspace)) await candidate.updateView(key, value);
          timer.enter('views');
          await candidate.coordinator.flush(candidate.coordinator.receipt());
          workspace = await assembleProjectWorkspace(prepared.initialize.workspace);
        } else {
          timer.enter('workspace');
          workspace = await readProjectWorkspace(candidate);
        }
        if (abortable?.aborted) throw cancelSuperseded();
        timer.enter('activation');
        this.hooks.progress?.({ phase: 'activation' }); await this.hooks.activate(candidate, workspace);
        this.hooks.install(candidate); this.active = candidate; this.hooks.progress?.({ phase: 'ready' });
      };
      try {
        if (previous) {
          await previous.coordinator.handoff(switchTarget);
        } else await switchTarget();
        // Activation succeeded. Close the old owner only after the complete replacement exists.
        timer.enter('close_previous');
        await previous?.close().catch(error => {
          // The new session is committed; a retired owner cleanup failure cannot roll it back.
          this.error = `Previous project cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
        });
        done('ready');
        return this.active!;
      } catch (caught) {
        // A request cancelled by the supersede signal is the supersede, not a storage failure.
        const error = abortable?.aborted && isCancellation(caught) ? cancelSuperseded() : caught;
        await (candidate as RepositorySession | null)?.close().catch(() => {});
        if (!isSupersededScratchOpen(error)) this.error = error instanceof Error ? error.message : String(error);
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
    }).catch((failure: unknown) => {
      const preparing = failure instanceof PrepareFailure; const error = preparing ? failure.cause : failure;
      const message = error instanceof Error ? error.message : String(error);
      if (isSupersededScratchOpen(error)) {
        // Not a failure: the project the person opened follows right behind and reports its own progress.
        done('superseded'); this.notify(); throw error;
      }
      // A failed or cancelled preparation never touched the active project: its save state stays as it was,
      // and the caller reports the failure. Without an active project the error explains the missing recovery.
      if (!preparing || !this.active && !isCancellation(error)) this.error = message;
      this.hooks.progress?.({ phase: 'failed', error: message }); this.notify();
      done(isCancellation(error) ? 'cancelled' : 'failed');
      throw error;
    });
  }
  flush(options: { retry?: boolean; measure?: boolean } = {}): Promise<OperationReceipt | null> {
    const timer = options.measure ? new RepositoryLoadTimer('save') : null;
    const report = timer ? this.hooks.measure?.('save') : undefined;
    timer?.enter('queue');
    const job = this.enqueue(async () => {
      const session = this.active; if (!session) return null;
      if (timer) { timer.noteLocation(session.location); timer.writable = session.opening.writable; }
      // Drain accepted changes before capturing more workspace/content. A full
      // recovery queue must not prevent the Save gesture from retrying its writer.
      timer?.enter('publish');
      if (options.retry && session.coordinator.getStatus().error) await session.coordinator.retry();
      timer?.enter('sync');
      await this.hooks.beforeReceipt?.(session);
      timer?.enter('publish');
      const receipt = session.coordinator.receipt(); await session.coordinator.flush(receipt);
      return receipt;
    });
    if (timer) {
      const done = (outcome: RepositoryLoadOutcome | null) => { try { report?.(outcome ? timer.finish(outcome) : null); } catch { /* Measuring never changes a save. */ } };
      job.then(receipt => done(receipt ? 'ready' : null), error => done(isCancellation(error) ? 'cancelled' : 'failed'));
    }
    return job;
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
