import type { AnthropicContentBlock, AnthropicTextBlock, AnthropicToolUseBlock, FlashBoardToolCall, OpenAiResponsesFunctionCall } from './FlashBoardChatTypes';

export function readErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as { error?: unknown; message?: unknown };
  if (typeof payload.message === 'string') {
    return payload.message;
  }
  if (payload.error && typeof payload.error === 'object') {
    const error = payload.error as { message?: unknown };
    return typeof error.message === 'string' ? error.message : null;
  }
  if (typeof payload.error === 'string') {
    return payload.error;
  }

  return null;
}

export function readOpenAiResponseText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const response = data as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        text?: unknown;
        type?: string;
      }>;
      type?: string;
    }>;
  };

  if (typeof response.output_text === 'string') {
    return response.output_text.trim();
  }

  return response.output
    ?.flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
    .trim() ?? '';
}

export function readOpenAiChatCompletionText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const response = data as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = response.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

export function parseOpenAiChatCompletion(data: unknown): {
  content: string | null;
  finishReason: string | null;
  toolCalls: FlashBoardToolCall[];
} {
  const payload = data as {
    choices?: Array<{
      finish_reason?: unknown;
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: {
            arguments?: string;
            name?: string;
          };
        }>;
      };
    }>;
  };
  const message = payload.choices?.[0]?.message;
  return {
    content: typeof message?.content === 'string' ? message.content.trim() : null,
    finishReason: typeof payload.choices?.[0]?.finish_reason === 'string'
      ? payload.choices[0].finish_reason
      : null,
    toolCalls: (message?.tool_calls ?? [])
      .map((toolCall, index): FlashBoardToolCall => ({
        id: toolCall.id || `flashboard-tool-${index}`,
        name: toolCall.function?.name || '',
        arguments: toolCall.function?.arguments || '{}',
      }))
      .filter((toolCall) => toolCall.name.length > 0),
  };
}

export function getOpenAiResponsesOutput(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') {
    return [];
  }

  const response = data as { output?: unknown };
  return Array.isArray(response.output) ? response.output : [];
}

export function parseOpenAiResponsesToolCalls(data: unknown): FlashBoardToolCall[] {
  return getOpenAiResponsesOutput(data)
    .map((item): FlashBoardToolCall | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const candidate = item as Partial<OpenAiResponsesFunctionCall>;
      if (candidate.type !== 'function_call' || !candidate.name || !candidate.call_id) {
        return null;
      }

      return {
        id: candidate.call_id,
        name: candidate.name,
        arguments: typeof candidate.arguments === 'string' ? candidate.arguments : '{}',
      };
    })
    .filter((toolCall): toolCall is FlashBoardToolCall => toolCall !== null);
}

export function parseAnthropicToolCalls(data: unknown): {
  contentBlocks: AnthropicContentBlock[];
  text: string | null;
  toolCalls: FlashBoardToolCall[];
} {
  const payload = data as { content?: unknown };
  const contentBlocks = Array.isArray(payload.content) ? payload.content as AnthropicContentBlock[] : [];
  const text = contentBlocks
    .filter((block): block is AnthropicTextBlock => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
  const toolCalls = contentBlocks
    .filter((block): block is AnthropicToolUseBlock => (
      block.type === 'tool_use'
      && typeof block.id === 'string'
      && typeof block.name === 'string'
    ))
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: JSON.stringify(block.input ?? {}),
    }));

  return {
    contentBlocks,
    text: text || null,
    toolCalls,
  };
}
