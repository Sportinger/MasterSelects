import { REPOSITORY_LIMITS, RepositoryError } from '../contracts';
import { canonicalJson, frozenJson } from '../segments/canonical';
import type { CheckoutResult, EntityDTO, EntityKey, JsonValue, OperationReceipt, RepositoryProjection, RevisionMetadata, RecordReference, BlobReference } from '../contracts';

export interface LogicalEntityChange { entityKey: EntityKey; before: EntityDTO | null; after: EntityDTO | null; }
export interface LogicalRevision {
  revisionId: string; transactionId: string; parentRevisionId: string | null;
  label: string; source: string; createdAt: number; changes: readonly LogicalEntityChange[];
}
export interface TransactionToken { readonly transactionId: string; readonly owner: symbol; readonly sessionEpoch: string; }
export interface CoordinatorStorage {
  publishRevision(revision: LogicalRevision, workspaceId: string, redo: Readonly<Record<string, string>>, sequence: number): Promise<void>;
  publishNavigation(revisionId: string, workspaceId: string, redo: Readonly<Record<string, string>>, sequence: number): Promise<void>;
  publishMetadata(key: string, value: JsonValue, sequence: number, dependencies?: { references?: RecordReference[]; blobs?: BlobReference[] }): Promise<void>;
  publishJournal(id: string, value: JsonValue, sequence: number, dependencies?: { references?: RecordReference[]; blobs?: BlobReference[] }): Promise<void>;
  loadProjection(revisionId: string, signal: AbortSignal): Promise<ReadonlyMap<EntityKey, EntityDTO>>;
  getRevision(revisionId: string): Promise<RevisionMetadata | null>;
  getRedoChild(revisionId: string, preferred?: string): Promise<string | null>;
  flushViews(views: Readonly<Record<string, number>>): Promise<void>;
  assertOwned(): void;
}
export interface CoordinatorActivation {
  /** Holds the mutation/export barrier across domain swap AND runtime rebind. */
  activate(projection: RepositoryProjection, previous: RepositoryProjection, signal: AbortSignal): Promise<void>;
  canActivate(): boolean;
}
interface OpenTransaction {
  token: TransactionToken; label: string; source: string;
  before: Map<EntityKey, EntityDTO | null>; after: Map<EntityKey, EntityDTO | null>;
}
export interface CoordinatorStatus {
  revisionId: string | null; generation: number; appliedSequence: number;
  confirmedSequence: number; queuedBytes: number; oldestPendingAt: number | null;
  navigation: 'idle' | 'pending' | 'failed'; error: RepositoryError | null;
}
function frozenEntity(value: EntityDTO): EntityDTO {
  return frozenJson(value);
}
function equalEntity(a: EntityDTO | null, b: EntityDTO | null): boolean {
  if (a === b) return true;
  // Encoders emit deterministic JSON values. No runtime handles enter here.
  return canonicalJson(a) === canonicalJson(b);
}

/** Synchronous logical commit, ordered asynchronous confirmation and checkout. */
export class ProjectTransactionCoordinator {
  readonly sessionEpoch = crypto.randomUUID();
  private readonly transactions = new Map<symbol, OpenTransaction>();
  private readonly entityOwners = new Map<EntityKey, symbol>();
  private entities = new Map<EntityKey, EntityDTO>();
  private revisionId: string | null = null;
  private generation = 0;
  private sequence = 0;
  private confirmed = 0;
  private queuedBytes = 0;
  private oldestPendingAt: number | null = null;
  private chain: Promise<void> = Promise.resolve();
  private failed: RepositoryError | null = null;
  private pending = new Map<number, { run: () => Promise<void>; bytes: number; started?: boolean; journal?: string }>();
  /** Journal publication per journal id that is queued but not yet started. */
  private queuedJournals = new Map<string, number>();
  private views: Record<string, number> = {};
  private redo: Record<string, string> = {};
  private localRevisions = new Map<string, LogicalRevision>();
  private navigationController: AbortController | null = null;
  private navigationChain: Promise<CheckoutResult | null> = Promise.resolve(null);
  private navigationEpoch = 0;
  private navigationState: CoordinatorStatus['navigation'] = 'idle';
  private closing = false;
  private activating = false;
  private readonly activeCheckouts = new Set<Promise<CheckoutResult>>();
  private listeners = new Set<(status: CoordinatorStatus) => void>();
  readonly repositoryId: string;
  readonly workspaceId: string;
  private readonly storage: CoordinatorStorage;
  private readonly activation: CoordinatorActivation;
  constructor(repositoryId: string, workspaceId: string, storage: CoordinatorStorage, activation: CoordinatorActivation) {
    this.repositoryId = repositoryId; this.workspaceId = workspaceId; this.storage = storage; this.activation = activation;}
  async getNavigationAvailability(): Promise<{ canUndo: boolean; canRedo: boolean }> {
    const current = this.revisionId;
    if (!current) return { canUndo: false, canRedo: false };
    const revision = this.localRevisions.get(current) ?? await this.storage.getRevision(current);
    const child = this.redo[current] ?? await this.storage.getRedoChild(current);
    return { canUndo: !!revision?.parentRevisionId, canRedo: !!child };
  }
  getEntities(): ReadonlyMap<EntityKey, EntityDTO> { return this.entities; }
  owns(token: TransactionToken): boolean { return token.sessionEpoch === this.sessionEpoch && this.transactions.get(token.owner)?.token === token; }
  getProjection(): RepositoryProjection { return { revisionId: this.revisionId, generation: this.generation, entities: new Map(this.entities) }; }
  getStatus(): CoordinatorStatus {
    return { revisionId: this.revisionId, generation: this.generation, appliedSequence: this.sequence,
      confirmedSequence: this.confirmed, queuedBytes: this.queuedBytes, oldestPendingAt: this.oldestPendingAt,
      navigation: this.navigationState, error: this.failed };
  }
  subscribe(listener: (status: CoordinatorStatus) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify(): void { const status = this.getStatus(); for (const listener of this.listeners) listener(status); }
  assertMutable(): void {
    this.storage.assertOwned();
    if (this.closing || this.activating) throw new RepositoryError('ownership', 'Project activation or handoff is in progress');
    if (this.queuedBytes >= REPOSITORY_LIMITS.queueBytes) throw new RepositoryError('budget', 'Project recovery queue is full; flush or export recovery before editing');
  }
  begin(label: string, source = 'user', join?: TransactionToken): TransactionToken {
    this.assertMutable();
    if (join) { this.requireTransaction(join); return join; }
    this.cancelNavigation();
    const token = Object.freeze({ transactionId: crypto.randomUUID(), owner: Symbol(label), sessionEpoch: this.sessionEpoch });
    this.transactions.set(token.owner, { token, label, source, before: new Map(), after: new Map() });
    return token;
  }
  private requireTransaction(token: TransactionToken): OpenTransaction {
    const tx = this.transactions.get(token.owner);
    if (token.sessionEpoch !== this.sessionEpoch || !tx || tx.token !== token) throw new RepositoryError('ownership', 'Project transaction ownership was lost');
    return tx;
  }
  touch(token: TransactionToken, key: EntityKey): void {
    const tx = this.requireTransaction(token);
    const owner = this.entityOwners.get(key);
    if (owner && owner !== token.owner) throw new RepositoryError('ownership', `Entity ${key} belongs to another transaction`);
    if (!tx.before.has(key)) tx.before.set(key, this.entities.get(key) ?? null);
    this.entityOwners.set(key, token.owner);
  }
  write(token: TransactionToken, key: EntityKey, value: EntityDTO | null): void {
    this.touch(token, key);
    const tx = this.requireTransaction(token);
    const next = value ? frozenEntity(value) : null;
    tx.after.set(key, next);
    if (next) this.entities.set(key, next); else this.entities.delete(key);
  }
  commit(token: TransactionToken): { revisionId: string | null; receipt: OperationReceipt } {
    const tx = this.requireTransaction(token);
    const changes: LogicalEntityChange[] = [];
    for (const [entityKey, before] of tx.before) {
      const after = tx.after.has(entityKey) ? tx.after.get(entityKey)! : this.entities.get(entityKey) ?? null;
      if (!equalEntity(before, after)) changes.push(Object.freeze({ entityKey, before, after }));
    }
    if (changes.length) {
      const bytes = new TextEncoder().encode(JSON.stringify(changes)).byteLength;
      if (this.queuedBytes + bytes > REPOSITORY_LIMITS.queueBytes) throw new RepositoryError('budget', 'Project transaction exceeds remaining recovery queue budget');
      this.cancelNavigation();
      const revision: LogicalRevision = Object.freeze({ revisionId: crypto.randomUUID(), transactionId: token.transactionId,
        parentRevisionId: this.revisionId, label: tx.label, source: tx.source, createdAt: Date.now(), changes: Object.freeze(changes) });
      if (this.revisionId) this.redo = { ...this.redo, [this.revisionId]: revision.revisionId };
      this.revisionId = revision.revisionId;
      this.generation++;
      this.localRevisions.set(revision.revisionId, revision);
      const sequence = ++this.sequence;
      const redo = Object.freeze({ ...this.redo });
      this.enqueue(sequence, bytes, () => this.storage.publishRevision(revision, this.workspaceId, redo, sequence));
    }
    this.finishTransaction(tx);
    this.notify();
    return { revisionId: this.revisionId, receipt: this.receipt() };
  }
  cancel(token: TransactionToken): void {
    const tx = this.requireTransaction(token);
    for (const [key, before] of tx.before) {
      if (this.entityOwners.get(key) !== token.owner) continue;
      if (before) this.entities.set(key, before); else this.entities.delete(key);
    }
    this.finishTransaction(tx); this.notify();
  }
  private finishTransaction(tx: OpenTransaction): void {
    for (const key of tx.before.keys()) if (this.entityOwners.get(key) === tx.token.owner) this.entityOwners.delete(key);
    this.transactions.delete(tx.token.owner);
  }
  private enqueue(sequence: number, bytes: number, run: () => Promise<void>, journal?: string): void {
    this.pending.set(sequence, { run, bytes, ...(journal === undefined ? {} : { journal }) });
    this.queuedBytes += bytes;
    this.oldestPendingAt ??= Date.now();
    this.chain = this.chain.then(async () => {
      const item = this.pending.get(sequence);
      if (this.failed || !item) return;
      // The publication runs the latest value it holds; a journal snapshot may have replaced it while queued.
      item.started = true;
      try { await item.run(); this.confirm(sequence); }
      catch (error) { this.failed = error instanceof RepositoryError ? error : new RepositoryError('io', String(error)); }
      this.notify();
    });
  }
  private confirm(sequence: number): void {
    const item = this.pending.get(sequence);
    if (item) this.queuedBytes -= item.bytes;
    if (item?.journal !== undefined && this.queuedJournals.get(item.journal) === sequence) this.queuedJournals.delete(item.journal);
    this.pending.delete(sequence); this.confirmed = sequence;
    if (!this.pending.size) this.oldestPendingAt = null;
    // Pending logical versions must remain available for Undo before flush.
    if (!this.pending.size && this.localRevisions.size > 150) {
      const remove = this.localRevisions.size - 150;
      for (const key of [...this.localRevisions.keys()].slice(0, remove)) this.localRevisions.delete(key);
    }
  }
  retry(): Promise<void> {
    const through = this.sequence;
    const job = this.chain.then(async () => {
      this.storage.assertOwned(); this.failed = null;
      for (const [sequence, item] of this.pending) {
        if (sequence > through) break;
        item.started = true;
        try { await item.run(); this.confirm(sequence); }
        catch (error) { this.failed = error instanceof RepositoryError ? error : new RepositoryError('io', String(error)); break; }
      }
      this.notify();
      if (this.failed) throw this.failed;
    });
    // Later accepted operations and other retries wait behind the complete retry batch.
    this.chain = job.catch(() => {}); return job;
  }
  receipt(): OperationReceipt { return { repositoryId: this.repositoryId, sessionEpoch: this.sessionEpoch, operationSequence: this.sequence, views: { ...this.views } }; }
  noteView(key: string, sequence: number): void { this.views[key] = sequence; }
  async flush(receipt = this.receipt()): Promise<void> {
    if (receipt.repositoryId !== this.repositoryId || receipt.sessionEpoch !== this.sessionEpoch) throw new RepositoryError('ownership', 'Flush receipt belongs to a different project session');
    await this.chain;
    if (this.failed) throw this.failed;
    if (this.confirmed < receipt.operationSequence) throw new RepositoryError('io', 'Requested operation has not been confirmed');
    await this.storage.flushViews(receipt.views);
  }
  publishMetadata(key: string, value: JsonValue, dependencies?: { references?: RecordReference[]; blobs?: BlobReference[] }): OperationReceipt {
    this.assertMutable();
    const frozen = frozenJson(value);
    const pinned = dependencies ? frozenJson(dependencies) : undefined;
    const bytes = new TextEncoder().encode(canonicalJson({ value: frozen, dependencies: pinned ?? null })).byteLength;
    if (this.queuedBytes + bytes > REPOSITORY_LIMITS.queueBytes) throw new RepositoryError('budget', 'Project metadata queue is full');
    const sequence = ++this.sequence;
    this.enqueue(sequence, bytes, () => this.storage.publishMetadata(key, frozen, sequence, pinned));
    this.notify(); return this.receipt();
  }
  createNamedVersion(name: string): OperationReceipt {
    this.assertMutable();
    if (!this.revisionId) throw new RepositoryError('corrupt', 'A named version needs a content revision');
    const key = `named-version:${crypto.randomUUID()}`;
    const value = { name: name.trim() || 'Version', revisionId: this.revisionId, createdAt: Date.now() };
    return this.publishMetadata(key, value);
  }
  appendJournal(id: string, value: JsonValue, dependencies?: { references?: RecordReference[]; blobs?: BlobReference[] }): OperationReceipt {
    this.storage.assertOwned();
    if (this.closing) throw new RepositoryError('ownership', 'Project journal handoff is in progress');
    const frozen = frozenJson(value);
    const pinned = dependencies ? frozenJson(dependencies) : undefined;
    const bytes = new TextEncoder().encode(canonicalJson({ value: frozen, dependencies: pinned ?? null })).byteLength;
    // Readers keep the latest value per journal id, so a newer snapshot (a chat run, the conversation)
    // replaces one that is still waiting to be written instead of queueing every intermediate state.
    const waiting = this.queuedJournals.get(id), queued = waiting === undefined ? undefined : this.pending.get(waiting);
    if (waiting !== undefined && queued && !queued.started) {
      if (this.queuedBytes - queued.bytes + bytes > REPOSITORY_LIMITS.queueBytes) throw new RepositoryError('budget', 'Project journal queue is full');
      this.queuedBytes += bytes - queued.bytes; queued.bytes = bytes;
      queued.run = () => this.storage.publishJournal(id, frozen, waiting, pinned);
      this.notify(); return this.receipt();
    }
    if (this.queuedBytes + bytes > REPOSITORY_LIMITS.queueBytes) throw new RepositoryError('budget', 'Project journal queue is full');
    const sequence = ++this.sequence;
    this.queuedJournals.set(id, sequence);
    this.enqueue(sequence, bytes, () => this.storage.publishJournal(id, frozen, sequence, pinned), id);
    this.notify(); return this.receipt();
  }
  private cancelNavigation(): void { this.navigationEpoch++; this.navigationController?.abort(); this.navigationController = null; this.navigationState = 'idle'; }
  undo(): Promise<CheckoutResult | null> { return this.navigate('undo'); }
  redoRevision(): Promise<CheckoutResult | null> { return this.navigate('redo'); }
  private navigate(direction: 'undo' | 'redo'): Promise<CheckoutResult | null> {
    const epoch = this.navigationEpoch;
    this.navigationState = 'pending'; this.notify();
    this.navigationChain = this.navigationChain.catch(() => null).then(async () => {
      if (epoch !== this.navigationEpoch) return null;
      const current = this.revisionId;
      if (!current) return null;
      const local = this.localRevisions.get(current);
      const target = direction === 'undo'
        ? local ? local.parentRevisionId : (await this.storage.getRevision(current))?.parentRevisionId
        : this.redo[current] && this.localRevisions.get(this.redo[current]!)?.parentRevisionId === current
          ? this.redo[current] : await this.storage.getRedoChild(current, this.redo[current]);
      if (!target || epoch !== this.navigationEpoch) { this.navigationState = 'idle'; this.notify(); return null; }
      return this.checkout(target, epoch);
    });
    return this.navigationChain;
  }
  checkout(target: string, expectedNavigationEpoch = this.navigationEpoch): Promise<CheckoutResult> {
    const job = this.performCheckout(target, expectedNavigationEpoch);
    this.activeCheckouts.add(job);
    void job.then(() => this.activeCheckouts.delete(job), () => this.activeCheckouts.delete(job));
    return job;
  }
  private async performCheckout(target: string, expectedNavigationEpoch: number): Promise<CheckoutResult> {
    if (this.transactions.size || this.closing || this.activating || !this.activation.canActivate()) return { status: 'cancelled', revisionId: target };
    const base = this.revisionId;
    const generation = this.generation;
    const controller = new AbortController();
    this.navigationController?.abort(); this.navigationController = controller;
    this.navigationState = 'pending'; this.notify();
    const stillOwns = () => !controller.signal.aborted && this.navigationController === controller
      && this.revisionId === base && this.generation === generation && expectedNavigationEpoch === this.navigationEpoch && !this.closing && this.transactions.size === 0;
    try {
      let loaded: ReadonlyMap<EntityKey, EntityDTO>;
      const currentLocal = base ? this.localRevisions.get(base) : undefined;
      const targetLocal = this.localRevisions.get(target);
      if (currentLocal?.parentRevisionId === target) {
        const map = new Map(this.entities);
        for (const change of currentLocal.changes) if (change.before) map.set(change.entityKey, change.before); else map.delete(change.entityKey);
        loaded = map;
      } else if (targetLocal?.parentRevisionId === base) {
        const map = new Map(this.entities);
        for (const change of targetLocal.changes) if (change.after) map.set(change.entityKey, change.after); else map.delete(change.entityKey);
        loaded = map;
      } else { await this.flush(); loaded = await this.storage.loadProjection(target, controller.signal); }
      if (!stillOwns() || !this.activation.canActivate()) return { status: 'cancelled', revisionId: target };
      const previous = this.getProjection();
      const projection = { revisionId: target, generation: generation + 1, entities: loaded };
      this.activating = true;
      try { await this.activation.activate(projection, previous, controller.signal); }
      finally { this.activating = false; }
      if (!stillOwns()) return { status: 'cancelled', revisionId: target };
      this.entities = new Map(loaded); this.revisionId = target; this.generation++;
      if (base && currentLocal?.parentRevisionId === target) this.redo = { ...this.redo, [target]: base };
      const sequence = ++this.sequence;
      const redo = { ...this.redo };
      this.enqueue(sequence, 256, () => this.storage.publishNavigation(target, this.workspaceId, redo, sequence));
      this.navigationState = 'idle';
      return { status: 'applied', revisionId: target };
    } catch (error) {
      if (!stillOwns()) return { status: 'cancelled', revisionId: target };
      this.navigationState = 'failed'; return { status: 'failed', revisionId: target, error: String(error) };
    } finally {
      if (this.navigationController === controller) this.navigationController = null;
      this.notify();
    }
  }
  restore(projection: RepositoryProjection, sequence: number, redo: Record<string, string> = {}): void {
    if (this.transactions.size || this.pending.size) throw new RepositoryError('ownership', 'Cannot restore over pending project operations');
    this.cancelNavigation(); this.entities = new Map(projection.entities); this.revisionId = projection.revisionId;
    this.generation = projection.generation; this.sequence = this.confirmed = sequence; this.redo = { ...redo }; this.notify();
  }
  async handoff(action: () => Promise<void>): Promise<void> {
    if (this.transactions.size) throw new RepositoryError('ownership', 'Finish or cancel open gestures before switching projects');
    this.cancelNavigation(); this.closing = true;
    try {
      // Aborted activation must finish its rollback before another session can swap runtime stores.
      await Promise.allSettled([...this.activeCheckouts]);
      await this.navigationChain.catch(() => null);
      await this.flush(this.receipt()); await action();
    }
    finally { this.closing = false; this.notify(); }
  }
}
