// Batch Execution Handler

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { ToolResult } from '../types';
import { executeToolInternal } from './index';
import { setStaggerBudget, consumeStaggerDelay } from '../executionState';

interface BatchAction {
  tool: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

interface BatchActionResult {
  tool: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Execute multiple tools in sequence as a single batch.
 * Re-fetches fresh store state between actions so that
 * clip IDs from splits are available to subsequent actions.
 *
 * All visual stagger delays (batch steps + internal tool steps like splits)
 * share a single 3s budget so the entire batch always finishes in ≤3s visually.
 */
export async function handleExecuteBatch(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const actions = args.actions as BatchAction[];

  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    return { success: false, error: 'actions must be a non-empty array' };
  }

  // Set global stagger budget — all delays (batch + internal splits/reorders) share this
  const budgetMs = (args.staggerDelayMs as number | undefined) !== undefined
    ? (args.staggerDelayMs as number) * actions.length  // manual override: total = per-step × count
    : 3000; // default: 3s total
  setStaggerBudget(budgetMs);

  const results: BatchActionResult[] = [];
  let allSucceeded = true;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    // Re-fetch fresh state before each action
    const timelineStore = useTimelineStore.getState();
    const mediaStore = useMediaStore.getState();

    // Support both { tool, args: {...} } and flat { tool, clipId, splitTime, ... }
    let toolArgs: Record<string, unknown>;
    if (action.args && typeof action.args === 'object') {
      toolArgs = action.args;
    } else {
      // Extract args from flat format: everything except 'tool' and 'args'
      const { tool: _tool, args: _args, ...rest } = action;
      toolArgs = rest as Record<string, unknown>;
    }

    try {
      const result = await executeToolInternal(
        action.tool,
        toolArgs,
        timelineStore,
        mediaStore
      );

      results.push({
        tool: action.tool,
        success: result.success,
        data: result.data,
        error: result.error,
      });

      if (!result.success) {
        allSucceeded = false;
      }
    } catch (error) {
      allSucceeded = false;
      results.push({
        tool: action.tool,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Consume from shared budget for between-action delay
    if (i < actions.length - 1) {
      const delay = consumeStaggerDelay(actions.length - 1 - i);
      await new Promise(resolve => setTimeout(resolve, delay));
    } else {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return {
    success: allSucceeded,
    data: {
      totalActions: actions.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    },
  };
}
