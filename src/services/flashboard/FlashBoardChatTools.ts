import {
  AI_TOOLS,
  createGuidedReplayBudgetController,
  executeAIToolCalls,
  getToolPolicy,
  type ToolResult,
} from '../aiTools';
import {
  FLASHBOARD_CHAT_MAX_PROVIDER_TOOLS,
  FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS,
  FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS,
} from './FlashBoardChatConfig';
import {
  findFlashBoardChatImageData,
  redactFlashBoardChatImageData,
} from './FlashBoardChatImageData';
import type {
  AnthropicToolDefinition,
  AgentActivityEventInput,
  FlashBoardChatCompletionMessage,
  FlashBoardChatToolExecutionMode,
  FlashBoardExecutedToolCall,
  FlashBoardToolCall,
  OpenAiResponsesToolDefinition,
} from './FlashBoardChatTypes';

const FLASHBOARD_CHAT_PRIORITY_TOOL_NAMES = new Set([
  'getTimelineState',
  'getTimelineAnalysis',
  'getClipDetails',
  'getClipFaceAnalysis',
  'startClipFaceAnalysis',
  'mergeClipFacePeople',
  'moveClipFaceAppearance',
  'assignClipFaceReviewCandidate',
  'cutRangesFromClip',
  'splitClip',
  'deleteClip',
  'trimClip',
  'getTextProperties',
  'createTextClip',
  'updateTextProperties',
  'setTextBox',
  'addTextBoundsKeyframe',
  'getMotionCapabilities',
  'getMotionDesign',
  'createMotionShapeClip',
  'updateMotionProperties',
  'updateMotionAppearances',
  'configureMotionReplicator',
  'editMotionModifier',
]);

const eligibleFlashBoardChatTools = AI_TOOLS.filter((tool) => (
  getToolPolicy(tool.function.name)?.allowedCallers.includes('chat') === true
));

export const FLASHBOARD_CHAT_TOOLS = [
  ...eligibleFlashBoardChatTools.filter((tool) => FLASHBOARD_CHAT_PRIORITY_TOOL_NAMES.has(tool.function.name)),
  ...eligibleFlashBoardChatTools.filter((tool) => !FLASHBOARD_CHAT_PRIORITY_TOOL_NAMES.has(tool.function.name)),
].slice(0, FLASHBOARD_CHAT_MAX_PROVIDER_TOOLS);

export const OPENAI_RESPONSES_TOOLS: OpenAiResponsesToolDefinition[] = FLASHBOARD_CHAT_TOOLS.map((tool) => ({
  type: 'function',
  name: tool.function.name,
  description: tool.function.description,
  parameters: tool.function.parameters,
  strict: false,
}));

export const ANTHROPIC_TOOLS: AnthropicToolDefinition[] = FLASHBOARD_CHAT_TOOLS.map((tool) => ({
  name: tool.function.name,
  description: tool.function.description,
  input_schema: tool.function.parameters,
}));

export function getFlashBoardToolResultImage(toolResult: FlashBoardExecutedToolCall): {
  base64: string;
  dataUrl: string;
  mediaType: string;
} | null {
  return findFlashBoardChatImageData(toolResult.result.data);
}

export function prepareFlashBoardToolCallsForHistory(
  toolCalls: FlashBoardExecutedToolCall[],
): FlashBoardExecutedToolCall[] {
  return redactFlashBoardChatImageData(toolCalls);
}

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

/**
 * Strips base64 image payloads and nothing else.
 *
 * This used to also cap nesting depth at 4, arrays at 30 entries and objects at
 * 50 keys. On a 26-clip timeline that turned `getTimelineState` into a lossy
 * prefix, so the model had to re-read the same range in overlapping slices
 * (0-130, 0-65, 65-130, 55-65 in one observed run) and clip ids were dropped
 * mid-list. Structural truncation is gone: the model gets the whole result.
 */
function sanitizeToolResultValue(value: unknown): unknown {
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

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolResultValue(item));
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeToolResultValue(nestedValue);
    }
    return sanitized;
  }

  return String(value);
}

function formatToolResultForModel(
  result: ToolResult,
  maxLength: number,
): string {
  const sanitized = JSON.stringify({
    success: result.success,
    data: sanitizeToolResultValue(result.data),
    error: result.error,
  });

  // A non-finite budget means "hand the model everything", which is the
  // default for hosted models. Local models keep a real cap because their
  // context is genuinely small.
  if (!Number.isFinite(maxLength) || sanitized.length <= maxLength) {
    return sanitized;
  }

  return JSON.stringify({
    success: result.success,
    error: result.error,
    preview: `${sanitized.slice(0, Math.max(256, maxLength - 128))}... [truncated]`,
    truncated: true,
  });
}

const COMPACT_MOTION_MUTATION_TOOLS = new Set([
  'createMotionShapeClip',
  'updateMotionProperties',
  'updateMotionAppearances',
  'configureMotionReplicator',
  'editMotionModifier',
]);

function compactMotionMutationResultForModel(
  toolName: string,
  result: ToolResult,
): ToolResult {
  if (
    !COMPACT_MOTION_MUTATION_TOOLS.has(toolName)
    || !result.success
    || !result.data
    || typeof result.data !== 'object'
    || Array.isArray(result.data)
  ) {
    return result;
  }

  const data = result.data as Record<string, unknown>;
  const motion = data.motion && typeof data.motion === 'object' && !Array.isArray(data.motion)
    ? data.motion as Record<string, unknown>
    : null;
  const position = Array.isArray(data.properties)
    ? data.properties.filter((property) => (
        property
        && typeof property === 'object'
        && ['position.x', 'position.y'].includes(String((property as { path?: unknown }).path))
      ))
    : [];
  const compactData: Record<string, unknown> = {};
  for (const key of [
    'clipId',
    'trackId',
    'name',
    'startTime',
    'duration',
    'sourceType',
    'primaryAppearanceIds',
    'commonEditablePaths',
    'updatedProperties',
    'configuredProperties',
    'createdAppearanceIds',
    'createdGradientStopIds',
    'effectiveReplicator',
    'stateRevisionBefore',
    'stateRevisionAfter',
    'entities',
  ]) {
    if (data[key] !== undefined) compactData[key] = data[key];
  }
  if (motion?.shape !== undefined) compactData.shape = motion.shape;
  if (position.length > 0) compactData.position = position;
  compactData.detail = 'Compact mutation receipt. Reuse commonEditablePaths for position and shape edits; call getMotionDesign only for uncommon editable descriptors.';
  return { success: true, data: compactData };
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
  options: { toolExecutionMode?: FlashBoardChatToolExecutionMode } = {},
): Promise<FlashBoardExecutedToolCall[]> {
  const guidedReplayBudgetController = createGuidedReplayBudgetController();
  const preparedToolCalls: Array<{
    args: Record<string, unknown>;
    result?: ToolResult;
    toolCall: FlashBoardToolCall;
  }> = [];

  for (const toolCall of toolCalls) {
    const parsedArgs = parseToolArguments(toolCall.arguments);
    const args = toolCall.name === 'getTimelineAnalysis'
      ? {
          ...parsedArgs,
          limit: Math.min(
            maxToolResultChars <= 2500 ? 5 : 25,
            Math.max(1, Number(parsedArgs.limit) || 25),
          ),
          maxBytes: Math.min(
            Math.max(1024, maxToolResultChars - 512),
            Math.max(1, Number(parsedArgs.maxBytes) || 6 * 1024),
          ),
        }
      : parsedArgs;
    const policy = getToolPolicy(toolCall.name);

    if (options.toolExecutionMode === 'read-only' && policy?.readOnly !== true) {
      preparedToolCalls.push({
        args,
        toolCall,
        result: {
          success: false,
          error: `Tool "${toolCall.name}" is mutating and this diagnostic chat run is read-only.`,
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
        {
          executionMode: options.toolExecutionMode,
          guidedReplayBudgetController,
        },
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
      modelContent: formatToolResultForModel(
        compactMotionMutationResultForModel(toolCall.name, resolvedResult),
        maxToolResultChars,
      ),
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
  includeToolResultImages = false,
  toolExecutionMode: FlashBoardChatToolExecutionMode = 'normal',
  onActivityEvent?: (event: AgentActivityEventInput) => void,
  signal?: AbortSignal,
): Promise<string> {
  const executedToolCalls: FlashBoardExecutedToolCall[] = [];

  for (let iteration = 0; iteration < FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS; iteration += 1) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Chat stopped.', 'AbortError');
    const result = await complete(messages);
    const content = result.content?.trim() || null;
    if (result.toolCalls.length === 0) {
      return content || (
        executedToolCalls.length > 0
          ? formatToolFollowupFallback(executedToolCalls)
          : `${providerName} returned an empty response.`
      );
    }

    if (content) {
      onActivityEvent?.({
        kind: 'narration',
        phase: iteration === 0 ? 'inspecting' : 'acting',
        roundIndex: iteration,
        text: content,
      });
    }
    for (const toolCall of result.toolCalls) {
      onActivityEvent?.({
        kind: 'operation',
        phase: 'started',
        safeLabel: toolCall.name,
        operationId: toolCall.id,
        toolName: toolCall.name,
      });
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

    if (signal?.aborted) throw signal.reason ?? new DOMException('Chat stopped.', 'AbortError');
    const toolResults = await executeFlashBoardToolCalls(
      result.toolCalls,
      maxToolResultChars,
      { toolExecutionMode },
    );
    executedToolCalls.push(...toolResults);
    for (const toolResult of toolResults) {
      onActivityEvent?.({
        kind: 'operation',
        phase: toolResult.result.success ? 'completed' : 'failed',
        safeLabel: toolResult.toolCall.name,
        operationId: toolResult.toolCall.id,
        toolName: toolResult.toolCall.name,
      });
    }
    onExecutedToolCalls?.(prepareFlashBoardToolCallsForHistory(toolResults));
    for (const toolResult of toolResults) {
      messages.push({
        role: 'tool',
        content: toolResult.modelContent,
        tool_call_id: toolResult.toolCall.id,
      });
    }
    if (includeToolResultImages) {
      for (const toolResult of toolResults) {
        const image = getFlashBoardToolResultImage(toolResult);
        if (image) {
          messages.push({
            role: 'user',
            content: `Visual output from ${toolResult.toolCall.name}:`,
            imageDataUrl: image.dataUrl,
          });
        }
      }
    }
  }

  return formatToolFollowupFallback(executedToolCalls) || 'Stopped after too many tool iterations.';
}
