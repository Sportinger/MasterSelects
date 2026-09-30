import { describe, expect, it } from 'vitest';
import {
  isProjectStoreSyncInProgress,
  waitForProjectStoreSync,
  withProjectStoreSyncGuard,
} from '../../src/services/project/projectStoreSyncGuard';

describe('project store synchronization wait', () => {
  it('releases waiters after a failed synchronization', async () => {
    let reject!: (reason: Error) => void;
    const failure = new Error('restore failed');
    const sync = withProjectStoreSyncGuard(() => new Promise<void>((_, fail) => { reject = fail; }));
    const rejected = expect(sync).rejects.toBe(failure);
    const waiting = waitForProjectStoreSync();
    reject(failure);
    await rejected;
    await waiting;
    expect(isProjectStoreSyncInProgress()).toBe(false);
  });

  it('wakes waiters without clearing a subsequently acquired guard', async () => {
    let release!: () => void;
    const first = withProjectStoreSyncGuard(() => new Promise<void>(resolve => { release = resolve; }));
    let finished = false;
    const waiting = waitForProjectStoreSync().then(() => { finished = true; });
    release();
    await first;
    let releaseSecond!: () => void;
    const second = withProjectStoreSyncGuard(() => new Promise<void>(resolve => { releaseSecond = resolve; }));
    // Consumers recheck the guard after waking before they capture state.
    await waiting;
    expect(finished).toBe(true);
    expect(isProjectStoreSyncInProgress()).toBe(true);
    releaseSecond();
    await second;
  });
});
