import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHostedAgentK1RecordedBilling,
  createHostedAgentK1RecordedBridge,
  createHostedAgentK1ReplayProvider,
} from '../../functions/lib/hostedAgent/k1RecordReplay';
import { runHostedAgentK1 } from '../../functions/lib/hostedAgent/k1Runtime';
import type {
  HostedAgentK1ToolResult,
  HostedAgentK1TurnRequest,
} from '../../src/services/kernelClient/hostedAgent/contracts';

const aiToolMocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('../../src/services/aiTools', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/aiTools')>(),
  executeAIToolCalls: aiToolMocks.execute,
}));

import { sendFlashBoardChatMessage } from '../../src/services/flashboard/FlashBoardChatService';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const SYSTEM_PROMPT = 'EXACT_SYSTEM_PROMPT';
const MODEL_PROMPT = 'EXACT_FLATTENED_HISTORY_AND_REQUEST';

interface FixtureState {
  clipStart: number;
  revision: number;
}

interface ToolInvocation {
  args: Record<string, unknown>;
  id: string;
  tool: string;
}

function applyFixtureCalls(
  state: FixtureState,
  calls: ToolInvocation[],
): Array<{ id: string; result: { data?: unknown; error?: string; success: boolean } }> {
  return calls.map((call) => {
    if (call.tool === 'getTimelineState') {
      return {
        id: call.id,
        result: {
          data: { clips: [{ id: 'clip-1', start: state.clipStart }] },
          success: true,
        },
      };
    }
    if (call.tool === 'captureFrame') {
      return {
        id: call.id,
        result: {
          data: {
            capturedAt: 2,
            dataUrl: DATA_URL,
            height: 180,
            width: 320,
          },
          success: true,
        },
      };
    }
    if (call.tool === 'moveClip') {
      state.clipStart = Number(call.args.startTime);
      state.revision += 1;
      return {
        id: call.id,
        result: {
          data: { clipId: 'clip-1', start: state.clipStart },
          success: true,
        },
      };
    }
    return {
      id: call.id,
      result: { error: `Unexpected tool ${call.tool}`, success: false },
    };
  });
}

function openAiFixtureResponses(): unknown[] {
  return [
    {
      credits_consumed: 1,
      output: [
        {
          content: [{ text: 'I will inspect the timeline and frame.', type: 'output_text' }],
          type: 'message',
        },
        {
          arguments: '{}',
          call_id: 'timeline-1',
          name: 'getTimelineState',
          type: 'function_call',
        },
        {
          arguments: '{"time":2}',
          call_id: 'frame-1',
          name: 'captureFrame',
          type: 'function_call',
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    },
    {
      credits_consumed: 1,
      output: [
        {
          content: [{ text: 'The approach is to move the clip.', type: 'output_text' }],
          type: 'message',
        },
        {
          arguments: '{"clipId":"clip-1","startTime":4}',
          call_id: 'move-1',
          name: 'moveClip',
          type: 'function_call',
        },
      ],
      usage: { input_tokens: 180, output_tokens: 20 },
    },
    {
      credits_consumed: 1,
      output: [{
        content: [{ text: 'Moved clip-1 to 4 seconds and verified the result.', type: 'output_text' }],
        type: 'message',
      }],
      usage: { input_tokens: 220, output_tokens: 16 },
    },
  ];
}

function gatewayEnvelope(data: unknown): Response {
  return new Response(JSON.stringify({
    creditBalance: 100,
    data,
    kind: 'ai.chat',
    mode: 'hosted',
    ok: true,
    provider: 'kie.ai',
    requestId: 'fixture-request',
    status: 'completed',
  }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

function providerBodyFromDirect(body: Record<string, unknown>): Record<string, unknown> {
  const {
    billingRoundIndex: _billingRoundIndex,
    billingTurnAction: _billingTurnAction,
    billingTurnId: _billingTurnId,
    idempotencyKey: _idempotencyKey,
    protocol: _protocol,
    ...providerBody
  } = body;
  return providerBody;
}

afterEach(() => {
  aiToolMocks.execute.mockReset();
  vi.unstubAllGlobals();
});

describe('hosted-agent K1 record/replay parity', () => {
  it('matches the legacy-direct OpenAI round bodies, grouped calls, narration, spend, and final state', async () => {
    const responses = openAiFixtureResponses();
    const directState: FixtureState = { clipStart: 0, revision: 0 };
    const directExecuted: Array<{
      modelContent: string;
      result: { data?: unknown; error?: string; success: boolean };
      toolCall: { arguments: string; id: string; name: string };
    }> = [];
    const directNarration: Array<{ roundIndex: number; text: string }> = [];
    const directBodies: Record<string, unknown>[] = [];
    const directCompletionBodies: Record<string, unknown>[] = [];
    let providerCursor = 0;

    aiToolMocks.execute.mockImplementation(async (calls: ToolInvocation[]) => (
      applyFixtureCalls(directState, calls)
    ));
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const body = requestBody.body && typeof requestBody.body === 'object'
        ? requestBody.body as Record<string, unknown>
        : requestBody;
      if (body.billingTurnAction === 'complete') {
        directCompletionBodies.push(body);
        return gatewayEnvelope({
          terminalReason: 'explicit_complete',
          terminalStatus: 'completed',
        });
      }
      directBodies.push(body);
      const response = responses[providerCursor];
      providerCursor += 1;
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }));

    const directMessage = await sendFlashBoardChatMessage({
      hostedAvailable: false,
      kieAiApiKey: 'test-byo-key',
      idempotencyKey: 'turn-k1-parity',
      model: 'gpt-5-6-terra',
      onActivityEvent(event) {
        if (event.kind === 'narration') {
          directNarration.push({ roundIndex: event.roundIndex, text: event.text });
        }
      },
      onExecutedToolCalls(calls) {
        directExecuted.push(...calls);
      },
      playbookPrompt: 'Move the inspected clip.',
      prompt: MODEL_PROMPT,
      provider: 'kie',
      systemPromptIncludeContext: false,
      systemPromptIncludePlaybook: false,
      systemPromptOverride: SYSTEM_PROMPT,
      temperature: 0.7,
      toolExecutionMode: 'normal',
    });

    expect(directBodies).toHaveLength(3);
    expect(directCompletionBodies).toEqual([]);
    expect(aiToolMocks.execute.mock.calls.map((call) => call[0].length)).toEqual([2, 1]);
    expect(directState).toEqual({ clipStart: 4, revision: 1 });

    const firstDirectProviderBody = providerBodyFromDirect(directBodies[0]);
    const directTools = firstDirectProviderBody.tools as Array<Record<string, unknown>>;
    const directInput = firstDirectProviderBody.input as unknown[];
    const directById = new Map(
      directExecuted.map((entry) => [entry.toolCall.id, entry]),
    );
    const hostedState: FixtureState = { clipStart: 0, revision: 0 };
    const provider = createHostedAgentK1ReplayProvider(
      responses.map((raw) => ({ raw })),
    );
    const bridge = createHostedAgentK1RecordedBridge(async (batch) => {
      const revisionBefore = String(hostedState.revision);
      applyFixtureCalls(
        hostedState,
        batch.toolCalls.map((call) => ({
          args: call.args as Record<string, unknown>,
          id: call.toolCallId,
          tool: call.toolName,
        })),
      );
      const results: HostedAgentK1ToolResult[] = batch.toolCalls.map((call) => {
        const direct = directById.get(call.toolCallId);
        if (!direct) {
          throw new Error(`Missing direct result for ${call.toolCallId}`);
        }
        return {
          error: direct.result.error,
          modelContent: direct.modelContent,
          providerContent: call.toolCallId === 'frame-1'
            ? {
                openAiFollowupInput: [{
                  content: [
                    { text: 'Visual output from captureFrame:', type: 'input_text' },
                    { detail: 'high', image_url: DATA_URL, type: 'input_image' },
                  ],
                  role: 'user',
                }],
              }
            : undefined,
          success: direct.result.success,
          toolCallId: call.toolCallId,
        };
      });
      return {
        authority: {
          approval: 'not-required',
          executionMode: 'normal',
          groupedTransactionId: `group-${batch.sequence}`,
          policyChecked: true,
          stateRevisionAfter: String(hostedState.revision),
          stateRevisionBefore: revisionBefore,
          validationPassed: true,
        },
        clientInstanceId: batch.clientInstanceId,
        results,
        sequence: batch.sequence,
        sessionId: batch.sessionId,
        toolSchemaVersion: batch.toolSchemaVersion,
        turnId: batch.turnId,
      };
    });
    const billing = createHostedAgentK1RecordedBilling();
    const request: HostedAgentK1TurnRequest = {
      clientCapabilities: {
        maximumInlineResultCharacters: 32 * 1024 * 1024,
        supportsImageResultRefs: true,
        supportsNarrationDeltas: true,
        toolNames: directTools.map((tool) => String(tool.name)),
      },
      clientInstanceId: 'client-parity',
      contextSummary: 'EXACT_CAPTURED_CONTEXT',
      historyFormatVersion: 'history-v1',
      maximumOutputTokens: Number(firstDirectProviderBody.max_output_tokens),
      maxTurnSpendCredits: 100,
      model: String(firstDirectProviderBody.model),
      modelPrompt: MODEL_PROMPT,
      playbookPrompt: 'Move the inspected clip.',
      promptVersion: 'prompt-v1',
      providerInput: {
        input: directInput,
        protocol: 'openai-responses',
        store: false,
        toolChoice: firstDirectProviderBody.tool_choice,
        tools: directTools,
      },
      reasoningEffort: (
        firstDirectProviderBody.reasoning as { effort: HostedAgentK1TurnRequest['reasoningEffort'] }
      ).effort,
      request: 'Move the inspected clip.',
      runSource: 'ui',
      systemPrompt: SYSTEM_PROMPT,
      toolExecutionMode: 'normal',
      toolSchemaVersion: 'tools-v1',
      turnId: 'turn-k1-parity',
      visualReferences: [],
    };

    const hosted = await runHostedAgentK1({
      acceptedHistoryFormatVersion: 'history-v1',
      acceptedPromptVersion: 'prompt-v1',
      acceptedToolSchemaVersion: 'tools-v1',
      billing,
      bridge,
      maximumIterations: 400,
      maximumSpendCredits: 100,
      provider,
      request,
      sessionId: 'session-k1-parity',
    });

    expect(provider.requests.map((round) => round.body))
      .toEqual(directBodies.map(providerBodyFromDirect));
    expect(bridge.requests.map((batch) => (
      batch.toolCalls.map((call) => ({
        args: call.args,
        id: call.toolCallId,
        tool: call.toolName,
      }))
    ))).toEqual(
      aiToolMocks.execute.mock.calls.map((call) => call[0]),
    );
    expect(hostedState).toEqual(directState);
    expect(hosted.finalMessage).toBe(directMessage);
    expect(hosted.providerRounds).toBe(3);
    expect(hosted.toolBatches).toBe(2);
    expect(hosted.creditsCharged).toBe(18);
    expect(billing.authorizations.map((round) => round.roundIndex)).toEqual([0, 1, 2]);
    expect(billing.settlements.map((round) => round.roundIndex)).toEqual([0, 1, 2]);
    expect(billing.completions).toEqual([{ turnId: 'turn-k1-parity' }]);
    expect(hosted.events
      .filter((event) => event.kind === 'narration-complete')
      .map((event) => ({ roundIndex: event.roundIndex, text: event.text })))
      .toEqual(directNarration);
    expect(hosted.events.map((event) => event.kind)).toEqual([
      'session-ready',
      'narration-complete',
      'tool-batch-request',
      'narration-complete',
      'tool-batch-request',
      'turn-complete',
    ]);
  });

  it('preserves Claude messages, grouped tool results, and initial visual input', async () => {
    const imageBase64 = 'iVBORw0KGgo=';
    const request: HostedAgentK1TurnRequest = {
      clientCapabilities: {
        maximumInlineResultCharacters: 1_000_000,
        supportsImageResultRefs: true,
        supportsNarrationDeltas: true,
        toolNames: ['getTimelineState', 'captureFrame'],
      },
      clientInstanceId: 'client-claude',
      historyFormatVersion: 'history-v1',
      maximumOutputTokens: 32_000,
      maxTurnSpendCredits: 50,
      model: 'claude-opus-4-8',
      modelPrompt: MODEL_PROMPT,
      playbookPrompt: 'Inspect visually.',
      promptVersion: 'prompt-v1',
      providerInput: {
        messages: [{
          content: [
            { text: MODEL_PROMPT, type: 'text' },
            {
              source: { data: imageBase64, media_type: 'image/png', type: 'base64' },
              type: 'image',
            },
          ],
          role: 'user',
        }],
        protocol: 'claude-messages',
        tools: [
          { description: 'Timeline', input_schema: {}, name: 'getTimelineState' },
          { description: 'Frame', input_schema: {}, name: 'captureFrame' },
        ],
      },
      request: 'Inspect visually.',
      runSource: 'ui',
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.7,
      toolExecutionMode: 'read-only',
      toolSchemaVersion: 'tools-v1',
      turnId: 'turn-k1-claude',
      visualReferences: [{
        id: 'initial-frame',
        mediaType: 'image/png',
        role: 'initial',
        source: imageBase64,
        transport: 'data-url',
      }],
    };
    const provider = createHostedAgentK1ReplayProvider([
      {
        raw: {
          content: [
            { text: 'I will inspect both sources.', type: 'text' },
            { id: 'timeline-c', input: {}, name: 'getTimelineState', type: 'tool_use' },
            { id: 'frame-c', input: { time: 2 }, name: 'captureFrame', type: 'tool_use' },
          ],
          credits_consumed: 0.5,
        },
      },
      {
        raw: {
          content: [{ text: 'The visual inspection is complete.', type: 'text' }],
          credits_consumed: 0.5,
        },
      },
    ]);
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
      results: batch.toolCalls.map((call) => ({
        modelContent: `{"success":true,"tool":"${call.toolName}"}`,
        providerContent: call.toolName === 'captureFrame'
          ? {
              claudeToolResultContent: [
                {
                  source: { data: imageBase64, media_type: 'image/png', type: 'base64' },
                  type: 'image',
                },
                { text: '{"success":true,"tool":"captureFrame"}', type: 'text' },
              ],
            }
          : undefined,
        success: true,
        toolCallId: call.toolCallId,
      })),
      sequence: batch.sequence,
      sessionId: batch.sessionId,
      toolSchemaVersion: batch.toolSchemaVersion,
      turnId: batch.turnId,
    }));

    const result = await runHostedAgentK1({
      acceptedHistoryFormatVersion: 'history-v1',
      acceptedPromptVersion: 'prompt-v1',
      acceptedToolSchemaVersion: 'tools-v1',
      billing: createHostedAgentK1RecordedBilling(),
      bridge,
      maximumIterations: 400,
      maximumSpendCredits: 50,
      provider,
      request,
      sessionId: 'session-k1-claude',
    });

    expect(bridge.requests[0].toolCalls).toHaveLength(2);
    expect(provider.requests[0].body).toMatchObject({
      max_tokens: 32_000,
      messages: request.providerInput.messages,
      model: 'claude-opus-4-8',
      system: SYSTEM_PROMPT,
      temperature: 0.7,
      tools: request.providerInput.tools,
    });
    const secondMessages = provider.requests[1].body.messages as Array<Record<string, unknown>>;
    expect(secondMessages.at(-2)).toMatchObject({
      role: 'assistant',
      content: expect.arrayContaining([
        expect.objectContaining({ id: 'timeline-c', type: 'tool_use' }),
        expect.objectContaining({ id: 'frame-c', type: 'tool_use' }),
      ]),
    });
    expect(secondMessages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.arrayContaining([
        expect.objectContaining({ tool_use_id: 'timeline-c', type: 'tool_result' }),
        expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'image' }),
          ]),
          tool_use_id: 'frame-c',
          type: 'tool_result',
        }),
      ]),
    });
    expect(result).toMatchObject({
      creditsCharged: 6,
      finalMessage: 'The visual inspection is complete.',
      providerRounds: 2,
      toolBatches: 1,
    });
  });
});
