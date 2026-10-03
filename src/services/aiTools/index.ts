import { toolResultFromGuidedSession, batchToolResultFromGuidedSession, toolResultsFromGuidedSessionGroup, createMissingGroupedToolResult, formatGroupedToolLabel, getToolCallResultKey } from './guidedToolResults';
import { getEditorRepositorySession } from '../project/repository/transaction/editorMutationRuntime';
// AI Tools Service - Modular architecture
// Provides tools for AI chat to control timeline editing
// Uses OpenAI function calling format

import { Logger } from '../logger';
import { useTimelineStore } from '../../stores/timeline';

const log = Logger.create('AITool');
import { flags } from '../../engine/featureFlags';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  cancelHistoryBatch,
  endBatch,
  startBatch,
  useHistoryStore,
} from '../../stores/historyStore';
import type {
  AIToolCallExecution,
  AIToolCallExecutionResult,
  AIToolExecutionOptions,
  ToolResult,
} from './types';
import { MODIFYING_TOOLS } from './types';
import { executeToolInternal } from './handlers';
import {
  containsBatchResultReference,
  handleExecuteBatch,
  preflightBatchToolAccess,
} from './handlers/batch';
import { setAIExecutionActive, setStaggerBudget } from './executionState';
import { checkToolAccess } from './policy';
import type { CallerContext } from './policy';
import { beginAIToolAudit, completeAIToolAudit } from './audit';
import {
  abortAgentTransaction, attachGroupedPartialFailure, beginAgentTransaction, pinAgentTransactionOptions, getPinnedAgentTransaction, bindAgentTransactionStore, runWithAgentTransaction,
  captureAgentTransactionAcrossAwaits,
  commitAgentTransaction, completeAgentToolAudit, completeOrDeferAgentToolAudit,
  createAgentTransactionRollbackReason, createGroupedPartialFailureInfo, createGroupedRollbackReason, type AgentToolAuditCompletion,
} from './agentTransaction';

// These handlers open, verify, and cancel their own history batch when invoked
// standalone. They remain in MODIFYING_TOOLS so grouped calls are wrapped and
// rolled back atomically by the outer agent transaction.
const SELF_MANAGED_HISTORY_TOOLS = new Set([
  'commitTimelineVariantOption',
]);

// These handlers rebuild the whole project through many awaited store actions
// (reset, imports, composition switches). A repository agent transaction only
// authorizes synchronous work, so each step commits as its own revision instead.
const PROJECT_REBUILD_TOOLS = new Set([
  'createStressTestProjectFixture',
  // Nested composition loading awaits the media store before it inserts the clip.
  'addCompositionClip',
]);

function opensStandaloneAgentTransaction(toolName: string): boolean {
  return MODIFYING_TOOLS.has(toolName) && !PROJECT_REBUILD_TOOLS.has(toolName);
}

function startOwnedHistoryBatch(label: string): number | null {
  const batch = startBatch(label);
  return batch.opened ? batch.batchId : null;
}

function endOwnedHistoryBatch(batchId: number | null): void {
  if (batchId === null) return;
  if (useHistoryStore.getState().batchId === batchId) {
    endBatch();
    return;
  }
  log.warn('Skipped closing AI history batch after ownership changed', { batchId });
}

function cancelOwnedHistoryBatch(batchId: number | null): void {
  if (batchId === null) return;
  if (useHistoryStore.getState().batchId === batchId) {
    cancelHistoryBatch();
    return;
  }
  log.warn('Skipped cancelling AI history batch after ownership changed', { batchId });
}
import {
  compileGuidedToolCall,
  compileGuidedToolCalls,
  getGuidedActionRuntime,
  SemanticExecutionAdapter,
  type GuidedAnimationBudget,
  type GuidedLegacyFeedbackMode,
  type GuidedSessionResult,
  type GuidedVisualizationMode,
} from '../guidedActions';

// Re-export types
export type {
  AIToolCallExecution,
  AIToolCallExecutionResult,
  AIToolExecutionOptions,
  GuidedReplayBudgetController,
  ToolResult,
  ToolDefinition,
} from './types';
export { MODIFYING_TOOLS } from './types';
export { createGuidedReplayBudgetController } from './guidedReplayBudget';

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
  textToolDefinitions,
  motionDesignToolDefinitions,
  playbackToolDefinitions,
  transitionToolDefinitions,
  storyboardToolDefinitions,
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
export function executeAITool(
  toolName: string, args: Record<string, unknown>,
  callerContext: CallerContext = 'internal', options: AIToolExecutionOptions = {},
): Promise<ToolResult> {
  return executeAIToolWithDeferredAudit(toolName, args, callerContext, options);
}

async function executeAIToolWithDeferredAudit(
  toolName: string, args: Record<string, unknown>,
  callerContext: CallerContext, options: AIToolExecutionOptions,
  deferAuditCompletion?: (completion: AgentToolAuditCompletion) => void,
): Promise<ToolResult> {
  const audit = beginAIToolAudit({
    args,
    callerContext,
    options,
    providerToolCallId: options.auditProviderToolCallId,
    tool: toolName,
  });
  // Policy gate: check if caller is allowed to execute this tool
  const access = checkToolAccess(toolName, callerContext, {
    executionMode: options.executionMode,
  });
  if (!access.allowed) {
    log.warn(`Policy denied: ${toolName} from ${callerContext} — ${access.reason}`);
    const result = { success: false, error: access.reason };
    completeOrDeferAgentToolAudit({ callId: audit.callId, tool: toolName, result, error: access.reason, explicitStatus: 'denied' }, deferAuditCompletion);
    return result;
  }

  const standaloneTransaction = getEditorRepositorySession() && !getPinnedAgentTransaction(options) && opensStandaloneAgentTransaction(toolName)
    ? beginAgentTransaction(`AI: ${toolName}`) : null;
  options = pinAgentTransactionOptions(options, standaloneTransaction);
  const useGuidedExecution = shouldUseGuidedAIToolExecution(callerContext, options);
  setAIExecutionActive(true, useGuidedExecution ? getGuidedLegacyFeedback(options) : getLegacyFeedback(options));
  try {
    const run = () => useGuidedExecution
      ? executeGuidedAITool(toolName, args, callerContext, options)
      : _executeAIToolInternal(toolName, args, callerContext, options);
    // A batch is one undo step and one saved revision, including mutations its actions make after awaits.
    const batchTool = toolName === 'executeBatch';
    const result = batchTool ? await captureAgentTransactionAcrossAwaits(standaloneTransaction, run) : await run();
    if (standaloneTransaction) {
      // executeBatch is documented as non-transactional: successful sibling actions stay applied.
      if (result.success || batchTool) commitAgentTransaction(standaloneTransaction); else abortAgentTransaction(standaloneTransaction);
    }
    completeOrDeferAgentToolAudit({ callId: audit.callId, tool: toolName, result }, deferAuditCompletion);
    return result;
  } catch (error) {
    if (standaloneTransaction) abortAgentTransaction(standaloneTransaction);
    completeOrDeferAgentToolAudit({ callId: audit.callId, tool: toolName, error }, deferAuditCompletion);
    throw error;
  } finally {
    setAIExecutionActive(false);
  }
}

export async function executeAIToolCalls(
  toolCalls: AIToolCallExecution[],
  callerContext: CallerContext = 'internal',
  options: AIToolExecutionOptions = {},
): Promise<AIToolCallExecutionResult[]> {
  if (toolCalls.length === 0) {
    return [];
  }

  if (toolCalls.length === 1 || !shouldUseGuidedAIToolExecution(callerContext, options)) {
    return executeAIToolCallsDirect(toolCalls, callerContext, options);
  }

  const allowedCalls: AIToolCallExecution[] = [];
  const auditCallIds = new Map<AIToolCallExecution, string>();
  const policyResults = new Map<string, ToolResult>();
  for (const toolCall of toolCalls) {
    const audit = beginAIToolAudit({
      args: toolCall.args,
      callerContext,
      options,
      providerToolCallId: toolCall.id,
      tool: toolCall.tool,
    });
    auditCallIds.set(toolCall, audit.callId);
    const access = checkToolAccess(toolCall.tool, callerContext, {
      executionMode: options.executionMode,
    });
    const batchAccessFailure = access.allowed && toolCall.tool === 'executeBatch'
      ? preflightBatchToolAccess(
          toolCall.args.actions,
          callerContext,
          options.executionMode,
        )
      : null;
    if (!access.allowed || batchAccessFailure) {
      const reason = access.reason ?? batchAccessFailure?.error;
      log.warn(`Policy denied: ${toolCall.tool} from ${callerContext} â€” ${reason}`);
      const result = { success: false, error: reason };
      policyResults.set(getToolCallResultKey(toolCall), result);
      completeAIToolAudit(audit.callId, result, reason, 'denied');
    } else {
      allowedCalls.push(toolCall);
    }
  }

  if (allowedCalls.length === 0) {
    return toolCalls.map((toolCall) => ({
      id: toolCall.id,
      tool: toolCall.tool,
      result: policyResults.get(getToolCallResultKey(toolCall)) ?? {
        success: false,
        error: 'Tool execution denied',
      },
    }));
  }

  const transaction = beginTransactionForToolCalls(allowedCalls, options);
  options = pinAgentTransactionOptions(options, transaction);
  try {
    setAIExecutionActive(true, getGuidedLegacyFeedback(options));
    const guidedResults = await executeGuidedAIToolCallGroup(allowedCalls, callerContext, {
      ...options,
      suppressHistory: transaction ? true : options.suppressHistory,
    });
    const guidedResultByKey = new Map(guidedResults.map((result) => [getToolCallResultKey(result), result.result]));
    let results: AIToolCallExecutionResult[] = toolCalls.map((toolCall) => ({
      id: toolCall.id,
      tool: toolCall.tool,
      result: policyResults.get(getToolCallResultKey(toolCall))
        ?? guidedResultByKey.get(getToolCallResultKey(toolCall))
        ?? createMissingGroupedToolResult(toolCall.tool),
    }));
    const partialFailure = createGroupedPartialFailureInfo(
      results,
      transaction,
      options.suppressHistory === true,
    );
    if (partialFailure) {
      if (transaction) {
        abortAgentTransaction(transaction);
      }
      results = attachGroupedPartialFailure(results, partialFailure);
    } else if (transaction) {
      commitAgentTransaction(transaction);
    }
    const rollbackReason = partialFailure?.rolledBack ? createGroupedRollbackReason(partialFailure) : undefined;
    for (const [index, toolCall] of allowedCalls.entries()) {
      const callId = auditCallIds.get(toolCall);
      const resultKey = getToolCallResultKey(toolCall);
      const finalResult = results.find(
        (entry) => getToolCallResultKey(entry) === resultKey,
      )?.result;
      const result = rollbackReason !== undefined && MODIFYING_TOOLS.has(toolCall.tool)
        ? guidedResults[index]?.result ?? finalResult
        : finalResult;
      if (callId && result) completeAgentToolAudit({ callId, tool: toolCall.tool, result }, rollbackReason);
    }
    return results;
  } catch (error) {
    const rollbackReason = transaction ? createAgentTransactionRollbackReason(transaction, error) : undefined;
    if (transaction) {
      abortAgentTransaction(transaction);
    }
    for (const toolCall of allowedCalls) {
      const callId = auditCallIds.get(toolCall);
      if (callId) completeAgentToolAudit({ callId, tool: toolCall.tool, error }, rollbackReason);
    }
    throw error;
  } finally {
    setAIExecutionActive(false);
  }
}

async function _executeAIToolInternal(
  toolName: string,
  args: Record<string, unknown>,
  callerContext: CallerContext = 'internal',
  options: AIToolExecutionOptions = {},
): Promise<ToolResult> {
  if (options.signal?.aborted) {
    return createCancelledToolResult(toolName);
  }

  // Special-case: executeBatch wraps all sub-actions in a single undo group
  if (toolName === 'executeBatch') {
    const ownedBatchId = (options.suppressHistory || getPinnedAgentTransaction(options))
      ? null
      : startOwnedHistoryBatch('AI: batch');
    let batchSucceeded = false;
    try {
      const result = await handleExecuteBatch(args, callerContext, options);
      batchSucceeded = result.success;
      return result;
    } catch (error) {
      log.error('Error executing batch', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    } finally {
      if (batchSucceeded) endOwnedHistoryBatch(ownedBatchId);
      else cancelOwnedHistoryBatch(ownedBatchId);
    }
  }

  const transaction = getPinnedAgentTransaction(options);
  const timelineStore = bindAgentTransactionStore(useTimelineStore.getState(), transaction);
  const mediaStore = bindAgentTransactionStore(useMediaStore.getState(), transaction);

  // Track history for modifying operations
  const isModifying = MODIFYING_TOOLS.has(toolName)
    && !SELF_MANAGED_HISTORY_TOOLS.has(toolName)
    && !options.suppressHistory && !getPinnedAgentTransaction(options)
    && !(getEditorRepositorySession() && PROJECT_REBUILD_TOOLS.has(toolName));
  const ownedBatchId = isModifying
    ? startOwnedHistoryBatch(`AI: ${toolName}`)
    : null;
  let mutationSucceeded = false;

  // Set fresh 3s stagger budget for standalone tool calls
  // (batch handler sets its own budget before calling tools)
  if (toolName !== 'executeBatch') {
    setStaggerBudget(options.staggerBudgetMs ?? 3000);
  }

  try {
    if (options.signal?.aborted) {
      return createCancelledToolResult(toolName);
    }
    const invoke = () => executeToolInternal(toolName, args, timelineStore, mediaStore, callerContext, options.signal);
    const result = await (transaction ? runWithAgentTransaction(transaction, invoke) : invoke());
    mutationSucceeded = result.success;
    return result;
  } catch (error) {
    log.error(`Error executing ${toolName}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  } finally {
    if (mutationSucceeded) endOwnedHistoryBatch(ownedBatchId);
    else cancelOwnedHistoryBatch(ownedBatchId);
  }
}

function createCancelledToolResult(toolName: string): ToolResult {
  return {
    success: false,
    error: 'AI tool execution cancelled',
    data: {
      cancelled: true,
      tool: toolName,
    },
  };
}

async function executeGuidedAITool(
  toolName: string,
  args: Record<string, unknown>,
  callerContext: CallerContext,
  options: AIToolExecutionOptions,
): Promise<ToolResult> {
  const inlineBatchExecution = toolName === 'executeBatch';
  if (inlineBatchExecution) {
    const accessFailure = preflightBatchToolAccess(
      args.actions,
      callerContext,
      options.executionMode,
    );
    if (accessFailure) return accessFailure;
  }
  const dependentBatchExecution = inlineBatchExecution
    && containsBatchResultReference(args.actions);
  const shouldManageGuidedHistory = !options.suppressHistory && !getPinnedAgentTransaction(options)
    && (inlineBatchExecution || MODIFYING_TOOLS.has(toolName));
  const compiled = compileGuidedToolCall({
    tool: toolName,
    args,
  }, {
    batchMode: inlineBatchExecution && !dependentBatchExecution
      ? 'inlineExecutions'
      : 'singleExecution',
  });
  const adapter = new SemanticExecutionAdapter({
    defaultCallerContext: callerContext,
    defaultLegacyFeedback: getGuidedLegacyFeedback(options),
    executeTool: (tool, toolArgs, nestedCallerContext, nestedOptions) => (
      _executeAIToolInternal(tool, toolArgs, nestedCallerContext, {
        ...pinAgentTransactionOptions(nestedOptions ?? {}, getPinnedAgentTransaction(options)),
        suppressHistory: shouldManageGuidedHistory
          || options.suppressHistory
          || nestedOptions?.suppressHistory,
      })
    ),
  });
  const runtime = getGuidedActionRuntime();
  const unregisterHandlers = runtime.setActionHandlers(adapter.createActionHandlers({
    callerContext,
    legacyFeedback: getGuidedLegacyFeedback(options),
  }));

  const ownedBatchId = shouldManageGuidedHistory
    ? startOwnedHistoryBatch(inlineBatchExecution ? 'AI: batch' : `AI: ${toolName}`)
    : null;
  let guidedCompleted = false;
  try {
    const result = await runtime.startSession({
      actions: compiled.actions,
      animationBudget: getGuidedAnimationBudget(options),
      callerContext,
      inputLock: { mode: 'locked', allowCancel: true },
      label: `AI: ${toolName}`,
      legacyFeedback: getGuidedLegacyFeedback(options),
      metadata: {
        compilerDiagnostics: compiled.diagnostics,
        toolName,
      },
      playbackMode: 'aiReplay',
      visualizationMode: getGuidedVisualizationMode(options),
    });
    guidedCompleted = result.status === 'completed';
    consumeGuidedReplayBudget(options, result);
    return inlineBatchExecution && !dependentBatchExecution
      ? batchToolResultFromGuidedSession(args, result)
      : toolResultFromGuidedSession(toolName, result);
  } finally {
    if (guidedCompleted) endOwnedHistoryBatch(ownedBatchId);
    else cancelOwnedHistoryBatch(ownedBatchId);
    unregisterHandlers();
  }
}

async function executeGuidedAIToolCallGroup(
  toolCalls: AIToolCallExecution[],
  callerContext: CallerContext,
  options: AIToolExecutionOptions,
): Promise<AIToolCallExecutionResult[]> {
  const compiled = compileGuidedToolCalls(toolCalls.map((toolCall) => ({
    id: toolCall.id,
    tool: toolCall.tool,
    args: toolCall.args,
  })));
  const adapter = new SemanticExecutionAdapter({
    defaultCallerContext: callerContext,
    defaultLegacyFeedback: getGuidedLegacyFeedback(options),
    executeTool: (tool, toolArgs, nestedCallerContext, nestedOptions) => (
      _executeAIToolInternal(tool, toolArgs, nestedCallerContext, {
        ...pinAgentTransactionOptions(nestedOptions ?? {}, getPinnedAgentTransaction(options)),
        suppressHistory: options.suppressHistory || nestedOptions?.suppressHistory,
      })
    ),
  });
  const runtime = getGuidedActionRuntime();
  const unregisterHandlers = runtime.setActionHandlers(adapter.createActionHandlers({
    callerContext,
    legacyFeedback: getGuidedLegacyFeedback(options),
  }));

  try {
    const result = await runtime.startSession({
      actions: compiled.actions,
      animationBudget: getGuidedAnimationBudget({
        ...options,
        guidedReplayRemainingCalls: 1,
      }),
      callerContext,
      inputLock: { mode: 'locked', allowCancel: true },
      label: `AI: ${formatGroupedToolLabel(toolCalls)}`,
      legacyFeedback: getGuidedLegacyFeedback(options),
      metadata: {
        compilerDiagnostics: compiled.diagnostics,
        toolNames: toolCalls.map((toolCall) => toolCall.tool),
      },
      playbackMode: 'aiReplay',
      visualizationMode: getGuidedVisualizationMode(options),
    });
    consumeGuidedReplayBudget(options, result);
    return toolResultsFromGuidedSessionGroup(toolCalls, result);
  } finally {
    unregisterHandlers();
  }
}

async function executeAIToolCallsDirect(
  toolCalls: AIToolCallExecution[],
  callerContext: CallerContext,
  options: AIToolExecutionOptions,
): Promise<AIToolCallExecutionResult[]> {
  const auditCompletions: AgentToolAuditCompletion[] = [];
  const results: AIToolCallExecutionResult[] = [];
  const transaction = beginTransactionForToolCalls(toolCalls, options);
  options = pinAgentTransactionOptions(options, transaction);
  try {
    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];
      if (!toolCall) {
        continue;
      }
      const result = await executeAIToolWithDeferredAudit(toolCall.tool, toolCall.args, callerContext, {
        ...options,
        auditProviderToolCallId: toolCall.id,
        guidedReplayRemainingCalls: toolCalls.length - index,
        suppressHistory: transaction ? true : options.suppressHistory,
      }, (completion) => auditCompletions.push(completion));
      results.push({
        id: toolCall.id,
        tool: toolCall.tool,
        result,
      });
    }
    const partialFailure = createGroupedPartialFailureInfo(
      results,
      transaction,
      options.suppressHistory === true,
    );
    let finalResults = results;
    let rollbackReason: string | undefined;
    if (partialFailure) {
      if (transaction) {
        abortAgentTransaction(transaction);
      }
      finalResults = attachGroupedPartialFailure(results, partialFailure);
      rollbackReason = partialFailure.rolledBack ? createGroupedRollbackReason(partialFailure) : undefined;
    } else if (transaction) {
      commitAgentTransaction(transaction);
    }
    for (const [index, completion] of auditCompletions.entries()) {
      const result = rollbackReason !== undefined && MODIFYING_TOOLS.has(completion.tool)
        ? completion.result
        : finalResults[index]?.result ?? completion.result;
      completeAgentToolAudit({ ...completion, result }, rollbackReason);
    }
    return finalResults;
  } catch (error) {
    const rollbackReason = transaction ? createAgentTransactionRollbackReason(transaction, error) : undefined;
    if (transaction) {
      abortAgentTransaction(transaction);
    }
    for (const completion of auditCompletions) {
      completeAgentToolAudit(completion, rollbackReason);
    }
    throw error;
  }
}

function beginTransactionForToolCalls(
  toolCalls: AIToolCallExecution[],
  options: AIToolExecutionOptions,
) {
  if (options.suppressHistory
    || !toolCalls.some((toolCall) => MODIFYING_TOOLS.has(toolCall.tool))) {
    return null;
  }

  const firstTool = toolCalls[0]?.tool ?? 'unknown';
  const additionalToolCount = toolCalls.length - 1;
  return beginAgentTransaction(
    `AI task: ${firstTool}${additionalToolCount > 0 ? ` +${additionalToolCount}` : ''}`,
  );
}

function shouldUseGuidedAIToolExecution(
  callerContext: CallerContext,
  options: AIToolExecutionOptions,
): boolean {
  if (options.guidedReplay === false || options.guidedSessionId) {
    return false;
  }

  const explicitGuidedReplay = options.guidedReplay === true;
  if (!explicitGuidedReplay && (!flags.guidedActionsRuntime || !flags.guidedActionsAIReplay)) {
    return false;
  }
  return callerContext === 'chat' || explicitGuidedReplay;
}

function getGuidedAnimationBudget(options: AIToolExecutionOptions): Partial<GuidedAnimationBudget> {
  const settings = useSettingsStore.getState();
  const budgetFromController = options.guidedAnimationBudgetMs === undefined
    ? options.guidedReplayBudgetController?.reserveBudgetMs(options.guidedReplayRemainingCalls)
    : undefined;

  return {
    totalMs: options.guidedAnimationBudgetMs ?? budgetFromController ?? settings.guidedActionReplayBudgetMs,
    compression: options.guidedCompressionMode
      ?? options.guidedReplayBudgetController?.compression
      ?? settings.guidedActionReplayCompressionMode,
  };
}

function consumeGuidedReplayBudget(
  options: AIToolExecutionOptions,
  result: GuidedSessionResult,
): void {
  if (options.guidedAnimationBudgetMs !== undefined) {
    return;
  }
  options.guidedReplayBudgetController?.consumeBudgetMs(result.diagnostics.plannedDurationMs);
}

function getGuidedLegacyFeedback(options: AIToolExecutionOptions): GuidedLegacyFeedbackMode {
  return options.guidedLegacyFeedback ?? 'off';
}

function getLegacyFeedback(options: AIToolExecutionOptions): GuidedLegacyFeedbackMode {
  return options.legacyFeedback ?? 'native';
}

function getGuidedVisualizationMode(options: AIToolExecutionOptions): GuidedVisualizationMode | undefined {
  return options.guidedVisualizationMode ?? useSettingsStore.getState().guidedActionReplayVisualizationMode;
}
