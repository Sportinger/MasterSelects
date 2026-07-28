import { describe, expect, it, vi } from 'vitest';
import {
  cancelAgentTimelineAnalysis,
  runAgentTimelineAnalysis,
} from '../../src/services/agentTimeline/jobs/analysisExecutionCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('agent timeline analysis execution coordinator', () => {
  it('coalesces duplicate runs with the same source, scope, and profile key', async () => {
    const gate = deferred<void>();
    const run = vi.fn(async () => {
      await gate.promise;
    });
    const options = {
      runKey: `coalesced:${crypto.randomUUID()}`,
      operations: [{ id: 'visual', channel: 'quality', run }],
    };

    const first = runAgentTimelineAnalysis(options);
    const second = runAgentTimelineAnalysis(options);
    gate.resolve();

    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ status: 'completed' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns cached without invoking an operation runner', async () => {
    const run = vi.fn();
    const result = await runAgentTimelineAnalysis({
      runKey: `cached:${crypto.randomUUID()}`,
      operations: [{
        id: 'cuts',
        channel: 'cuts',
        isCached: () => true,
        run,
      }],
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.jobs[0]).toMatchObject({ status: 'cached', progress: 1 });
  });

  it('awaits an asynchronous coverage cache probe before running', async () => {
    const run = vi.fn();
    const isCached = vi.fn().mockResolvedValue(true);
    const result = await runAgentTimelineAnalysis({
      runKey: `async-cached:${crypto.randomUUID()}`,
      operations: [{ id: 'transcript', channel: 'speech', isCached, run }],
    });

    expect(isCached).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(result.jobs[0]).toMatchObject({ status: 'cached', progress: 1 });
  });

  it('cancels the active runner and reports a cancelled graph', async () => {
    const started = deferred<void>();
    const cancelled = deferred<void>();
    const cancel = vi.fn(() => cancelled.resolve());
    const runKey = `cancel:${crypto.randomUUID()}`;
    const promise = runAgentTimelineAnalysis({
      runKey,
      operations: [{
        id: 'faces',
        channel: 'people',
        cancel,
        async run(signal) {
          started.resolve();
          await new Promise<void>((resolve, reject) => {
            const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
            signal.addEventListener('abort', abort, { once: true });
          });
        },
      }],
    });
    await started.promise;

    expect(cancelAgentTimelineAnalysis(runKey)).toBe(true);
    await cancelled.promise;
    await expect(promise).resolves.toMatchObject({ status: 'cancelled' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelAgentTimelineAnalysis(runKey)).toBe(false);
  });
});
