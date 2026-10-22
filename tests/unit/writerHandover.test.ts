import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWriterHandover, HANDOVER_ACK_MS, HANDOVER_MOVED_NOTICE, HANDOVER_UNRESPONSIVE,
  type HandoverChannel, type HandoverMessage, type WriterHandover,
} from '../../src/services/project/repository/lifecycle/writerHandover';

// Two tabs of one browser share a BroadcastChannel (no self-delivery) and one writer lock.
interface Tab { id: string; writable: boolean; flushes: number; refuse: string | null; revision: string; reloads: number; handover: WriterHandover }
let lockHolder: string | null;
let savedRevision: string;
let bus: Set<{ tab: string; listener: (message: HandoverMessage) => void }>;

function channel(tab: string): HandoverChannel {
  return {
    post(message) {
      for (const entry of [...bus]) if (entry.tab !== tab) queueMicrotask(() => entry.listener(structuredClone(message)));
    },
    subscribe(listener) { const entry = { tab, listener }; bus.add(entry); return () => { bus.delete(entry); }; },
  };
}

function openTab(id: string): Tab {
  const tab = { id, writable: false, flushes: 0, refuse: null, revision: savedRevision, reloads: 0 } as Tab;
  if (!lockHolder) { lockHolder = id; tab.writable = true; }
  tab.handover = createWriterHandover({
    tabId: id, channel: channel(id),
    getRepository: () => ({ repositoryId: 'repo', writable: tab.writable }),
    async releaseWriter() {
      if (tab.refuse) throw new Error(tab.refuse);
      tab.flushes++;
      // Reopening read-only while the old worker still holds the lock, then retiring it.
      tab.writable = false; lockHolder = null; tab.handover.refresh();
    },
    async reopenForWriting() {
      if (!lockHolder) lockHolder = id;
      tab.writable = lockHolder === id; tab.revision = savedRevision; return tab.writable;
    },
    getRevision: () => tab.revision,
    async reloadReadOnly() { tab.reloads++; tab.revision = savedRevision; },
    isWriterLockHeld: async () => lockHolder !== null,
    isVisible: () => true,
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  return tab;
}

describe('writer handover between tabs', () => {
  beforeEach(() => { vi.useFakeTimers(); lockHolder = null; bus = new Set(); savedRevision = 'r1'; });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the writing tab and moves write access after it saved', async () => {
    const writer = openTab('a');
    const reader = openTab('b');
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.handover.getSnapshot()).toMatchObject({ writerLockHeld: true, writer: { tabId: 'a' } });

    const takeover = reader.handover.requestTakeover();
    await vi.advanceTimersByTimeAsync(0);
    await expect(takeover).resolves.toBe(true);

    expect(writer.flushes).toBe(1);
    expect(lockHolder).toBe('b');
    expect(reader.handover.getSnapshot()).toMatchObject({ phase: 'idle', notice: null });
    // The former writer says why it is read-only now and learns who writes instead.
    await vi.advanceTimersByTimeAsync(0);
    expect(writer.writable).toBe(false);
    expect(writer.handover.getSnapshot()).toMatchObject({ phase: 'idle', notice: HANDOVER_MOVED_NOTICE, writer: { tabId: 'b' } });
  });

  it('reports a refused handover and keeps the writer intact', async () => {
    const writer = openTab('a');
    const reader = openTab('b');
    writer.refuse = 'Save failed: disk full';
    const takeover = reader.handover.requestTakeover();
    await vi.advanceTimersByTimeAsync(0);
    await expect(takeover).resolves.toBe(false);
    expect(reader.handover.getSnapshot().phase).toBe('failed');
    expect(reader.handover.getSnapshot().notice).toContain('Save failed: disk full');
    expect(writer.writable).toBe(true);
    expect(lockHolder).toBe('a');
  });

  it('fails visibly when the lock holder does not answer, and takes a free lock directly', async () => {
    openTab('a').handover.dispose(); // A frozen tab: holds the lock, answers nothing.
    const reader = openTab('b');
    const blocked = reader.handover.requestTakeover();
    await vi.advanceTimersByTimeAsync(HANDOVER_ACK_MS);
    await expect(blocked).resolves.toBe(false);
    expect(reader.handover.getSnapshot()).toMatchObject({ phase: 'failed', notice: HANDOVER_UNRESPONSIVE });

    lockHolder = null; // The frozen tab was closed.
    const free = reader.handover.requestTakeover();
    await vi.advanceTimersByTimeAsync(HANDOVER_ACK_MS);
    await expect(free).resolves.toBe(true);
    expect(lockHolder).toBe('b');
  });

  it('marks a read-only tab stale when the writer saves a newer revision, and reloads it', async () => {
    const writer = openTab('a');
    const reader = openTab('b');
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.handover.getSnapshot().stale).toBe(false);

    // The writer deletes media and saves: the reader's projection (r1) is now out of date.
    savedRevision = 'r2'; writer.revision = 'r2';
    writer.handover.announceCommit('r2');
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.handover.getSnapshot().stale).toBe(true);
    expect(writer.handover.getSnapshot().stale).toBe(false);

    await expect(reader.handover.reloadLatest()).resolves.toBe(true);
    expect(reader.reloads).toBe(1);
    expect(reader.handover.getSnapshot()).toMatchObject({ phase: 'idle', stale: false });
    // A read-only tab never announces commits.
    reader.handover.announceCommit('r3');
    await vi.advanceTimersByTimeAsync(0);
    expect(writer.handover.getSnapshot().stale).toBe(false);
  });

  it('marks the former writer stale after a handover once the new writer saves', async () => {
    const first = openTab('a');
    const second = openTab('b');
    const takeover = second.handover.requestTakeover();
    await vi.advanceTimersByTimeAsync(0);
    await expect(takeover).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.handover.getSnapshot()).toMatchObject({ notice: HANDOVER_MOVED_NOTICE, stale: false });

    savedRevision = 'r2'; second.revision = 'r2';
    second.handover.announceCommit('r2');
    await vi.advanceTimersByTimeAsync(0);
    expect(first.handover.getSnapshot().stale).toBe(true);
  });

  it('reports a failed reload visibly', async () => {
    openTab('a');
    const reader = openTab('b');
    reader.handover.dispose();
    const broken = createWriterHandover({
      tabId: 'c', channel: channel('c'),
      getRepository: () => ({ repositoryId: 'repo', writable: false }),
      releaseWriter: async () => {}, reopenForWriting: async () => false,
      getRevision: () => 'r1', reloadReadOnly: async () => { throw new Error('disk gone'); },
      isWriterLockHeld: async () => true, isVisible: () => true, now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    await expect(broken.reloadLatest()).resolves.toBe(false);
    expect(broken.getSnapshot()).toMatchObject({ phase: 'failed' });
    expect(broken.getSnapshot().notice).toContain('disk gone');
  });
});
