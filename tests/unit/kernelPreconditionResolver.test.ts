import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AIToolCallExecution,
  AIToolCallExecutionResult,
} from '../../src/services/aiTools';
import { tryKernelFirst } from '../../src/services/kernelClient/kernelChatGateway';
import {
  findPreconditionResolver,
  type ExecuteToolCalls,
} from '../../src/services/kernelClient/preconditionResolvers';

function createStorage(values: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(values));
  return {
    clear: vi.fn(() => entries.clear()),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(entries.keys())[index] ?? null),
    get length() { return entries.size; },
    removeItem: vi.fn((key: string) => entries.delete(key)),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return { json: vi.fn(async () => data), ok: status >= 200 && status < 300, status } as unknown as Response;
}

const snapshot = { totalClips: 1 };
const finalSnapshot = { totalClips: 1 };
const missingTranscript = { kind: 'transcript' as const };

function configuredStorage(): Storage {
  return createStorage({ 'ms.kernel.token': 'test-token', 'ms.kernel.url': 'http://kernel.test/' });
}

function compiledResponse() {
  return {
    expectedFingerprint: 'sha256:abcdef1234567890',
    resolvedCalls: [{ stepId: 'step-1', tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } }],
    runId: 'run-compiled', status: 'compiled', summary: {}, taskContract: {},
  };
}

function completedResponse() {
  return { fingerprintAssert: { matches: true }, status: 'succeeded', verificationReport: {} };
}

function abortedResponse() {
  return {
    failures: ['no transcript index'], missingPrecondition: missingTranscript,
    reason: 'storyPathNeedsMoments', runId: 'run-aborted', status: 'aborted',
  };
}

function successfulTools(): ExecuteToolCalls {
  return vi.fn(async (calls: AIToolCallExecution[]): Promise<AIToolCallExecutionResult[]> => calls.map((call) => ({
    ...(call.id === undefined ? {} : { id: call.id }), tool: call.tool, result: { success: true },
  })));
}

function compileCalls(fetchImpl: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/kernel/compile'));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('kernel precondition resolver', () => {
  it('repairs an auto-approved precondition once, then succeeds on the retry', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(abortedResponse()))
      .mockResolvedValueOnce(jsonResponse(compiledResponse()))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    const satisfyPrecondition = vi.fn().mockResolvedValue(true);

    const result = await tryKernelFirst('Make highlights', {
      autoApprove: true, executeToolCalls: successfulTools(), fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot).mockResolvedValueOnce(finalSnapshot),
      satisfyPrecondition, storage: configuredStorage(),
      transaction: { begin: vi.fn(() => ({}) as never), commit: vi.fn(), abort: vi.fn(), hasOwnership: vi.fn(() => true) },
    });

    expect(satisfyPrecondition).toHaveBeenCalledTimes(1);
    expect(compileCalls(fetchImpl)).toHaveLength(2);
    expect(result).toMatchObject({ handled: true, runId: 'run-compiled', report: { outcome: 'verified' } });
  });

  it('declines without repair when auto approval is off', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(abortedResponse()));
    const satisfyPrecondition = vi.fn().mockResolvedValue(true);
    const result = await tryKernelFirst('Make highlights', {
      autoApprove: false, executeToolCalls: successfulTools(), fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(snapshot), satisfyPrecondition, storage: configuredStorage(),
    });

    expect(satisfyPrecondition).not.toHaveBeenCalled();
    expect(compileCalls(fetchImpl)).toHaveLength(1);
    expect(result).toMatchObject({
      report: {
        outcome: 'declined',
        decline: {
          reason: 'storyPathNeedsMoments',
          missingPrecondition: { kind: 'transcript' },
        },
      },
    });
  });

  it('declines with the original reason when the resolver cannot satisfy it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(abortedResponse()));
    const satisfyPrecondition = vi.fn().mockResolvedValue(false);
    const result = await tryKernelFirst('Make highlights', {
      autoApprove: true, executeToolCalls: successfulTools(), fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(snapshot), satisfyPrecondition, storage: configuredStorage(),
    });

    expect(satisfyPrecondition).toHaveBeenCalledTimes(1);
    expect(compileCalls(fetchImpl)).toHaveLength(1);
    expect(result).toMatchObject({ report: { decline: { reason: 'storyPathNeedsMoments' } } });
  });

  it('never recurses when both compiles report the same missing precondition', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(abortedResponse()))
      .mockResolvedValueOnce(jsonResponse(abortedResponse()));
    const satisfyPrecondition = vi.fn().mockResolvedValue(true);
    const result = await tryKernelFirst('Make highlights', {
      autoApprove: true, executeToolCalls: successfulTools(), fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(snapshot), satisfyPrecondition, storage: configuredStorage(),
    });

    expect(satisfyPrecondition).toHaveBeenCalledTimes(1);
    expect(compileCalls(fetchImpl)).toHaveLength(2);
    expect(result).toMatchObject({ report: { outcome: 'declined', decline: { reason: 'storyPathNeedsMoments' } } });
  });

  it('starts transcription then polls clip details until the transcript is ready', async () => {
    vi.useFakeTimers();
    const resolver = findPreconditionResolver('transcript');
    if (!resolver) throw new Error('transcript resolver missing');
    let detailPolls = 0;
    const executeToolCalls = vi.fn(async (calls: AIToolCallExecution[]): Promise<AIToolCallExecutionResult[]> => calls.map((call) => ({
      ...(call.id === undefined ? {} : { id: call.id }),
      tool: call.tool,
      result: call.tool === 'getClipDetails'
        ? { success: true, data: { hasTranscript: ++detailPolls >= 2 } }
        : { success: true },
    }))) as unknown as ExecuteToolCalls;

    const satisfied = resolver.satisfy({
      executeToolCalls,
      snapshot: { videoTracks: [{ clips: [{ id: 'clip-1', hasTranscript: false }] }], audioTracks: [] },
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(satisfied).resolves.toBe(true);
    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual([
      'startClipTranscription', 'getClipDetails', 'getClipDetails',
    ]);
  });
});
