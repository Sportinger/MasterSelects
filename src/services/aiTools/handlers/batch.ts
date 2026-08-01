// Batch Execution Handler

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { AIToolExecutionOptions, ToolResult } from '../types';
import { executeToolInternal } from './index';
import { setStaggerBudget, consumeStaggerDelay } from '../executionState';
import { checkToolAccess } from '../policy';
import type { CallerContext } from '../policy';
import type { AIToolExecutionMode } from '../policy';

export interface BatchAction {
  tool: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BatchActionResult {
  tool: string;
  success: boolean;
  data?: unknown;
  error?: string;
  stateRevisionBefore: number | null;
  stateRevisionAfter: number | null;
}

interface BatchEntityRef {
  kind: string;
  id: string;
}

interface BatchMutationMetadata {
  stateRevisionBefore: number | null;
  stateRevisionAfter: number | null;
  entities: {
    created: BatchEntityRef[];
    updated: BatchEntityRef[];
    deleted: BatchEntityRef[];
  };
  warnings: string[];
}

export interface NormalizedBatchAction {
  action: BatchAction;
  args: Record<string, unknown>;
  index: number;
  tool: string;
}

export type BatchToolExecutor = (
  tool: string,
  args: Record<string, unknown>,
  callerContext: CallerContext,
) => Promise<ToolResult>;

export interface BatchExecutionHooks {
  beforeAction?: (action: NormalizedBatchAction) => void | Promise<void>;
  afterAction?: (action: NormalizedBatchAction, result: BatchActionResult) => void | Promise<void>;
}

interface BatchResultReference {
  $batchResult: {
    action: number;
    path?: string;
  };
}

export interface ExecuteBatchCoreOptions extends AIToolExecutionOptions {
  callerContext?: CallerContext;
  executeTool?: BatchToolExecutor;
  hooks?: BatchExecutionHooks;
}

export function preflightBatchToolAccess(
  value: unknown,
  callerContext: CallerContext,
  executionMode?: AIToolExecutionMode,
  depth = 0,
): ToolResult | null {
  if (depth > 8) {
    return {
      success: false,
      error: 'Batch rejected - nested batch depth exceeds the policy limit.',
    };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { success: false, error: 'actions must be a non-empty array' };
  }
  const disallowed: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== 'object'
      || entry === null
      || Array.isArray(entry)
      || typeof (entry as { tool?: unknown }).tool !== 'string'
    ) {
      disallowed.push('invalid batch action');
      continue;
    }
    const tool = (entry as { tool: string }).tool;
    const access = checkToolAccess(tool, callerContext, { executionMode });
    if (!access.allowed) {
      disallowed.push(`${tool}: ${access.reason}`);
      continue;
    }
    if (tool === 'executeBatch') {
      const record = entry as Record<string, unknown>;
      const nestedArgs = record.args
        && typeof record.args === 'object'
        && !Array.isArray(record.args)
        ? record.args as Record<string, unknown>
        : record;
      const nestedFailure = preflightBatchToolAccess(
        nestedArgs.actions,
        callerContext,
        executionMode,
        depth + 1,
      );
      if (nestedFailure) {
        disallowed.push(`executeBatch: ${nestedFailure.error}`);
      }
    }
  }
  return disallowed.length > 0
    ? {
        success: false,
        error: `Batch rejected - disallowed tools: ${disallowed.join('; ')}`,
      }
    : null;
}

/**
 * Execute multiple tools in sequence as a single batch.
 * Re-fetches fresh store state between actions so that clip IDs from splits are
 * available to subsequent actions.
 *
 * History batching is intentionally handled by aiTools/index.ts so this core can
 * be reused by guided execution hooks without changing undo semantics.
 */
export async function handleExecuteBatch(
  args: Record<string, unknown>,
  callerContext: CallerContext = 'internal',
  options: AIToolExecutionOptions = {},
): Promise<ToolResult> {
  return executeBatchCore(args, {
    ...options,
    callerContext,
  });
}

export async function executeBatchCore(
  args: Record<string, unknown>,
  options: ExecuteBatchCoreOptions = {},
): Promise<ToolResult> {
  const actions = args.actions as BatchAction[];
  const callerContext = options.callerContext ?? 'internal';
  const executeTool = options.executeTool ?? defaultBatchToolExecutor;

  const accessFailure = preflightBatchToolAccess(
    actions,
    callerContext,
    options.executionMode,
  );
  if (accessFailure) return accessFailure;

  const budgetMs = options.staggerBudgetMs ?? (
    (args.staggerDelayMs as number | undefined) !== undefined
      ? (args.staggerDelayMs as number) * actions.length
      : 3000
  );
  setStaggerBudget(budgetMs);

  const results: BatchActionResult[] = [];
  let allSucceeded = true;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action) {
      continue;
    }

    if (options.signal?.aborted) {
      return createCancelledBatchResult(actions, results, i);
    }

    try {
      const toolArgs = resolveBatchResultReferences(
        normalizeBatchActionArgs(action),
        results,
        i,
      ) as Record<string, unknown>;
      const normalizedAction: NormalizedBatchAction = {
        action,
        args: toolArgs,
        index: i,
        tool: action.tool,
      };
      await options.hooks?.beforeAction?.(normalizedAction);
      const result = await executeTool(action.tool, toolArgs, callerContext);
      const mutationMetadata = readMutationMetadata(result.data);
      const actionResult: BatchActionResult = {
        tool: action.tool,
        success: result.success,
        data: result.data,
        error: result.error,
        stateRevisionBefore: mutationMetadata.stateRevisionBefore,
        stateRevisionAfter: mutationMetadata.stateRevisionAfter,
      };

      results.push(actionResult);
      await options.hooks?.afterAction?.(normalizedAction, actionResult);

      if (!result.success) {
        allSucceeded = false;
      }
    } catch (error) {
      allSucceeded = false;
      results.push({
        tool: action.tool,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stateRevisionBefore: null,
        stateRevisionAfter: null,
      });
    }

    if (i < actions.length - 1) {
      const delay = consumeStaggerDelay(actions.length - 1 - i);
      if (!await delayWithSignal(delay, options.signal)) {
        return createCancelledBatchResult(actions, results, i + 1);
      }
    } else if (!await delayWithSignal(0, options.signal)) {
      return createCancelledBatchResult(actions, results, i + 1);
    }
  }

  return {
    success: allSucceeded,
    data: {
      totalActions: actions.length,
      succeeded: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      results,
      ...aggregateBatchMutationMetadata(results),
    },
  };
}

async function defaultBatchToolExecutor(
  tool: string,
  args: Record<string, unknown>,
  callerContext: CallerContext,
): Promise<ToolResult> {
  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();
  return executeToolInternal(tool, args, timelineStore, mediaStore, callerContext);
}

function normalizeBatchActionArgs(action: BatchAction): Record<string, unknown> {
  if (action.args && typeof action.args === 'object' && !Array.isArray(action.args)) {
    return action.args;
  }

  const { tool: _tool, args: _args, ...rest } = action;
  return rest as Record<string, unknown>;
}

function isBatchResultReference(value: unknown): value is BatchResultReference {
  if (!isRecord(value) || !Object.hasOwn(value, '$batchResult')) return false;
  const reference = value.$batchResult;
  return isRecord(reference)
    && Number.isInteger(reference.action)
    && (reference.path === undefined || typeof reference.path === 'string');
}

export function containsBatchResultReference(value: unknown): boolean {
  if (isBatchResultReference(value)) return true;
  if (Array.isArray(value)) return value.some(containsBatchResultReference);
  if (isRecord(value)) {
    return Object.values(value).some(containsBatchResultReference);
  }
  return false;
}

function resolveBatchResultReferences(
  value: unknown,
  results: readonly BatchActionResult[],
  currentActionIndex: number,
): unknown {
  if (isBatchResultReference(value)) {
    const { action, path = '' } = value.$batchResult;
    if (action < 0 || action >= currentActionIndex) {
      throw new Error(
        `Invalid $batchResult reference in action ${currentActionIndex}: action must target an earlier action`,
      );
    }
    const sourceResult = results[action];
    if (!sourceResult?.success) {
      throw new Error(
        `Invalid $batchResult reference in action ${currentActionIndex}: action ${action} did not succeed`,
      );
    }
    return readBatchResultPath(sourceResult.data, path, currentActionIndex, action);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveBatchResultReferences(entry, results, currentActionIndex));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveBatchResultReferences(entry, results, currentActionIndex),
      ]),
    );
  }

  return value;
}

function readBatchResultPath(
  data: unknown,
  path: string,
  currentActionIndex: number,
  sourceActionIndex: number,
): unknown {
  if (!path) return data;
  const segments = path.split('.').filter(Boolean);
  let cursor: unknown = data;

  for (const segment of segments) {
    if (
      segment === '__proto__'
      || segment === 'prototype'
      || segment === 'constructor'
    ) {
      throw new Error(
        `Invalid $batchResult path in action ${currentActionIndex}: unsafe segment "${segment}"`,
      );
    }
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        throw new Error(
          `Invalid $batchResult path in action ${currentActionIndex}: "${path}" was not found in action ${sourceActionIndex}`,
        );
      }
      cursor = cursor[index];
      continue;
    }
    if (!isRecord(cursor) || !Object.hasOwn(cursor, segment)) {
      throw new Error(
        `Invalid $batchResult path in action ${currentActionIndex}: "${path}" was not found in action ${sourceActionIndex}`,
      );
    }
    cursor = cursor[segment];
  }

  return cursor;
}

function createCancelledBatchResult(
  actions: BatchAction[],
  completedResults: BatchActionResult[],
  nextIndex: number,
): ToolResult {
  const skippedResults = actions.slice(nextIndex).map((action): BatchActionResult => ({
    tool: action.tool,
    success: false,
    error: 'Batch execution cancelled',
    stateRevisionBefore: null,
    stateRevisionAfter: null,
  }));
  const results = [...completedResults, ...skippedResults];
  const succeeded = results.filter((result) => result.success).length;

  return {
    success: false,
    error: 'Batch execution cancelled',
    data: {
      totalActions: actions.length,
      succeeded,
      failed: actions.length - succeeded,
      cancelled: true,
      results,
      ...aggregateBatchMutationMetadata(results),
    },
  };
}

function readMutationMetadata(data: unknown): BatchMutationMetadata {
  const record = isRecord(data) ? data : {};
  const entities = isRecord(record.entities) ? record.entities : {};
  return {
    stateRevisionBefore: typeof record.stateRevisionBefore === 'number'
      ? record.stateRevisionBefore
      : null,
    stateRevisionAfter: typeof record.stateRevisionAfter === 'number'
      ? record.stateRevisionAfter
      : null,
    entities: {
      created: readEntityRefs(entities.created),
      updated: readEntityRefs(entities.updated),
      deleted: readEntityRefs(entities.deleted),
    },
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
      : [],
  };
}

function aggregateBatchMutationMetadata(results: readonly BatchActionResult[]): BatchMutationMetadata {
  const metadata = results.map((result) => readMutationMetadata(result.data));
  const firstRevision = metadata.find((item) => item.stateRevisionBefore !== null);
  const lastRevision = metadata.findLast((item) => item.stateRevisionAfter !== null);
  return {
    stateRevisionBefore: firstRevision?.stateRevisionBefore ?? null,
    stateRevisionAfter: lastRevision?.stateRevisionAfter ?? null,
    entities: {
      created: unionEntityRefs(metadata.flatMap((item) => item.entities.created)),
      updated: unionEntityRefs(metadata.flatMap((item) => item.entities.updated)),
      deleted: unionEntityRefs(metadata.flatMap((item) => item.entities.deleted)),
    },
    warnings: [...new Set(metadata.flatMap((item) => item.warnings))],
  };
}

function readEntityRefs(value: unknown): BatchEntityRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entity): entity is BatchEntityRef => (
    isRecord(entity)
    && typeof entity.kind === 'string'
    && typeof entity.id === 'string'
  ));
}

function unionEntityRefs(entities: readonly BatchEntityRef[]): BatchEntityRef[] {
  return [...new Map(entities.map((entity) => [`${entity.kind}:${entity.id}`, entity])).values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delayWithSignal(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return Promise.resolve(false);
  }
  if (ms <= 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
