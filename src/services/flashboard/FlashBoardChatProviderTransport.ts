import {
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_MODEL,
  loadLemonadeModel,
} from '../lemonadeProvider';
import { requestKieChatByo, type KieChatEndpoint } from '../kieAi/chatTransport';
import { cloudAiService } from '../cloudAiService';
import {
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
  FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS,
  FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS,
  FLASHBOARD_LEMONADE_INITIAL_RESPONSE_TIMEOUT_MS,
  FLASHBOARD_LEMONADE_MAX_TOOL_RESULT_CHARS,
  FLASHBOARD_LEMONADE_STREAM_IDLE_TIMEOUT_MS,
  clampTemperature,
  isOpenAiReasoningEffortSupported,
  isTemperatureSupported,
  normalizeOpenAiReasoningEffort,
} from './FlashBoardChatConfig';
import {
  getOpenAiResponsesOutput,
  parseAnthropicToolCalls,
  parseOpenAiResponsesToolCalls,
  readOpenAiResponseText,
} from './FlashBoardChatResponseMapping';
import {
  ANTHROPIC_TOOLS,
  FLASHBOARD_CHAT_TOOLS,
  OPENAI_RESPONSES_TOOLS,
  executeFlashBoardToolCalls,
  formatToolFollowupFallback,
  getFlashBoardToolResultImage,
  prepareFlashBoardToolCallsForHistory,
  runChatCompletionToolLoop,
} from './FlashBoardChatTools';
import {
  emitAgentActivity,
  inferNarrationPhase,
  safeToolActivityLabel,
} from './FlashBoardChatActivity';
import type { AnthropicMessage, AnthropicToolResultBlock, FlashBoardChatCompletionMessage, FlashBoardChatRequest, FlashBoardExecutedToolCall } from './FlashBoardChatTypes';
import { sendHostedKieAgentChat } from './FlashBoardHostedAgentTransport';

const FLASHBOARD_LEMONADE_TOOL_NAMES = new Set([
  'getTimelineState',
  'getTimelineAnalysis',
  'getClipDetails',
  'getClipFaceAnalysis',
  'startClipFaceAnalysis',
  'mergeClipFacePeople',
  'moveClipFaceAppearance',
  'assignClipFaceReviewCandidate',
  'getClipsInTimeRange',
  'selectClips',
  'clearSelection',
  'setPlayhead',
  'setInOutPoints',
  'splitClip',
  'deleteClip',
  'moveClip',
  'trimClip',
  'cutRangesFromClip',
  'getMediaItems',
  'setTransform',
  'getTextProperties',
  'createTextClip',
  'updateTextProperties',
  'setTextBox',
  'addTextBoundsKeyframe',
  'listEffects',
  'addEffect',
  'updateEffect',
  'undo',
  'redo',
  'play',
  'pause',
]);
const FLASHBOARD_LEMONADE_TOOLS = FLASHBOARD_CHAT_TOOLS.filter((tool) => (
  FLASHBOARD_LEMONADE_TOOL_NAMES.has(tool.function.name)
));
function createHostedChatRoundIdempotencyKey(
  request: FlashBoardChatRequest,
  protocol: 'claude-messages' | 'openai-responses',
  roundIndex: number,
): string {
  return request.idempotencyKey
    ? `${request.idempotencyKey}:${protocol}:${roundIndex}`
    : `flashboard-chat:${Date.now()}:${crypto.randomUUID()}`;
}

async function requestKieChatRound(
  request: FlashBoardChatRequest,
  endpoint: KieChatEndpoint,
  protocol: 'claude-messages' | 'openai-responses',
  providerBody: Record<string, unknown>,
  roundIndex: number,
): Promise<unknown> {
  if (request.signal?.aborted) {
    throw request.signal.reason ?? new DOMException('Chat stopped.', 'AbortError');
  }
  if (request.hostedAvailable) {
    return cloudAiService.createChatCompletion({
      ...providerBody,
      billingRoundIndex: roundIndex,
      billingTurnId: request.idempotencyKey,
      billingTurnAction: 'continue',
      idempotencyKey: createHostedChatRoundIdempotencyKey(request, protocol, roundIndex),
      protocol,
    }, request.signal);
  }
  return requestKieChatByo({
    apiKey: request.kieAiApiKey ?? '',
    body: providerBody,
    endpoint,
    signal: request.signal,
  });
}

async function completeHostedChatTurn(request: FlashBoardChatRequest): Promise<void> {
  if (!request.hostedAvailable || !request.idempotencyKey) return;
  await cloudAiService.createChatCompletion({
    billingRoundIndex: 0,
    billingTurnAction: 'complete',
    billingTurnId: request.idempotencyKey,
    idempotencyKey: `${request.idempotencyKey}:terminal:complete`,
  });
}

async function sendKieResponsesChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const input: unknown[] = [{ role: 'user', content: request.prompt }];
  const executedToolCalls: FlashBoardExecutedToolCall[] = [];

  for (let iteration = 0; iteration < FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS; iteration += 1) {
    const body: Record<string, unknown> = {
      model: request.model,
      instructions: systemPrompt,
      input,
      tools: OPENAI_RESPONSES_TOOLS,
      tool_choice: 'auto',
      max_output_tokens: FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
      store: false,
    };

    if (isTemperatureSupported('kie', request.model)) {
      body.temperature = clampTemperature(request.temperature);
    }

    if (isOpenAiReasoningEffortSupported(request.model)) {
      body.reasoning = {
        effort: normalizeOpenAiReasoningEffort(request.model, request.openAiReasoningEffort),
      };
    }

    const data = await requestKieChatRound(
      request,
      '/codex/v1/responses',
      'openai-responses',
      body,
      iteration,
    );

    const toolCalls = parseOpenAiResponsesToolCalls(data);
    if (toolCalls.length === 0) {
      const response = readOpenAiResponseText(data) || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : 'Kie.ai returned an empty response.'
      );
      await completeHostedChatTurn(request);
      return response;
    }

    const narration = readOpenAiResponseText(data);
    if (narration) {
      emitAgentActivity(request, {
        kind: 'narration',
        phase: inferNarrationPhase(iteration, narration),
        roundIndex: iteration,
        text: narration,
      });
    }
    for (const toolCall of toolCalls) {
      emitAgentActivity(request, {
        kind: 'operation',
        phase: 'started',
        safeLabel: safeToolActivityLabel(toolCall.name),
        toolName: toolCall.name,
      });
    }
    input.push(...getOpenAiResponsesOutput(data));
    if (request.signal?.aborted) {
      throw request.signal.reason ?? new DOMException('Chat stopped.', 'AbortError');
    }
    const toolResults = await executeFlashBoardToolCalls(
      toolCalls,
      FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS,
      { toolExecutionMode: request.toolExecutionMode },
    );
    for (const toolResult of toolResults) {
      emitAgentActivity(request, {
        kind: 'operation',
        phase: toolResult.result.success ? 'completed' : 'failed',
        safeLabel: safeToolActivityLabel(toolResult.toolCall.name),
        toolName: toolResult.toolCall.name,
      });
    }
    executedToolCalls.push(...toolResults);
    request.onExecutedToolCalls?.(prepareFlashBoardToolCallsForHistory(toolResults));
    for (const toolResult of toolResults) {
      input.push({
        type: 'function_call_output',
        call_id: toolResult.toolCall.id,
        output: toolResult.modelContent,
      });
    }
    for (const toolResult of toolResults) {
      const image = getFlashBoardToolResultImage(toolResult);
      if (image) {
        input.push({
          role: 'user',
          content: [
            { type: 'input_text', text: `Visual output from ${toolResult.toolCall.name}:` },
            { type: 'input_image', image_url: image.dataUrl, detail: 'high' },
          ],
        });
      }
    }
  }

  await completeHostedChatTurn(request);
  return formatToolFollowupFallback(executedToolCalls) || 'Stopped after too many tool iterations.';
}

async function sendKieClaudeChat(
  request: FlashBoardChatRequest,
  systemPrompt: string,
  supportsTools: boolean,
): Promise<string> {
  const messages: AnthropicMessage[] = [{ role: 'user', content: request.prompt }];
  const executedToolCalls: FlashBoardExecutedToolCall[] = [];
  const maxIterations = supportsTools ? FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS : 1;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS,
      temperature: clampTemperature(request.temperature),
      system: systemPrompt,
      messages,
    };
    if (supportsTools) {
      body.tools = ANTHROPIC_TOOLS;
    }
    const data = await requestKieChatRound(
      request,
      '/claude/v1/messages',
      'claude-messages',
      body,
      iteration,
    );

    const parsed = parseAnthropicToolCalls(data);
    if (!supportsTools) {
      const response = parsed.text || 'Kie.ai Fable returned an empty chat response.';
      await completeHostedChatTurn(request);
      return response;
    }
    if (parsed.toolCalls.length === 0) {
      const response = parsed.text || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : 'Kie.ai returned an empty response.'
      );
      await completeHostedChatTurn(request);
      return response;
    }

    if (parsed.text) {
      emitAgentActivity(request, {
        kind: 'narration',
        phase: inferNarrationPhase(iteration, parsed.text),
        roundIndex: iteration,
        text: parsed.text,
      });
    }
    for (const toolCall of parsed.toolCalls) {
      emitAgentActivity(request, {
        kind: 'operation',
        phase: 'started',
        safeLabel: safeToolActivityLabel(toolCall.name),
        toolName: toolCall.name,
      });
    }
    messages.push({ role: 'assistant', content: parsed.contentBlocks });
    if (request.signal?.aborted) {
      throw request.signal.reason ?? new DOMException('Chat stopped.', 'AbortError');
    }
    const toolResults = await executeFlashBoardToolCalls(
      parsed.toolCalls,
      FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS,
      { toolExecutionMode: request.toolExecutionMode },
    );
    for (const toolResult of toolResults) {
      emitAgentActivity(request, {
        kind: 'operation',
        phase: toolResult.result.success ? 'completed' : 'failed',
        safeLabel: safeToolActivityLabel(toolResult.toolCall.name),
        toolName: toolResult.toolCall.name,
      });
    }
    executedToolCalls.push(...toolResults);
    request.onExecutedToolCalls?.(prepareFlashBoardToolCallsForHistory(toolResults));
    messages.push({
      role: 'user',
      content: toolResults.map((toolResult): AnthropicToolResultBlock => {
        const image = getFlashBoardToolResultImage(toolResult);
        return {
          type: 'tool_result',
          tool_use_id: toolResult.toolCall.id,
          content: image
            ? [
                { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
                { type: 'text', text: toolResult.modelContent },
              ]
            : toolResult.modelContent,
          is_error: !toolResult.result.success,
        };
      }),
    });
  }

  await completeHostedChatTurn(request);
  return formatToolFollowupFallback(executedToolCalls) || 'Stopped after too many tool iterations.';
}

export async function sendKieChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const turnRequest = request.hostedAvailable && !request.idempotencyKey
    ? {
        ...request,
        idempotencyKey: `flashboard-chat-turn:${Date.now()}:${crypto.randomUUID()}`,
      }
    : request;
  const model = FLASHBOARD_CHAT_MODEL_OPTIONS.kie.find((candidate) => candidate.id === turnRequest.model);
  if (!model?.kieProtocol) {
    throw new Error(`Unsupported Kie.ai chat model: ${turnRequest.model}`);
  }
  if (turnRequest.hostedAvailable) {
    return sendHostedKieAgentChat({
      protocol: model.kieProtocol,
      request: turnRequest,
      supportsTools: model.supportsTools,
      systemPrompt,
    });
  }
  return model.kieProtocol === 'openai-responses'
    ? sendKieResponsesChat(turnRequest, systemPrompt)
    : sendKieClaudeChat(turnRequest, systemPrompt, model.supportsTools);
}

export async function sendLemonadeChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  await loadLemonadeModel({
    contextSize: request.lemonadeContextSize,
    endpoint: request.lemonadeEndpoint ?? '',
    model: request.model || DEFAULT_LEMONADE_MODEL,
    signal: request.signal,
    timeoutMs: FLASHBOARD_LEMONADE_INITIAL_RESPONSE_TIMEOUT_MS,
  });

  const messages: FlashBoardChatCompletionMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request.prompt },
  ];

  return runChatCompletionToolLoop(messages, async (currentMessages) => (
    createLemonadeChatCompletionStream({
      endpoint: request.lemonadeEndpoint ?? '',
      model: request.model || DEFAULT_LEMONADE_MODEL,
      messages: currentMessages,
      tools: FLASHBOARD_LEMONADE_TOOLS,
      maxTokens: 1024,
      temperature: clampTemperature(request.temperature),
      signal: request.signal,
      timeoutMs: FLASHBOARD_LEMONADE_INITIAL_RESPONSE_TIMEOUT_MS,
      streamIdleTimeoutMs: FLASHBOARD_LEMONADE_STREAM_IDLE_TIMEOUT_MS,
    })
  ), 'Lemonade', FLASHBOARD_LEMONADE_MAX_TOOL_RESULT_CHARS, request.onExecutedToolCalls, false, request.toolExecutionMode, (event) => {
    if (event.kind === 'narration') {
      emitAgentActivity(request, {
        ...event,
        phase: inferNarrationPhase(event.roundIndex, event.text),
      });
      return;
    }
    if (event.kind === 'operation') {
      emitAgentActivity(request, {
        ...event,
        safeLabel: safeToolActivityLabel(event.toolName ?? event.safeLabel),
      });
      return;
    }
    emitAgentActivity(request, event);
  }, request.signal);
}
