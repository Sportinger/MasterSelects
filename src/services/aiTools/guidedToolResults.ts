import type { AIToolCallExecution, AIToolCallExecutionResult, ToolResult } from './types';
import type { GuidedSessionResult } from '../guidedActions';

export function toolResultFromGuidedSession(
  toolName: string,
  result: GuidedSessionResult,
): ToolResult {
  if (result.toolResults.length > 1) {
    const succeeded = result.toolResults.filter((entry) => entry.success).length;
    const failed = result.toolResults.length - succeeded;
    return {
      success: result.status === 'completed' && failed === 0,
      ...(result.status === 'completed' && failed === 0 ? {} : { error: result.error ?? `Guided AI execution ${result.status}` }),
      data: {
        guidedSessionId: result.sessionId,
        tool: toolName,
        totalActions: result.toolResults.length,
        succeeded,
        failed,
        results: result.toolResults,
        status: result.status,
      },
    };
  }

  const primaryToolResult = result.toolResults[0];
  if (primaryToolResult) {
    if (result.status === 'completed') return primaryToolResult;
    return {
      success: false,
      error: result.error ?? `Guided AI execution ${result.status}`,
      data: {
        guidedSessionId: result.sessionId,
        status: result.status,
        tool: toolName,
        toolResult: primaryToolResult,
      },
    };
  }

  if (result.status === 'completed') {
    return {
      success: true,
      data: {
        guidedSessionId: result.sessionId,
        tool: toolName,
      },
    };
  }

  return {
    success: false,
    error: result.error ?? `Guided AI execution ${result.status}`,
    data: {
      cancelled: result.status === 'cancelled',
      guidedSessionId: result.sessionId,
      skipped: result.status === 'skipped',
      status: result.status,
      tool: toolName,
    },
  };
}

export function batchToolResultFromGuidedSession(
  args: Record<string, unknown>,
  result: GuidedSessionResult,
): ToolResult {
  const actions = Array.isArray(args.actions) ? args.actions : [];
  const results = actions.map((action, index) => {
    const tool = isToolActionRecord(action) ? action.tool : `action-${index}`;
    const toolResult = result.toolResults[index];
    return {
      tool,
      success: toolResult?.success ?? false,
      data: toolResult?.data,
      error: toolResult?.error,
    };
  });
  const succeeded = results.filter((entry) => entry.success).length;
  const failed = results.length - succeeded;
  const completed = result.status === 'completed';

  return {
    success: completed && failed === 0,
    ...(completed ? {} : { error: result.error ?? `Guided AI execution ${result.status}` }),
    data: {
      guidedSessionId: result.sessionId,
      totalActions: actions.length,
      succeeded,
      failed,
      results,
      status: result.status,
    },
  };
}

export function toolResultsFromGuidedSessionGroup(
  toolCalls: AIToolCallExecution[],
  result: GuidedSessionResult,
): AIToolCallExecutionResult[] {
  return toolCalls.map((toolCall, index) => ({
    id: toolCall.id,
    tool: toolCall.tool,
    result: result.toolResults[index] ?? createMissingGroupedToolResult(toolCall.tool, result),
  }));
}

export function createMissingGroupedToolResult(
  toolName: string,
  result?: GuidedSessionResult,
): ToolResult {
  if (result?.status === 'completed') {
    return {
      success: true,
      data: {
        guidedSessionId: result.sessionId,
        tool: toolName,
      },
    };
  }

  return {
    success: false,
    error: result?.error ?? `Guided AI execution ${result?.status ?? 'did not return a tool result'}`,
    data: {
      cancelled: result?.status === 'cancelled',
      guidedSessionId: result?.sessionId,
      skipped: result?.status === 'skipped',
      status: result?.status,
      tool: toolName,
    },
  };
}

export function formatGroupedToolLabel(toolCalls: AIToolCallExecution[]): string {
  const names = Array.from(new Set(toolCalls.map((toolCall) => toolCall.tool)));
  if (names.length === 1) {
    return `${names[0]} x${toolCalls.length}`;
  }
  if (names.length <= 3) {
    return names.join(', ');
  }
  return `${toolCalls.length} tools`;
}

export function getToolCallResultKey(toolCall: Pick<AIToolCallExecution, 'id' | 'tool'>): string {
  return toolCall.id ? `id:${toolCall.id}` : `tool:${toolCall.tool}`;
}

export function isToolActionRecord(value: unknown): value is { tool: string } {
  return !!value
    && typeof value === 'object'
    && 'tool' in value
    && typeof (value as { tool?: unknown }).tool === 'string';
}
