import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AIToolCallExecution,
  AIToolCallExecutionResult,
} from '../../src/services/aiTools';
import type { AgentTransaction } from '../../src/services/aiTools/agentTransaction';
import { Logger } from '../../src/services/logger';
import {
  resolveKernelConfig,
  tryKernelFirst,
} from '../../src/services/kernelClient/kernelChatGateway';

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
    hasOwnership: vi.fn(() => true),
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

const configuredStorage = (enabled?: string, fallback?: string) => createStorage({
  ...(enabled === undefined ? {} : { 'ms.kernel.enabled': enabled }),
  ...(fallback === undefined ? {} : { 'ms.kernel.fallback': fallback }),
  'ms.kernel.token': 'test-token',
  'ms.kernel.url': 'http://kernel.test/',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('kernel chat gateway WP11 cutover', () => {
  it('heals a stale localhost kernel token with the current dev token', () => {
    const storage = createStorage({
      'ms.kernel.token': 'stale-token',
      'ms.kernel.url': 'http://127.0.0.1:8787',
    });

    expect(resolveKernelConfig(storage, 'current-dev-token')).toEqual({
      baseUrl: 'http://127.0.0.1:8787',
      token: 'current-dev-token',
    });
  });

  it('keeps explicit remote kernel credentials in dev', () => {
    const storage = createStorage({
      'ms.kernel.token': 'remote-token',
      'ms.kernel.url': 'https://kernel.example.test',
    });

    expect(resolveKernelConfig(storage, 'current-dev-token')).toEqual({
      baseUrl: 'https://kernel.example.test',
      token: 'remote-token',
    });
  });

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

    expect(result).toMatchObject({
      handled: true,
      message: 'Kernel verified (abcdef12): 2 video clips, 1 audio clips, timeline 0–12s (12s)',
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
        : call.tool === 'createComposition'
          ? { success: true, data: { compositionId: 'comp-story' } }
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

    expect(result).toMatchObject({
      handled: true,
      message: 'Kernel verified (abcdef12): 2 video clips, 1 audio clips, timeline 0–12s (12s)\n'
        + 'Assumed: Die Reihenfolge folgt den verfuegbaren Transkriptstellen.',
      runId: 'run-1',
    });
    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual([
      'getClipTranscript',
      'getSpeechMarkers',
      'findSilentSections',
      'createComposition',
      'splitClip',
      'moveClip',
    ]);
    expect(executeToolCalls).toHaveBeenNthCalledWith(4, [{
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
        evidence: {
          transcript: 'Ein guter Moment.',
          words: [
            {
              text: 'Ein',
              startSeconds: 2.5,
              endSeconds: 2.5 + (0.75 * 3) / 14,
            },
            {
              text: 'guter',
              startSeconds: 2.5 + (0.75 * 3) / 14,
              endSeconds: 2.5 + (0.75 * 8) / 14,
            },
            {
              text: 'Moment.',
              startSeconds: 2.5 + (0.75 * 8) / 14,
              endSeconds: 3.25,
            },
          ],
        },
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

    expect(result).toMatchObject({
      handled: true,
      message: 'Kernel verified (abcdef12): 2 video clips, 1 audio clips, timeline 0–12s (12s)',
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
  ])('uses the explicitly enabled provider fallback when compile aborts with %s', async (reason) => {
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
      storage: configuredStorage(undefined, 'true'),
      transaction,
    })).resolves.toEqual({ handled: false });

    expect(executeToolCalls).not.toHaveBeenCalled();
    expect(transaction.begin).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed by default when the kernel compile transport fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const executeToolCalls = vi.fn();
    const transaction = createTransactionMocks();

    const result = await tryKernelFirst('Baue einen neuen Schnitt', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toMatchObject({
      handled: true,
      message: expect.stringContaining('The kernel service could not be reached'),
    });
    expect(executeToolCalls).not.toHaveBeenCalled();
    expect(transaction.begin).not.toHaveBeenCalled();
  });

  it('binds null and stale track ids to live timeline tracks at execution time', async () => {
    const trackedSnapshot = {
      ...initialSnapshot,
      activeCompositionId: 'comp-prev',
      videoTracks: [{ id: 'video-src', clips: [] }],
      audioTracks: [{ id: 'audio-src', clips: [] }],
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ...storyCompiledResponse(true, false),
        resolvedCalls: [
          {
            stepId: 'seg-1',
            tool: 'addClipSegment',
            args: { mediaFileId: 'media-1', trackId: null, startTime: 0, inPoint: 2.8, outPoint: 3.28 },
          },
          {
            stepId: 'seg-2',
            tool: 'addClipSegment',
            args: { mediaFileId: 'media-1', trackId: 'audio-src', startTime: 0.48, inPoint: 5, outPoint: 6 },
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    const executeToolCalls = vi.fn(async (
      calls: AIToolCallExecution[],
    ): Promise<AIToolCallExecutionResult[]> => calls.map((call) => ({
      ...(call.id === undefined ? {} : { id: call.id }),
      tool: call.tool,
      result: call.tool === 'getTimelineState'
        ? {
            success: true,
            data: {
              videoTracks: [{ id: 'video-new' }],
              audioTracks: [{ id: 'audio-new' }],
            },
          }
        : call.tool === 'createComposition'
          ? { success: true, data: { compositionId: 'comp-new' } }
          : { success: true },
    })));
    const transaction = createTransactionMocks();

    const result = await tryKernelFirst('Baue daraus eine kurze Story', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn()
        .mockResolvedValueOnce(trackedSnapshot)
        .mockResolvedValueOnce(finalSnapshot),
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toMatchObject({ handled: true, runId: 'run-1' });
    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual([
      'createComposition',
      'getTimelineState',
      'addClipSegment',
      'getTimelineState',
      'addClipSegment',
    ]);
    expect(executeToolCalls.mock.calls[2]?.[0]?.[0]?.args).toEqual({
      mediaFileId: 'media-1',
      trackId: 'video-new',
      startTime: 0,
      inPoint: 2.8,
      outPoint: 3.28,
    });
    expect(executeToolCalls.mock.calls[4]?.[0]?.[0]?.args).toEqual({
      mediaFileId: 'media-1',
      trackId: 'audio-new',
      startTime: 0.48,
      inPoint: 5,
      outPoint: 6,
    });
    expect(transaction.commit).toHaveBeenCalledWith(transaction.agentTransaction);
  });

  it('removes the setup composition and reopens the previous one when a later call fails', async () => {
    const trackedSnapshot = {
      ...initialSnapshot,
      activeCompositionId: 'comp-prev',
      videoTracks: [{ id: 'video-src', clips: [] }],
      audioTracks: [],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      ...storyCompiledResponse(true, false),
      resolvedCalls: [{
        stepId: 'seg-1',
        tool: 'addClipSegment',
        args: { mediaFileId: 'media-1', trackId: null, startTime: 0, inPoint: 2.8, outPoint: 3.28 },
      }],
    }));
    const executeToolCalls = vi.fn(async (
      calls: AIToolCallExecution[],
    ): Promise<AIToolCallExecutionResult[]> => calls.map((call) => ({
      ...(call.id === undefined ? {} : { id: call.id }),
      tool: call.tool,
      result: call.tool === 'getTimelineState'
        ? { success: true, data: { videoTracks: [{ id: 'video-new' }], audioTracks: [] } }
        : call.tool === 'createComposition'
          ? { success: true, data: { compositionId: 'comp-new' } }
          : call.tool === 'addClipSegment'
            ? { success: false, error: 'media unavailable' }
            : { success: true },
    })));
    const transaction = createTransactionMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(tryKernelFirst('Baue daraus eine kurze Story', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValueOnce(trackedSnapshot),
      storage: configuredStorage(undefined, 'true'),
      transaction,
    })).resolves.toEqual({ handled: false });

    const toolSequence = executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool);
    expect(toolSequence).toEqual([
      'createComposition',
      'getTimelineState',
      'addClipSegment',
      'openComposition',
      'deleteMediaItem',
    ]);
    expect(executeToolCalls.mock.calls[3]?.[0]?.[0]?.args).toEqual({ compositionId: 'comp-prev' });
    expect(executeToolCalls.mock.calls[4]?.[0]?.[0]?.args).toEqual({ itemId: 'comp-new' });
    expect(transaction.abort).toHaveBeenCalledWith(transaction.agentTransaction);
    expect(transaction.commit).not.toHaveBeenCalled();
    const abortOrder = transaction.abort.mock.invocationCallOrder[0] as number;
    const reopenOrder = executeToolCalls.mock.invocationCallOrder[3] as number;
    const deleteOrder = executeToolCalls.mock.invocationCallOrder[4] as number;
    expect(reopenOrder).toBeLessThan(deleteOrder);
    expect(deleteOrder).toBeLessThan(abortOrder);
    expect(Math.max(...executeToolCalls.mock.invocationCallOrder)).toBeLessThan(abortOrder);
  });

  it('keeps the setup composition when the rollback is deferred to an outer owner', async () => {
    const trackedSnapshot = {
      ...initialSnapshot,
      activeCompositionId: 'comp-prev',
      videoTracks: [{ id: 'video-src', clips: [] }],
      audioTracks: [],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      ...storyCompiledResponse(true, false),
      resolvedCalls: [{
        stepId: 'seg-1',
        tool: 'addClipSegment',
        args: { mediaFileId: 'media-1', trackId: null, startTime: 0, inPoint: 2.8, outPoint: 3.28 },
      }],
    }));
    const executeToolCalls = vi.fn(async (
      calls: AIToolCallExecution[],
    ): Promise<AIToolCallExecutionResult[]> => calls.map((call) => ({
      ...(call.id === undefined ? {} : { id: call.id }),
      tool: call.tool,
      result: call.tool === 'getTimelineState'
        ? { success: true, data: { videoTracks: [{ id: 'video-new' }], audioTracks: [] } }
        : call.tool === 'createComposition'
          ? { success: true, data: { compositionId: 'comp-new' } }
          : call.tool === 'addClipSegment'
            ? { success: false, error: 'media unavailable' }
            : { success: true },
    })));
    const transaction = createTransactionMocks();
    transaction.agentTransaction.abortNoop = true;

    const result = await tryKernelFirst('Baue daraus eine kurze Story', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValueOnce(trackedSnapshot),
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toMatchObject({
      handled: true,
      message: expect.stringContaining('Kernel run failed'),
      runId: 'run-1',
    });
    const toolSequence = executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool);
    expect(toolSequence).toEqual([
      'createComposition',
      'getTimelineState',
      'addClipSegment',
    ]);
    expect(transaction.abort).toHaveBeenCalledWith(transaction.agentTransaction);
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
      storage: configuredStorage(undefined, 'true'),
      transaction,
    })).resolves.toEqual({ handled: false });

    expect(transaction.abort).toHaveBeenCalledWith(transaction.agentTransaction);
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      'Kernel tool execution failed; rolled back.',
      'clip missing',
    );
  });

  it('rolls back a fingerprint mismatch instead of committing it', async () => {
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
      message: expect.stringContaining('Kernel verification failed (deadbeef)'),
      runId: 'run-1',
    });
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.abort).toHaveBeenCalledWith(transaction.agentTransaction);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('passes stale track ids through non-placement tools without reading timeline state', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ...compiledResponse(),
        resolvedCalls: [{
          stepId: 'mute-1',
          tool: 'setTrackMuted',
          args: { trackId: 'stale-track', muted: true },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    const executeToolCalls = perCallSuccess();
    const transaction = createTransactionMocks();

    await expect(tryKernelFirst('Stummschalten', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn()
        .mockResolvedValueOnce({ ...initialSnapshot, videoTracks: [{ id: 'stale-track' }] })
        .mockResolvedValueOnce(finalSnapshot),
      storage: configuredStorage(),
      transaction,
    })).resolves.toMatchObject({ handled: true, runId: 'run-1' });

    expect(executeToolCalls).toHaveBeenCalledTimes(1);
    expect(executeToolCalls.mock.calls[0]?.[0]?.[0]).toEqual({
      id: 'mute-1',
      tool: 'setTrackMuted',
      args: { trackId: 'stale-track', muted: true },
    });
  });

  it('leaves addClipSegment args untouched when no live video track exists', async () => {
    const args = { mediaFileId: 'media-1', trackId: null, startTime: 0, inPoint: 1, outPoint: 2 };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ...compiledResponse(),
        resolvedCalls: [{ stepId: 'segment-1', tool: 'addClipSegment', args }],
      }))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    const executeToolCalls = vi.fn(async (calls: AIToolCallExecution[]) => calls.map((call) => ({
      ...(call.id === undefined ? {} : { id: call.id }),
      tool: call.tool,
      result: call.tool === 'getTimelineState'
        ? { success: true, data: { videoTracks: [], audioTracks: [{ id: 'audio-live' }] } }
        : { success: true },
    })));
    const transaction = createTransactionMocks();

    await expect(tryKernelFirst('Clip einsetzen', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn()
        .mockResolvedValueOnce({ ...initialSnapshot, videoTracks: [{ id: 'video-source' }], audioTracks: [] })
        .mockResolvedValueOnce(finalSnapshot),
      storage: configuredStorage(),
      transaction,
    })).resolves.toMatchObject({ handled: true, runId: 'run-1' });

    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual([
      'getTimelineState',
      'addClipSegment',
    ]);
    expect(executeToolCalls.mock.calls[1]?.[0]?.[0]?.args).toEqual(args);
  });

  it('rolls back and declines when setup succeeds without a composition id', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      ...storyCompiledResponse(true, false),
      resolvedCalls: [{ stepId: 'step-1', tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } }],
    }));
    const executeToolCalls = perCallSuccess();
    const transaction = createTransactionMocks();

    await expect(tryKernelFirst('Baue eine Story', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      storage: configuredStorage(undefined, 'true'),
      transaction,
    })).resolves.toEqual({ handled: false });

    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual(['createComposition']);
    expect(transaction.abort).toHaveBeenCalledWith(transaction.agentTransaction);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('continues rollback when setup cleanup reports success false', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      ...storyCompiledResponse(true, false),
      resolvedCalls: [{ stepId: 'step-1', tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } }],
    }));
    const executeToolCalls = vi.fn(async (calls: AIToolCallExecution[]) => calls.map((call) => ({
      ...(call.id === undefined ? {} : { id: call.id }),
      tool: call.tool,
      result: call.tool === 'createComposition'
        ? { success: true, data: { compositionId: 'comp-new' } }
        : call.tool === 'splitClip'
          ? { success: false, error: 'clip missing' }
          : call.tool === 'deleteMediaItem'
            ? { success: false, error: 'cleanup failed' }
            : { success: true },
    })));
    const transaction = createTransactionMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(tryKernelFirst('Baue eine Story', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue({ ...initialSnapshot, activeCompositionId: 'comp-prev' }),
      storage: configuredStorage(undefined, 'true'),
      transaction,
    })).resolves.toEqual({ handled: false });

    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual([
      'createComposition',
      'splitClip',
      'openComposition',
      'deleteMediaItem',
    ]);
    expect(transaction.abort).toHaveBeenCalledWith(transaction.agentTransaction);
    expect(Logger.search('kernel setup rollback call failed')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        data: expect.objectContaining({ error: 'cleanup failed', tool: 'deleteMediaItem' }),
      }),
    ]));
  });

  it('returns an honest failure without cleanup when transaction ownership is lost', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      ...storyCompiledResponse(true, false),
      resolvedCalls: [{ stepId: 'step-1', tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } }],
    }));
    const executeToolCalls = vi.fn(async (calls: AIToolCallExecution[]) => calls.map((call) => ({
      ...(call.id === undefined ? {} : { id: call.id }),
      tool: call.tool,
      result: call.tool === 'createComposition'
        ? { success: true, data: { compositionId: 'comp-new' } }
        : { success: false, error: 'clip missing' },
    })));
    const transaction = createTransactionMocks();
    transaction.hasOwnership.mockReturnValue(false);

    const result = await tryKernelFirst('Baue eine Story', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toMatchObject({
      handled: true,
      message: expect.stringContaining('Kernel run failed'),
      runId: 'run-1',
    });
    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual([
      'createComposition',
      'splitClip',
    ]);
    expect(transaction.abort).not.toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('reports the structured run report alongside the derived message', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ...compiledResponse(),
        plan: {
          steps: [
            { id: 'step-1', capability: 'timeline.splitClip' },
            { id: 'step-2', capability: 'timeline.moveClip' },
          ],
        },
        taskContract: {
          request: 'Schneide den Clip',
          goals: [{ property: 'silence', operation: 'remove', value: true }],
          preserve: ['sourceOrder'],
          assumptions: { minSilence: 0.4 },
          ambiguities: [{
            description: '"the intro"',
            resolvedBy: 'assumption',
            chosen: 'first 12s',
          }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));

    const result = await tryKernelFirst('Schneide den Clip', {
      executeToolCalls: perCallSuccess(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn()
        .mockResolvedValueOnce(initialSnapshot)
        .mockResolvedValueOnce(finalSnapshot),
      storage: configuredStorage(),
      transaction: createTransactionMocks(),
    });

    if (!result.handled) throw new Error('expected a handled kernel turn');
    expect(result.report).toMatchObject({
      schemaVersion: 1,
      runId: 'run-1',
      outcome: 'verified',
      understood: {
        goals: [{ property: 'silence', operation: 'remove' }],
        preserve: ['sourceOrder'],
        assumptions: [{ name: 'minSilence', value: 0.4 }],
        ambiguities: [{ description: '"the intro"', chosen: 'first 12s' }],
      },
      verified: { matches: true, counts: { video: 2, audio: 1 } },
    });
    expect(result.report?.steps).toMatchObject([
      { stepId: 'step-1', tool: 'splitClip', capability: 'timeline.splitClip', status: 'ok' },
      { stepId: 'step-2', tool: 'moveClip', capability: 'timeline.moveClip', status: 'ok' },
    ]);
  });

  it('emits local progress stages while it works the turn', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(compiledResponse()))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    const stages: string[] = [];

    await tryKernelFirst('Schneide den Clip', {
      executeToolCalls: perCallSuccess(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn()
        .mockResolvedValueOnce(initialSnapshot)
        .mockResolvedValueOnce(finalSnapshot),
      onProgress: (event) => stages.push(event.stage),
      storage: configuredStorage(),
      transaction: createTransactionMocks(),
    });

    expect(stages).toEqual([
      'reading-timeline',
      'reading-transcript',
      'reading-audio',
      'compiling',
      'executing',
      'executing',
      'verifying',
      'committing',
    ]);
  });

  it('counts executing progress per resolved call', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(compiledResponse()))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    const executing: Array<{ current?: number; total?: number; detail?: string }> = [];

    await tryKernelFirst('Schneide den Clip', {
      executeToolCalls: perCallSuccess(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn()
        .mockResolvedValueOnce(initialSnapshot)
        .mockResolvedValueOnce(finalSnapshot),
      onProgress: (event) => {
        if (event.stage === 'executing') {
          executing.push({
            ...(event.current === undefined ? {} : { current: event.current }),
            ...(event.total === undefined ? {} : { total: event.total }),
            ...(event.detail === undefined ? {} : { detail: event.detail }),
          });
        }
      },
      storage: configuredStorage(),
      transaction: createTransactionMocks(),
    });

    expect(executing).toEqual([
      { current: 1, total: 2, detail: 'splitClip' },
      { current: 2, total: 2, detail: 'moveClip' },
    ]);
  });

  it('stops before any tool runs when the caller aborts during compile', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(async () => {
      controller.abort();
      return jsonResponse(compiledResponse());
    });
    const executeToolCalls = perCallSuccess();
    const transaction = createTransactionMocks();

    const result = await tryKernelFirst('Schneide den Clip', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      signal: controller.signal,
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toMatchObject({
      handled: true,
      message: expect.stringContaining('cancelled'),
    });
    expect(transaction.begin).not.toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rolls back instead of committing when the caller aborts mid-execution', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(compiledResponse()))
      .mockResolvedValueOnce(jsonResponse(completedResponse()));
    // Abort after the first resolved call has been applied.
    const executeToolCalls = vi.fn(async (
      calls: AIToolCallExecution[],
    ): Promise<AIToolCallExecutionResult[]> => {
      if (calls[0]?.tool === 'splitClip') controller.abort();
      return calls.map((call) => ({
        ...(call.id === undefined ? {} : { id: call.id }),
        tool: call.tool,
        result: { success: true },
      }));
    });
    const transaction = createTransactionMocks();

    const result = await tryKernelFirst('Schneide den Clip', {
      executeToolCalls,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      signal: controller.signal,
      storage: configuredStorage(),
      transaction,
    });

    expect(result).toMatchObject({ handled: true, runId: 'run-1' });
    expect(result).toMatchObject({
      report: { outcome: 'declined', decline: { reason: 'cancelled' } },
    });
    expect(executeToolCalls.mock.calls.map((call) => call[0]?.[0]?.tool)).toEqual(['splitClip']);
    expect(transaction.abort).toHaveBeenCalledWith(transaction.agentTransaction);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('translates a kernel decline reason into user-facing copy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      failures: ['no transcript index'],
      reason: 'storyPathNeedsMoments',
      runId: 'run-aborted',
      status: 'aborted',
    }));

    const result = await tryKernelFirst('Baue eine Story', {
      executeToolCalls: vi.fn(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      storage: configuredStorage(),
      transaction: createTransactionMocks(),
    });

    if (!result.handled) throw new Error('expected a handled decline');
    expect(result.message).toBe(
      'Story edits are built from what is actually said on screen, '
      + 'and this footage has no transcript yet. Transcribe the clip, then ask again.',
    );
    expect(result.report).toMatchObject({
      outcome: 'declined',
      runId: 'run-aborted',
      decline: { reason: 'storyPathNeedsMoments', detail: 'no transcript index' },
    });
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
