import type { ToolDefinition } from './aiTools/types';

export const DEFAULT_LEMONADE_ENDPOINT = 'http://localhost:13305/api/v1';
export const DEFAULT_LEMONADE_MODEL = 'gemma4-it-e2b-FLM';
export const DEFAULT_LEMONADE_CONTEXT_SIZE = -1;

export const LEMONADE_CONTEXT_SIZE_OPTIONS = [
  { value: DEFAULT_LEMONADE_CONTEXT_SIZE, label: 'Auto' },
  { value: 4096, label: '4K' },
  { value: 8192, label: '8K' },
  { value: 16384, label: '16K' },
  { value: 32768, label: '32K' },
  { value: 65536, label: '64K' },
  { value: 131072, label: '128K' },
  { value: 262144, label: '256K' },
] as const;

export const LEMONADE_MODEL_PRESETS = [
  { id: 'gemma4-it-e2b-FLM', name: 'Gemma 4 Edge E2B', description: 'Fast FLM/NPU chat model' },
  { id: 'gemma3-1b-FLM', name: 'Gemma 3 1B', description: 'Small fast FLM model' },
  { id: 'qwen3-0.6b-FLM', name: 'Qwen3 0.6B', description: 'Very small FLM model' },
  { id: 'qwen3-4b-FLM', name: 'Qwen3 4B', description: 'Balanced local FLM model' },
  { id: 'llama3.2-1b-FLM', name: 'Llama 3.2 1B', description: 'Fast FLM fallback model' },
  { id: 'Gemma-4-E2B-it-GGUF', name: 'Gemma 4 E2B GGUF', description: 'Legacy GGUF preset' },
] as const;

export type LemonadeMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LemonadeMessage {
  role: LemonadeMessageRole;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface LemonadeToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LemonadeChatResult {
  content: string | null;
  finishReason?: string | null;
  toolCalls: LemonadeToolCall[];
}

export interface LemonadeModelInfo {
  id: string;
  name?: string;
}

export interface LemonadeHealthResult {
  available: boolean;
  models: LemonadeModelInfo[];
  error?: string;
}

export const INVALID_LEMONADE_ENDPOINT_MESSAGE = 'Lemonade endpoint must be a local loopback URL.';

interface LemonadeChatOptions {
  endpoint: string;
  model: string;
  messages: LemonadeMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface LemonadeChatStreamOptions extends LemonadeChatOptions {
  onContentDelta?: (delta: string) => void;
  streamIdleTimeoutMs?: number;
}

interface LemonadeLoadModelOptions {
  contextSize?: number;
  endpoint: string;
  model: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  const resolved = trimmed || DEFAULT_LEMONADE_ENDPOINT;
  return resolved.replace(/\/+$/, '');
}

export function isLoopbackLemonadeEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(normalizeEndpoint(endpoint));
    const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    return (url.protocol === 'http:' || url.protocol === 'https:') && allowedHosts.has(url.hostname);
  } catch {
    return false;
  }
}

function getValidatedEndpoint(endpoint: string): string {
  const normalized = normalizeEndpoint(endpoint);
  if (!isLoopbackLemonadeEndpoint(normalized)) {
    throw new Error(INVALID_LEMONADE_ENDPOINT_MESSAGE);
  }
  return normalized;
}

function lemonadeHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer lemonade',
  };
}

function createRequestController(signal?: AbortSignal, timeoutMs?: number): {
  clearTimeout: () => void;
  cleanup: () => void;
  didTimeout: () => boolean;
  signal: AbortSignal | undefined;
} {
  if (!signal && (!timeoutMs || timeoutMs <= 0)) {
    return {
      clearTimeout: () => undefined,
      cleanup: () => undefined,
      didTimeout: () => false,
      signal: undefined,
    };
  }

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const abortFromParent = () => controller.abort(signal?.reason);

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    clearTimeout: () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
    },
    cleanup: () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (signal) {
        signal.removeEventListener('abort', abortFromParent);
      }
    },
    didTimeout: () => timedOut,
    signal: controller.signal,
  };
}

function getRequestErrorMessage(error: unknown, requestController: { didTimeout: () => boolean }): string {
  if (requestController.didTimeout()) {
    return 'Lemonade request timed out. The local model may still be loading; stop and retry when it is ready.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Lemonade request failed.';
}

function buildChatRequestBody(options: LemonadeChatOptions, stream: boolean): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    model: options.model.trim() || DEFAULT_LEMONADE_MODEL,
    messages: options.messages,
    max_tokens: options.maxTokens ?? 4096,
    stream,
  };

  if (options.tools && options.tools.length > 0) {
    requestBody.tools = options.tools;
    requestBody.tool_choice = 'auto';
  }

  if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) {
    requestBody.temperature = Math.max(0, Math.min(2, options.temperature));
  }

  return requestBody;
}

function parseErrorPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as { error?: unknown; message?: unknown };
  if (payload.error && typeof payload.error === 'object') {
    const nested = payload.error as {
      message?: unknown;
      details?: {
        response?: {
          error?: {
            message?: unknown;
          };
        };
      };
    };
    const backendMessage = nested.details?.response?.error?.message;
    if (typeof backendMessage === 'string' && backendMessage.trim()) {
      return backendMessage;
    }
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  if (payload.error && typeof payload.error === 'object') {
    const nested = payload.error as { message?: unknown };
    if (typeof nested.message === 'string' && nested.message.trim()) {
      return nested.message;
    }
  }

  return null;
}

function getEmptyLemonadeResponseMessage(finishReason?: string | null): string {
  if (finishReason === 'length') {
    return 'Lemonade stopped before returning text because the model hit its output or context limit. Try fewer requested items, a shorter prompt, or increase the loaded model Context Size in Lemonade.';
  }

  if (finishReason === 'content_filter') {
    return 'Lemonade stopped the response because the model reported a content filter.';
  }

  if (finishReason === 'tool_calls') {
    return 'Lemonade requested tool calls, but none were usable by MasterSelects. Try the request again or switch to OpenAI for this edit.';
  }

  return finishReason
    ? `Lemonade finished with "${finishReason}" but returned no text. Try a shorter prompt or reload the model with a larger context size.`
    : 'Lemonade returned no text. Try a shorter prompt or reload the model with a larger context size.';
}

export function parseLemonadeChatCompletion(data: unknown): LemonadeChatResult {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
  };

  const choice = payload.choices?.[0];
  if (!choice?.message) {
    throw new Error(parseErrorPayload(data) || 'Lemonade returned an invalid chat completion response.');
  }

  const toolCalls = (choice.message.tool_calls || [])
    .map((toolCall, index): LemonadeToolCall => ({
      id: toolCall.id || `lemonade-tool-${index}`,
      name: toolCall.function?.name || '',
      arguments: toolCall.function?.arguments || '{}',
    }))
    .filter((toolCall) => toolCall.name.length > 0);

  return {
    content: choice.message.content || null,
    finishReason: choice.finish_reason ?? null,
    toolCalls,
  };
}

function parseSseDataPayload(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs?: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!idleTimeoutMs || idleTimeoutMs <= 0) {
    return reader.read();
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('Lemonade stream stalled. Stop and retry when the local model is ready.'));
      }, idleTimeoutMs);
    }),
  ]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

async function* readLemonadeSsePayloads(
  response: Response,
  idleTimeoutMs?: number,
): AsyncGenerator<unknown> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await readStreamChunk(reader, idleTimeoutMs);

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      while (true) {
        const separatorIndex = buffer.indexOf('\n\n');
        if (separatorIndex < 0) {
          break;
        }

        const rawEvent = buffer.slice(0, separatorIndex).trim();
        buffer = buffer.slice(separatorIndex + 2);

        if (!rawEvent) {
          continue;
        }

        const dataLines: string[] = [];
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        const payload = dataLines.join('\n');
        if (!payload || payload === '[DONE]') {
          continue;
        }

        yield parseSseDataPayload(payload);
      }
    }

    const trailingEvent = buffer.trim();
    if (trailingEvent) {
      const dataLines = trailingEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      const payload = dataLines.join('\n');
      if (payload && payload !== '[DONE]') {
        yield parseSseDataPayload(payload);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function createLemonadeChatCompletionStream(
  options: LemonadeChatStreamOptions,
): Promise<LemonadeChatResult> {
  const baseUrl = getValidatedEndpoint(options.endpoint);
  const requestController = createRequestController(options.signal, options.timeoutMs);
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...lemonadeHeaders(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(buildChatRequestBody(options, true)),
      signal: requestController.signal,
    });
  } catch (error) {
    requestController.cleanup();
    throw new Error(getRequestErrorMessage(error, requestController));
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    requestController.cleanup();
    throw new Error(parseErrorPayload(data) || `Lemonade API error: ${response.status}`);
  }
  requestController.clearTimeout();

  const toolCallParts = new Map<number, LemonadeToolCall>();
  let content = '';
  let finishReason: string | null = null;

  try {
    for await (const payload of readLemonadeSsePayloads(response, options.streamIdleTimeoutMs)) {
      const errorMessage = parseErrorPayload(payload);
      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (!payload || typeof payload !== 'object') {
        continue;
      }

      const chunk = payload as {
        choices?: Array<{
          finish_reason?: string | null;
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: {
                name?: string;
                arguments?: string;
              };
            }>;
          };
        }>;
      };

      const choice = chunk.choices?.[0];
      if (typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0) {
        finishReason = choice.finish_reason;
      }
      const delta = choice?.delta;
      if (!delta) {
        continue;
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        options.onContentDelta?.(delta.content);
      }

      for (const toolCallDelta of delta.tool_calls || []) {
        const index = toolCallDelta.index ?? toolCallParts.size;
        const current = toolCallParts.get(index) || {
          id: toolCallDelta.id || `lemonade-tool-${index}`,
          name: '',
          arguments: '',
        };

        toolCallParts.set(index, {
          id: toolCallDelta.id || current.id,
          name: toolCallDelta.function?.name || current.name,
          arguments: current.arguments + (toolCallDelta.function?.arguments || ''),
        });
      }
    }
  } catch (error) {
    throw new Error(getRequestErrorMessage(error, requestController));
  } finally {
    requestController.cleanup();
  }

  const result = {
    content: content || null,
    finishReason,
    toolCalls: Array.from(toolCallParts.entries())
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => toolCall)
      .filter((toolCall) => toolCall.name.length > 0),
  };

  if (!result.content && result.toolCalls.length === 0) {
    throw new Error(getEmptyLemonadeResponseMessage(finishReason));
  }

  return result;
}

export async function checkLemonadeHealth(endpoint: string): Promise<LemonadeHealthResult> {
  try {
    const baseUrl = getValidatedEndpoint(endpoint);
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer lemonade',
      },
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      return {
        available: false,
        models: [],
        error: parseErrorPayload(errorPayload) || `Server returned ${response.status}`,
      };
    }

    const data = await response.json();
    const rawModels: unknown[] = Array.isArray(data.data) ? data.data : [];
    const models = rawModels
      .map((model: unknown): LemonadeModelInfo | null => {
        if (typeof model === 'string') {
          return { id: model };
        }
        if (model && typeof model === 'object') {
          const candidate = model as { id?: unknown; name?: unknown };
          if (typeof candidate.id === 'string' && candidate.id.trim()) {
            return {
              id: candidate.id,
              name: typeof candidate.name === 'string' ? candidate.name : undefined,
            };
          }
        }
        return null;
      })
      .filter((model): model is LemonadeModelInfo => Boolean(model));

    return { available: true, models };
  } catch (error) {
    return {
      available: false,
      models: [],
      error: error instanceof Error ? error.message : 'Unable to reach Lemonade Server',
    };
  }
}

export async function loadLemonadeModel(options: LemonadeLoadModelOptions): Promise<void> {
  const contextSize = Math.trunc(options.contextSize ?? DEFAULT_LEMONADE_CONTEXT_SIZE);
  if (!Number.isFinite(contextSize) || contextSize <= 0) {
    return;
  }

  const baseUrl = getValidatedEndpoint(options.endpoint);
  const requestController = createRequestController(options.signal, options.timeoutMs);
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/load`, {
      method: 'POST',
      headers: lemonadeHeaders(),
      body: JSON.stringify({
        ctx_size: contextSize,
        model_name: options.model.trim() || DEFAULT_LEMONADE_MODEL,
      }),
      signal: requestController.signal,
    });
  } catch (error) {
    requestController.cleanup();
    throw new Error(getRequestErrorMessage(error, requestController));
  }

  const data = await response.json().catch(() => null);
  requestController.cleanup();

  if (!response.ok) {
    throw new Error(parseErrorPayload(data) || `Lemonade model load failed: ${response.status}`);
  }
}

export async function createLemonadeChatCompletion(options: LemonadeChatOptions): Promise<LemonadeChatResult> {
  const baseUrl = getValidatedEndpoint(options.endpoint);
  const requestController = createRequestController(options.signal, options.timeoutMs);
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: lemonadeHeaders(),
      body: JSON.stringify(buildChatRequestBody(options, false)),
      signal: requestController.signal,
    });
  } catch (error) {
    requestController.cleanup();
    throw new Error(getRequestErrorMessage(error, requestController));
  }

  const data = await response.json().catch(() => null);
  requestController.cleanup();

  if (!response.ok) {
    throw new Error(parseErrorPayload(data) || `Lemonade API error: ${response.status}`);
  }

  return parseLemonadeChatCompletion(data);
}
