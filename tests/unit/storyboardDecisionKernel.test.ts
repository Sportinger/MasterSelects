import { describe, expect, it, vi } from 'vitest';
import { tryKernelFirst } from '../../src/services/kernelClient/kernelChatGateway';

function createStorage(): Storage {
  const entries = new Map([
    ['ms.kernel.url', 'http://127.0.0.1:8787'],
    ['ms.kernel.token', 'test-token'],
  ]);
  return {
    clear: vi.fn(() => entries.clear()),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    key: vi.fn((index: number) => [...entries.keys()][index] ?? null),
    get length() { return entries.size; },
    removeItem: vi.fn((key: string) => entries.delete(key)),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
  };
}

const decision = {
  id: 'decision-kernel',
  kind: 'story',
  question: 'Which opening?',
  baseFingerprint: {
    schemaVersion: 1,
    algorithm: 'sha-256',
    value: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  },
  options: [{
    id: 'direct',
    title: 'Direct',
    summary: 'Open on the main claim.',
    tradeoffs: ['Less mystery'],
  }],
  allowMultiple: false,
  allowFreeform: false,
};

describe('kernel durable decision flow', () => {
  it('returns a decision without transaction, tools, or completion', async () => {
    const compile = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        runId: 'decision-run',
        status: 'awaiting-decision',
        message: 'Choose an opening.',
        decision,
      },
    }));
    const completeRun = vi.fn();
    const executeToolCalls = vi.fn();
    const begin = vi.fn();

    const result = await tryKernelFirst('Plan the opening.', {
      client: { compile, completeRun } as never,
      executeToolCalls,
      getSnapshot: () => ({ fingerprint: 'snapshot-1' }),
      intent: 'plan',
      storage: createStorage(),
      transaction: { begin },
    });

    expect(result).toMatchObject({
      handled: true,
      runId: 'decision-run',
      decision: { id: 'decision-kernel' },
    });
    expect(begin).not.toHaveBeenCalled();
    expect(executeToolCalls).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
  });

  it('recompiles a selection against a fresh snapshot and never replays calls', async () => {
    const snapshots = [
      { fingerprint: 'snapshot-1' },
      { fingerprint: 'snapshot-2', changed: true },
    ];
    const getSnapshot = vi.fn(() => snapshots.shift());
    const compile = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          runId: 'decision-run',
          status: 'awaiting-decision',
          message: 'Choose an opening.',
          decision,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          runId: 'decision-resume',
          status: 'planned',
          message: 'Choice recompiled on the latest plan.',
          resolvedCalls: [],
        },
      });
    const executeToolCalls = vi.fn();
    const completeRun = vi.fn();
    const client = { compile, completeRun } as never;
    const storage = createStorage();

    await tryKernelFirst('Plan the opening.', {
      client,
      executeToolCalls,
      getSnapshot,
      intent: 'plan',
      storage,
    });
    const result = await tryKernelFirst('Continue with Direct.', {
      activeDecision: {
        decisionId: 'decision-kernel',
        optionIds: ['direct'],
      },
      client,
      executeToolCalls,
      getSnapshot,
      intent: 'plan',
      storage,
    });

    expect(result).toMatchObject({
      handled: true,
      runId: 'decision-resume',
    });
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(compile.mock.calls[0]?.[0]).toMatchObject({
      snapshot: { fingerprint: 'snapshot-1' },
    });
    expect(compile.mock.calls[1]?.[0]).toMatchObject({
      activeDecision: {
        decisionId: 'decision-kernel',
        optionIds: ['direct'],
      },
      snapshot: { fingerprint: 'snapshot-2', changed: true },
    });
    expect(executeToolCalls).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
  });

  it('preserves stale-decision abort reasons for fail-closed UI handling', async () => {
    const result = await tryKernelFirst('Continue.', {
      activeDecision: {
        decisionId: 'decision-kernel',
        optionIds: ['direct'],
      },
      client: {
        compile: vi.fn(async () => ({
          ok: true as const,
          status: 200,
          data: {
            runId: 'decision-stale',
            status: 'aborted',
            reason: 'staleDecision',
            failures: ['The base fingerprint changed.'],
          },
        })),
        completeRun: vi.fn(),
      } as never,
      getSnapshot: () => ({ fingerprint: 'snapshot-new' }),
      storage: createStorage(),
    });

    expect(result).toMatchObject({
      handled: true,
      report: {
        outcome: 'declined',
        decline: { reason: 'staleDecision' },
      },
    });
  });
});
