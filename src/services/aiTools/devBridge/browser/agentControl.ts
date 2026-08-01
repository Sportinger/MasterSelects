import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import {
  useFlashBoardStore,
  type FlashBoardChatExecutedToolCall,
  type FlashBoardChatMessage,
} from '../../../../stores/flashboardStore';
import {
  FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS,
} from '../../../flashboard/FlashBoardChatConfig';
import {
  executeFlashBoardToolCalls,
  FLASHBOARD_CHAT_TOOLS,
} from '../../../flashboard/FlashBoardChatTools';
import { redactFlashBoardChatImageData } from '../../../flashboard/FlashBoardChatImageData';
import {
  compareFlashBoardChatPrompts,
  runFlashBoardBridgeChatTurn,
} from '../../../flashboard/FlashBoardChatBridgeRunner';
import {
  findFlashBoardChatRunByIdempotencyKey,
  getFlashBoardChatRun,
  listFlashBoardChatRuns,
} from '../../../flashboard/FlashBoardChatRunAudit';
import { buildFlashBoardChatSystemPrompt } from '../../../flashboard/FlashBoardChatPrompt';
import type {
  FlashBoardChatPromptVersion,
  FlashBoardChatProvider,
  FlashBoardChatRunSource,
  FlashBoardChatToolExecutionMode,
  FlashBoardOpenAiReasoningEffort,
} from '../../../flashboard/FlashBoardChatTypes';
import {
  AI_TOOLS,
  executeAITool,
  getQuickTimelineSummary,
  getToolPolicy,
  type ToolDefinition,
} from '../../index';
import { getAIToolAuditEntry, listAIToolAuditEntries } from '../../audit';
import type { CallerContext, ToolPolicyEntry } from '../../policy';
import { isRecord, resolveBridgeToolExecution } from './guidedOptions';
import { projectFileService } from '../../../projectFileService';

export type AgentControlSurface = 'chat' | 'devBridge';

interface AgentControlToolDescriptor {
  definition: ToolDefinition;
  policy: ToolPolicyEntry | null;
  surface: AgentControlSurface;
}

interface AgentControlHistoryCall {
  args: Record<string, unknown>;
  argsRaw: string;
  callId: string;
  createdAt: number | null;
  messageId: string;
  modelContent: string;
  result: FlashBoardChatExecutedToolCall['result'];
  source: 'chat';
  status: 'succeeded' | 'failed';
  surface: 'chat';
  tool: string;
  toolCallId: string;
}

export function describeAgentControlSession(): Record<string, unknown> {
  const media = useMediaStore.getState();
  const timeline = useTimelineStore.getState();
  const messages = useFlashBoardStore.getState().chatMessages;
  const toolCallCount = messages.reduce((sum, message) => sum + (message.toolCalls?.length ?? 0), 0);

  return {
    chatMessageCount: messages.length,
    chatToolCallCount: toolCallCount,
    devToolCount: getSurfaceToolDefinitions('devBridge').length,
    chatToolCount: getSurfaceToolDefinitions('chat').length,
    projectId: media.currentProjectId,
    projectName: media.currentProjectName,
    projectFileOpen: projectFileService.isProjectOpen(),
    projectFileName: projectFileService.getProjectData()?.name ?? null,
    timelineClipCount: timeline.clips.length,
    timelineSummary: getQuickTimelineSummary(),
    title: typeof document !== 'undefined' ? document.title : 'MasterSelects',
    url: typeof location !== 'undefined' ? location.href : null,
  };
}

export async function handleAgentControlRequest(
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (operation) {
    case 'describeSession':
      return { success: true, data: describeAgentControlSession() };
    case 'listTools':
      return listAgentControlTools(args);
    case 'getToolSchema':
      return getAgentControlToolSchema(args);
    case 'getHistory':
      return getAgentControlHistory(args);
    case 'getCall':
      return getAgentControlCall(args);
    case 'sendChatTurn':
      return sendAgentControlChatTurn(args);
    case 'compareChatPrompts':
      return compareAgentControlChatPrompts(args);
    case 'listChatRuns':
      return listAgentControlChatRuns(args);
    case 'getChatRun':
      return getAgentControlChatRun(args);
    case 'findChatRunByIdempotencyKey':
      return findAgentControlChatRunByIdempotencyKey(args);
    case 'getChatPrompt':
      return getAgentControlChatPrompt(args);
    case 'executeTool':
      return executeAgentControlTool(args);
    default:
      return { success: false, error: `Unknown agent-control operation: ${operation}` };
  }
}

async function sendAgentControlChatTurn(args: Record<string, unknown>): Promise<unknown> {
  const prompt = readRequiredString(args.prompt);
  if (!prompt) return { success: false, error: 'Missing chat prompt.' };

  const result = await runFlashBoardBridgeChatTurn({
    includeContext: readOptionalBoolean(args.includeContext),
    includeHistory: readOptionalBoolean(args.includeHistory),
    includePlaybook: readOptionalBoolean(args.includePlaybook),
    idempotencyKey: readOptionalString(args.idempotencyKey),
    model: readOptionalString(args.model),
    openAiReasoningEffort: normalizeReasoningEffort(args.openAiReasoningEffort),
    persistToChat: readOptionalBoolean(args.persistToChat),
    prompt,
    promptVersion: normalizePromptVersion(args.promptVersion),
    provider: normalizeProvider(args.provider),
    referenceMediaFileIds: readOptionalStringArray(args.referenceMediaFileIds),
    runSource: normalizeRunSource(args.runSource),
    systemPromptOverride: readOptionalString(args.systemPromptOverride),
    temperature: readOptionalNumber(args.temperature),
    toolExecutionMode: normalizeToolExecutionMode(args.toolExecutionMode),
  });
  return { success: true, data: redactFlashBoardChatImageData(result) };
}

async function compareAgentControlChatPrompts(args: Record<string, unknown>): Promise<unknown> {
  const prompt = readRequiredString(args.prompt);
  if (!prompt) return { success: false, error: 'Missing chat prompt.' };
  const result = await compareFlashBoardChatPrompts({
    includeContext: readOptionalBoolean(args.includeContext),
    includeHistory: readOptionalBoolean(args.includeHistory),
    includePlaybook: readOptionalBoolean(args.includePlaybook),
    model: readOptionalString(args.model),
    openAiReasoningEffort: normalizeReasoningEffort(args.openAiReasoningEffort),
    prompt,
    provider: normalizeProvider(args.provider),
    runSource: normalizeRunSource(args.runSource),
    systemPromptOverride: readOptionalString(args.systemPromptOverride),
    temperature: readOptionalNumber(args.temperature),
  });
  return { success: true, data: redactFlashBoardChatImageData(result) };
}

async function listAgentControlChatRuns(args: Record<string, unknown>): Promise<unknown> {
  return {
    success: true,
    data: {
      runs: await listFlashBoardChatRuns({
        limit: normalizeHistoryLimit(args.limit),
        source: normalizeRunSource(args.source),
      }),
    },
  };
}

async function getAgentControlChatRun(args: Record<string, unknown>): Promise<unknown> {
  const runId = readRequiredString(args.runId);
  if (!runId) return { success: false, error: 'Missing runId.' };
  const run = await getFlashBoardChatRun(runId);
  return run
    ? { success: true, data: run }
    : { success: false, error: `Chat run "${runId}" was not found.` };
}

async function findAgentControlChatRunByIdempotencyKey(
  args: Record<string, unknown>,
): Promise<unknown> {
  const idempotencyKey = readRequiredString(args.idempotencyKey);
  if (!idempotencyKey) return { success: false, error: 'Missing idempotencyKey.' };
  const run = await findFlashBoardChatRunByIdempotencyKey(idempotencyKey);
  return { success: true, data: run };
}

function getAgentControlChatPrompt(args: Record<string, unknown>): unknown {
  const promptVersion = normalizePromptVersion(args.promptVersion) ?? 'v2';
  const userPrompt = readOptionalString(args.prompt) ?? '';
  const systemPrompt = buildFlashBoardChatSystemPrompt(
    readOptionalString(args.systemPromptOverride),
    {
      includeContext: args.includeContext !== false,
      includePlaybook: args.includePlaybook !== false,
      promptVersion,
      userPrompt,
    },
  );
  return {
    success: true,
    data: {
      characterCount: systemPrompt.length,
      promptVersion,
      systemPrompt,
    },
  };
}

export function flattenFlashBoardToolHistory(
  messages: FlashBoardChatMessage[],
): AgentControlHistoryCall[] {
  const calls: AgentControlHistoryCall[] = [];

  for (const message of messages) {
    for (const [index, executed] of (message.toolCalls ?? []).entries()) {
      const toolCallId = executed.toolCall.id || `tool-${index}`;
      calls.push({
        args: parseToolArguments(executed.toolCall.arguments),
        argsRaw: executed.toolCall.arguments,
        callId: createChatHistoryCallId(message.id, toolCallId),
        createdAt: typeof message.createdAt === 'number' ? message.createdAt : null,
        messageId: message.id,
        modelContent: executed.modelContent,
        result: redactFlashBoardChatImageData(executed.result),
        source: 'chat',
        status: executed.result.success ? 'succeeded' : 'failed',
        surface: 'chat',
        tool: executed.toolCall.name,
        toolCallId,
      });
    }
  }

  return calls;
}

function listAgentControlTools(args: Record<string, unknown>): unknown {
  const surface = normalizeSurface(args.surface);
  return {
    success: true,
    data: {
      surface,
      tools: getSurfaceToolDefinitions(surface).map((definition) => describeTool(definition, surface)),
    },
  };
}

function getAgentControlToolSchema(args: Record<string, unknown>): unknown {
  const surface = normalizeSurface(args.surface);
  const toolName = readRequiredString(args.tool ?? args.name);
  if (!toolName) {
    return { success: false, error: 'Missing tool name.' };
  }

  const definition = getSurfaceToolDefinitions(surface)
    .find((tool) => tool.function.name === toolName);
  if (!definition) {
    return { success: false, error: `Tool "${toolName}" is not available on the ${surface} surface.` };
  }

  return { success: true, data: describeTool(definition, surface) };
}

async function getAgentControlHistory(args: Record<string, unknown>): Promise<unknown> {
  const messages = redactFlashBoardChatImageData(useFlashBoardStore.getState().chatMessages);
  const tool = typeof args.tool === 'string' && args.tool.trim() ? args.tool.trim() : null;
  const limit = normalizeHistoryLimit(args.limit);
  const calls = flattenFlashBoardToolHistory(messages)
    .filter((call) => !tool || call.tool === tool)
    .slice(-limit)
    .reverse();
  const auditCalls = await listAIToolAuditEntries({
    limit,
    tool: tool ?? undefined,
  });

  return {
    success: true,
    data: {
      auditCalls,
      calls,
      messages: args.includeMessages === false ? undefined : messages,
      session: describeAgentControlSession(),
      totalCalls: flattenFlashBoardToolHistory(messages).length,
      totalMessages: messages.length,
    },
  };
}

async function getAgentControlCall(args: Record<string, unknown>): Promise<unknown> {
  const callId = readRequiredString(args.callId);
  if (!callId) {
    return { success: false, error: 'Missing callId.' };
  }

  const calls = flattenFlashBoardToolHistory(useFlashBoardStore.getState().chatMessages);
  const call = calls.find((candidate) =>
    candidate.callId === callId || candidate.toolCallId === callId
  );
  if (call) return { success: true, data: call };

  const auditCall = await getAIToolAuditEntry(callId);
  return auditCall
    ? { success: true, data: auditCall }
    : { success: false, error: `Tool call "${callId}" was not found in the current project chat or audit history.` };
}

async function executeAgentControlTool(args: Record<string, unknown>): Promise<unknown> {
  const surface = normalizeSurface(args.surface);
  const toolName = readRequiredString(args.tool ?? args.name);
  if (!toolName) {
    return { success: false, error: 'Missing tool name.' };
  }

  const definition = getSurfaceToolDefinitions(surface)
    .find((tool) => tool.function.name === toolName);
  if (!definition) {
    return { success: false, error: `Tool "${toolName}" is not available on the ${surface} surface.` };
  }

  const toolArgs = isRecord(args.args) ? args.args : {};
  if (surface === 'chat') {
    const toolCallId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `manual-${Date.now().toString(36)}`;
    const [executed] = await executeFlashBoardToolCalls([{
      id: toolCallId,
      name: toolName,
      arguments: JSON.stringify(toolArgs),
    }], FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS);

    if (!executed) {
      return { success: false, error: `Tool "${toolName}" did not return a result.` };
    }
    return {
      success: executed.result.success,
      data: {
        modelContent: executed.modelContent,
        result: executed.result,
        surface,
        tool: toolName,
        toolCallId,
      },
      error: executed.result.error,
    };
  }

  const execution = resolveBridgeToolExecution(toolArgs, args.options);
  return executeAITool(toolName, execution.args, 'devBridge', execution.options);
}

function getSurfaceToolDefinitions(surface: AgentControlSurface): ToolDefinition[] {
  if (surface === 'chat') {
    return FLASHBOARD_CHAT_TOOLS;
  }
  return AI_TOOLS.filter((tool) => isAllowedForCaller(tool.function.name, 'devBridge'));
}

function describeTool(
  definition: ToolDefinition,
  surface: AgentControlSurface,
): AgentControlToolDescriptor {
  return {
    definition,
    policy: getToolPolicy(definition.function.name) ?? null,
    surface,
  };
}

function isAllowedForCaller(toolName: string, caller: CallerContext): boolean {
  return getToolPolicy(toolName)?.allowedCallers.includes(caller) === true;
}

function normalizeSurface(value: unknown): AgentControlSurface {
  return value === 'devBridge' ? 'devBridge' : 'chat';
}

function readRequiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean))].slice(0, 4);
}

function normalizePromptVersion(value: unknown): FlashBoardChatPromptVersion | undefined {
  return value === 'v2' || value === 'legacy-v1' ? value : undefined;
}

function normalizeProvider(value: unknown): FlashBoardChatProvider | undefined {
  return value === 'kernel' || value === 'kie' || value === 'lemonade'
    ? value
    : undefined;
}

function normalizeRunSource(value: unknown): FlashBoardChatRunSource | undefined {
  return value === 'ui' || value === 'bridge' || value === 'mcp' || value === 'test'
    ? value
    : undefined;
}

function normalizeToolExecutionMode(value: unknown): FlashBoardChatToolExecutionMode | undefined {
  return value === 'normal' || value === 'read-only' ? value : undefined;
}

function normalizeReasoningEffort(value: unknown): FlashBoardOpenAiReasoningEffort | undefined {
  return value === 'none' || value === 'low' || value === 'medium'
    || value === 'high' || value === 'xhigh'
    ? value
    : undefined;
}

function normalizeHistoryLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(2_000, Math.round(value)))
    : 500;
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function createChatHistoryCallId(messageId: string, toolCallId: string): string {
  return `chat:${encodeURIComponent(messageId)}:${encodeURIComponent(toolCallId)}`;
}
