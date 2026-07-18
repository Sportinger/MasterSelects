import {
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_MODEL,
  loadLemonadeModel,
} from '../lemonadeProvider';
import { cloudAiService } from '../cloudAiService';
import { AI_TOOLS } from '../aiTools';
import {
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
  parseOpenAiChatCompletion,
  parseOpenAiResponsesToolCalls,
  readErrorMessage,
  readOpenAiChatCompletionText,
  readOpenAiResponseText,
} from './FlashBoardChatResponseMapping';
import {
  ANTHROPIC_TOOLS,
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
  'getClipDetails',
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
const FLASHBOARD_LEMONADE_TOOLS = AI_TOOLS.filter((tool) => FLASHBOARD_LEMONADE_TOOL_NAMES.has(tool.function.name));
function createHostedChatRoundIdempotencyKey(): string {
  return `flashboard-chat:${Date.now()}:${crypto.randomUUID()}`;
}

function serializeHostedOpenAiMessage(message: FlashBoardChatCompletionMessage): Record<string, unknown> {
  const { imageDataUrl, ...serialized } = message;
  return imageDataUrl
    ? {
        ...serialized,
        content: [
          { type: 'text', text: message.content },
          { type: 'image_url', image_url: { detail: 'high', url: imageDataUrl } },
        ],
      }
    : serialized;
}

export async function sendHostedOpenAiChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const messages: FlashBoardChatCompletionMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request.prompt },
  ];

  return runChatCompletionToolLoop(messages, async (currentMessages) => {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: currentMessages.map(serializeHostedOpenAiMessage),
      tools: AI_TOOLS,
      tool_choice: 'auto',
      max_completion_tokens: 2048,
    };

    if (isTemperatureSupported('openai', request.model)) {
      body.temperature = clampTemperature(request.temperature);
    }
    if (isOpenAiReasoningEffortSupported(request.model)) {
      body.reasoning_effort = normalizeOpenAiReasoningEffort(request.model, request.openAiReasoningEffort);
    }

    body.idempotencyKey = createHostedChatRoundIdempotencyKey();

    const data = await cloudAiService.createChatCompletion(body);
    const parsed = parseOpenAiChatCompletion(data);
    if (parsed.finishReason === 'length' && !parsed.content && parsed.toolCalls.length === 0) {
      throw new Error('OpenAI used the full 2048-token round budget before returning a result. Lower reasoning effort or try again.');
    }
    return parsed.toolCalls.length > 0
      ? parsed
      : {
        content: parsed.content || readOpenAiChatCompletionText(data) || readOpenAiResponseText(data) || null,
        toolCalls: [],
      };
  }, 'OpenAI', FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS, request.onExecutedToolCalls, true);
}

export async function sendOpenAiResponsesChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const apiKey = request.openAiApiKey?.trim();
  if (!apiKey) {
    throw new Error('Add an OpenAI API key in Settings to use compact chat.');
  }

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
      include: ['reasoning.encrypted_content'],
    };

    if (isTemperatureSupported('openai', request.model)) {
      body.temperature = clampTemperature(request.temperature);
    }

    if (isOpenAiReasoningEffortSupported(request.model)) {
      body.reasoning = {
        effort: normalizeOpenAiReasoningEffort(request.model, request.openAiReasoningEffort),
      };
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data) ?? `OpenAI request failed: ${response.status}`);
    }

    const toolCalls = parseOpenAiResponsesToolCalls(data);
    if (toolCalls.length === 0) {
      return readOpenAiResponseText(data) || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : 'OpenAI returned an empty response.'
      );
    }

    input.push(...getOpenAiResponsesOutput(data));
    const toolResults = await executeFlashBoardToolCalls(toolCalls, FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS);
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

export async function sendOpenAiChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  return request.hostedAvailable
    ? sendHostedOpenAiChat(request, systemPrompt)
    : sendOpenAiResponsesChat(request, systemPrompt);
}

export async function sendAnthropicChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  const apiKey = request.anthropicApiKey?.trim();
  if (!apiKey) {
    throw new Error('Add an Anthropic API key in Settings to use Claude chat.');
  }

  const messages: AnthropicMessage[] = [{ role: 'user', content: request.prompt }];
  const executedToolCalls: FlashBoardExecutedToolCall[] = [];

  for (let iteration = 0; iteration < FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS; iteration += 1) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 2048,
        temperature: clampTemperature(request.temperature),
        system: systemPrompt,
        tools: ANTHROPIC_TOOLS,
        messages,
      }),
      signal: request.signal,
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data) ?? `Anthropic request failed: ${response.status}`);
    }

    const parsed = parseAnthropicToolCalls(data);
    if (parsed.toolCalls.length === 0) {
      return parsed.text || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : 'Anthropic returned an empty response.'
      );
    }

    messages.push({ role: 'assistant', content: parsed.contentBlocks });
    const toolResults = await executeFlashBoardToolCalls(parsed.toolCalls, FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS);
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
  ), 'Lemonade', FLASHBOARD_LEMONADE_MAX_TOOL_RESULT_CHARS, request.onExecutedToolCalls);
}
