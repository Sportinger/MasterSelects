import { describe, it, expect, vi } from 'vitest';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type CoordinatorActivation, type LogicalRevision } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { REPOSITORY_LIMITS, type RevisionMetadata, type EntityDTO } from '../../src/services/project/repository/contracts';
function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const entity = (value: number): EntityDTO => ({ type: 'fixture', schemaVersion: 1, value, references: [], blobs: [] });
function fixture(activate: CoordinatorActivation['activate'] = async () => {}) {
  const revisions = new Map<string, LogicalRevision>(), projections = new Map<string, ReadonlyMap<string, EntityDTO>>();
  const metadata = (id: string): RevisionMetadata | null => {
    const revision = revisions.get(id); return revision ? { ...revision,
      reference: { hash: 'sha256:' + '0'.repeat(64), segmentId: 'test', offset: 8, length: 1 }, operationSequence: 1, changedEntities: revision.changes.map(change => change.entityKey) } : null;
  };
  const storage: CoordinatorStorage = {
    publishRevision: vi.fn(async revision => { const projection = new Map(revision.parentRevisionId ? projections.get(revision.parentRevisionId) : []);
      for (const change of revision.changes) if (change.after) projection.set(change.entityKey, change.after); else projection.delete(change.entityKey);
      revisions.set(revision.revisionId, revision); projections.set(revision.revisionId, projection); }),
    publishNavigation: vi.fn(async () => {}), publishMetadata: vi.fn(async () => {}), publishJournal: vi.fn(async () => {}),
    loadProjection: vi.fn(async id => projections.get(id) ?? new Map()), getRevision: vi.fn(async id => metadata(id)),
    getRedoChild: vi.fn(async (id, preferred) => preferred ?? [...revisions.values()].find(row => row.parentRevisionId === id)?.revisionId ?? null),
    flushViews: vi.fn(async () => {}), assertOwned: vi.fn(),
  };
  const coordinator = new ProjectTransactionCoordinator('repo', 'workspace', storage, { canActivate: () => true, activate });
  const edit = (value: number) => { const token = coordinator.begin('Edit'); coordinator.write(token, 'value', entity(value)); return coordinator.commit(token); };
  return { coordinator, storage, edit, revisions, projections };
}
describe('repository coordinator ordering and ownership', () => {
  it('serializes retry before a newly accepted revision without replaying it twice', async () => {
    const { coordinator, storage, edit } = fixture();
    const base = storage.publishRevision; const retryStarted = deferred(), releaseRetry = deferred(); let calls = 0;
    storage.publishRevision = vi.fn(async (...args) => { calls++; if (calls === 1) throw new Error('Lost acknowledgement');
      if (calls === 2) { retryStarted.resolve(); await releaseRetry.promise; } await base(...args); });
    const first = edit(1); await expect(coordinator.flush(first.receipt)).rejects.toThrow();
    const retry = coordinator.retry(); await retryStarted.promise;
    const second = edit(2); releaseRetry.resolve(); await retry; await coordinator.flush(second.receipt);
    expect(calls).toBe(3); expect(coordinator.getStatus().confirmedSequence).toBe(2);
    expect(coordinator.getEntities().get('value')?.value).toBe(2);
  });
  it('cancels an in-flight load when a gesture begins before its first write', async () => {
    const { coordinator, storage } = fixture(); const entered = deferred(), release = deferred();
    storage.loadProjection = vi.fn(async () => { entered.resolve(); await release.promise; return new Map([['value', entity(99)]]); });
    const activate = vi.fn(async () => {});
    // Use a fresh coordinator so activation is directly observable.
    const pinned = new ProjectTransactionCoordinator('repo', 'workspace', storage, { canActivate: () => true, activate });
    const checkout = pinned.checkout('target'); await entered.promise;
    const token = pinned.begin('New gesture'); release.resolve();
    expect((await checkout).status).toBe('cancelled'); expect(activate).not.toHaveBeenCalled();
    expect(pinned.owns(token)).toBe(true); pinned.cancel(token);
    expect(coordinator.getStatus().revisionId).toBeNull();
  });
  it('waits for aborted activation rollback before handing runtime to another project', async () => {
    const entered = deferred(), finishRollback = deferred(); const order: string[] = [];
    const { coordinator } = fixture(async (_next, _previous, signal) => {
      entered.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      order.push('rollback-start'); await finishRollback.promise; order.push('rollback-finished');
    });
    const checkout = coordinator.checkout('target'); await entered.promise;
    const handoff = coordinator.handoff(async () => { order.push('new-project'); });
    await Promise.resolve(); expect(order).not.toContain('new-project');
    finishRollback.resolve(); await handoff; expect((await checkout).status).toBe('cancelled');
    expect(order).toEqual(['rollback-start', 'rollback-finished', 'new-project']);
  });
  it('rejects foreign receipts and flushes precisely the captured view sequences', async () => {
    const { coordinator, storage, edit } = fixture(); const result = edit(1); coordinator.noteView('zoom', 4);
    const receipt = coordinator.receipt(); coordinator.noteView('zoom', 5);
    await expect(coordinator.flush({ ...receipt, sessionEpoch: 'other' })).rejects.toMatchObject({ code: 'ownership' });
    await coordinator.flush(receipt); expect(storage.flushViews).toHaveBeenLastCalledWith({ zoom: 4 });
    expect(coordinator.getStatus().confirmedSequence).toBe(result.receipt.operationSequence);
  });
  it('retains branches beyond the local undo cache and restores their persisted projection', async () => {
    const { coordinator, storage, edit, projections } = fixture(); const ids: string[] = [];
    for (let i = 0; i < 170; i++) { const result = edit(i); ids.push(result.revisionId!); await coordinator.flush(result.receipt); }
    await coordinator.checkout(ids[5]); const fork = edit(900); await coordinator.flush(fork.receipt);
    const reopened = new ProjectTransactionCoordinator('repo', 'fresh-workspace', storage, { canActivate: () => true, activate: async () => {} });
    reopened.restore({ revisionId: fork.revisionId, generation: 0, entities: new Map(projections.get(fork.revisionId!)) }, coordinator.getStatus().confirmedSequence);
    expect((await reopened.checkout(ids[169])).status).toBe('applied'); expect(reopened.getEntities().get('value')?.value).toBe(169);
    expect((await reopened.checkout(fork.revisionId!)).status).toBe('applied'); expect(reopened.getEntities().get('value')?.value).toBe(900);
  });
  it('applies byte budgets to named versions before accepting a sequence', () => {
    const { coordinator, edit } = fixture(); edit(1); const before = coordinator.getStatus().appliedSequence;
    expect(() => coordinator.createNamedVersion('x'.repeat(REPOSITORY_LIMITS.queueBytes))).toThrow();
    expect(coordinator.getStatus().appliedSequence).toBe(before);
  });
});
