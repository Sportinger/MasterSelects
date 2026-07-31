import {
  executeAIToolCalls,
  type AIToolCallExecution,
  type AIToolCallExecutionResult,
} from '../aiTools';
import {
  abortAgentTransaction,
  beginAgentTransaction,
  commitAgentTransaction,
  hasAgentTransactionOwnership,
  type AgentTransaction,
} from '../aiTools/agentTransaction';
import { Logger } from '../logger';
import { getDevBridgeToken } from '../security/devBridgeAuth';
import { createExecutionIdBinding } from './executionIdBinding';
import { KernelServiceClient } from './index';
import { formatAssumptionNote } from './storyVerification';
import {
  buildDecline,
  buildSteps,
  buildUnderstood,
  buildVerified,
  formatKernelRunMessage,
  type KernelReportStep,
  type KernelRunReport,
} from './runReport';
import {
  createKernelProgressEvent,
  type KernelProgressReporter,
  type KernelProgressStage,
} from './runProgress';
import {
  buildTranscriptMoments,
  TRANSCRIPT_MOMENT_INDEX_VERSION,
} from './transcriptMoments';
import { buildSilenceRanges } from './silenceEvidence';
import {
  describeTranscriptPrecondition,
  findPreconditionResolver,
  type PreconditionResolverContext,
} from './preconditionResolvers';
import type {
  KernelCompileAbortReason,
  KernelCompileCompiledResponse,
  KernelCompileDecisionResponse,
  KernelCompileResponse,
  KernelResolvedCall,
  KernelRunCompleteResponse,
  KernelMissingPrecondition,
  KernelSilenceRange,
} from './types';
import {
  parseKernelStoryboardResponse,
  type KernelActiveDecision,
  type KernelConversationTurn,
  type KernelDecisionPrompt,
} from '../storyboard/contracts';

const KERNEL_ENABLED_KEY = 'ms.kernel.enabled';
const KERNEL_TOKEN_KEY = 'ms.kernel.token';
const KERNEL_URL_KEY = 'ms.kernel.url';

const log = Logger.create('KernelGateway');

/**
 * A handled turn now carries the structured run report alongside the derived
 * message. `message` stays the contract for the bridge, MCP, and the chat-run
 * audit; `report` is what the UI renders.
 */
export type KernelChatGatewayResult =
  | { handled: false }
  | {
      handled: true;
      message: string;
      runId?: string;
      report?: KernelRunReport;
      decision?: KernelDecisionPrompt;
    };

type ExecuteToolCalls = typeof executeAIToolCalls;

interface KernelTransactionAdapter {
  abort: (transaction: AgentTransaction) => void;
  begin: (label: string) => AgentTransaction;
  commit: (transaction: AgentTransaction) => unknown;
  hasOwnership: (transaction: AgentTransaction) => boolean;
}

export interface KernelChatGatewayDependencies {
  client?: KernelServiceClient;
  executeToolCalls?: ExecuteToolCalls;
  fetchImpl?: typeof fetch;
  getSilenceRanges?: (snapshot: unknown) => Promise<KernelSilenceRange[]>;
  getSnapshot?: () => Promise<unknown> | unknown;
  /** Injected so the gateway stays free of store reads (plan Â§8.3). */
  satisfyPrecondition?: (
    precondition: KernelMissingPrecondition,
    context: PreconditionResolverContext,
  ) => Promise<boolean>;
  /** Whether automatic repair is allowed; defaults to false when absent. */
  autoApprove?: boolean;
  /** Reports the local stage the run is in, so the chat can show progress. */
  onProgress?: KernelProgressReporter;
  intent?: 'execute' | 'plan';
  decisionPolicy?: 'automatic' | 'milestones' | 'every-decision';
  conversation?: KernelConversationTurn[];
  activeDecision?: KernelActiveDecision;
  activeVariantSetId?: string;
  seed?: string;
  /**
   * Cancels the run. Checked before every mutating step and before the commit,
   * so a stopped turn can never leave a committed edit behind.
   */
  signal?: AbortSignal;
  storage?: Storage;
  transaction?: Partial<KernelTransactionAdapter>;
}

/** Thrown when the caller aborts; converted to a decline by the run wrapper. */
class KernelRunAbortedError extends Error {
  constructor() {
    super('Kernel run cancelled.');
    this.name = 'KernelRunAbortedError';
  }
}

interface KernelConfig {
  baseUrl: string;
  token: string;
}

const DEFAULT_LOCAL_KERNEL_URL = 'http://127.0.0.1:8787';

function getDefaultStorage(): Storage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLocalKernelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      && url.port === '8787';
  } catch {
    return false;
  }
}

export function resolveKernelConfig(
  storage: Storage,
  devToken = import.meta.env.DEV ? getDevBridgeToken().trim() : '',
): KernelConfig | undefined {
  try {
    if (storage.getItem(KERNEL_ENABLED_KEY) === 'false') {
      return undefined;
    }

    const token = storage.getItem(KERNEL_TOKEN_KEY)?.trim();
    const baseUrl = storage.getItem(KERNEL_URL_KEY)?.trim();
    // dev-full rotates its local bridge token on every start. Keep an
    // explicit remote override intact, but heal stale localhost credentials
    // automatically so browser localStorage cannot strand the chat gateway.
    if (devToken && (!baseUrl || isLocalKernelUrl(baseUrl))) {
      return {
        baseUrl: baseUrl || DEFAULT_LOCAL_KERNEL_URL,
        token: devToken,
      };
    }
    if (token && baseUrl) {
      return { baseUrl, token };
    }

    // Production default: route through the same-origin Pages proxy, which
    // injects the kernel bearer token server-side. localStorage keys remain
    // the explicit override; 'ms.kernel.enabled' = 'false' still disables.
    if (import.meta.env.PROD) {
      return { baseUrl: '/api', token: '' };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function parseResolvedCall(value: unknown): KernelResolvedCall | undefined {
  if (!isRecord(value) || !isRecord(value.args)) {
    return undefined;
  }

  const stepId = readString(value.stepId);
  const tool = readString(value.tool);
  if (!stepId || !tool) {
    return undefined;
  }

  return { stepId, tool, args: value.args };
}

const KERNEL_ABORT_REASONS: readonly KernelCompileAbortReason[] = [
  'notMechanicalTask',
  'storyPathNeedsProvider',
  'storyPathNeedsMoments',
  'storyOnlyModeActive',
  'staleDecision',
  'staleVariant',
  'policyDeclined',
];

function parseAbortReason(value: unknown): KernelCompileAbortReason | undefined {
  const reason = readString(value);
  return KERNEL_ABORT_REASONS.find((known) => known === reason);
}

function parseMissingPrecondition(value: unknown): KernelMissingPrecondition | undefined {
  if (!isRecord(value)) return undefined;
  return readString(value.kind) === 'transcript' ? { kind: 'transcript' } : undefined;
}

function parseCompileResponse(value: unknown): KernelCompileResponse | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const runId = readString(value.runId);
  const status = readString(value.status)?.toLowerCase();
  if (!runId) {
    return undefined;
  }

  if (status === 'aborted' || status === 'failed') {
    const reason = parseAbortReason(value.reason);
    const missingPrecondition = parseMissingPrecondition(value.missingPrecondition);
    return {
      runId,
      status,
      failures: value.failures,
      ...(reason === undefined ? {} : { reason }),
      ...(missingPrecondition === undefined ? {} : { missingPrecondition }),
    };
  }

  if (status === 'planned') {
    if (!Array.isArray(value.resolvedCalls)) return undefined;
    const resolvedCalls = value.resolvedCalls.map(parseResolvedCall);
    const message = readString(value.message);
    if (!message || resolvedCalls.some((call) => call === undefined)) return undefined;
    return {
      runId,
      status: 'planned',
      message,
      resolvedCalls: resolvedCalls as KernelResolvedCall[],
      ...(value.expectedFingerprint === undefined
        ? {}
        : { expectedFingerprint: value.expectedFingerprint }),
      ...(value.planSummary === undefined ? {} : { planSummary: value.planSummary }),
    };
  }

  if (status === 'awaiting-decision') {
    try {
      const parsed = parseKernelStoryboardResponse(value);
      return parsed.status === 'awaiting-decision'
        ? parsed as KernelCompileDecisionResponse
        : undefined;
    } catch {
      return undefined;
    }
  }

  if (status !== 'compiled'
    || !Array.isArray(value.resolvedCalls)
    || value.resolvedCalls.length === 0) {
    return undefined;
  }

  const resolvedCalls = value.resolvedCalls.map(parseResolvedCall);
  if (resolvedCalls.some((call) => call === undefined)) {
    return undefined;
  }

  const segments = isRecord(value.segments)
    && Array.isArray(value.segments.simulatedVideoClipIds)
    && value.segments.simulatedVideoClipIds.every(
      (id): id is string => typeof id === 'string',
    )
    ? { simulatedVideoClipIds: [...value.segments.simulatedVideoClipIds] }
    : undefined;
  const modeValue = readString(value.mode)?.toLowerCase();
  const mode = modeValue === 'story' || modeValue === 'mechanical'
    ? modeValue
    : undefined;
  if (modeValue !== undefined && mode === undefined) {
    return undefined;
  }

  let setup: KernelCompileCompiledResponse['setup'];
  if (value.setup !== undefined) {
    if (!isRecord(value.setup) || !isRecord(value.setup.newComposition)) {
      return undefined;
    }
    const name = readString(value.setup.newComposition.name);
    const durationSeconds = value.setup.newComposition.durationSeconds;
    if (!name
      || typeof durationSeconds !== 'number'
      || !Number.isFinite(durationSeconds)
      || durationSeconds <= 0) {
      return undefined;
    }
    setup = { newComposition: { name, durationSeconds } };
  }

  return {
    runId,
    status,
    ...(mode === undefined ? {} : { mode }),
    taskContract: value.taskContract,
    plan: value.plan,
    storySummary: value.storySummary,
    resolvedCalls: resolvedCalls as KernelResolvedCall[],
    ...(setup === undefined ? {} : { setup }),
    ...(segments === undefined ? {} : { segments }),
    expectedFingerprint: value.expectedFingerprint,
    summary: value.summary,
  };
}

function parseCompleteResponse(value: unknown): KernelRunCompleteResponse | undefined {
  if (!isRecord(value) || !isRecord(value.fingerprintAssert)) {
    return undefined;
  }

  const status = readString(value.status)?.toLowerCase();
  if ((status !== 'succeeded' && status !== 'failed')
    || typeof value.fingerprintAssert.matches !== 'boolean') {
    return undefined;
  }

  return {
    status,
    fingerprintAssert: {
      ...value.fingerprintAssert,
      matches: value.fingerprintAssert.matches,
    },
    verificationReport: value.verificationReport,
  };
}

// Snapshots go through the semantic tool gateway like every other kernel
// interaction (plan §8.3) — the gateway never reads stores directly.
async function buildTimelineSnapshot(executor: ExecuteToolCalls): Promise<unknown> {
  const [execution] = await executor(
    [{ id: 'kernel-snapshot', tool: 'getTimelineState', args: {} }],
    'chat',
    { guidedReplay: false, suppressHistory: true },
  );
  const result = execution?.result;
  if (!result?.success || result.data === undefined) {
    throw new Error(result?.error ?? 'getTimelineState did not return a snapshot.');
  }
  return result.data;
}

function describeFailure(value: unknown): string | undefined {
  const direct = readString(value);
  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    const messages = value
      .map(describeFailure)
      .filter((message): message is string => message !== undefined);
    return messages.length > 0 ? messages.slice(0, 3).join('; ') : undefined;
  }

  if (isRecord(value)) {
    return describeFailure(value.message)
      ?? describeFailure(value.error)
      ?? describeFailure(value.failures)
      ?? describeFailure(value.reason);
  }

  return undefined;
}

function readFingerprint(value: unknown): string | undefined {
  const direct = readString(value);
  if (direct) {
    return direct;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  return readFingerprint(value.committed)
    ?? readFingerprint(value.actualFingerprint)
    ?? readFingerprint(value.fingerprint)
    ?? readFingerprint(value.actual)
    ?? readFingerprint(value.hash)
    ?? readFingerprint(value.simulated)
    ?? readFingerprint(value.expectedFingerprint)
    ?? readFingerprint(value.expected);
}

function toolExecutionFailure(
  calls: KernelResolvedCall[],
  results: AIToolCallExecutionResult[],
): string | undefined {
  if (results.length !== calls.length) {
    return `Expected ${calls.length} tool results, received ${results.length}.`;
  }

  for (let index = 0; index < calls.length; index++) {
    const call = calls[index];
    const result = results[index];
    if (!call || !result || result.result.success !== true) {
      return result?.result.error ?? `Tool ${call?.tool ?? `#${index + 1}`} failed.`;
    }
  }
  return undefined;
}

function transactionAdapter(
  overrides?: Partial<KernelTransactionAdapter>,
): KernelTransactionAdapter {
  return {
    abort: overrides?.abort ?? abortAgentTransaction,
    begin: overrides?.begin ?? beginAgentTransaction,
    commit: overrides?.commit ?? commitAgentTransaction,
    hasOwnership: overrides?.hasOwnership ?? hasAgentTransactionOwnership,
  };
}

/** Wraps a report into the gateway result, deriving the legacy message. */
function handledResult(report: KernelRunReport): KernelChatGatewayResult {
  return {
    handled: true,
    message: formatKernelRunMessage(report),
    ...(report.runId === undefined ? {} : { runId: report.runId }),
    report,
  };
}

export async function tryKernelFirst(
  request: string,
  deps: KernelChatGatewayDependencies = {},
): Promise<KernelChatGatewayResult> {
  const storage = deps.storage ?? getDefaultStorage();
  if (!storage) {
    return { handled: false };
  }

  const config = resolveKernelConfig(storage);
  if (!config) {
    return { handled: false };
  }
  // Kernel-enabled turns fail closed by default so a timeout or decline can
  // never silently hand editing authority to the community provider. Legacy
  // fallback remains available only as an explicit local calibration opt-in.
  let fallbackEnabled = false;
  try {
    fallbackEnabled = storage.getItem('ms.kernel.fallback') === 'true';
  } catch {
    fallbackEnabled = false;
  }

  const startedAt = Date.now();
  const report = (partial: Omit<KernelRunReport, 'schemaVersion' | 'timings'> & {
    timings?: Partial<KernelRunReport['timings']>;
  }): KernelRunReport => ({
    schemaVersion: 1,
    ...partial,
    timings: { totalMs: Date.now() - startedAt, ...partial.timings },
  });

  const declineResult = (
    reason: string,
    detail?: string,
    runId?: string,
    missingPrecondition?: KernelMissingPrecondition,
  ): KernelChatGatewayResult => (
    fallbackEnabled
      ? { handled: false }
      : handledResult(report({
          outcome: 'declined',
          ...(runId === undefined ? {} : { runId }),
          steps: [],
          decline: buildDecline(reason, detail, missingPrecondition),
        }))
  );

  const notify = (
    stage: KernelProgressStage,
    options?: { detail?: string; current?: number; total?: number },
  ): void => {
    deps.onProgress?.(createKernelProgressEvent(stage, options ?? {}));
  };
  // Every mutating step is gated on this, so a cancelled turn cannot leave a
  // committed edit behind.
  const throwIfAborted = (): void => {
    if (deps.signal?.aborted) {
      throw new KernelRunAbortedError();
    }
  };

  const client = deps.client ?? new KernelServiceClient({
    authToken: config.token,
    baseUrl: config.baseUrl,
    fetchImpl: deps.fetchImpl,
  });
  const executeToolCalls = deps.executeToolCalls ?? executeAIToolCalls;
  const getSnapshot = deps.getSnapshot ?? (() => buildTimelineSnapshot(executeToolCalls));

  let compiled: KernelCompileResponse;
  let compileSnapshot: unknown;
  let compileMs: number | undefined;
  try {
    throwIfAborted();
    notify('reading-timeline');
    const snapshot = await getSnapshot();
    compileSnapshot = snapshot;
    throwIfAborted();
    notify('reading-transcript');
    const moments = await buildTranscriptMoments(snapshot, executeToolCalls);
    throwIfAborted();
    notify('reading-audio');
    const silenceRanges = await (deps.getSilenceRanges
      ? deps.getSilenceRanges(snapshot)
      : buildSilenceRanges(snapshot, executeToolCalls));
    log.info('kernel compile request', {
      momentCount: moments.length,
      requestLength: request.length,
      silenceRangeCount: silenceRanges.length,
    });
    throwIfAborted();
    notify('compiling', {
      detail: moments.length > 0 ? `${moments.length} transcript moments` : undefined,
    });
    const compileStartedAt = Date.now();
    const compileResult = await client.compile({
      request,
      snapshot,
      ...(deps.intent === undefined ? {} : { intent: deps.intent }),
      ...(deps.decisionPolicy === undefined
        ? {}
        : { decisionPolicy: deps.decisionPolicy }),
      ...(deps.conversation === undefined ? {} : { conversation: deps.conversation }),
      ...(deps.activeDecision === undefined ? {} : { activeDecision: deps.activeDecision }),
      ...(deps.activeVariantSetId === undefined
        ? {}
        : { activeVariantSetId: deps.activeVariantSetId }),
      ...(deps.seed === undefined ? {} : { seed: deps.seed }),
      ...(moments.length === 0
        ? {}
        : { moments, indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION }),
      ...(silenceRanges.length === 0 ? {} : { silentRanges: silenceRanges }),
    });
    compileMs = Date.now() - compileStartedAt;
    if (!compileResult.ok) {
      log.warn('kernel compile transport failed', {
        status: compileResult.status,
        error: compileResult.error,
      });
      return declineResult(
        'transportError',
        `The kernel service replied ${compileResult.status}: ${compileResult.error}`,
      );
    }

    const parsed = parseCompileResponse(compileResult.data);
    if (!parsed) {
      log.warn('kernel compile response unparseable', {
        data: compileResult.data,
      });
      return declineResult('unreadableResponse');
    }
    compiled = parsed;
  } catch (error) {
    if (error instanceof KernelRunAbortedError) {
      return declineResult('cancelled');
    }
    log.warn('kernel gateway threw before execution', {
      error: error instanceof Error ? error.message : String(error),
    });
    return declineResult(
      'gatewayError',
      error instanceof Error ? error.message : String(error),
    );
  }

  // A precondition abort occurs before any transaction starts. In auto mode we
  // may establish the declared evidence and compile one more time; never repair
  // a second abort, even if it repeats the same precondition.
  const declaredPrecondition = compiled.status === 'aborted'
    ? compiled.missingPrecondition
    : undefined;
  if (compiled.status === 'aborted'
    && declaredPrecondition !== undefined
    && deps.autoApprove === true
    && deps.satisfyPrecondition !== undefined) {
    const resolver = findPreconditionResolver(declaredPrecondition.kind);
    if (resolver) {
      const originalAbort = compiled;
      try {
        throwIfAborted();
        const detail = declaredPrecondition.kind === 'transcript'
          ? describeTranscriptPrecondition(compileSnapshot)
          : resolver.describe();
        notify('preparing-evidence', { detail });
        const satisfied = await deps.satisfyPrecondition(declaredPrecondition, {
          executeToolCalls,
          snapshot: compileSnapshot,
          signal: deps.signal,
          onProgress: (progressDetail, current, total) => {
            notify('preparing-evidence', { detail: progressDetail, current, total });
          },
        });
        throwIfAborted();

        if (satisfied) {
          throwIfAborted();
          notify('reading-timeline');
          const snapshot = await getSnapshot();
          compileSnapshot = snapshot;
          throwIfAborted();
          notify('reading-transcript');
          const moments = await buildTranscriptMoments(snapshot, executeToolCalls);
          throwIfAborted();
          notify('reading-audio');
          const silenceRanges = await (deps.getSilenceRanges
            ? deps.getSilenceRanges(snapshot)
            : buildSilenceRanges(snapshot, executeToolCalls));
          throwIfAborted();
          notify('compiling', {
            detail: moments.length > 0 ? `${moments.length} transcript moments` : undefined,
          });
          const compileStartedAt = Date.now();
          const compileResult = await client.compile({
            request,
            snapshot,
            ...(deps.intent === undefined ? {} : { intent: deps.intent }),
            ...(deps.decisionPolicy === undefined
              ? {}
              : { decisionPolicy: deps.decisionPolicy }),
            ...(deps.conversation === undefined ? {} : { conversation: deps.conversation }),
            ...(deps.activeDecision === undefined ? {} : { activeDecision: deps.activeDecision }),
            ...(deps.activeVariantSetId === undefined
              ? {}
              : { activeVariantSetId: deps.activeVariantSetId }),
            ...(deps.seed === undefined ? {} : { seed: deps.seed }),
            ...(moments.length === 0
              ? {}
              : { moments, indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION }),
            ...(silenceRanges.length === 0 ? {} : { silentRanges: silenceRanges }),
          });
          compileMs = (compileMs ?? 0) + Date.now() - compileStartedAt;
          if (!compileResult.ok) {
            return declineResult(
              'transportError',
              `The kernel service replied ${compileResult.status}: ${compileResult.error}`,
            );
          }
          const parsed = parseCompileResponse(compileResult.data);
          if (!parsed) {
            return declineResult('unreadableResponse');
          }
          compiled = parsed;
        }
      } catch (error) {
        if (error instanceof KernelRunAbortedError) {
          return declineResult('cancelled');
        }
        log.warn('kernel precondition repair failed', {
          error: error instanceof Error ? error.message : String(error),
          kind: declaredPrecondition.kind,
        });
        return declineResult(
          originalAbort.reason ?? 'declined',
          Array.isArray(originalAbort.failures) ? originalAbort.failures.join('; ') : undefined,
          originalAbort.runId,
          declaredPrecondition,
        );
      }
    }
  }

  if (compiled.status === 'planned' && compiled.resolvedCalls.length === 0) {
    return {
      handled: true,
      message: compiled.message,
      runId: compiled.runId,
    };
  }

  if (compiled.status === 'awaiting-decision') {
    return {
      handled: true,
      message: compiled.message,
      runId: compiled.runId,
      decision: compiled.decision,
    };
  }

  if (compiled.status !== 'compiled' && compiled.status !== 'planned') {
    if (compiled.status === 'aborted') {
      log.info('kernel declined the task', {
        reason: compiled.reason,
        failures: compiled.failures,
      });
      const abortFailures = Array.isArray(compiled.failures) ? compiled.failures : [];
      return declineResult(
        compiled.reason ?? 'declined',
        abortFailures.length > 0 ? abortFailures.join('; ') : undefined,
        compiled.runId,
        compiled.missingPrecondition,
      );
    }
    // Compile failures happen before any local mutation. The provider path is
    // only available when the local calibration fallback was explicitly enabled.
    log.warn('kernel compile failed', {
      runId: compiled.runId,
      failures: compiled.failures,
    });
    const compileFailures = Array.isArray(compiled.failures) ? compiled.failures : [];
    return declineResult(
      'compileFailed',
      compileFailures.length > 0 ? compileFailures.join('; ') : undefined,
      compiled.runId,
    );
  }

  const compiledPlan: KernelCompileCompiledResponse = compiled.status === 'planned'
    ? {
        runId: compiled.runId,
        status: 'compiled',
        mode: 'story',
        taskContract: { intent: 'plan' },
        plan: compiled.planSummary,
        resolvedCalls: compiled.resolvedCalls,
        expectedFingerprint: compiled.expectedFingerprint,
        summary: compiled.message,
      }
    : compiled;
  const transaction = transactionAdapter(deps.transaction);
  let agentTransaction: AgentTransaction | undefined;
  let setupCompositionId: string | undefined;
  const previousCompositionId = isRecord(compileSnapshot)
    ? readString(compileSnapshot.activeCompositionId)
    : undefined;

  type RollbackOutcome = 'rolled-back' | 'deferred' | 'ownership-lost' | 'unavailable';

  const understood = buildUnderstood(compiledPlan.taskContract);
  const plannedSteps = buildSteps(compiledPlan.resolvedCalls, compiledPlan.plan);
  const executedSteps: KernelReportStep[] = [];

  const failureResult = (detail: unknown, rollback: RollbackOutcome): KernelChatGatewayResult => {
    // A deferred rollback means our mutations are still applied; falling
    // back to the legacy loop would double-edit the timeline. Report the
    // failure honestly instead.
    if (rollback === 'deferred' || rollback === 'ownership-lost') {
      return handledResult(report({
        runId: compiledPlan.runId,
        ...(compiledPlan.mode === undefined ? {} : { mode: compiledPlan.mode }),
        outcome: 'failed',
        ...(understood === undefined ? {} : { understood }),
        steps: executedSteps,
        ...(describeFailure(detail) === undefined
          ? {}
          : { failure: describeFailure(detail) }),
        timings: { ...(compileMs === undefined ? {} : { compileMs }) },
      }));
    }
    console.warn('Kernel tool execution failed; rolled back.', detail);
    return declineResult(
      'toolExecutionFailed',
      describeFailure(detail) ?? String(detail),
      compiledPlan.runId,
    );
  };

  // Setup rollback: the history-batch abort restores store contents but not
  // the composition tab state (openCompositionIds/activeCompositionId), so a
  // setup-created composition would linger as an open ghost tab. Remove it
  // before the abort. The history snapshot application is the final store
  // update, so nothing may mutate composition state after it.
  const runSetupRollbackCall = async (
    id: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<void> => {
    try {
      const [execution] = await executeToolCalls([{ id, tool, args }], 'chat', {
        ...(deps.intent === 'plan' ? { executionMode: 'plan' as const } : {}),
        guidedReplay: false,
        suppressHistory: true,
      });
      if (execution?.result.success !== true) {
        log.warn('kernel setup rollback call failed', {
          tool,
          error: execution?.result.error ?? 'Tool did not return success.',
        });
      }
    } catch (error) {
      log.warn('kernel setup rollback call failed', {
        tool,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const rollbackExecution = async (): Promise<RollbackOutcome> => {
    if (!agentTransaction) {
      return 'unavailable';
    }
    if (!transaction.hasOwnership(agentTransaction)) {
      log.warn('kernel execution rollback skipped because transaction ownership was lost', {
        transactionId: agentTransaction.transactionId,
        historyBatchId: agentTransaction.historyBatchId,
      });
      return 'ownership-lost';
    }
    const cleanupSetup = setupCompositionId !== undefined && !agentTransaction.abortNoop;
    if (cleanupSetup && previousCompositionId) {
      await runSetupRollbackCall(
        'kernel-setup-rollback-reopen',
        'openComposition',
        { compositionId: previousCompositionId },
      );
    }
    if (cleanupSetup) {
      await runSetupRollbackCall(
        'kernel-setup-rollback-delete',
        'deleteMediaItem',
        { itemId: setupCompositionId },
      );
    }
    transaction.abort(agentTransaction);
    return agentTransaction.abortNoop ? 'deferred' : 'rolled-back';
  };

  const executeStartedAt = Date.now();
  try {
    throwIfAborted();
    agentTransaction = transaction.begin(`Kernel task: ${compiledPlan.runId}`);

    if (compiledPlan.setup?.newComposition) {
      notify('preparing', { detail: compiledPlan.setup.newComposition.name });
      const setupCall: KernelResolvedCall = {
        stepId: 'kernel-setup-new-composition',
        tool: 'createComposition',
        args: {
          name: compiledPlan.setup.newComposition.name,
          duration: compiledPlan.setup.newComposition.durationSeconds,
          openAfterCreate: true,
        },
      };
      const setupExecution: AIToolCallExecution = {
        id: setupCall.stepId,
        tool: setupCall.tool,
        args: setupCall.args,
      };
      const setupResults = await executeToolCalls([setupExecution], 'chat', {
        ...(deps.intent === 'plan' ? { executionMode: 'plan' as const } : {}),
        guidedReplay: false,
        suppressHistory: true,
      });
      const setupFailure = toolExecutionFailure([setupCall], setupResults);
      if (setupFailure) {
        return failureResult(setupFailure, await rollbackExecution());
      }
      const setupData = setupResults[0]?.result.data;
      if (isRecord(setupData) && typeof setupData.compositionId === 'string') {
        setupCompositionId = setupData.compositionId;
      } else {
        return failureResult(
          'createComposition did not return a compositionId.',
          await rollbackExecution(),
        );
      }
    }

    // Runtime id binding (plan §7.1): simulated segment ids and
    // source-timeline track ids are bound to live store ids per call.
    const binding = createExecutionIdBinding({
      executeToolCalls,
      sourceSnapshot: compileSnapshot,
      ...(compiledPlan.segments === undefined
        ? {}
        : { simulatedVideoClipIds: compiledPlan.segments.simulatedVideoClipIds }),
    });

    const totalCalls = compiledPlan.resolvedCalls.length;
    for (let index = 0; index < totalCalls; index++) {
      const call = compiledPlan.resolvedCalls[index]!;
      throwIfAborted();
      notify('executing', {
        detail: call.tool,
        current: index + 1,
        total: totalCalls,
      });
      const stepStartedAt = Date.now();
      const execution: AIToolCallExecution = {
        id: call.stepId,
        tool: call.tool,
        args: await binding.bindArgs(call.tool, call.args),
      };
      const results = await executeToolCalls([execution], 'chat', {
        ...(deps.intent === 'plan' ? { executionMode: 'plan' as const } : {}),
        guidedReplay: false,
        suppressHistory: true,
      });
      const failure = toolExecutionFailure([call], results);
      const planned = plannedSteps[index];
      if (failure) {
        executedSteps.push({
          ...(planned ?? { stepId: call.stepId, tool: call.tool }),
          status: 'failed',
          durationMs: Date.now() - stepStartedAt,
          error: failure,
        });
        return failureResult(failure, await rollbackExecution());
      }
      executedSteps.push({
        ...(planned ?? { stepId: call.stepId, tool: call.tool, status: 'ok' as const }),
        status: 'ok',
        durationMs: Date.now() - stepStartedAt,
      });

      binding.observeResult(call.tool, results[0]?.result.data);
    }
  } catch (error) {
    if (error instanceof KernelRunAbortedError) {
      await rollbackExecution();
      return declineResult('cancelled', undefined, compiledPlan.runId);
    }
    return failureResult(error, await rollbackExecution());
  }
  const executeMs = Date.now() - executeStartedAt;

  // A verification failure is not a decline: the edit already ran locally and
  // was rolled back, so the turn is reported as failed rather than handed to
  // the provider.
  const verificationFailure = (
    detail: unknown,
    fingerprint?: string,
  ): KernelChatGatewayResult => handledResult(report({
    runId: compiledPlan.runId,
    ...(compiledPlan.mode === undefined ? {} : { mode: compiledPlan.mode }),
    outcome: 'failed',
    ...(understood === undefined ? {} : { understood }),
    steps: executedSteps,
    ...(fingerprint === undefined
      ? {}
      : {
          verified: {
            matches: false,
            fingerprint,
            counts: {},
            checks: [],
          },
        }),
    failure: describeFailure(detail) ?? 'The kernel did not report a reason.',
    timings: {
      ...(compileMs === undefined ? {} : { compileMs }),
      executeMs,
    },
  }));

  notify('verifying');
  let completion: KernelRunCompleteResponse;
  let finalSnapshot: unknown;
  const verifyStartedAt = Date.now();
  try {
    finalSnapshot = await getSnapshot();
    const completeResult = await client.completeRun(compiledPlan.runId, { finalSnapshot });
    if (!completeResult.ok) {
      await rollbackExecution();
      return verificationFailure(completeResult.error);
    }

    const parsed = parseCompleteResponse(completeResult.data);
    if (!parsed) {
      await rollbackExecution();
      return verificationFailure('The completion check returned an unreadable response.');
    }
    completion = parsed;
  } catch (error) {
    await rollbackExecution();
    return verificationFailure(error);
  }
  const verifyMs = Date.now() - verifyStartedAt;

  const fingerprint = readFingerprint(completion.fingerprintAssert)
    ?? readFingerprint(compiledPlan.expectedFingerprint);
  if (completion.fingerprintAssert.matches !== true) {
    await rollbackExecution();
    return verificationFailure(
      describeFailure(completion.verificationReport)
        ?? 'The final fingerprint does not match the simulated result.',
      fingerprint,
    );
  }
  if (completion.status !== 'succeeded') {
    await rollbackExecution();
    return verificationFailure(completion.verificationReport, fingerprint);
  }

  // Last cancellation window: after this the edit is durable.
  if (deps.signal?.aborted) {
    await rollbackExecution();
    return declineResult('cancelled', undefined, compiledPlan.runId);
  }

  notify('committing');
  try {
    transaction.commit(agentTransaction);
  } catch (error) {
    return failureResult(error, await rollbackExecution());
  }

  const assumptionNote = compiledPlan.mode === 'story'
    ? formatAssumptionNote(compiledPlan.storySummary)
    : undefined;

  return handledResult(report({
    runId: compiledPlan.runId,
    ...(compiledPlan.mode === undefined ? {} : { mode: compiledPlan.mode }),
    outcome: 'verified',
    ...(understood === undefined ? {} : { understood }),
    steps: executedSteps,
    verified: buildVerified(
      completion.fingerprintAssert,
      completion.verificationReport,
      compiledPlan.summary,
      fingerprint,
      finalSnapshot,
    ),
    ...(assumptionNote === undefined ? {} : { assumptionNote }),
    timings: {
      ...(compileMs === undefined ? {} : { compileMs }),
      executeMs,
      verifyMs,
    },
  }));
}
