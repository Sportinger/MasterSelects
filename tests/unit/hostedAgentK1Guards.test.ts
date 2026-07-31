import { describe, expect, it } from 'vitest';
import {
  createHostedAgentK1RecordedBilling,
  createHostedAgentK1RecordedBridge,
  createHostedAgentK1ReplayProvider,
} from '../../functions/lib/hostedAgent/k1RecordReplay';
import { runHostedAgentK1 } from '../../functions/lib/hostedAgent/k1Runtime';
import type {
  HostedAgentEvent,
  HostedAgentK1TurnRequest,
} from '../../src/services/kernelClient/hostedAgent/contracts';

function request(
  maximumSpendCredits = 50,
  toolNames = ['getTimelineState'],
): HostedAgentK1TurnRequest {
  return {
    clientCapabilities: {
      maximumInlineResultCharacters: 1_000_000,
      supportsImageResultRefs: true,
      supportsNarrationDeltas: true,
      toolNames,
    },
    clientInstanceId: 'client-guard',
    historyFormatVersion: 'history-v1',
    maximumOutputTokens: 32_000,
    maxTurnSpendCredits: maximumSpendCredits,
    model: 'gpt-5-6-terra',
    modelPrompt: 'Exact history.',
    playbookPrompt: 'Inspect.',
    promptVersion: 'prompt-v1',
    providerInput: {
      input: [{ content: 'Exact history.', role: 'user' }],
      protocol: 'openai-responses',
      store: false,
      tools: toolNames.map((name) => ({
        description: name,
        name,
        parameters: {},
        strict: false,
        type: 'function',
      })),
    },
    reasoningEffort: 'medium',
    request: 'Inspect.',
    runSource: 'ui',
    systemPrompt: 'Exact system.',
    toolExecutionMode: 'read-only',
    toolSchemaVersion: 'tools-v1',
    turnId: 'turn-k1-guard',
    visualReferences: [],
  };
}

function runInput(overrides: {
  billing?: ReturnType<typeof createHostedAgentK1RecordedBilling>;
  bridge?: ReturnType<typeof createHostedAgentK1RecordedBridge>;
  events?: HostedAgentEvent[];
  maximumIterations?: number;
  maximumSpendCredits?: number;
  provider: ReturnType<typeof createHostedAgentK1ReplayProvider>;
  request?: HostedAgentK1TurnRequest;
}) {
  const turnRequest = overrides.request ?? request(overrides.maximumSpendCredits);
  const events = overrides.events ?? [];
  return {
    acceptedHistoryFormatVersion: 'history-v1',
    acceptedPromptVersion: 'prompt-v1',
    acceptedToolSchemaVersion: 'tools-v1',
    billing: overrides.billing ?? createHostedAgentK1RecordedBilling(),
    bridge: overrides.bridge ?? createHostedAgentK1RecordedBridge(async (batch) => ({
      authority: {
        approval: 'not-required',
        executionMode: 'read-only',
        policyChecked: true,
        stateRevisionAfter: '0',
        stateRevisionBefore: '0',
        validationPassed: true,
      },
      clientInstanceId: batch.clientInstanceId,
      results: batch.toolCalls.map((call) => ({
        modelContent: '{"success":true}',
        success: true,
        toolCallId: call.toolCallId,
      })),
      sequence: batch.sequence,
      sessionId: batch.sessionId,
      toolSchemaVersion: batch.toolSchemaVersion,
      turnId: batch.turnId,
    })),
    maximumIterations: overrides.maximumIterations ?? 400,
    maximumSpendCredits: overrides.maximumSpendCredits ?? turnRequest.maxTurnSpendCredits,
    onEvent(event: HostedAgentEvent) {
      events.push(event);
    },
    provider: overrides.provider,
    request: turnRequest,
    sessionId: 'session-k1-guard',
  };
}

describe('hosted-agent K1 runtime guards', () => {
  it('fails before a client tool batch when measured provider spend exceeds the turn budget', async () => {
    const provider = createHostedAgentK1ReplayProvider([{
      raw: {
        credits_consumed: 1,
        output: [{
          arguments: '{}',
          call_id: 'tool-1',
          name: 'getTimelineState',
          type: 'function_call',
        }],
      },
    }]);
    const billing = createHostedAgentK1RecordedBilling();
    const bridge = createHostedAgentK1RecordedBridge(async () => {
      throw new Error('The bridge must not run after failed settlement.');
    });
    const events: HostedAgentEvent[] = [];

    await expect(runHostedAgentK1(runInput({
      billing,
      bridge,
      events,
      maximumSpendCredits: 5,
      provider,
      request: request(5),
    }))).rejects.toThrow(/maximum spend/i);

    expect(provider.requests).toHaveLength(1);
    expect(bridge.requests).toHaveLength(0);
    expect(billing.completions).toHaveLength(0);
    expect(events.map((event) => event.kind)).toEqual([
      'session-ready',
      'turn-failed',
    ]);
  });

  it('uses the one supplied iteration authority and still completes explicitly after its grouped batch', async () => {
    const provider = createHostedAgentK1ReplayProvider([{
      raw: {
        credits_consumed: 0.5,
        output: [{
          arguments: '{}',
          call_id: 'tool-1',
          name: 'getTimelineState',
          type: 'function_call',
        }],
      },
    }]);
    const billing = createHostedAgentK1RecordedBilling();
    const result = await runHostedAgentK1(runInput({
      billing,
      maximumIterations: 1,
      provider,
    }));

    expect(provider.requests).toHaveLength(1);
    expect(billing.authorizations).toHaveLength(1);
    expect(billing.settlements).toHaveLength(1);
    expect(billing.completions).toEqual([{ turnId: 'turn-k1-guard' }]);
    expect(result).toMatchObject({
      creditsCharged: 3,
      providerRounds: 1,
      status: 'completed',
      toolBatches: 1,
    });
    expect(result.events.at(-1)?.kind).toBe('turn-complete');
  });

  it('rejects reordered client results instead of silently serializing a grouped tool batch', async () => {
    const provider = createHostedAgentK1ReplayProvider([{
      raw: {
        credits_consumed: 0,
        output: [
          {
            arguments: '{}',
            call_id: 'tool-1',
            name: 'getTimelineState',
            type: 'function_call',
          },
          {
            arguments: '{}',
            call_id: 'tool-2',
            name: 'captureFrame',
            type: 'function_call',
          },
        ],
      },
    }]);
    const bridge = createHostedAgentK1RecordedBridge(async (batch) => ({
      authority: {
        approval: 'not-required',
        executionMode: 'read-only',
        policyChecked: true,
        stateRevisionAfter: '0',
        stateRevisionBefore: '0',
        validationPassed: true,
      },
      clientInstanceId: batch.clientInstanceId,
      results: [
        { modelContent: '{}', success: true, toolCallId: 'tool-2' },
        { modelContent: '{}', success: true, toolCallId: 'tool-1' },
      ],
      sequence: batch.sequence,
      sessionId: batch.sessionId,
      toolSchemaVersion: batch.toolSchemaVersion,
      turnId: batch.turnId,
    }));

    await expect(runHostedAgentK1(runInput({
      bridge,
      provider,
      request: request(50, ['getTimelineState', 'captureFrame']),
    }))).rejects.toThrow(/invalid or reordered/i);
    expect(bridge.requests[0].toolCalls).toHaveLength(2);
    expect(provider.requests).toHaveLength(1);
  });
});
