import { describe, expect, it, vi } from 'vitest';

import {
  cancelHostedAgentK2Session,
  runHostedAgentK2,
} from '../../functions/lib/hostedAgent/k2Runtime';
import { HostedAgentK2MemorySessionStore } from '../../functions/lib/hostedAgent/k2Session';
import {
  createHostedAgentK1RecordedBilling,
  createHostedAgentK1ReplayProvider,
} from '../../functions/lib/hostedAgent/k1RecordReplay';
import {
  HostedAgentK2ClientSession,
  HostedAgentK2InPageLedger,
  HostedAgentK2ReconnectableError,
  type HostedAgentK2BatchExecutor,
  type HostedAgentK2ClientTransport,
  type HostedAgentK1TurnRequest,
} from '../../src/services/kernelClient/hostedAgent';

const SESSION_ID = 'session-k2-reliability';
const TURN_ID = 'turn-k2-reliability';
const CLIENT_ID = 'client-k2-reliability';

function request(): HostedAgentK1TurnRequest {
  return {
    clientCapabilities: {
      maximumInlineResultCharacters: 2_000_000,
      supportsImageResultRefs: true,
      supportsNarrationDeltas: true,
      toolNames: ['getTimelineState'],
    },
    clientInstanceId: CLIENT_ID,
    historyFormatVersion: 'history-v1',
    maximumOutputTokens: 32_000,
    maxTurnSpendCredits: 50,
    model: 'gpt-5-6-terra',
    modelPrompt: 'Exact history.',
    playbookPrompt: 'Inspect first, then verify.',
    promptVersion: 'prompt-v1',
    providerInput: {
      input: [{ content: 'Exact history.', role: 'user' }],
      protocol: 'openai-responses',
      store: false,
      tools: [{
        description: 'Read the timeline.',
        name: 'getTimelineState',
        parameters: {},
        strict: false,
        type: 'function',
      }],
    },
    reasoningEffort: 'medium',
    request: 'Inspect the timeline.',
    runSource: 'ui',
    systemPrompt: 'Exact system.',
    toolExecutionMode: 'read-only',
    toolSchemaVersion: 'tools-v1',
    turnId: TURN_ID,
    visualReferences: [],
  };
}

function providerResponses() {
  return [{
    raw: {
      credits_consumed: 0.5,
      output: [
        {
          content: [{ text: 'I am inspecting the timeline.', type: 'output_text' }],
          role: 'assistant',
          type: 'message',
        },
        {
          arguments: '{}',
          call_id: 'tool-call-1',
          name: 'getTimelineState',
          type: 'function_call',
        },
      ],
    },
  }, {
    raw: {
      credits_consumed: 0.5,
      output: [{
        content: [{ text: 'The timeline is verified.', type: 'output_text' }],
        role: 'assistant',
        type: 'message',
      }],
    },
  }];
}

function toolEventFixture(sequence: number) {
  return {
    eventId: String(sequence + 1),
    kind: 'tool-batch-request' as const,
    roundIndex: sequence,
    sequence,
    sessionId: SESSION_ID,
    toolCalls: [{
      args: {},
      toolCallId: `tool-call-${sequence}`,
      toolName: 'getTimelineState',
    }],
    toolSchemaVersion: 'tools-v1',
    turnId: TURN_ID,
  };
}

async function createSession(
  sessions: HostedAgentK2MemorySessionStore,
  sessionId = SESSION_ID,
) {
  return sessions.createSession({
    activeLeaseMs: 30_000,
    clientInstanceId: CLIENT_ID,
    protectedState: {
      conversation: 'protected provider conversation',
    },
    sessionId,
    terminalTtlMs: 30_000,
    toolExecutionMode: 'read-only',
    toolSchemaVersion: 'tools-v1',
    turnId: TURN_ID,
  });
}

function boundTransport(
  sessions: HostedAgentK2MemorySessionStore,
  options: {
    duplicateFirstReplay?: boolean;
    failBeforeFirstPost?: boolean;
    failOncePerCursor?: boolean;
    failBeforeReplayCalls?: Set<number>;
    loseFirstAcceptedPostResponse?: boolean;
  } = {},
): HostedAgentK2ClientTransport {
  let replayCalls = 0;
  let postCalls = 0;
  let duplicateReturned = false;
  const failedCursors = new Set<string>();
  return {
    async cancel(input) {
      await sessions.cancel(input);
    },
    async interrupt(input) {
      await sessions.interruptForReload(input);
    },
    async postToolResults(input) {
      postCalls += 1;
      if (options.failBeforeFirstPost && postCalls === 1) {
        throw new HostedAgentK2ReconnectableError(
          'The result connection disconnected before posting.',
        );
      }
      const response = await sessions.postToolResults(input);
      const firstAcceptedPost = options.failBeforeFirstPost ? 2 : 1;
      if (
        options.loseFirstAcceptedPostResponse
        && postCalls === firstAcceptedPost
      ) {
        throw new HostedAgentK2ReconnectableError('The result acknowledgement was lost.');
      }
      return response;
    },
    async replayEvents(input) {
      replayCalls += 1;
      const cursorKey = input.afterEventId ?? '<start>';
      if (options.failOncePerCursor && !failedCursors.has(cursorKey)) {
        failedCursors.add(cursorKey);
        throw new HostedAgentK2ReconnectableError(
          'The event connection disconnected before this event boundary.',
        );
      }
      if (options.failBeforeReplayCalls?.has(replayCalls)) {
        throw new HostedAgentK2ReconnectableError(
          'The event connection disconnected before delivery.',
        );
      }
      if (
        options.duplicateFirstReplay
        && !duplicateReturned
        && input.afterEventId === '1'
      ) {
        duplicateReturned = true;
        return sessions.replayEvents({
          ...input,
          afterEventId: null,
          limit: 1,
        });
      }
      // A one-event lease models a disconnect after every delivered boundary.
      return sessions.replayEvents({ ...input, limit: 1 });
    },
  };
}

const execute: HostedAgentK2BatchExecutor = async (event) => ({
  authority: {
    approval: 'not-required',
    executionMode: 'read-only',
    policyChecked: true,
    stateRevisionAfter: 'revision-1',
    stateRevisionBefore: 'revision-1',
    validationPassed: true,
  },
  results: event.toolCalls.map((toolCall) => ({
    modelContent: '{"tracks":[],"clips":[]}',
    success: true,
    toolCallId: toolCall.toolCallId,
  })),
});

describe('hosted-agent K2 distributed-loop reliability', () => {
  it('deduplicates concurrent editor delivery and rejects a skipped mutating sequence', async () => {
    const ledger = new HostedAgentK2InPageLedger({
      clientInstanceId: CLIENT_ID,
      sessionId: SESSION_ID,
      toolSchemaVersion: 'tools-v1',
      turnId: TURN_ID,
    });
    const event = {
      ...toolEventFixture(0),
    };
    let finishExecution: (() => void) | undefined;
    const executeOnce = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishExecution = resolve;
      });
      return execute(event);
    });
    const first = ledger.executeOnce(event, executeOnce);
    const duplicate = ledger.executeOnce(event, executeOnce);
    await vi.waitFor(() => {
      expect(executeOnce).toHaveBeenCalledOnce();
    });
    finishExecution?.();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(firstResult).toEqual(duplicateResult);
    expect(ledger.completedBatchCount).toBe(1);
    await expect(ledger.executeOnce(toolEventFixture(2), execute)).rejects.toThrow(
      /skipped or reordered/i,
    );
  });

  it('restores a completed browser batch after reload without executing its mutations again', async () => {
    const firstLedger = new HostedAgentK2InPageLedger({
      clientInstanceId: CLIENT_ID,
      sessionId: SESSION_ID,
      toolSchemaVersion: 'tools-v1',
      turnId: TURN_ID,
    });
    const event = toolEventFixture(0);
    const completed = await firstLedger.executeOnce(event, execute);
    const restoredLedger = new HostedAgentK2InPageLedger({
      clientInstanceId: CLIENT_ID,
      completedBatches: [completed],
      sessionId: SESSION_ID,
      toolSchemaVersion: 'tools-v1',
      turnId: TURN_ID,
    });
    const duplicateExecution = vi.fn(execute);

    await expect(restoredLedger.executeOnce(event, duplicateExecution)).resolves.toEqual(completed);
    expect(duplicateExecution).not.toHaveBeenCalled();
    expect(restoredLedger.expectedSequence).toBe(1);
  });

  it('reconnects at every event boundary and replays a lost result acknowledgement exactly once', async () => {
    const sessions = new HostedAgentK2MemorySessionStore();
    const lease = await createSession(sessions);
    const provider = createHostedAgentK1ReplayProvider(providerResponses());
    const billing = createHostedAgentK1RecordedBilling();
    const executeSpy = vi.fn(execute);
    const runtime = runHostedAgentK2({
      acceptedHistoryFormatVersion: 'history-v1',
      acceptedPromptVersion: 'prompt-v1',
      acceptedToolSchemaVersion: 'tools-v1',
      billing,
      maximumIterations: 400,
      maximumSpendCredits: 50,
      provider,
      request: request(),
      sessionId: SESSION_ID,
      sessions,
    });
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      lease,
      toolSchemaVersion: 'tools-v1',
      transport: boundTransport(sessions, {
        duplicateFirstReplay: true,
        failBeforeFirstPost: true,
        failOncePerCursor: true,
        loseFirstAcceptedPostResponse: true,
      }),
      turnId: TURN_ID,
    });
    const deliveredKinds: string[] = [];
    const clientResult = await client.runUntilTerminal({
      execute: executeSpy,
      maximumReconnects: 20,
      onEvent: (event) => deliveredKinds.push(event.kind),
      reconnectDelayMs: 0,
    });
    const runtimeResult = await runtime;

    expect(clientResult.status).toBe('completed');
    expect(runtimeResult).toMatchObject({
      providerRounds: 2,
      status: 'completed',
      toolBatches: 1,
    });
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(client.ledger.completedBatchCount).toBe(1);
    expect(provider.requests).toHaveLength(2);
    expect(billing.authorizations.map((entry) => entry.roundIndex)).toEqual([0, 1]);
    expect(billing.settlements).toHaveLength(2);
    expect(billing.completions).toEqual([{ turnId: TURN_ID }]);
    expect(deliveredKinds).toEqual([
      'session-ready',
      'billing-settled',
      'narration-complete',
      'tool-batch-request',
      'billing-settled',
      'turn-complete',
    ]);
  });

  it('drains confirmed billing after client abort without executing later tool events', async () => {
    const controller = new AbortController();
    let canceled = false;
    const executeSpy = vi.fn(execute);
    const deliveredKinds: string[] = [];
    const lease = {
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      leaseToken: 'lease-cancel-drain',
      sessionId: SESSION_ID,
    };
    const transport: HostedAgentK2ClientTransport = {
      async cancel() {
        canceled = true;
      },
      async interrupt() {},
      async postToolResults() {
        throw new Error('No tool result should be posted after cancellation.');
      },
      async replayEvents(input) {
        const events = canceled
          ? [
              {
                creditBalance: 44,
                creditsCharged: 6,
                eventId: '2',
                kind: 'billing-settled' as const,
                ledgerEntryId: 'ledger-cancel-drain',
                roundIndex: 0,
                sessionId: SESSION_ID,
                totalCreditsCharged: 6,
                turnId: TURN_ID,
              },
              {
                eventId: '3',
                kind: 'turn-canceled' as const,
                message: 'Canceled after settlement.',
                recoverable: false,
                sessionId: SESSION_ID,
                turnId: TURN_ID,
              },
            ]
          : [{
              acceptedHistoryFormatVersion: 'history-v1',
              acceptedPromptVersion: 'prompt-v1',
              acceptedToolSchemaVersion: 'tools-v1',
              eventId: '1',
              kind: 'session-ready' as const,
              maximumIterations: 400,
              maximumSpendCredits: 50,
              sessionId: SESSION_ID,
              turnId: TURN_ID,
            }];
        return {
          cursor: events.at(-1)?.eventId ?? input.afterEventId,
          events,
          leaseExpiresAt: lease.expiresAt,
          sessionId: SESSION_ID,
          status: canceled ? 'cancelled' as const : 'active' as const,
          turnId: TURN_ID,
        };
      },
    };
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      lease,
      toolSchemaVersion: 'tools-v1',
      transport,
      turnId: TURN_ID,
    });

    await expect(client.runUntilTerminal({
      execute: executeSpy,
      onEvent: (event) => {
        deliveredKinds.push(event.kind);
        if (event.kind === 'session-ready') controller.abort();
      },
      reconnectDelayMs: 0,
      signal: controller.signal,
    })).rejects.toBeDefined();

    expect(executeSpy).not.toHaveBeenCalled();
    expect(deliveredKinds).toEqual(['session-ready', 'billing-settled', 'turn-canceled']);
    expect(client.status).toBe('cancelled');
  });

  it('still performs the accounting drain when abort happens during the reconnect pause', async () => {
    const controller = new AbortController();
    let canceled = false;
    const deliveredKinds: string[] = [];
    const lease = {
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      leaseToken: 'lease-reconnect-pause',
      sessionId: SESSION_ID,
    };
    const transport: HostedAgentK2ClientTransport = {
      async cancel() {
        canceled = true;
      },
      async interrupt() {},
      async postToolResults() {},
      async replayEvents(input) {
        const events = canceled
          ? [{
              creditBalance: 48,
              creditsCharged: 2,
              eventId: '2',
              kind: 'billing-settled' as const,
              ledgerEntryId: 'ledger-reconnect-pause',
              roundIndex: 0,
              sessionId: SESSION_ID,
              totalCreditsCharged: 2,
              turnId: TURN_ID,
            }, {
              eventId: '3',
              kind: 'turn-canceled' as const,
              message: 'Canceled during reconnect pause.',
              recoverable: false,
              sessionId: SESSION_ID,
              turnId: TURN_ID,
            }]
          : [{
              acceptedHistoryFormatVersion: 'history-v1',
              acceptedPromptVersion: 'prompt-v1',
              acceptedToolSchemaVersion: 'tools-v1',
              eventId: '1',
              kind: 'session-ready' as const,
              maximumIterations: 400,
              maximumSpendCredits: 50,
              sessionId: SESSION_ID,
              turnId: TURN_ID,
            }];
        return {
          cursor: events.at(-1)?.eventId ?? input.afterEventId,
          events,
          leaseExpiresAt: lease.expiresAt,
          sessionId: SESSION_ID,
          status: canceled ? 'cancelled' as const : 'active' as const,
          turnId: TURN_ID,
        };
      },
    };
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      lease,
      toolSchemaVersion: 'tools-v1',
      transport,
      turnId: TURN_ID,
    });
    const run = client.runUntilTerminal({
      execute,
      onEvent: (event) => deliveredKinds.push(event.kind),
      reconnectDelayMs: 100,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(deliveredKinds).toEqual(['session-ready']));
    controller.abort();

    await expect(run).rejects.toBeDefined();
    expect(deliveredKinds).toEqual(['session-ready', 'billing-settled', 'turn-canceled']);
  });

  it('cancels during provider wait and prevents every later authorization and tool request', async () => {
    const sessions = new HostedAgentK2MemorySessionStore();
    const lease = await createSession(sessions);
    const billing = createHostedAgentK1RecordedBilling();
    const providerRequests: unknown[] = [];
    const runtime = runHostedAgentK2({
      acceptedHistoryFormatVersion: 'history-v1',
      acceptedPromptVersion: 'prompt-v1',
      acceptedToolSchemaVersion: 'tools-v1',
      billing,
      maximumIterations: 400,
      maximumSpendCredits: 50,
      provider: {
        async complete(providerRequest, signal) {
          providerRequests.push(providerRequest);
          return new Promise((resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(signal.reason);
            }, { once: true });
          });
        },
      },
      request: request(),
      sessionId: SESSION_ID,
      sessions,
    });

    await vi.waitFor(() => {
      expect(billing.authorizations).toHaveLength(1);
    });
    const cancelBilling = vi.fn(async () => {});
    await cancelHostedAgentK2Session({
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      onCancelBilling: cancelBilling,
      sessionId: SESSION_ID,
      sessions,
      turnId: TURN_ID,
    });

    await expect(runtime).resolves.toEqual({ status: 'cancelled' });
    expect(providerRequests).toHaveLength(1);
    expect(billing.authorizations).toHaveLength(1);
    expect(billing.settlements).toHaveLength(0);
    expect(billing.completions).toHaveLength(0);
    expect(cancelBilling).toHaveBeenCalledOnce();
    expect(sessions.getStatus(SESSION_ID)).toBe('cancelled');
    const replay = await sessions.replayEvents({
      afterEventId: null,
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    });
    expect(replay.events.map((event) => event.kind)).toEqual([
      'session-ready',
      'turn-canceled',
    ]);
  });

  it('settles already-finished non-abortable provider work but stops before tools or another authorization', async () => {
    const sessions = new HostedAgentK2MemorySessionStore();
    const lease = await createSession(sessions);
    const billing = createHostedAgentK1RecordedBilling();
    let resolveProvider: ((response: { raw: unknown }) => void) | undefined;
    const runtime = runHostedAgentK2({
      acceptedHistoryFormatVersion: 'history-v1',
      acceptedPromptVersion: 'prompt-v1',
      acceptedToolSchemaVersion: 'tools-v1',
      billing,
      maximumIterations: 400,
      maximumSpendCredits: 50,
      provider: {
        async complete() {
          return new Promise((resolve) => {
            resolveProvider = resolve;
          });
        },
      },
      request: request(),
      sessionId: SESSION_ID,
      sessions,
    });
    await vi.waitFor(() => {
      expect(billing.authorizations).toHaveLength(1);
      expect(resolveProvider).toBeTypeOf('function');
    });
    await sessions.cancel({
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    });
    resolveProvider?.(providerResponses()[0]);

    await expect(runtime).resolves.toEqual({ status: 'cancelled' });
    expect(billing.authorizations.map((entry) => entry.roundIndex)).toEqual([0]);
    expect(billing.settlements).toHaveLength(1);
    expect(billing.completions).toHaveLength(0);
    const replay = await sessions.replayEvents({
      afterEventId: null,
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    });
    expect(replay.events.some((event) => event.kind === 'tool-batch-request')).toBe(false);
  });

  it('cancels while waiting for a tool result, accepts an honestly finished batch, and never authorizes round two', async () => {
    const sessions = new HostedAgentK2MemorySessionStore();
    const lease = await createSession(sessions);
    const billing = createHostedAgentK1RecordedBilling();
    const provider = createHostedAgentK1ReplayProvider([providerResponses()[0]]);
    const runtime = runHostedAgentK2({
      acceptedHistoryFormatVersion: 'history-v1',
      acceptedPromptVersion: 'prompt-v1',
      acceptedToolSchemaVersion: 'tools-v1',
      billing,
      maximumIterations: 400,
      maximumSpendCredits: 50,
      provider,
      request: request(),
      sessionId: SESSION_ID,
      sessions,
    });
    await vi.waitFor(async () => {
      const replay = await sessions.replayEvents({
        afterEventId: null,
        clientInstanceId: CLIENT_ID,
        leaseToken: lease.leaseToken,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      });
      expect(replay.events.some((event) => event.kind === 'tool-batch-request')).toBe(true);
    });
    const replay = await sessions.replayEvents({
      afterEventId: null,
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    });
    const toolEvent = replay.events.find(
      (event): event is Extract<typeof event, { kind: 'tool-batch-request' }> => (
        event.kind === 'tool-batch-request'
      ),
    );
    expect(toolEvent).toBeDefined();
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      lease,
      toolSchemaVersion: 'tools-v1',
      transport: boundTransport(sessions),
      turnId: TURN_ID,
    });
    let finishToolExecution: (() => void) | undefined;
    const activeToolExecution = client.ledger.executeOnce(toolEvent!, async (event) => {
      await new Promise<void>((resolve) => {
        finishToolExecution = resolve;
      });
      return execute(event);
    });
    await vi.waitFor(() => {
      expect(finishToolExecution).toBeTypeOf('function');
    });
    await sessions.cancel({
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    });
    finishToolExecution?.();
    const batch = await activeToolExecution;
    const accepted = await sessions.postToolResults({
      batch,
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    });

    expect(accepted.status).toBe('cancelled');
    await expect(runtime).resolves.toEqual({ status: 'cancelled' });
    expect(billing.authorizations.map((entry) => entry.roundIndex)).toEqual([0]);
    expect(billing.settlements).toHaveLength(1);
    expect(billing.completions).toHaveLength(0);
  });
});
