import type { ToolDefinition, ToolResult } from '../aiTools/types';

/**
 * Compact tool surface for Direct providers without hosted tool search.
 * Sending all ~217 full schemas costs ~58k input tokens on every model call;
 * here only everyday editing tools carry their schema, the rest are listed by
 * name and one line and are described on demand through getToolSchema.
 */
export const DIRECT_TOOL_SCHEMA_TOOL = 'getToolSchema';
const MAX_SCHEMA_REQUEST = 12;

const CORE_TOOLS = new Set([
  'getTimelineState', 'getClipDetails', 'getMediaItems', 'getMediaPreviewFrames', 'captureFrame', 'setPlayhead',
  'selectClips', 'splitClip', 'trimClip', 'moveClip', 'deleteClips', 'executeBatch', 'undo', 'redo',
  'listEffects', 'addEffect', 'updateEffect', 'removeEffect', 'setTransform', 'getKeyframes', 'addKeyframe',
  'focusNodeGraph', 'searchNodeCatalog', 'getNodeDefinitions', 'createImageNodeGraph', 'getOperatorGraph', 'editOperatorGraph',
]);

/**
 * Loaded up front even where hosted tool search defers the rest: node authoring
 * otherwise starts with repeated tool-search steps that reread the conversation.
 */
export const DIRECT_EAGER_TOOLS: ReadonlySet<string> = new Set([
  'getTimelineState', 'searchNodeCatalog', 'getNodeDefinitions', 'createImageNodeGraph', 'editOperatorGraph', 'getOperatorGraph', 'focusNodeGraph',
  'captureFrame',
]);

/** Diagnostics, QA fixtures and UI automation belong to the dev bridge, not to a chat model. */
const DEV_ONLY_TOOL = /^(?:(?:run|capture|verify)WorkerFirst|simulate)|^(?:getStats|getStatsHistory|getAudioDiagnostics|getLogs|getPlaybackTrace|getRuntimeDiagnostics|clearRuntimeDiagnostics|purgePlaybackPath|samplePlaybackFramePacing|setRenderHostMode|profileAppInteraction|clickAppControl|fillAppControl|probeSameOriginRequest|captureAppScreenshot|getCaptureState|monitorManualPause|runPixelParticleDisintegrateQa|getNodeWorkspaceDebugState|verifyTimelineInvariants)$/;

function firstSentence(description: string): string {
  const sentence = description.split(/(?<=\.)\s/u)[0].trim();
  return sentence.length <= 140 ? sentence : `${sentence.slice(0, 137).trimEnd()}…`;
}

/** One dynamic-tool entry, or none for dev-only tools. */
export function compactDirectToolEntry(tool: ToolDefinition): Array<Record<string, unknown>> {
  const name = tool.function.name;
  if (DEV_ONLY_TOOL.test(name)) return [];
  if (CORE_TOOLS.has(name)) {
    return [{ description: tool.function.description, inputSchema: tool.function.parameters, name, type: 'function' }];
  }
  return [{
    description: `${firstSentence(tool.function.description)} Arguments: call ${DIRECT_TOOL_SCHEMA_TOOL} first.`,
    inputSchema: { type: 'object', additionalProperties: true },
    name,
    type: 'function',
  }];
}

export function directToolSchemaEntry(): Record<string, unknown> {
  return {
    description: `Return the full argument schema and description for listed tools whose entry says "Arguments: call ${DIRECT_TOOL_SCHEMA_TOOL} first". Request only the tools you are about to use (max ${MAX_SCHEMA_REQUEST}).`,
    inputSchema: { type: 'object', additionalProperties: false, required: ['names'], properties: {
      names: { type: 'array', minItems: 1, maxItems: MAX_SCHEMA_REQUEST, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 120 } },
    } },
    name: DIRECT_TOOL_SCHEMA_TOOL,
    type: 'function',
  };
}

/** Read-only and browser-local: it never reaches editor policy or execution. */
export function directToolSchemaResult(args: Record<string, unknown>, definitions: ReadonlyMap<string, ToolDefinition>): ToolResult {
  const names = Array.isArray(args.names) ? args.names.filter((name): name is string => typeof name === 'string') : [];
  if (!names.length || names.length > MAX_SCHEMA_REQUEST) return { success: false, error: `names must list 1..${MAX_SCHEMA_REQUEST} tool names.` };
  const tools = names.flatMap(name => {
    const tool = definitions.get(name);
    return tool && !DEV_ONLY_TOOL.test(name)
      ? [{ name, description: tool.function.description, parameters: tool.function.parameters }] : [];
  });
  const missing = names.filter(name => !tools.some(tool => tool.name === name));
  return { success: true, data: { tools, ...(missing.length ? { missing } : {}) } };
}

/** Handles browser-local Direct tools; undefined means the call is an editor tool. */
export function localDirectToolResult(toolName: string, rawArguments: unknown,
  definitions: ReadonlyMap<string, ToolDefinition>): ToolResult | undefined {
  if (toolName !== DIRECT_TOOL_SCHEMA_TOOL) return undefined;
  let args: unknown = rawArguments;
  try { if (typeof rawArguments === 'string') args = JSON.parse(rawArguments); } catch { args = {}; }
  const record = args !== null && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
  return directToolSchemaResult(record, definitions);
}
