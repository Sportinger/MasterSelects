// AI Tools Service - Modular architecture
// Provides tools for AI chat to control timeline editing
// Uses OpenAI function calling format

import { Logger } from '../logger';
import { useTimelineStore } from '../../stores/timeline';

const log = Logger.create('AITool');
import { useMediaStore } from '../../stores/mediaStore';
import { startBatch, endBatch } from '../../stores/historyStore';
import type { ToolResult } from './types';
import { MODIFYING_TOOLS } from './types';
import { executeToolInternal } from './handlers';
import { handleExecuteBatch } from './handlers/batch';
import { setAIExecutionActive, setStaggerBudget } from './executionState';
import { checkToolAccess } from './policy';
import type { CallerContext } from './policy';

// Re-export types
export type { ToolResult, ToolDefinition } from './types';
export { MODIFYING_TOOLS } from './types';

// Re-export policy
export { checkToolAccess, getToolPolicy } from './policy';
export type { CallerContext, RiskLevel, ToolPolicyEntry } from './policy';

// Re-export tool definitions
export { AI_TOOLS } from './definitions';
export {
  timelineToolDefinitions,
  clipToolDefinitions,
  trackToolDefinitions,
  analysisToolDefinitions,
  previewToolDefinitions,
  mediaToolDefinitions,
  batchToolDefinitions,
  youtubeToolDefinitions,
  transformToolDefinitions,
  effectToolDefinitions,
  keyframeToolDefinitions,
  playbackToolDefinitions,
  transitionToolDefinitions,
} from './definitions';

// Re-export utilities
export { getQuickTimelineSummary, formatClipInfo, formatTrackInfo, captureFrameGrid } from './utils';

// Re-export handlers for advanced usage
export { executeToolInternal } from './handlers';

// Re-export execution state check (from separate module to avoid circular imports)
export { isAIExecutionActive } from './executionState';

/**
 * Execute an AI tool with history tracking and policy enforcement.
 * Main entry point for AI chat integration.
 * @param callerContext identifies who is calling (chat, devBridge, etc.)
 */
export async function executeAITool(
  toolName: string,
  args: Record<string, unknown>,
  callerContext: CallerContext = 'internal',
): Promise<ToolResult> {
  // Policy gate: check if caller is allowed to execute this tool
  const access = checkToolAccess(toolName, callerContext);
  if (!access.allowed) {
    log.warn(`Policy denied: ${toolName} from ${callerContext} — ${access.reason}`);
    return { success: false, error: access.reason };
  }

  setAIExecutionActive(true);
  try {
    return await _executeAIToolInternal(toolName, args, callerContext);
  } finally {
    setAIExecutionActive(false);
  }
}

async function _executeAIToolInternal(
  toolName: string,
  args: Record<string, unknown>,
  callerContext: CallerContext = 'internal',
): Promise<ToolResult> {
  // Special-case: executeBatch wraps all sub-actions in a single undo group
  if (toolName === 'executeBatch') {
    startBatch('AI: batch');
    try {
      const result = await handleExecuteBatch(args, callerContext);
      endBatch();
      return result;
    } catch (error) {
      endBatch();
      log.error('Error executing batch', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();

  // Track history for modifying operations
  const isModifying = MODIFYING_TOOLS.has(toolName);
  if (isModifying) {
    startBatch(`AI: ${toolName}`);
  }

  // Set fresh 3s stagger budget for standalone tool calls
  // (batch handler sets its own budget before calling tools)
  if (toolName !== 'executeBatch') {
    setStaggerBudget(3000);
  }

  try {
    const result = await executeToolInternal(toolName, args, timelineStore, mediaStore, callerContext);


    if (isModifying) {
      endBatch();
    }

    return result;
  } catch (error) {
    if (isModifying) {
      endBatch();
    }
    log.error(`Error executing ${toolName}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
