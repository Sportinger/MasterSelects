import { createOpenAIChatCompletion } from '../openai';
import type { Env } from '../env';

export type HostedChatRole = 'assistant' | 'developer' | 'system' | 'tool' | 'user';

export interface HostedChatMessage {
  content: unknown;
  name?: string;
  role: HostedChatRole;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      arguments: string;
      name: string;
    };
  }>;
  tool_call_id?: string;
}

export interface HostedChatRequest {
  max_completion_tokens?: number;
  max_tokens?: number;
  messages: HostedChatMessage[];
  model: string;
  reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  response_format?: Record<string, unknown>;
  stream?: boolean;
  tool_choice?: unknown;
  tools?: unknown;
  temperature?: number;
  top_p?: number;
}

export interface HostedChatCapabilities {
  byoExplicit: true;
  model: string;
  provider: 'openai';
  streamingSupported: false;
}

const SUPPORTED_REASONING_EFFORTS = new Set<NonNullable<HostedChatRequest['reasoning_effort']>>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeNumericValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function normalizeToolCalls(value: unknown): HostedChatMessage['tool_calls'] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const toolCalls = value
    .filter(isRecord)
    .map((toolCall) => {
      const id = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
      const type = typeof toolCall.type === 'string' ? toolCall.type.trim().toLowerCase() : '';
      const fn = isRecord(toolCall.function) ? toolCall.function : null;
      const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
      const argumentsText = typeof fn?.arguments === 'string' ? fn.arguments : '';

      if (!id || type !== 'function' || !name) {
        return null;
      }

      return {
        function: {
          arguments: argumentsText,
          name,
        },
        id,
        type: 'function' as const,
      };
    })
    .filter((toolCall): toolCall is NonNullable<HostedChatMessage['tool_calls']>[number] => toolCall !== null);

  return toolCalls.length > 0 ? toolCalls : undefined;
}

export function normalizeHostedChatRequest(body: unknown): HostedChatRequest | null {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return null;
  }

  const messages = body.messages
    .filter(isRecord)
    .map((message) => {
      const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : '';
      const content = message.content;

      if (!role || content === undefined) {
        return null;
      }

      if (!['assistant', 'developer', 'system', 'tool', 'user'].includes(role)) {
        return null;
      }

      const normalized: HostedChatMessage = {
        content,
        role: role as HostedChatRole,
      };

      if (typeof message.name === 'string' && message.name.trim()) {
        normalized.name = message.name.trim();
      }

      const toolCalls = normalizeToolCalls(message.tool_calls);
      if (toolCalls) {
        normalized.tool_calls = toolCalls;

        if (typeof normalized.content !== 'string' || normalized.content.trim().length === 0) {
          normalized.content = 'Calling tools.';
        }
      }

      if (typeof message.tool_call_id === 'string' && message.tool_call_id.trim()) {
        normalized.tool_call_id = message.tool_call_id.trim();
      }

      return normalized;
    })
    .filter((message): message is HostedChatMessage => message !== null);

  if (messages.length === 0) {
    return null;
  }

  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-4.1-mini';
  const reasoningEffortCandidate =
    typeof body.reasoning_effort === 'string'
      ? body.reasoning_effort.trim() as NonNullable<HostedChatRequest['reasoning_effort']>
      : undefined;

  return {
    max_completion_tokens: normalizeNumericValue(body.max_completion_tokens),
    max_tokens: normalizeNumericValue(body.max_tokens),
    messages,
    model,
    reasoning_effort: reasoningEffortCandidate && SUPPORTED_REASONING_EFFORTS.has(reasoningEffortCandidate)
      ? reasoningEffortCandidate
      : undefined,
    response_format: isRecord(body.response_format) ? body.response_format : undefined,
    stream: body.stream === true,
    tool_choice: body.tool_choice,
    tools: body.tools,
    temperature: normalizeNumericValue(body.temperature),
    top_p: normalizeNumericValue(body.top_p),
  };
}

export async function runHostedChatCompletion(env: Env, request: HostedChatRequest): Promise<unknown> {
  return createOpenAIChatCompletion(env, {
    max_completion_tokens: request.max_completion_tokens,
    max_tokens: request.max_tokens,
    messages: request.messages,
    model: request.model,
    reasoning_effort: request.reasoning_effort,
    response_format: request.response_format,
    stream: false,
    tool_choice: request.tool_choice,
    tools: request.tools,
    temperature: request.temperature,
    top_p: request.top_p,
  });
}

export function buildHostedChatCapabilities(): HostedChatCapabilities {
  return {
    byoExplicit: true,
    model: 'gpt-4.1-mini',
    provider: 'openai',
    streamingSupported: false,
  };
}
