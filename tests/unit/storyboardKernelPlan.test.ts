import { describe, expect, it, vi } from 'vitest';
import type { AgentTransaction } from '../../src/services/aiTools/agentTransaction';
import { executeAIToolCalls } from '../../src/services/aiTools';
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

describe('kernel storyboard Plan responses', () => {
  it('returns pure planned conversation without transaction, tools, or complete', async () => {
    const compile = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        runId: 'plan-run-1',
        status: 'planned',
        message: 'I drafted a three-scene structure.',
        resolvedCalls: [],
      },
    }));
    const completeRun = vi.fn();
    const executeToolCalls = vi.fn();
    const begin = vi.fn();

    const result = await tryKernelFirst('Draft a structure.', {
      client: { compile, completeRun } as never,
      decisionPolicy: 'milestones',
      executeToolCalls,
      getSnapshot: () => ({ activeCompositionId: 'comp-1' }),
      intent: 'plan',
      storage: createStorage(),
      transaction: { begin },
    });

    expect(result).toEqual({
      handled: true,
      message: 'I drafted a three-scene structure.',
      runId: 'plan-run-1',
    });
    expect(compile).toHaveBeenCalledWith(expect.objectContaining({
      request: 'Draft a structure.',
      intent: 'plan',
      decisionPolicy: 'milestones',
    }));
    expect(executeToolCalls).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(completeRun).not.toHaveBeenCalled();
  });

  it('passes Plan execution policy to every planned semantic call', async () => {
    const compile = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        runId: 'plan-run-2',
        status: 'planned',
        message: 'Updating the storyboard scene.',
        resolvedCalls: [{
          stepId: 'scene-1',
          tool: 'updateStoryboardScene',
          args: { sceneId: 'scene-1', title: 'Opening' },
        }],
        expectedFingerprint: { value: 'expected' },
      },
    }));
    const completeRun = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        status: 'succeeded',
        fingerprintAssert: { matches: true, committed: 'expected' },
        verificationReport: { status: 'succeeded' },
      },
    }));
    const executeToolCalls = vi.fn(async () => [{
      id: 'scene-1',
      tool: 'updateStoryboardScene',
      result: { success: true },
    }]);
    const transaction: AgentTransaction = {
      abortNoop: false,
      alreadyBatching: false,
      historyBatchId: 1,
      label: 'plan',
      transactionId: 'tx-plan',
    };

    const result = await tryKernelFirst('Rename the opening.', {
      client: { compile, completeRun } as never,
      executeToolCalls: executeToolCalls as never,
      getSnapshot: () => ({ activeCompositionId: 'comp-1' }),
      intent: 'plan',
      storage: createStorage(),
      transaction: {
        abort: vi.fn(),
        begin: vi.fn(() => transaction),
        commit: vi.fn(),
        hasOwnership: vi.fn(() => true),
      },
    });

    expect(result.handled).toBe(true);
    expect(executeToolCalls).toHaveBeenCalledWith(
      [expect.objectContaining({ tool: 'updateStoryboardScene' })],
      'chat',
      expect.objectContaining({
        executionMode: 'plan',
        suppressHistory: true,
      }),
    );
    expect(completeRun).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a kernel Plan requests real-media mutation', async () => {
    const compile = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        runId: 'plan-run-denied',
        status: 'planned',
        message: 'Attempting a forbidden edit.',
        resolvedCalls: [{
          stepId: 'delete-real-clip',
          tool: 'deleteClip',
          args: { clipId: 'real-clip' },
        }],
        expectedFingerprint: { value: 'must-not-complete' },
      },
    }));
    const completeRun = vi.fn();
    const abort = vi.fn();
    const transaction: AgentTransaction = {
      abortNoop: false,
      alreadyBatching: false,
      historyBatchId: 1,
      label: 'plan',
      transactionId: 'tx-plan-denied',
    };

    const result = await tryKernelFirst('Delete the real clip.', {
      client: { compile, completeRun } as never,
      executeToolCalls: executeAIToolCalls,
      getSnapshot: () => ({ activeCompositionId: 'comp-1' }),
      intent: 'plan',
      storage: createStorage(),
      transaction: {
        abort,
        begin: vi.fn(() => transaction),
        commit: vi.fn(),
        hasOwnership: vi.fn(() => true),
      },
    });

    expect(result.handled).toBe(true);
    expect(result.report).toMatchObject({
      outcome: 'declined',
      decline: {
        reason: 'toolExecutionFailed',
        detail: expect.stringMatching(/Plan mode/i),
      },
    });
    expect(completeRun).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('verifies a resolved variant commit with /complete and rolls it back on rejection', async () => {
    const order: string[] = [];
    const compile = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      data: {
        runId: 'variant-commit-run',
        status: 'compiled',
        taskContract: { task: 'commit selected storyboard range option' },
        plan: { steps: ['commit-option'] },
        resolvedCalls: [{
          stepId: 'commit-option',
          tool: 'commitTimelineVariantOption',
          args: {
            optionId: 'option-a',
            boundaryPolicy: 'preserve',
          },
        }],
        expectedFingerprint: { value: 'expected-variant-result' },
        summary: { videoCount: 1, audioCount: 0 },
      },
    }));
    const completeRun = vi.fn(async () => {
      order.push('complete');
      return {
        ok: true as const,
        status: 200,
        data: {
          status: 'failed',
          fingerprintAssert: {
            matches: false,
            committed: 'rejected-variant-result',
          },
          verificationReport: {
            status: 'failed',
            reason: 'outside-scope fingerprint changed',
          },
        },
      };
    });
    const executeToolCalls = vi.fn(async () => {
      order.push('execute-commit');
      return [{
        id: 'commit-option',
        tool: 'commitTimelineVariantOption',
        result: { success: true },
      }];
    });
    const transaction: AgentTransaction = {
      abortNoop: false,
      alreadyBatching: false,
      historyBatchId: 12,
      label: 'variant commit',
      stateRevisionBefore: 0,
      transactionId: 'tx-variant-commit',
    };
    const abort = vi.fn(() => {
      order.push('rollback');
    });
    const commit = vi.fn(() => {
      order.push('transaction-commit');
    });
    const finalSnapshot = {
      activeCompositionId: 'base-composition',
      storyboard: { variantSetId: 'set-a', status: 'committed' },
    };

    const result = await tryKernelFirst('Commit option A.', {
      client: { compile, completeRun } as never,
      executeToolCalls: executeToolCalls as never,
      getSnapshot: () => finalSnapshot,
      intent: 'execute',
      storage: createStorage(),
      transaction: {
        abort,
        begin: vi.fn(() => transaction),
        commit,
        hasOwnership: vi.fn(() => true),
      },
    });

    expect(executeToolCalls).toHaveBeenCalledWith(
      [expect.objectContaining({
        tool: 'commitTimelineVariantOption',
        args: {
          optionId: 'option-a',
          boundaryPolicy: 'preserve',
        },
      })],
      'chat',
      expect.objectContaining({
        guidedReplay: false,
        suppressHistory: true,
      }),
    );
    expect(completeRun).toHaveBeenCalledWith(
      'variant-commit-run',
      { finalSnapshot },
    );
    expect(order).toEqual(['execute-commit', 'complete', 'rollback']);
    expect(commit).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      handled: true,
      report: {
        outcome: 'failed',
        verified: {
          matches: false,
          fingerprint: 'rejected-variant-result',
        },
      },
    });
  });
});
