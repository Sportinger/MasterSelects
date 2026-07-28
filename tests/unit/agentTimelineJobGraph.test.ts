import { describe, expect, it, vi } from 'vitest';
import { runAgentTimelineJobGraph } from '../../src/services/agentTimeline/jobs/analysisJobGraph';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('Agent Timeline job graph', () => {
  it('runs independent jobs concurrently and waits for dependencies', async () => {
    const first = deferred<'completed'>();
    const second = deferred<'cached'>();
    const order: string[] = [];
    const running = runAgentTimelineJobGraph({
      graphId: 'parallel',
      jobs: [
        {
          id: 'metrics',
          channel: 'quality',
          run: async () => {
            order.push('metrics:start');
            const result = await first.promise;
            order.push('metrics:end');
            return result;
          },
        },
        {
          id: 'cuts',
          channel: 'cuts',
          run: async () => {
            order.push('cuts:start');
            const result = await second.promise;
            order.push('cuts:end');
            return result;
          },
        },
        {
          id: 'scenes',
          channel: 'scenes',
          dependencies: ['cuts', 'metrics'],
          run: async () => {
            order.push('scenes');
            return 'completed';
          },
        },
      ],
    });

    await vi.waitFor(() => expect(order).toEqual(['metrics:start', 'cuts:start']));
    second.resolve('cached');
    first.resolve('completed');
    const result = await running;
    expect(order.at(-1)).toBe('scenes');
    expect(result.status).toBe('completed');
    expect(result.jobs.map((job) => job.status)).toEqual(['completed', 'cached', 'completed']);
  });

  it('serializes matching global resource locks', async () => {
    const gate = deferred<'completed'>();
    const order: string[] = [];
    const first = runAgentTimelineJobGraph({
      graphId: 'decoder-a',
      jobs: [{
        id: 'faces-a',
        channel: 'people',
        resourceLocks: ['decoder:source-a'],
        run: async () => {
          order.push('a:start');
          const outcome = await gate.promise;
          order.push('a:end');
          return outcome;
        },
      }],
    });
    const second = runAgentTimelineJobGraph({
      graphId: 'decoder-b',
      jobs: [{
        id: 'cuts-b',
        channel: 'cuts',
        resourceLocks: ['decoder:source-a'],
        run: async () => {
          order.push('b:start');
          return 'completed';
        },
      }],
    });

    await vi.waitFor(() => expect(order).toEqual(['a:start']));
    gate.resolve('completed');
    await Promise.all([first, second]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('keeps independent work after a failure and blocks dependants', async () => {
    const result = await runAgentTimelineJobGraph({
      graphId: 'failure',
      jobs: [
        {
          id: 'broken',
          channel: 'quality',
          run: async () => { throw new Error('fixture failed'); },
        },
        {
          id: 'dependant',
          channel: 'scenes',
          dependencies: ['broken'],
          run: async () => 'completed',
        },
        {
          id: 'independent',
          channel: 'speech',
          run: async () => 'partial',
        },
      ],
    });
    expect(result.status).toBe('failed');
    expect(result.jobs.map((job) => job.status)).toEqual(['failed', 'blocked', 'partial']);
    expect(result.jobs[0].error?.message).toBe('fixture failed');
  });

  it('cancels queued work and exposes immutable progress snapshots', async () => {
    const controller = new AbortController();
    const snapshots: number[] = [];
    const result = await runAgentTimelineJobGraph({
      graphId: 'cancel',
      signal: controller.signal,
      onUpdate: (snapshot) => snapshots.push(snapshot.jobs[0].progress),
      jobs: [{
        id: 'metrics',
        channel: 'quality',
        run: async ({ signal, reportProgress }) => {
          reportProgress(0.45);
          controller.abort();
          if (signal.aborted) {
            const error = new Error('cancelled');
            error.name = 'AbortError';
            throw error;
          }
          return 'completed';
        },
      }],
    });
    expect(result.status).toBe('cancelled');
    expect(result.jobs[0].status).toBe('cancelled');
    expect(snapshots).toContain(0.45);
  });

  it('rejects cycles and unknown dependencies before running', async () => {
    await expect(runAgentTimelineJobGraph({
      graphId: 'cycle',
      jobs: [
        { id: 'a', channel: 'a', dependencies: ['b'], run: async () => 'completed' },
        { id: 'b', channel: 'b', dependencies: ['a'], run: async () => 'completed' },
      ],
    })).rejects.toThrow('cycle');
    await expect(runAgentTimelineJobGraph({
      graphId: 'unknown',
      jobs: [
        { id: 'a', channel: 'a', dependencies: ['missing'], run: async () => 'completed' },
      ],
    })).rejects.toThrow('unknown dependency');
  });
});
