import { getTimelineRevision } from '../../stores/timeline/revisionMiddleware';
import { useTimelineStore } from '../../stores/timeline';
import { handleCaptureFrame } from '../aiTools/handlers/preview';
import {
  HOSTED_AGENT_MAXIMUM_ITERATIONS,
  HostedAgentK2ClientSession,
  clearHostedAgentReloadSnapshot,
  createHostedAgentK2FetchTransport,
  getHostedAgentClientInstanceId,
  hostedAgentRoundIdempotencyKey,
  readHostedAgentReloadSnapshot,
  saveHostedAgentReloadSnapshot,
  startHostedAgentK2Turn,
  type HostedAgentEvent,
  type HostedAgentK1TurnRequest,
  type HostedAgentK2BatchExecutorResult,
  type HostedAgentK2ClientPersistedState,
  type HostedAgentToolExecutionMode,
  type HostedAgentTurnAccepted,
} from '../kernelClient/hostedAgent';
import {
  applyConfirmedCreditUpdate,
  beginCreditActivity,
  endCreditActivity,
  recordCreditActivityTotal,
} from '../credits/creditBalanceCoordinator';
import {
  FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
  clampTemperature,
  isOpenAiReasoningEffortSupported,
  isTemperatureSupported,
  normalizeOpenAiReasoningEffort,
} from './FlashBoardChatConfig';
import {
  ANTHROPIC_TOOLS,
  OPENAI_RESPONSES_TOOLS,
  executeFlashBoardToolCalls,
  getFlashBoardToolResultImage,
  prepareFlashBoardToolCallsForHistory,
} from './FlashBoardChatTools';
import {
  emitAgentActivity,
  safeToolActivityLabel,
} from './FlashBoardChatActivity';
import {
  appendFlashBoardChatRunToolCalls,
  completeFlashBoardChatRun,
  reactivateFlashBoardChatRunByIdempotencyKey,
} from './FlashBoardChatRunAudit';
import { findFlashBoardChatImageData } from './FlashBoardChatImageData';
import type {
  FlashBoardChatRequest,
  FlashBoardChatToolExecutionMode,
  FlashBoardChatVisualReference,
  FlashBoardExecutedToolCall,
  FlashBoardKieChatProtocol,
  FlashBoardToolCall,
} from './FlashBoardChatTypes';

const HOSTED_AGENT_PROMPT_VERSION = 'flashboard-chat-v2';
const HOSTED_AGENT_HISTORY_VERSION = 'flashboard-provider-history-v1';
const HOSTED_AGENT_TOOL_SCHEMA_VERSION = 'flashboard-chat-tools-v2';
const HOSTED_AGENT_MAX_TURN_SPEND_CREDITS = 500;
const HOSTED_AGENT_MAXIMUM_INLINE_RESULT_CHARACTERS = 32 * 1024 * 1024;

function clientInstanceId(): string {
  return getHostedAgentClientInstanceId();
}

function turnId(request: FlashBoardChatRequest): string {
  const candidate = request.idempotencyKey?.trim();
  if (candidate && /^[A-Za-z0-9:_-]{1,160}$/.test(candidate)) {
    return candidate;
  }
  return `flashboard-chat-turn:${Date.now()}:${crypto.randomUUID()}`;
}

function hostedExecutionMode(
  mode: FlashBoardChatToolExecutionMode | undefined,
): HostedAgentToolExecutionMode {
  return mode === 'plan' || mode === 'read-only' ? mode : 'normal';
}

function providerInput(
  protocol: FlashBoardKieChatProtocol,
  prompt: string,
  supportsTools: boolean,
  visualReferences: FlashBoardChatVisualReference[],
): HostedAgentK1TurnRequest['providerInput'] {
  if (protocol === 'openai-responses') {
    return {
      input: [{
        role: 'user',
        content: visualReferences.length === 0
          ? prompt
          : [
              { text: prompt, type: 'input_text' },
              ...visualReferences.map((reference) => ({
                detail: 'high',
                image_url: reference.dataUrl,
                type: 'input_image',
              })),
            ],
      }],
      protocol,
      store: false,
      toolChoice: 'auto',
      tools: supportsTools ? OPENAI_RESPONSES_TOOLS : [],
    };
  }
  return {
    messages: [{
      role: 'user',
      content: visualReferences.length === 0
        ? prompt
        : [
            { text: prompt, type: 'text' },
            ...visualReferences.map((reference) => {
              const image = getVisualReferenceImage(reference);
              return {
                source: {
                  data: image.base64,
                  media_type: image.mediaType,
                  type: 'base64',
                },
                type: 'image',
              };
            }),
          ],
    }],
    protocol,
    tools: supportsTools ? ANTHROPIC_TOOLS : [],
  };
}

function getVisualReferenceImage(reference: FlashBoardChatVisualReference): {
  base64: string;
  mediaType: string;
} {
  const image = findFlashBoardChatImageData(reference.dataUrl);
  if (!image) {
    throw new Error('A chat reference is not a supported PNG, JPEG, GIF, or WebP image.');
  }
  return { base64: image.base64.replace(/\s+/g, ''), mediaType: image.mediaType };
}

function hostedVisualReferences(
  protocol: FlashBoardKieChatProtocol,
  visualReferences: FlashBoardChatVisualReference[],
): HostedAgentK1TurnRequest['visualReferences'] {
  return visualReferences.map((reference, index) => {
    const image = getVisualReferenceImage(reference);
    return {
      id: `initial-reference-${index + 1}`,
      mediaType: image.mediaType,
      role: 'initial',
      source: protocol === 'openai-responses' ? reference.dataUrl : image.base64,
      transport: 'data-url',
    };
  });
}

export function buildHostedAgentTurnRequest(input: {
  protocol: FlashBoardKieChatProtocol;
  request: FlashBoardChatRequest;
  supportsTools: boolean;
  systemPrompt: string;
}): HostedAgentK1TurnRequest {
  const tools = input.supportsTools
    ? (input.protocol === 'openai-responses' ? OPENAI_RESPONSES_TOOLS : ANTHROPIC_TOOLS)
    : [];
  const visualReferences = input.request.visualReferences ?? [];
  const request: HostedAgentK1TurnRequest = {
    clientCapabilities: {
      maximumInlineResultCharacters: HOSTED_AGENT_MAXIMUM_INLINE_RESULT_CHARACTERS,
      supportsImageResultRefs: false,
      supportsNarrationDeltas: false,
      toolNames: tools.map((tool) => tool.name),
    },
    clientInstanceId: clientInstanceId(),
    historyFormatVersion: HOSTED_AGENT_HISTORY_VERSION,
    maximumOutputTokens: FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
    maxTurnSpendCredits: HOSTED_AGENT_MAX_TURN_SPEND_CREDITS,
    model: input.request.model,
    modelPrompt: input.request.prompt,
    playbookPrompt: input.request.playbookPrompt ?? input.request.prompt,
    promptVersion: HOSTED_AGENT_PROMPT_VERSION,
    providerInput: providerInput(
      input.protocol,
      input.request.prompt,
      input.supportsTools,
      visualReferences,
    ),
    request: input.request.prompt,
    routePreference: 'auto',
    runSource: input.request.runSource === 'bridge' || input.request.runSource === 'mcp'
      ? input.request.runSource
      : 'ui',
    systemPrompt: input.systemPrompt,
    toolExecutionMode: hostedExecutionMode(input.request.toolExecutionMode),
    toolSchemaVersion: HOSTED_AGENT_TOOL_SCHEMA_VERSION,
    turnId: turnId(input.request),
    visualReferences: hostedVisualReferences(input.protocol, visualReferences),
  };
  if (isTemperatureSupported('kie', input.request.model)) {
    request.temperature = clampTemperature(input.request.temperature);
  }
  if (isOpenAiReasoningEffortSupported(input.request.model)) {
    request.reasoningEffort = normalizeOpenAiReasoningEffort(
      input.request.model,
      input.request.openAiReasoningEffort,
    );
  }
  return request;
}

function toolCallsForEvent(
  event: Extract<HostedAgentEvent, { kind: 'tool-batch-request' }>,
): FlashBoardToolCall[] {
  return event.toolCalls.map((toolCall) => ({
    arguments: typeof toolCall.args === 'string'
      ? toolCall.args
      : JSON.stringify(toolCall.args ?? {}),
    id: toolCall.toolCallId,
    name: toolCall.toolName,
  }));
}

function hostedToolResultProviderContent(
  protocol: FlashBoardKieChatProtocol,
  image: { base64: string; dataUrl: string; mediaType: string },
  label: string,
  modelContent: string,
) {
  if (protocol === 'openai-responses') {
    return {
      openAiFollowupInput: [{
        content: [
          { text: label, type: 'input_text' },
          { detail: 'high', image_url: image.dataUrl, type: 'input_image' },
        ],
        role: 'user',
      }],
    };
  }
  return {
    claudeToolResultContent: [
      {
        source: {
          data: image.base64,
          media_type: image.mediaType,
          type: 'base64',
        },
        type: 'image',
      },
      { text: modelContent, type: 'text' },
    ],
  };
}

const VISUAL_RESULT_TOOL_NAMES = new Set([
  'captureFrame',
  'getCutPreviewQuad',
  'getFramesAtTimes',
]);

async function executeKernelToolBatch(
  request: FlashBoardChatRequest,
  protocol: FlashBoardKieChatProtocol,
  executionMode: HostedAgentToolExecutionMode,
  event: Extract<HostedAgentEvent, { kind: 'tool-batch-request' }>,
): Promise<HostedAgentK2BatchExecutorResult> {
  const toolCalls = toolCallsForEvent(event);
  for (const toolCall of toolCalls) {
    emitAgentActivity(request, {
      kind: 'operation',
      phase: 'started',
      safeLabel: safeToolActivityLabel(toolCall.name),
      operationId: toolCall.id,
      toolName: toolCall.name,
    });
  }
  const stateRevisionBefore = getTimelineRevision();
  const executed = await executeFlashBoardToolCalls(
    toolCalls,
    Number.POSITIVE_INFINITY,
    { toolExecutionMode: executionMode },
  );
  const stateRevisionAfter = getTimelineRevision();
  for (const toolResult of executed) {
    emitAgentActivity(request, {
      kind: 'operation',
      phase: toolResult.result.success ? 'completed' : 'failed',
      safeLabel: safeToolActivityLabel(toolResult.toolCall.name),
      operationId: toolResult.toolCall.id,
      toolName: toolResult.toolCall.name,
    });
  }
  request.onExecutedToolCalls?.(prepareFlashBoardToolCallsForHistory(executed));
  const includesRequestedVisualResult = executed.some((toolResult) => (
    toolResult.result.success && VISUAL_RESULT_TOOL_NAMES.has(toolResult.toolCall.name)
  ));
  let automaticPostEditPreview: ReturnType<typeof findFlashBoardChatImageData> = null;
  if (stateRevisionAfter !== stateRevisionBefore && !includesRequestedVisualResult) {
    try {
      const capture = await handleCaptureFrame(
        { mode: 'auto', settleMs: 180 },
        useTimelineStore.getState(),
      );
      if (capture.success) {
        automaticPostEditPreview = findFlashBoardChatImageData(capture.data);
      }
    } catch {
      // The edit result remains authoritative when a best-effort preview cannot render.
    }
  }
  const automaticPreviewResultIndex = automaticPostEditPreview && executed.length > 0
    ? executed.length - 1
    : -1;
  return {
    authority: {
      approval: 'not-required',
      executionMode,
      policyChecked: true,
      stateRevisionAfter: `timeline:${stateRevisionAfter}`,
      stateRevisionBefore: `timeline:${stateRevisionBefore}`,
      validationPassed: true,
    },
    results: executed.map((toolResult, index) => {
      const requestedImage = getFlashBoardToolResultImage(toolResult);
      const image = requestedImage
        ?? (index === automaticPreviewResultIndex ? automaticPostEditPreview : null);
      return {
        ...(toolResult.result.error === undefined ? {} : { error: toolResult.result.error }),
        modelContent: toolResult.modelContent,
        ...(image ? {
          providerContent: hostedToolResultProviderContent(
            protocol,
            image,
            requestedImage
              ? `Visual output from ${toolResult.toolCall.name}:`
              : 'Automatic post-edit preview after this tool batch. This current frame is valid visual evidence; do not call captureFrame again unless you need another time or the image reveals a problem:',
            toolResult.modelContent,
          ),
        } : {}),
        success: toolResult.result.success,
        toolCallId: toolResult.toolCall.id,
      };
    }),
  };
}

export async function sendHostedKieAgentChat(input: {
  protocol: FlashBoardKieChatProtocol;
  request: FlashBoardChatRequest;
  supportsTools: boolean;
  systemPrompt: string;
}): Promise<string> {
  const turnRequest = buildHostedAgentTurnRequest(input);
  if (input.request.resumeMessageId) {
    saveHostedAgentReloadSnapshot({
      assistantMessageId: input.request.resumeMessageId,
      completedBatches: [],
      cursor: null,
      request: turnRequest,
    });
  }
  let accepted: HostedAgentTurnAccepted;
  try {
    accepted = await startHostedAgentK2Turn({
      request: turnRequest,
      signal: input.request.signal,
    });
  } catch (error) {
    if (input.request.resumeMessageId) {
      clearHostedAgentReloadSnapshot(input.request.resumeMessageId);
    }
    throw error;
  }
  assertCompatibleAcceptedTurn(turnRequest, accepted);
  input.request.onPhase?.('provider');
  return runHostedAgentSession({
    accepted,
    assistantMessageId: input.request.resumeMessageId,
    callbackRequest: input.request,
    turnRequest,
  });
}

function assertCompatibleAcceptedTurn(
  turnRequest: HostedAgentK1TurnRequest,
  accepted: HostedAgentTurnAccepted,
): void {
  if (
    accepted.maximumIterations !== HOSTED_AGENT_MAXIMUM_ITERATIONS
    || accepted.acceptedPromptVersion !== turnRequest.promptVersion
    || accepted.acceptedHistoryFormatVersion !== turnRequest.historyFormatVersion
    || accepted.acceptedToolSchemaVersion !== turnRequest.toolSchemaVersion
  ) {
    throw new Error('The kernel accepted an incompatible hosted-agent contract.');
  }
}

async function runHostedAgentSession(input: {
  accepted: HostedAgentTurnAccepted;
  assistantMessageId?: string;
  callbackRequest: FlashBoardChatRequest;
  restoredState?: Pick<HostedAgentK2ClientPersistedState, 'completedBatches' | 'cursor'>;
  turnRequest: HostedAgentK1TurnRequest;
}): Promise<string> {
  const activityId = input.turnRequest.turnId;
  beginCreditActivity({
    feature: 'AI agent',
    id: activityId,
    targetId: 'flashboard-credit-activity-anchor',
  });
  let activityEnded = false;
  const finishActivity = (status: 'completed' | 'failed' | 'canceled') => {
    if (activityEnded) return;
    activityEnded = true;
    endCreditActivity({ id: activityId, status });
  };
  const persist = (state: HostedAgentK2ClientPersistedState) => {
    if (!input.assistantMessageId) return;
    if (state.status !== 'active') {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
      return;
    }
    saveHostedAgentReloadSnapshot({
      assistantMessageId: input.assistantMessageId,
      completedBatches: state.completedBatches,
      cursor: state.cursor,
      request: input.turnRequest,
    });
  };

  if (input.assistantMessageId) {
    saveHostedAgentReloadSnapshot({
      assistantMessageId: input.assistantMessageId,
      completedBatches: input.restoredState?.completedBatches ?? [],
      cursor: input.restoredState?.cursor ?? null,
      request: input.turnRequest,
    });
  }

  let client: HostedAgentK2ClientSession;
  try {
    client = new HostedAgentK2ClientSession({
      clientInstanceId: input.turnRequest.clientInstanceId,
      completedBatches: input.restoredState?.completedBatches,
      cursor: input.restoredState?.cursor,
      lease: input.accepted.pageLease,
      onStateChange: persist,
      toolSchemaVersion: input.turnRequest.toolSchemaVersion,
      transport: createHostedAgentK2FetchTransport({ signal: input.callbackRequest.signal }),
      turnId: input.turnRequest.turnId,
    });
  } catch (error) {
    finishActivity('failed');
    throw error;
  }
  let finalMessage = '';
  let terminalError = '';
  let detachingForReload = false;
  const interruptForPageExit = () => {
    detachingForReload = true;
    client.detachForReload();
  };
  window.addEventListener('pagehide', interruptForPageExit);
  try {
    const result = await client.runUntilTerminal({
      execute: (event) => executeKernelToolBatch(
        input.callbackRequest,
        input.turnRequest.providerInput.protocol,
        input.turnRequest.toolExecutionMode,
        event,
      ),
      onEvent: (event) => {
        if (event.kind === 'narration-complete' || event.kind === 'narration-delta') {
          emitAgentActivity(input.callbackRequest, {
            kind: 'narration',
            phase: event.phase,
            roundIndex: event.roundIndex,
            text: event.text,
          });
        } else if (event.kind === 'billing-settled') {
          applyConfirmedCreditUpdate({
            activityId,
            activityTotalCredits: event.totalCreditsCharged,
            balance: event.creditBalance,
            credits: event.creditsCharged,
            kind: 'debit',
            mutationId: event.ledgerEntryId
              ? `debit:hosted:ai_chat:${event.ledgerEntryId}`
              : `debit:hosted:ai_chat:${hostedAgentRoundIdempotencyKey(event.turnId, event.roundIndex)}`,
            source: 'hosted:ai_chat',
          });
        } else if (event.kind === 'turn-complete') {
          recordCreditActivityTotal(activityId, event.creditsCharged);
          finalMessage = event.message;
          finishActivity('completed');
        } else if (
          event.kind === 'turn-failed'
          || event.kind === 'turn-canceled'
          || event.kind === 'turn-interrupted'
        ) {
          terminalError = event.message;
          finishActivity(event.kind === 'turn-canceled' ? 'canceled' : 'failed');
        }
      },
      signal: input.callbackRequest.signal,
    });
    if (result.status !== 'completed') {
      throw new Error(terminalError || `The kernel fast-agent turn ended as ${result.status}.`);
    }
    if (input.assistantMessageId) {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
    }
    if (!finalMessage.trim()) {
      throw new Error('The kernel completed without a final agent response.');
    }
    return finalMessage;
  } catch (error) {
    if (!detachingForReload) {
      finishActivity(input.callbackRequest.signal?.aborted ? 'canceled' : 'failed');
    }
    if (!detachingForReload && input.assistantMessageId) {
      clearHostedAgentReloadSnapshot(input.assistantMessageId);
    }
    throw error;
  } finally {
    window.removeEventListener('pagehide', interruptForPageExit);
  }
}

export async function resumeHostedKieAgentChat(input: {
  assistantMessageId: string;
  request: FlashBoardChatRequest;
}): Promise<string | null> {
  const snapshot = readHostedAgentReloadSnapshot(input.assistantMessageId);
  if (!snapshot) return null;
  if (snapshot.request.clientInstanceId !== clientInstanceId()) {
    clearHostedAgentReloadSnapshot(input.assistantMessageId);
    return null;
  }

  const auditRun = await reactivateFlashBoardChatRunByIdempotencyKey(snapshot.request.turnId);
  const resumedToolCalls: FlashBoardExecutedToolCall[] = [];
  const callbackRequest: FlashBoardChatRequest = {
    ...input.request,
    onExecutedToolCalls: (toolCalls) => {
      resumedToolCalls.push(...toolCalls);
      if (auditRun) appendFlashBoardChatRunToolCalls(auditRun.runId, toolCalls);
      input.request.onExecutedToolCalls?.(toolCalls);
    },
  };
  try {
    const accepted = await startHostedAgentK2Turn({
      request: snapshot.request,
      signal: input.request.signal,
    });
    assertCompatibleAcceptedTurn(snapshot.request, accepted);
    input.request.onPhase?.('provider');
    const response = await runHostedAgentSession({
      accepted,
      assistantMessageId: input.assistantMessageId,
      callbackRequest,
      restoredState: {
        completedBatches: snapshot.completedBatches,
        cursor: snapshot.cursor,
      },
      turnRequest: snapshot.request,
    });
    if (auditRun) {
      completeFlashBoardChatRun(auditRun.runId, {
        executedToolCalls: [...auditRun.executedToolCalls, ...resumedToolCalls],
        response,
      });
    }
    return response;
  } catch (error) {
    if (auditRun) {
      completeFlashBoardChatRun(auditRun.runId, {
        error,
        executedToolCalls: [...auditRun.executedToolCalls, ...resumedToolCalls],
      });
    }
    throw error;
  }
}
