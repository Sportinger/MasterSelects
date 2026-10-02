import { describe, expect, it, vi } from 'vitest';
import { ProjectTransactionCoordinator, type CoordinatorStorage } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import type { JsonValue } from '../../src/services/project/repository/contracts';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

function fixture() {
  const written: Array<{ id: string; value: JsonValue; sequence: number }> = [];
  let gate = deferred(), entered = deferred();
  const storage: CoordinatorStorage = {
    publishRevision: vi.fn(async () => {}), publishNavigation: vi.fn(async () => {}), publishMetadata: vi.fn(async () => {}),
    publishJournal: vi.fn(async (id: string, value: JsonValue, sequence: number) => {
      entered.resolve(); await gate.promise; written.push({ id, value, sequence });
    }),
    loadProjection: vi.fn(async () => new Map()), getRevision: vi.fn(async () => null), getRedoChild: vi.fn(async () => null),
    flushViews: vi.fn(async () => {}), assertOwned: vi.fn(),
  };
  const coordinator = new ProjectTransactionCoordinator('repo', 'workspace', storage, { canActivate: () => true, activate: async () => {} });
  const release = () => { gate.resolve(); };
  const hold = () => { gate = deferred(); entered = deferred(); };
  return { coordinator, storage, written, release, hold, entered: () => entered.promise };
}

describe('repository journal publication', () => {
  it('replaces a queued snapshot of the same journal id with the latest one', async () => {
    const { coordinator, storage, written, release, entered } = fixture();
    coordinator.appendJournal('chat-run:a', { step: 1 });
    await entered();
    // While step 1 is being written, later snapshots of the run and of another id queue up.
    coordinator.appendJournal('chat-run:a', { step: 2 });
    coordinator.appendJournal('conversation', { messages: 1 });
    coordinator.appendJournal('chat-run:a', { step: 3 });
    const receipt = coordinator.appendJournal('chat-run:a', { step: 4, text: 'x'.repeat(100) });
    expect(coordinator.getStatus().appliedSequence).toBe(3);
    release();
    await coordinator.flush(receipt);
    expect(written.map(({ id, value }) => [id, value])).toEqual([
      ['chat-run:a', { step: 1 }], ['chat-run:a', { step: 4, text: 'x'.repeat(100) }], ['conversation', { messages: 1 }]]);
    expect(storage.publishJournal).toHaveBeenCalledTimes(3);
    expect(coordinator.getStatus()).toMatchObject({ confirmedSequence: 3, queuedBytes: 0, oldestPendingAt: null });
  });

  it('queues a new snapshot once the waiting one has started writing', async () => {
    const { coordinator, written, release, hold, entered } = fixture();
    coordinator.appendJournal('conversation', { messages: 1 });
    await entered();
    release();
    await coordinator.flush();
    hold();
    coordinator.appendJournal('conversation', { messages: 2 });
    await entered();
    // The second snapshot is in flight; a third one must not be dropped into it.
    const receipt = coordinator.appendJournal('conversation', { messages: 3 });
    release();
    await coordinator.flush(receipt);
    expect(written.map(({ value }) => value)).toEqual([{ messages: 1 }, { messages: 2 }, { messages: 3 }]);
    expect(written.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
  });
});
