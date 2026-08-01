import { extractKieChatProviderUsage } from '../chatBilling';
import {
  appendHostedAgentK1RoundToConversation,
  buildHostedAgentK1ProviderBody,
  createHostedAgentK1ConversationState,
  parseHostedAgentK1ProviderRound,
  type HostedAgentK1Provider,
} from './k1Provider';
import {
  HOSTED_AGENT_K1_PROTOCOL_VERSION,
  hostedAgentRoundIdempotencyKey,
  type HostedAgentEvent,
  type HostedAgentK1ProviderRoundRequest,
  type HostedAgentK1RoundUsage,
  type HostedAgentK1RuntimeResult,
  type HostedAgentK1ToolBatchResult,
  type HostedAgentK1TurnRequest,
  type HostedAgentProviderProtocol,
} from '../../../src/services/kernelClient/hostedAgent/contracts';

export interface HostedAgentK1BillingPort {
  authorizeRound(input: {
    idempotencyKey: string;
    maximumIterations: number;
    maximumSpendCredits: number;
    model: string;
    providerProtocol: HostedAgentProviderProtocol;
    roundIndex: number;
    turnId: string;
  }): Promise<void>;
  completeTurn(input: {
    turnId: string;
  }): Promise<{
    creditsCharged: number;
  }>;
  settleRound(input: {
    idempotencyKey: string;
    providerResultDigest: string;
    roundIndex: number;
    turnId: string;
    usage: HostedAgentK1RoundUsage;
  }): Promise<{
    creditBalance: number;
    creditsCharged: number;
    ledgerEntryId: string | null;
    replayed: boolean;
    totalCreditsCharged: number;
  }>;
}

export interface HostedAgentK1ClientBridge {
  executeToolBatch(input: {
    clientInstanceId: string;
    roundIndex: number;
    sequence: number;
    sessionId: string;
    toolCalls: Array<{
      args: unknown;
      arguments: string;
      toolCallId: string;
      toolName: string;
    }>;
    toolExecutionMode: HostedAgentK1TurnRequest['toolExecutionMode'];
    toolSchemaVersion: string;
    turnId: string;
  }): Promise<HostedAgentK1ToolBatchResult>;
}

export interface RunHostedAgentK1Input {
  acceptedHistoryFormatVersion: string;
  acceptedPromptVersion: string;
  acceptedToolSchemaVersion: string;
  billing: HostedAgentK1BillingPort;
  bridge: HostedAgentK1ClientBridge;
  maximumIterations: number;
  maximumSpendCredits: number;
  onEvent?: (event: HostedAgentEvent) => void;
  provider: HostedAgentK1Provider;
  request: HostedAgentK1TurnRequest;
  sessionId: string;
  signal?: AbortSignal;
}

type HostedAgentEventPayload<T = HostedAgentEvent> = T extends HostedAgentEvent
  ? Omit<T, 'eventId' | 'sessionId' | 'turnId'>
  : never;

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Hosted-agent turn stopped.', 'AbortError');
  }
}

function inferNarrationPhase(
  roundIndex: number,
  narration: string,
): 'inspecting' | 'planning' | 'acting' | 'verifying' {
  if (/\b(verif|check(?:ing|ed)? the result|confirm(?:ing|ed)?)\b/i.test(narration)) {
    return 'verifying';
  }
  if (/\b(plan|approach|option|strategy)\b/i.test(narration)) {
    return 'planning';
  }
  return roundIndex === 0 ? 'inspecting' : 'acting';
}

function providerToolNames(request: HostedAgentK1TurnRequest): string[] {
  return request.providerInput.tools
    .map((tool) => {
      if (typeof tool !== 'object' || tool === null) {
        return null;
      }
      const record = tool as Record<string, unknown>;
      if (typeof record.name === 'string') {
        return record.name;
      }
      const nested = record.function;
      return typeof nested === 'object'
        && nested !== null
        && typeof (nested as Record<string, unknown>).name === 'string'
        ? String((nested as Record<string, unknown>).name)
        : null;
    })
    .filter((name): name is string => name !== null);
}

function assertRuntimeContract(input: RunHostedAgentK1Input): HostedAgentProviderProtocol {
  const { request } = input;
  if (
    request.promptVersion !== input.acceptedPromptVersion
    || request.historyFormatVersion !== input.acceptedHistoryFormatVersion
    || request.toolSchemaVersion !== input.acceptedToolSchemaVersion
  ) {
    throw new Error('The hosted-agent prompt, history, or tool schema version is incompatible.');
  }
  if (
    !Number.isInteger(input.maximumIterations)
    || input.maximumIterations <= 0
    || input.maximumIterations > 400
    || !Number.isInteger(input.maximumSpendCredits)
    || input.maximumSpendCredits <= 0
    || !Number.isInteger(request.maximumOutputTokens)
    || request.maximumOutputTokens <= 0
    || request.maximumOutputTokens > 32_000
  ) {
    throw new Error('The hosted-agent runtime limits are invalid.');
  }
  if (request.maxTurnSpendCredits !== input.maximumSpendCredits) {
    throw new Error('The hosted-agent client and server maximum-spend contracts differ.');
  }
  const expectedTools = new Set(request.clientCapabilities.toolNames);
  const actualTools = providerToolNames(request);
  if (
    expectedTools.size !== actualTools.length
    || actualTools.some((toolName) => !expectedTools.has(toolName))
  ) {
    throw new Error('The hosted-agent provider tools do not match the client capability contract.');
  }
  const serializedProviderInput = JSON.stringify(request.providerInput);
  if (
    request.visualReferences.some((reference) => (
      !serializedProviderInput.includes(reference.source)
    ))
  ) {
    throw new Error('A hosted-agent visual reference is absent from the exact provider input.');
  }
  return request.providerInput.protocol;
}

function exactToolResultBatch(
  batch: HostedAgentK1ToolBatchResult,
  expected: {
    clientInstanceId: string;
    sequence: number;
    sessionId: string;
    toolCallIds: string[];
    toolExecutionMode: HostedAgentK1TurnRequest['toolExecutionMode'];
    toolSchemaVersion: string;
    turnId: string;
  },
): void {
  const resultIds = batch.results.map((result) => result.toolCallId);
  if (
    batch.clientInstanceId !== expected.clientInstanceId
    || batch.sequence !== expected.sequence
    || batch.sessionId !== expected.sessionId
    || batch.turnId !== expected.turnId
    || batch.toolSchemaVersion !== expected.toolSchemaVersion
    || batch.authority.policyChecked !== true
    || batch.authority.executionMode !== expected.toolExecutionMode
    || typeof batch.authority.stateRevisionBefore !== 'string'
    || typeof batch.authority.stateRevisionAfter !== 'string'
    || resultIds.length !== expected.toolCallIds.length
    || resultIds.some((id, index) => id !== expected.toolCallIds[index])
    || new Set(resultIds).size !== resultIds.length
  ) {
    throw new Error('The client-authoritative hosted-agent batch result is invalid or reordered.');
  }
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value) ?? 'null');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toUsage(raw: unknown): HostedAgentK1RoundUsage {
  const usage = extractKieChatProviderUsage(raw);
  return {
    cachedInputTokens: usage.cachedInputTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    providerCredits: usage.providerCredits,
    reasoningTokens: usage.reasoningTokens,
    toolCallCount: usage.toolCallCount,
  };
}

function fallbackMessage(
  results: Array<{ error?: string; success: boolean; toolName: string }>,
): string {
  if (results.length === 0) {
    return 'Done.';
  }
  return results
    .map((result) => result.success
      ? `${result.toolName}: done.`
      : `${result.toolName}: ${result.error ?? 'failed.'}`)
    .join('\n');
}

export async function runHostedAgentK1(
  input: RunHostedAgentK1Input,
): Promise<HostedAgentK1RuntimeResult> {
  const providerProtocol = assertRuntimeContract(input);
  const conversation = createHostedAgentK1ConversationState(input.request);
  const events: HostedAgentEvent[] = [];
  const completedBatches: HostedAgentK1ToolBatchResult[] = [];
  const completedToolOutcomes: Array<{
    error?: string;
    success: boolean;
    toolName: string;
  }> = [];
  let nextEventId = 1;
  let sequence = 0;
  let providerRounds = 0;
  let totalCreditsCharged = 0;

  const emit = (event: HostedAgentEventPayload): void => {
    const completeEvent = {
      ...event,
      eventId: String(nextEventId),
      sessionId: input.sessionId,
      turnId: input.request.turnId,
    } as HostedAgentEvent;
    nextEventId += 1;
    events.push(completeEvent);
    input.onEvent?.(completeEvent);
  };

  emit({
    acceptedHistoryFormatVersion: input.acceptedHistoryFormatVersion,
    acceptedPromptVersion: input.acceptedPromptVersion,
    acceptedToolSchemaVersion: input.acceptedToolSchemaVersion,
    kind: 'session-ready',
    maximumIterations: input.maximumIterations,
    maximumSpendCredits: input.maximumSpendCredits,
  });

  try {
    for (let roundIndex = 0; roundIndex < input.maximumIterations; roundIndex += 1) {
      abortIfNeeded(input.signal);
      const idempotencyKey = hostedAgentRoundIdempotencyKey(input.request.turnId, roundIndex);
      await input.billing.authorizeRound({
        idempotencyKey,
        maximumIterations: input.maximumIterations,
        maximumSpendCredits: input.maximumSpendCredits,
        model: input.request.model,
        providerProtocol,
        roundIndex,
        turnId: input.request.turnId,
      });
      abortIfNeeded(input.signal);

      const providerRequest: HostedAgentK1ProviderRoundRequest = {
        body: buildHostedAgentK1ProviderBody(input.request, conversation),
        model: input.request.model,
        protocol: providerProtocol,
        roundIndex,
        turnId: input.request.turnId,
      };
      const providerResponse = await input.provider.complete(providerRequest, input.signal);
      providerRounds += 1;
      const parsed = parseHostedAgentK1ProviderRound(
        providerProtocol,
        providerResponse.raw,
      );
      const settlement = await input.billing.settleRound({
        idempotencyKey,
        providerResultDigest: await sha256Hex(providerResponse.raw),
        roundIndex,
        turnId: input.request.turnId,
        usage: toUsage(providerResponse.raw),
      });
      totalCreditsCharged = settlement.totalCreditsCharged;
      emit({
        creditBalance: settlement.creditBalance,
        creditsCharged: settlement.creditsCharged,
        kind: 'billing-settled',
        ledgerEntryId: settlement.ledgerEntryId,
        roundIndex,
        totalCreditsCharged,
      });
      // A provider that cannot abort transport-level work may still finish
      // after cancellation. Settle that already-authorized work honestly, then
      // stop before emitting a tool request or authorizing another round.
      abortIfNeeded(input.signal);

      if (parsed.toolCalls.length === 0) {
        const message = parsed.narration || fallbackMessage(completedToolOutcomes);
        const completion = await input.billing.completeTurn({
          turnId: input.request.turnId,
        });
        totalCreditsCharged = completion.creditsCharged;
        emit({
          creditsCharged: totalCreditsCharged,
          kind: 'turn-complete',
          message,
          rounds: providerRounds,
        });
        return {
          creditsCharged: totalCreditsCharged,
          events,
          finalMessage: message,
          providerRounds,
          status: 'completed',
          toolBatches: completedBatches.length,
        };
      }

      if (parsed.narration) {
        emit({
          kind: 'narration-complete',
          phase: inferNarrationPhase(roundIndex, parsed.narration),
          roundIndex,
          text: parsed.narration,
        });
      }
      emit({
        kind: 'tool-batch-request',
        roundIndex,
        sequence,
        toolCalls: parsed.toolCalls.map((toolCall) => ({
          args: toolCall.args,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
        })),
        toolSchemaVersion: input.request.toolSchemaVersion,
      });

      abortIfNeeded(input.signal);
      const batch = await input.bridge.executeToolBatch({
        clientInstanceId: input.request.clientInstanceId,
        roundIndex,
        sequence,
        sessionId: input.sessionId,
        toolCalls: parsed.toolCalls,
        toolExecutionMode: input.request.toolExecutionMode,
        toolSchemaVersion: input.request.toolSchemaVersion,
        turnId: input.request.turnId,
      });
      exactToolResultBatch(batch, {
        clientInstanceId: input.request.clientInstanceId,
        sequence,
        sessionId: input.sessionId,
        toolCallIds: parsed.toolCalls.map((toolCall) => toolCall.toolCallId),
        toolExecutionMode: input.request.toolExecutionMode,
        toolSchemaVersion: input.request.toolSchemaVersion,
        turnId: input.request.turnId,
      });
      completedBatches.push(batch);
      completedToolOutcomes.push(...batch.results.map((result, index) => ({
        error: result.error,
        success: result.success,
        toolName: parsed.toolCalls[index].toolName,
      })));
      appendHostedAgentK1RoundToConversation(conversation, parsed, batch);
      sequence += 1;
    }

    const message = fallbackMessage(completedToolOutcomes);
    const completion = await input.billing.completeTurn({
      turnId: input.request.turnId,
    });
    totalCreditsCharged = completion.creditsCharged;
    emit({
      creditsCharged: totalCreditsCharged,
      kind: 'turn-complete',
      message,
      rounds: providerRounds,
    });
    return {
      creditsCharged: totalCreditsCharged,
      events,
      finalMessage: message,
      providerRounds,
      status: 'completed',
      toolBatches: completedBatches.length,
    };
  } catch (error) {
    if (input.signal?.aborted) {
      emit({
        kind: 'turn-canceled',
        message: 'The hosted-agent turn was canceled.',
        recoverable: false,
      });
    } else {
      emit({
        kind: 'turn-failed',
        message: error instanceof Error ? error.message : 'The hosted-agent turn failed.',
        recoverable: false,
      });
    }
    throw error;
  }
}

export { HOSTED_AGENT_K1_PROTOCOL_VERSION };
