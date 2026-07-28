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
  duration: 24,
  totalClips: 3,
  occupancy: { occupied: { startSeconds: 0, endSeconds: 12, spanSeconds: 12 } },
};
const transcriptSnapshot = {
  ...initialSnapshot,
  videoTracks: [{
    id: 'video-1',
    clips: [{
      id: 'clip-1',
      mediaId: 'media-1',
      inPoint: 2,
      outPoint: 8,
      hasTranscript: true,
    }],
  }],
  audioTracks: [],
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

function storyCompiledResponse(withSetup = true, withAssumptions = true) {
  return {
    ...compiledResponse(),
    mode: 'story',
    storySummary: {
      assumptionReport: withAssumptions
        ? ['Die Reihenfolge folgt den verfuegbaren Transkriptstellen.']
        : [],
    },
    ...(withSetup
      ? { setup: { newComposition: { name: 'Story Cut', durationSeconds: 24 } } }
      : {}),
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

function perCallSuccess() {
  return vi.fn(async (
    calls: AIToolCallExecution[],
  ): Promise<AIToolCallExecutionResult[]> => calls.map((call) => ({
    ...(call.id === undefined ? {} : { id: call.id }),
    tool: call.tool,
    result: { success: true },
  })));
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
    const executeToolCalls = perCallSuccess();
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
    expect(executeToolCalls).toHaveBeenCalledTimes(2);
    expect(executeToolCalls).toHaveBeenNthCalledWith(1, [
      { id: 'step-1', tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } },
    ], 'chat', {
      guidedReplay: false,
      suppressHistory: true,
    });
    expect(executeToolCalls).toHaveBeenNthCalledWith(2, [
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

  it('builds local moments, creates and opens the story composition, then verifies resolved calls', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(storyCompiledResponse()))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(transcriptSnapshot)
      .mockResolvedValueOnce(finalSnapshot);
    const executeToolCalls = vi.fn(async (
      calls: AIToolCallExecution[],
    ): Promise<AIToolCallExecutionResult[]> => calls.map((call) => ({
      ...(call.id === undefined ? {} : { id: call.id }),
      tool: call.tool,
      result: call.tool === 'getClipTranscript'
        ? {
            success: true,
            data: {
              hasTranscript: true,
              hasMore: false,
              nextOffset: null,
              segments: [{ start: 2.5, end: 3.25, text: 'Ein guter Moment.' }],
            },
          }
        : { success: true },
    })));
    const transaction = createTransactionMocks();

    const result = await tryKernelFirst('Baue daraus eine kurze Story', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot,
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toEqual({
      handled: true,
      message: 'Kernel-verifiziert (abcdef12): 3 Clips, belegt bis 12s\n'
        + 'Annahmen: Die Reihenfolge folgt den verfuegbaren Transkriptstellen.',
      runId: 'run-1',
    });
    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual([
      'getClipTranscript',
      'getSpeechMarkers',
      'createComposition',
      'splitClip',
      'moveClip',
    ]);
    expect(executeToolCalls).toHaveBeenNthCalledWith(3, [{
      id: 'kernel-setup-new-composition',
      tool: 'createComposition',
      args: {
        name: 'Story Cut',
        duration: 24,
        openAfterCreate: true,
      },
    }], 'chat', {
      guidedReplay: false,
      suppressHistory: true,
    });
    expect(transaction.commit).toHaveBeenCalledWith(transaction.agentTransaction);

    const [, compileInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(compileInit.body as string)).toEqual({
      request: 'Baue daraus eine kurze Story',
      snapshot: transcriptSnapshot,
      indexVersion: 'app-transcript-v2',
      moments: [{
        schemaVersion: 1,
        handle: '$m1',
        source: { mediaId: 'media-1' },
        sourceRange: { startSeconds: 2.5, endSeconds: 3.25 },
        evidence: { transcript: 'Ein guter Moment.' },
        confidence: 1,
        indexVersion: 'app-transcript-v2',
        analysisSources: ['transcript'],
      }],
    });
    const [completeUrl] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(completeUrl).toBe('http://kernel.test/kernel/runs/run-1/complete');
  });

  it('executes a story response without setup through the existing per-call path', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(storyCompiledResponse(false, false)))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    const executeToolCalls = perCallSuccess();
    const transaction = createTransactionMocks();

    const result = await tryKernelFirst('Ordne die Story', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn()
        .mockResolvedValueOnce(initialSnapshot)
        .mockResolvedValueOnce(finalSnapshot),
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toEqual({
      handled: true,
      message: 'Kernel-verifiziert (abcdef12): 3 Clips, belegt bis 12s',
      runId: 'run-1',
    });
    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual([
      'splitClip',
      'moveClip',
    ]);
    expect(transaction.commit).toHaveBeenCalledWith(transaction.agentTransaction);
  });

  it.each([
    'notMechanicalTask',
    'storyPathNeedsProvider',
    'storyPathNeedsMoments',
  ])('falls back silently when compile aborts with %s', async (reason) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      failures: ['mechanical coverage not migrated'],
      reason,
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
    const executeToolCalls = vi.fn()
      .mockResolvedValueOnce([
        { id: 'step-1', tool: 'splitClip', result: { success: true } },
      ])
      .mockResolvedValueOnce([
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
      executeToolCalls: perCallSuccess(),
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
