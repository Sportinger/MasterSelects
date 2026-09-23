import { describe, expect, it } from 'vitest';
import { DisFlowWriteQueue } from '../../src/effects/time/DisFlowWriteQueue';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

describe('DIS background persistence', () => {
  it('lets analysis continue while disk writes are pending and bounds retained payloads', async () => {
    const queue = new DisFlowWriteQueue(32*1024*1024);
    const first = deferred(), second = deferred(), third = deferred();
    await queue.enqueue(() => first.promise);
    await queue.enqueue(() => second.promise);
    let thirdStarted = false;
    const enqueued = queue.enqueue(() => { thirdStarted = true; return third.promise; });
    await Promise.resolve();
    expect(thirdStarted).toBe(false);
    first.resolve();
    await enqueued;
    expect(thirdStarted).toBe(true);
    let finished = false;
    const drain = queue.drain().then(() => { finished = true; });
    second.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    third.resolve();
    await drain;
    expect(finished).toBe(true);
  });

  it('releases a slot after a failed write', async () => {
    const queue = new DisFlowWriteQueue(64*1024*1024);
    await queue.enqueue(async () => { throw new Error('disk unavailable'); });
    let captured = false;
    await queue.enqueue(async () => { captured = true; });
    await queue.drain();
    expect(captured).toBe(true);
  });
});
