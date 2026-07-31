import type { Env } from '../env';
import {
  normalizeHostedKieChatRequest,
  runHostedKieChatCompletion,
} from '../providers/kieChat';
import type {
  HostedAgentK1ProviderRoundRequest,
  HostedAgentK1ProviderRoundResponse,
  HostedAgentK1ToolBatchResult,
  HostedAgentK1TurnRequest,
  HostedAgentProviderProtocol,
} from '../../../src/services/kernelClient/hostedAgent/contracts';

export interface HostedAgentK1Provider {
  complete(
    request: HostedAgentK1ProviderRoundRequest,
    signal?: AbortSignal,
  ): Promise<HostedAgentK1ProviderRoundResponse>;
}

export interface HostedAgentK1ParsedRound {
  narration: string;
  providerContinuation: unknown[];
  toolCalls: Array<{
    args: unknown;
    arguments: string;
    toolCallId: string;
    toolName: string;
  }>;
}

export type HostedAgentK1ConversationState =
  | {
      input: unknown[];
      protocol: 'openai-responses';
    }
  | {
      messages: unknown[];
      protocol: 'claude-messages';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonArguments(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value ?? {}) ?? '{}';
  } catch {
    return '{}';
  }
}

function openAiNarration(raw: unknown): string {
  if (!isRecord(raw)) {
    return '';
  }
  if (typeof raw.output_text === 'string') {
    return raw.output_text.trim();
  }
  if (!Array.isArray(raw.output)) {
    return '';
  }
  return raw.output
    .flatMap((item) => isRecord(item) && Array.isArray(item.content) ? item.content : [])
    .filter((part) => (
      isRecord(part)
      && part.type === 'output_text'
      && typeof part.text === 'string'
    ))
    .map((part) => (part as { text: string }).text)
    .join('\n')
    .trim();
}

function parseOpenAiRound(raw: unknown): HostedAgentK1ParsedRound {
  const output = isRecord(raw) && Array.isArray(raw.output) ? raw.output : [];
  const toolCalls = output
    .map((item) => {
      if (
        !isRecord(item)
        || item.type !== 'function_call'
        || typeof item.call_id !== 'string'
        || typeof item.name !== 'string'
      ) {
        return null;
      }
      const argumentsText = jsonArguments(item.arguments);
      let args: unknown = {};
      try {
        args = JSON.parse(argumentsText) as unknown;
      } catch {
        // Client validation remains authoritative for malformed model arguments.
      }
      return {
        args,
        arguments: argumentsText,
        toolCallId: item.call_id,
        toolName: item.name,
      };
    })
    .filter((toolCall): toolCall is NonNullable<typeof toolCall> => toolCall !== null);
  return {
    narration: openAiNarration(raw),
    providerContinuation: output,
    toolCalls,
  };
}

function parseClaudeRound(raw: unknown): HostedAgentK1ParsedRound {
  const content = isRecord(raw) && Array.isArray(raw.content) ? raw.content : [];
  const narration = content
    .filter((block) => (
      isRecord(block)
      && block.type === 'text'
      && typeof block.text === 'string'
    ))
    .map((block) => (block as { text: string }).text)
    .join('\n')
    .trim();
  const toolCalls = content
    .map((block) => {
      if (
        !isRecord(block)
        || block.type !== 'tool_use'
        || typeof block.id !== 'string'
        || typeof block.name !== 'string'
      ) {
        return null;
      }
      return {
        args: block.input ?? {},
        arguments: jsonArguments(block.input),
        toolCallId: block.id,
        toolName: block.name,
      };
    })
    .filter((toolCall): toolCall is NonNullable<typeof toolCall> => toolCall !== null);
  return {
    narration,
    providerContinuation: content,
    toolCalls,
  };
}

export function parseHostedAgentK1ProviderRound(
  protocol: HostedAgentProviderProtocol,
  raw: unknown,
): HostedAgentK1ParsedRound {
  return protocol === 'openai-responses'
    ? parseOpenAiRound(raw)
    : parseClaudeRound(raw);
}

export function createHostedAgentK1ConversationState(
  request: HostedAgentK1TurnRequest,
): HostedAgentK1ConversationState {
  return request.providerInput.protocol === 'openai-responses'
    ? {
        input: [...request.providerInput.input],
        protocol: 'openai-responses',
      }
    : {
        messages: [...request.providerInput.messages],
        protocol: 'claude-messages',
      };
}

export function buildHostedAgentK1ProviderBody(
  request: HostedAgentK1TurnRequest,
  state: HostedAgentK1ConversationState,
): Record<string, unknown> {
  if (request.providerInput.protocol !== state.protocol) {
    throw new Error('The hosted-agent provider input changed protocol.');
  }
  if (state.protocol === 'openai-responses') {
    const providerInput = request.providerInput;
    if (providerInput.protocol !== 'openai-responses') {
      throw new Error('The hosted-agent OpenAI provider input is unavailable.');
    }
    const body: Record<string, unknown> = {
      input: state.input,
      instructions: request.systemPrompt,
      max_output_tokens: request.maximumOutputTokens,
      model: request.model,
      store: providerInput.store,
      tool_choice: providerInput.toolChoice ?? 'auto',
      tools: providerInput.tools,
    };
    if (providerInput.include !== undefined) {
      body.include = providerInput.include;
    }
    if (providerInput.text !== undefined) {
      body.text = providerInput.text;
    }
    if (request.reasoningEffort !== undefined) {
      body.reasoning = { effort: request.reasoningEffort };
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    return body;
  }

  const providerInput = request.providerInput;
  if (providerInput.protocol !== 'claude-messages') {
    throw new Error('The hosted-agent Claude provider input is unavailable.');
  }
  const body: Record<string, unknown> = {
    max_tokens: request.maximumOutputTokens,
    messages: state.messages,
    model: request.model,
    system: request.systemPrompt,
  };
  if (providerInput.tools.length > 0) {
    body.tools = providerInput.tools;
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (providerInput.toolChoice !== undefined) {
    body.tool_choice = providerInput.toolChoice;
  }
  if (providerInput.topP !== undefined) {
    body.top_p = providerInput.topP;
  }
  return body;
}

export function appendHostedAgentK1RoundToConversation(
  state: HostedAgentK1ConversationState,
  parsed: HostedAgentK1ParsedRound,
  batch: HostedAgentK1ToolBatchResult,
): void {
  if (state.protocol === 'openai-responses') {
    state.input.push(...parsed.providerContinuation);
    for (const result of batch.results) {
      state.input.push({
        call_id: result.toolCallId,
        output: result.modelContent,
        type: 'function_call_output',
      });
    }
    for (const result of batch.results) {
      if (result.providerContent?.openAiFollowupInput) {
        state.input.push(...result.providerContent.openAiFollowupInput);
      }
    }
    return;
  }

  state.messages.push({
    content: parsed.providerContinuation,
    role: 'assistant',
  });
  state.messages.push({
    content: batch.results.map((result) => ({
      content: result.providerContent?.claudeToolResultContent ?? result.modelContent,
      is_error: !result.success,
      tool_use_id: result.toolCallId,
      type: 'tool_result',
    })),
    role: 'user',
  });
}

export function createKieHostedAgentK1Provider(env: Env): HostedAgentK1Provider {
  return {
    async complete(request): Promise<HostedAgentK1ProviderRoundResponse> {
      const normalized = normalizeHostedKieChatRequest({
        ...request.body,
        model: request.model,
        protocol: request.protocol,
        stream: false,
      });
      if (!normalized) {
        throw new Error('The hosted-agent provider request is incompatible with Kie.ai.');
      }
      return {
        raw: await runHostedKieChatCompletion(env, normalized),
      };
    },
  };
}
