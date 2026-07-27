import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AIToolCallExecution,
  AIToolCallExecutionResult,
} from '../../src/services/aiTools';
import type { AgentTransaction } from '../../src/services/aiTools/agentTransaction';
import { tryKernelFirst } from '../../src/services/kernelClient/kernelChatGateway';

function createStorage(values: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(values));

  return {
    clear: vi.fn(() => entries.clear()),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(entries.keys())[index] ?? null),
    get length() {
      return entries.size;
    },
    removeItem: vi.fn((key: string) => entries.delete(key)),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    json: vi.fn(async () => data),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

const initialSnapshot = {
  totalClips: 1,
  occupancy: { occupied: { startSeconds: 0, endSeconds: 8, spanSeconds: 8 } },
};
const finalSnapshot = {
  totalClips: 3,
  occupancy: { occupied: { startSeconds: 0, endSeconds: 12, spanSeconds: 12 } },
};
const resolvedCalls = [
  { stepId: 'step-1', tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } },
  { stepId: 'step-2', tool: 'moveClip', args: { clipId: 'clip-2', newStartTime: 8 } },
];

function compiledResponse() {
  return {
    expectedFingerprint: 'sha256:abcdef1234567890',
    plan: { steps: ['step-1', 'step-2'] },
    resolvedCalls,
    runId: 'run-1',
    status: 'compiled',
    summary: {
      videoCount: 2,
      audioCount: 1,
      occupiedEndSeconds: 12,
    },
    taskContract: { task: 'cutover-test' },
  };
}

function completedResponse(matches = true) {
  return {
    fingerprintAssert: {
      simulated: 'sha256:abcdef1234567890',
      committed: matches ? 'sha256:abcdef1234567890' : 'sha256:deadbeef00000000',
      matches,
    },
    status: matches ? 'succeeded' : 'failed',
    verificationReport: {
      schemaVersion: 1,
      status: 'succeeded',
      verified: { videoClipCount: 2, audioClipCount: 1 },
      checks: [],
      warnings: [],
    },
  };
}
function createTransactionMocks() {
  const agentTransaction: AgentTransaction = {
    abortNoop: false,
    alreadyBatching: false,
    historyBatchId: 7,
    label: 'Kernel task',
    stateRevisionBefore: 1,
    transactionId: 'agent-tx-test',
  };
  return {
    abort: vi.fn(),
    agentTransaction,
    begin: vi.fn(() => agentTransaction),
    commit: vi.fn(),
  };
}

function successfulToolResults(): AIToolCallExecutionResult[] {
  return resolvedCalls.map((call) => ({
    id: call.stepId,
    tool: call.tool,
    result: { success: true },
  }));
}

const configuredStorage = (enabled?: string) => createStorage({
  ...(enabled === undefined ? {} : { 'ms.kernel.enabled': enabled }),
  'ms.kernel.token': 'test-token',
  'ms.kernel.url': 'http://kernel.test/',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('kernel chat gateway WP11 cutover', () => {
  it('compiles, executes one transaction, completes, and returns the verified result', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(compiledResponse()))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(finalSnapshot);
    const executeToolCalls = vi.fn(async (
      _calls: AIToolCallExecution[],
    ): Promise<AIToolCallExecutionResult[]> => successfulToolResults());
    const transaction = createTransactionMocks();

    const result = await tryKernelFirst('Schneide den Clip', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot,
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toEqual({
      handled: true,
      message: 'Kernel-verifiziert (abcdef12): 2 Video-Clips, 1 Audio-Clips, belegte Timeline bis 12 s',
      runId: 'run-1',
    });
    expect(transaction.begin).toHaveBeenCalledTimes(1);
    expect(transaction.commit).toHaveBeenCalledWith(transaction.agentTransaction);
    expect(transaction.abort).not.toHaveBeenCalled();
    expect(executeToolCalls).toHaveBeenCalledWith([
      { id: 'step-1', tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } },
      { id: 'step-2', tool: 'moveClip', args: { clipId: 'clip-2', newStartTime: 8 } },
    ], 'chat', {
      guidedReplay: false,
      suppressHistory: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [compileUrl, compileInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(compileUrl).toBe('http://kernel.test/kernel/compile');
    expect(compileInit.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse(compileInit.body as string)).toEqual({
      request: 'Schneide den Clip',
      snapshot: initialSnapshot,
    });

    const [completeUrl, completeInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(completeUrl).toBe('http://kernel.test/kernel/runs/run-1/complete');
    expect(JSON.parse(completeInit.body as string)).toEqual({ finalSnapshot });
  });

  it('falls back silently when compile aborts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      failures: ['mechanical coverage not migrated'],
      runId: 'run-aborted',
      status: 'aborted',
    }));
    const executeToolCalls = vi.fn();
    const transaction = createTransactionMocks();

    await expect(tryKernelFirst('Erstelle Untertitel', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      storage: configuredStorage(),
      transaction,
    })).resolves.toEqual({ handled: false });

    expect(executeToolCalls).not.toHaveBeenCalled();
    expect(transaction.begin).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rolls back and falls back when any semantic tool fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(compiledResponse()));
    const executeToolCalls = vi.fn().mockResolvedValue([
      { id: 'step-1', tool: 'splitClip', result: { success: true } },
      { id: 'step-2', tool: 'moveClip', result: { success: false, error: 'clip missing' } },
    ]);
    const transaction = createTransactionMocks();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(tryKernelFirst('Schneide den Clip', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      storage: configuredStorage(),
      transaction,
    })).resolves.toEqual({ handled: false });

    expect(transaction.abort).toHaveBeenCalledWith(transaction.agentTransaction);
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      'Kernel tool execution failed; rolled back and falling back to community chat.',
      'clip missing',
    );
  });

  it('reports a fingerprint mismatch without falling back after the commit', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(compiledResponse()))
      .mockResolvedValueOnce(jsonResponse(completedResponse(false)));
    const transaction = createTransactionMocks();

    const result = await tryKernelFirst('Schneide den Clip', {
      executeToolCalls: vi.fn().mockResolvedValue(successfulToolResults()),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn()
        .mockResolvedValueOnce(initialSnapshot)
        .mockResolvedValueOnce(finalSnapshot),
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toMatchObject({
      handled: true,
      message: expect.stringContaining('Kernel-Verifikation fehlgeschlagen (deadbeef)'),
      runId: 'run-1',
    });
    expect(transaction.commit).toHaveBeenCalledWith(transaction.agentTransaction);
    expect(transaction.abort).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('bypasses kernel-first when the flag is explicitly false', async () => {
    const fetchImpl = vi.fn();
    const getSnapshot = vi.fn();
    const executeToolCalls = vi.fn();
    const transaction = createTransactionMocks();

    await expect(tryKernelFirst('Schneide den Clip', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot,
      storage: configuredStorage('false'),
      transaction,
    })).resolves.toEqual({ handled: false });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(executeToolCalls).not.toHaveBeenCalled();
    expect(transaction.begin).not.toHaveBeenCalled();
  });
});
