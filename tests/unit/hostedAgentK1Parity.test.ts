import { describe, expect, it } from 'vitest';
import {
  createHostedAgentK1RecordedBilling,
  createHostedAgentK1RecordedBridge,
  createHostedAgentK1ReplayProvider,
} from '../../functions/lib/hostedAgent/k1RecordReplay';
import { runHostedAgentK1 } from '../../functions/lib/hostedAgent/k1Runtime';
import type { HostedAgentK1TurnRequest } from '../../src/services/kernelClient/hostedAgent/contracts';

const SYSTEM_PROMPT = 'EXACT_SYSTEM_PROMPT';
const MODEL_PROMPT = 'EXACT_FLATTENED_HISTORY_AND_REQUEST';

describe('hosted-agent K1 record/replay parity', () => {
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
    expect(result.events.filter((event) => event.kind === 'billing-settled')).toEqual([
      expect.objectContaining({
        creditBalance: 47,
        creditsCharged: 3,
        ledgerEntryId: 'recorded-ledger:hosted-agent:turn-k1-claude:0',
        roundIndex: 0,
        totalCreditsCharged: 3,
      }),
      expect.objectContaining({
        creditBalance: 44,
        creditsCharged: 3,
        ledgerEntryId: 'recorded-ledger:hosted-agent:turn-k1-claude:1',
        roundIndex: 1,
        totalCreditsCharged: 6,
      }),
    ]);
  });
});
