import { getToolPolicy } from '../aiTools';
import type { ToolResult } from '../aiTools';

const MAX_IDENTICAL_READ_ATTEMPTS = 3;

const DEDUPED_READ_TOOLS = new Set([
  'captureFrame',
  'getCaptionProperties',
  'getClipDetails',
  'getClipsInTimeRange',
  'getCutPreviewQuad',
  'getFramesAtTimes',
  'getMediaItems',
  'getMediaPreviewFrames',
  'getMediaTranscript',
  'getMotionCapabilities',
  'getTextProperties',
  'getTimelineState',
  'getTimelineTranscript',
  'listEffects',
  'verifyTimelineInvariants',
]);

const REVISION_INDEPENDENT_READ_TOOLS = new Set([
  'getMediaPreviewFrames',
  'listEffects',
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function isNodeCreation(toolName: string, args: Record<string, unknown>): boolean {
  return ['createImageNodeGraph', 'addFlockNode', 'addEffect'].includes(toolName)
    || (toolName === 'editOperatorGraph' && args.action === 'add');
}

function toolCallKey(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${JSON.stringify(canonicalize(args))}`;
}

function duplicateReadResult(toolName: string, hardLimit: boolean): ToolResult {
  return {
    success: !hardLimit,
    ...(hardLimit ? { error: `Repeated identical ${toolName} call blocked.` } : {}),
    data: {
      cached: true,
      instruction: 'Reuse the result already present earlier in this turn. Do not call this tool again with the same arguments unless a successful editor mutation changes the relevant state.',
      reason: hardLimit
        ? 'direct_identical_read_limit'
        : 'direct_duplicate_read_suppressed',
      toolName,
    },
  };
}

export interface DirectCodexTurnToolPolicy {
  afterTool(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResult,
  ): void;
  beforeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): ToolResult | undefined;
}

export function createDirectCodexTurnToolPolicy(): DirectCodexTurnToolPolicy {
  let mediaGenerationStarted = false;
  let projectRevision = 0;
  const completedMutationKeys = new Set<string>();
  const completedReadKeys = new Set<string>();
  const identicalReadAttempts = new Map<string, number>();

  const readKey = (toolName: string, args: Record<string, unknown>) => {
    const revision = REVISION_INDEPENDENT_READ_TOOLS.has(toolName)
      ? 'source'
      : projectRevision;
    return `${revision}:${toolCallKey(toolName, args)}`;
  };

  return {
    beforeTool(toolName, args) {
      if (toolName === 'startMediaGeneration') {
        if (!mediaGenerationStarted) {
          mediaGenerationStarted = true;
        } else {
          return {
            success: false,
            error: 'Only one paid media generation may be started per user message.',
            data: {
              instruction: 'Do not retry or switch providers. Continue polling the first record, then report its result or ask the user before a new paid attempt.',
              reason: 'direct_turn_media_generation_limit',
            },
          };
        }
      }

      if (DEDUPED_READ_TOOLS.has(toolName)) {
        const key = readKey(toolName, args);
        if (completedReadKeys.has(key)) {
          const attempts = (identicalReadAttempts.get(key) ?? 1) + 1;
          identicalReadAttempts.set(key, attempts);
          return duplicateReadResult(toolName, attempts >= MAX_IDENTICAL_READ_ATTEMPTS);
        }
      }

      // Separate calls may intentionally create identical graph elements.
      if (!isNodeCreation(toolName, args) && getToolPolicy(toolName)?.readOnly === false) {
        const key = toolCallKey(toolName, args);
        if (completedMutationKeys.has(key)) {
          return {
            success: false,
            error: `Duplicate mutation blocked: ${toolName}.`,
            data: {
              instruction: 'The identical mutation already succeeded in this turn. Inspect its earlier result instead of applying it again.',
              reason: 'direct_duplicate_mutation_blocked',
            },
          };
        }
      }
      return undefined;
    },

    afterTool(toolName, args, result) {
      if (!result.success) return;
      if (DEDUPED_READ_TOOLS.has(toolName)) {
        const key = readKey(toolName, args);
        completedReadKeys.add(key);
        identicalReadAttempts.set(key, 1);
      }
      if (getToolPolicy(toolName)?.readOnly === false) {
        completedMutationKeys.add(toolCallKey(toolName, args));
        projectRevision += 1;
      }
    },
  };
}

/** Compatibility wrapper used by focused guard tests and callers needing only preflight. */
export function createDirectCodexTurnToolGuard(): (
  toolName: string,
  args?: Record<string, unknown>,
) => ToolResult | undefined {
  const policy = createDirectCodexTurnToolPolicy();
  return (toolName, args = {}) => policy.beforeTool(toolName, args);
}
