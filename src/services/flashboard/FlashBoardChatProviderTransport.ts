import {
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_MODEL,
  loadLemonadeModel,
} from '../lemonadeProvider';
import { requestKieChatByo, type KieChatEndpoint } from '../kieAi/chatTransport';
import { cloudAiService } from '../cloudAiService';
import {
  FLASHBOARD_CHAT_MODEL_OPTIONS,
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
import type { AnthropicMessage, AnthropicToolResultBlock, FlashBoardChatCompletionMessage, FlashBoardChatRequest, FlashBoardExecutedToolCall } from './FlashBoardChatTypes';

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
function createHostedChatRoundIdempotencyKey(): string {
  return `flashboard-chat:${Date.now()}:${crypto.randomUUID()}`;
}

async function requestKieChatRound(
  request: FlashBoardChatRequest,
  endpoint: KieChatEndpoint,
  protocol: 'claude-messages' | 'openai-responses',
  providerBody: Record<string, unknown>,
): Promise<unknown> {
  if (request.hostedAvailable) {
    return cloudAiService.createChatCompletion({
      ...providerBody,
      idempotencyKey: createHostedChatRoundIdempotencyKey(),
      protocol,
    });
  }
  return requestKieChatByo({
    apiKey: request.kieAiApiKey ?? '',
    body: providerBody,
    endpoint,
    signal: request.signal,
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
      max_output_tokens: 2048,
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
    );

    const toolCalls = parseOpenAiResponsesToolCalls(data);
    if (toolCalls.length === 0) {
      return readOpenAiResponseText(data) || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : 'Kie.ai returned an empty response.'
      );
    }

    input.push(...getOpenAiResponsesOutput(data));
    const toolResults = await executeFlashBoardToolCalls(
      toolCalls,
      FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS,
      { toolExecutionMode: request.toolExecutionMode },
    );
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
      max_tokens: 2048,
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
    );

    const parsed = parseAnthropicToolCalls(data);
    if (!supportsTools) {
      return parsed.text || 'Kie.ai Fable returned an empty chat response.';
    }
    if (parsed.toolCalls.length === 0) {
      return parsed.text || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : 'Kie.ai returned an empty response.'
      );
    }

    messages.push({ role: 'assistant', content: parsed.contentBlocks });
    const toolResults = await executeFlashBoardToolCalls(
      parsed.toolCalls,
      FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS,
      { toolExecutionMode: request.toolExecutionMode },
    );
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

  return formatToolFollowupFallback(executedToolCalls) || 'Stopped after too many tool iterations.';
}

export async function sendKieChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const model = FLASHBOARD_CHAT_MODEL_OPTIONS.kie.find((candidate) => candidate.id === request.model);
  if (!model?.kieProtocol) {
    throw new Error(`Unsupported Kie.ai chat model: ${request.model}`);
  }
  return model.kieProtocol === 'openai-responses'
    ? sendKieResponsesChat(request, systemPrompt)
    : sendKieClaudeChat(request, systemPrompt, model.supportsTools);
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
  ), 'Lemonade', FLASHBOARD_LEMONADE_MAX_TOOL_RESULT_CHARS, request.onExecutedToolCalls, false, request.toolExecutionMode);
}
