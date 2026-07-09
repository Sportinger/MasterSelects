import {
  AI_TOOLS,
  createGuidedReplayBudgetController,
  executeAIToolCalls,
  getToolPolicy,
  type ToolPolicyEntry,
  type ToolResult,
} from '../aiTools';
import { useSettingsStore } from '../../stores/settingsStore';
import { FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS, FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS } from './FlashBoardChatConfig';
import type {
  AnthropicToolDefinition,
  FlashBoardApprovalMode,
  FlashBoardChatCompletionMessage,
  FlashBoardExecutedToolCall,
  FlashBoardToolCall,
  OpenAiResponsesToolDefinition,
} from './FlashBoardChatTypes';

export const OPENAI_RESPONSES_TOOLS: OpenAiResponsesToolDefinition[] = AI_TOOLS.map((tool) => ({
  type: 'function',
  name: tool.function.name,
  description: tool.function.description,
  parameters: tool.function.parameters,
  strict: false,
}));

export const ANTHROPIC_TOOLS: AnthropicToolDefinition[] = AI_TOOLS.map((tool) => ({
  name: tool.function.name,
  description: tool.function.description,
  input_schema: tool.function.parameters,
}));

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid model-supplied JSON is converted into an empty argument object.
  }

  return {};
}

function shouldRequireConfirmation(
  policy: ToolPolicyEntry | undefined,
  approvalMode: FlashBoardApprovalMode,
): boolean {
  if (!policy) return true;
  if (approvalMode === 'auto') return false;
  if (approvalMode === 'confirm-destructive') {
    return policy.requiresConfirmation || policy.riskLevel === 'high' ||
      policy.localFileAccess || policy.sensitiveDataAccess;
  }

  return !policy.readOnly;
}

function sanitizeToolResultValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
      return '[image data omitted from compact chat context]';
    }
    return value.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, '[image data omitted]');
  }

  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }

  if (depth >= 4) {
    return '[truncated nested value]';
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 30).map((item) => sanitizeToolResultValue(item, depth + 1));
    if (value.length > 30) {
      items.push(`[${value.length - 30} more items truncated]`);
    }
    return items;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of entries.slice(0, 50)) {
      sanitized[key] = sanitizeToolResultValue(nestedValue, depth + 1);
    }
    if (entries.length > 50) {
      sanitized.__truncatedKeys = entries.length - 50;
    }
    return sanitized;
  }

  return String(value);
}

function formatToolResultForModel(result: ToolResult, maxLength: number): string {
  const sanitized = JSON.stringify({
    success: result.success,
    data: sanitizeToolResultValue(result.data),
    error: result.error,
  });

  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  return JSON.stringify({
    success: result.success,
    error: result.error,
    preview: `${sanitized.slice(0, Math.max(256, maxLength - 128))}... [truncated]`,
    truncated: true,
  });
}

export function formatToolFollowupFallback(executedToolCalls: FlashBoardExecutedToolCall[]): string {
  if (executedToolCalls.length === 0) {
    return 'Done.';
  }

  return executedToolCalls
    .map(({ result, toolCall }) => (
      result.success
        ? `${toolCall.name}: done.`
        : `${toolCall.name}: ${result.error ?? 'failed.'}`
    ))
    .join('\n');
}

export async function executeFlashBoardToolCalls(
  toolCalls: FlashBoardToolCall[],
  maxToolResultChars: number,
): Promise<FlashBoardExecutedToolCall[]> {
  const approvalMode = useSettingsStore.getState().aiApprovalMode;
  const guidedReplayBudgetController = createGuidedReplayBudgetController();
  const preparedToolCalls: Array<{
    args: Record<string, unknown>;
    result?: ToolResult;
    toolCall: FlashBoardToolCall;
  }> = [];

  for (const toolCall of toolCalls) {
    const args = parseToolArguments(toolCall.arguments);
    const policy = getToolPolicy(toolCall.name);

    if (shouldRequireConfirmation(policy, approvalMode)) {
      preparedToolCalls.push({
        args,
        toolCall,
        result: {
          success: false,
          error: `Tool "${toolCall.name}" requires confirmation in the current AI approval mode. Use the full AI Editor approval flow or switch approval mode to Auto before running it from compact chat.`,
        },
      });
      continue;
    }

    preparedToolCalls.push({ args, toolCall });
  }

  const executableToolCalls = preparedToolCalls.filter((entry) => !entry.result);
  const executedResultsById = new Map<string, ToolResult>();

  if (executableToolCalls.length > 0) {
    try {
      const groupedResults = await executeAIToolCalls(
        executableToolCalls.map((entry) => ({
          id: entry.toolCall.id,
          tool: entry.toolCall.name,
          args: entry.args,
        })),
        'chat',
        { guidedReplayBudgetController },
      );
      for (const groupedResult of groupedResults) {
        if (groupedResult.id) {
          executedResultsById.set(groupedResult.id, groupedResult.result);
        }
      }
    } catch (error) {
      const result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      for (const entry of executableToolCalls) {
        executedResultsById.set(entry.toolCall.id, result);
      }
    }
  }

  return preparedToolCalls.map(({ result, toolCall }) => {
    const resolvedResult = result
      ?? executedResultsById.get(toolCall.id)
      ?? { success: false, error: 'Tool execution did not return a result.' };
    return {
      toolCall,
      result: resolvedResult,
      modelContent: formatToolResultForModel(resolvedResult, maxToolResultChars),
    };
  });
}

export async function runChatCompletionToolLoop(
  messages: FlashBoardChatCompletionMessage[],
  complete: (currentMessages: FlashBoardChatCompletionMessage[]) => Promise<{
    content: string | null;
    toolCalls: FlashBoardToolCall[];
  }>,
  providerName: string,
  maxToolResultChars = FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS,
  onExecutedToolCalls?: (toolCalls: FlashBoardExecutedToolCall[]) => void,
): Promise<string> {
  const executedToolCalls: FlashBoardExecutedToolCall[] = [];

  for (let iteration = 0; iteration < FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS; iteration += 1) {
    const result = await complete(messages);
    const content = result.content?.trim() || null;
    if (result.toolCalls.length === 0) {
      return content || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : `${providerName} returned an empty response.`
      );
    }

    messages.push({
      role: 'assistant',
      content,
      tool_calls: result.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      })),
    });

    const toolResults = await executeFlashBoardToolCalls(result.toolCalls, maxToolResultChars);
    executedToolCalls.push(...toolResults);
    onExecutedToolCalls?.(toolResults);
    for (const toolResult of toolResults) {
      messages.push({
        role: 'tool',
        content: toolResult.modelContent,
        tool_call_id: toolResult.toolCall.id,
      });
    }
  }

  return formatToolFollowupFallback(executedToolCalls) || 'Stopped after too many tool iterations.';
}
