import type { ToolDefinition } from './aiTools/types';

export const DEFAULT_LEMONADE_ENDPOINT = 'http://localhost:13305/api/v1';
export const DEFAULT_LEMONADE_MODEL = 'gemma4-it-e2b-FLM';

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
  signal?: AbortSignal;
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

function parseErrorPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as { error?: unknown; message?: unknown };
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
    }>;
  };

  const choice = payload.choices?.[0];
  if (!choice?.message) {
    throw new Error('Lemonade returned an invalid chat completion response.');
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
    toolCalls,
  };
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

export async function createLemonadeChatCompletion(options: LemonadeChatOptions): Promise<LemonadeChatResult> {
  const baseUrl = getValidatedEndpoint(options.endpoint);
  const requestBody: Record<string, unknown> = {
    model: options.model.trim() || DEFAULT_LEMONADE_MODEL,
    messages: options.messages,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  };

  if (options.tools && options.tools.length > 0) {
    requestBody.tools = options.tools;
    requestBody.tool_choice = 'auto';
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: lemonadeHeaders(),
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(parseErrorPayload(data) || `Lemonade API error: ${response.status}`);
  }

  return parseLemonadeChatCompletion(data);
}
