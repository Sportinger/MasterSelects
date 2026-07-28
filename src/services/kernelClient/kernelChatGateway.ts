import {
  executeAIToolCalls,
  type AIToolCallExecution,
  type AIToolCallExecutionResult,
} from '../aiTools';
import {
  abortAgentTransaction,
  beginAgentTransaction,
  commitAgentTransaction,
  type AgentTransaction,
} from '../aiTools/agentTransaction';
import { Logger } from '../logger';
import { KernelServiceClient } from './index';
import {
  formatAssumptionNote,
  formatStoryVerificationDetails,
} from './storyVerification';
import {
  buildTranscriptMoments,
  TRANSCRIPT_MOMENT_INDEX_VERSION,
} from './transcriptMoments';
import type {
  KernelCompileAbortReason,
  KernelCompileCompiledResponse,
  KernelCompileResponse,
  KernelResolvedCall,
  KernelRunCompleteResponse,
} from './types';

const KERNEL_ENABLED_KEY = 'ms.kernel.enabled';
const KERNEL_TOKEN_KEY = 'ms.kernel.token';
const KERNEL_URL_KEY = 'ms.kernel.url';
const FINGERPRINT_SHORT_LENGTH = 8;

const log = Logger.create('KernelGateway');

export type KernelChatGatewayResult =
  | { handled: false }
  | { handled: true; message: string; runId?: string };

type ExecuteToolCalls = typeof executeAIToolCalls;

interface KernelTransactionAdapter {
  abort: (transaction: AgentTransaction) => void;
  begin: (label: string) => AgentTransaction;
  commit: (transaction: AgentTransaction) => unknown;
}

export interface KernelChatGatewayDependencies {
  client?: KernelServiceClient;
  executeToolCalls?: ExecuteToolCalls;
  fetchImpl?: typeof fetch;
  getSnapshot?: () => Promise<unknown> | unknown;
  seed?: string;
  storage?: Storage;
  transaction?: Partial<KernelTransactionAdapter>;
}

interface KernelConfig {
  baseUrl: string;
  token: string;
}

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

function readConfig(storage: Storage): KernelConfig | undefined {
  try {
    if (storage.getItem(KERNEL_ENABLED_KEY) === 'false') {
      return undefined;
    }

    const token = storage.getItem(KERNEL_TOKEN_KEY)?.trim();
    const baseUrl = storage.getItem(KERNEL_URL_KEY)?.trim();
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

function parseAbortReason(value: unknown): KernelCompileAbortReason | undefined {
  const reason = readString(value);
  return reason === 'notMechanicalTask'
    || reason === 'storyPathNeedsProvider'
    || reason === 'storyPathNeedsMoments'
    ? reason
    : undefined;
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
    return {
      runId,
      status,
      failures: value.failures,
      ...(reason === undefined ? {} : { reason }),
    };
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
// interaction (plan Â§8.3) â€” the gateway never reads stores directly.
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

function failedMessage(detail: unknown, prefix = 'Kernel-Ausf\u00fchrung fehlgeschlagen'): string {
  const reason = describeFailure(detail);
  return reason
    ? `${prefix}: ${reason}`
    : `${prefix}: Der Kernel hat keinen Fehlergrund angegeben.`;
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

function firstRecord(values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord) as Record<string, unknown> | undefined;
}

function readFiniteNumber(
  sources: Array<Record<string, unknown> | undefined>,
  keys: string[],
): number | undefined {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (Array.isArray(value)) {
        return value.length;
      }
    }
  }
  return undefined;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function shortFingerprint(fingerprint: string | undefined): string {
  if (!fingerprint) {
    return 'unbekannt';
  }
  const separatorIndex = fingerprint.indexOf(':');
  const digest = separatorIndex >= 0 ? fingerprint.slice(separatorIndex + 1) : fingerprint;
  return digest.slice(0, FINGERPRINT_SHORT_LENGTH) || 'unbekannt';
}

function formatVerificationDetails(report: unknown, compileSummary: unknown): string {
  const reportRecord = isRecord(report) ? report : undefined;
  const reportSummary = reportRecord && isRecord(reportRecord.summary)
    ? reportRecord.summary
    : undefined;
  const verified = reportRecord && isRecord(reportRecord.verified)
    ? reportRecord.verified
    : undefined;
  const compileSummaryRecord = isRecord(compileSummary) ? compileSummary : undefined;
  const counts = firstRecord([
    reportSummary?.counts,
    reportRecord?.counts,
    compileSummaryRecord?.counts,
  ]);
  const sources = [counts, verified, reportSummary, reportRecord, compileSummaryRecord];
  const videoCount = readFiniteNumber(sources, ['videoCount', 'videoClipCount']);
  const audioCount = readFiniteNumber(sources, ['audioCount', 'audioClipCount']);
  const clipCount = readFiniteNumber(sources, ['clipCount', 'totalClips', 'clips']);
  const trackCount = readFiniteNumber(sources, ['trackCount', 'totalTracks', 'tracks']);
  const occupancy = firstRecord([
    reportSummary?.occupied,
    reportSummary?.occupiedSpan,
    reportRecord?.occupied,
    reportRecord?.occupiedSpan,
    isRecord(reportRecord?.occupancy) ? reportRecord.occupancy.occupied : undefined,
    compileSummaryRecord?.occupied,
    compileSummaryRecord?.occupiedSpan,
  ]);
  const range = [
    reportSummary?.occupiedRange,
    verified?.occupiedRange,
    reportRecord?.occupiedRange,
    compileSummaryRecord?.occupiedRange,
  ].find((value): value is unknown[] => Array.isArray(value) && value.length >= 2);
  const rangeStart = range?.[0];
  const rangeEnd = range?.[1];
  const startSeconds = typeof rangeStart === 'number' && Number.isFinite(rangeStart)
    ? rangeStart
    : readFiniteNumber([occupancy, ...sources], ['occupiedStartSeconds', 'startSeconds', 'start']);
  const endSeconds = typeof rangeEnd === 'number' && Number.isFinite(rangeEnd)
    ? rangeEnd
    : readFiniteNumber([occupancy, ...sources], ['occupiedEndSeconds', 'endSeconds', 'end']);
  const spanSeconds = readFiniteNumber([occupancy, ...sources], [
    'occupiedSpanSeconds',
    'spanSeconds',
    'durationSeconds',
    'duration',
  ]);
  const details: string[] = [];

  if (videoCount !== undefined) details.push(`${formatNumber(videoCount)} Video-Clips`);
  if (audioCount !== undefined) details.push(`${formatNumber(audioCount)} Audio-Clips`);
  if (videoCount === undefined && audioCount === undefined && clipCount !== undefined) {
    details.push(`${formatNumber(clipCount)} Clips`);
  }
  if (trackCount !== undefined) details.push(`${formatNumber(trackCount)} Spuren`);
  if (startSeconds !== undefined && endSeconds !== undefined) {
    const measuredSpan = spanSeconds ?? endSeconds - startSeconds;
    details.push(
      `belegter Bereich ${formatNumber(startSeconds)}\u2013${formatNumber(endSeconds)} s (${formatNumber(measuredSpan)} s)`,
    );
  } else if (spanSeconds !== undefined) {
    details.push(`belegte Spanne ${formatNumber(spanSeconds)} s`);
  } else if (endSeconds !== undefined) {
    details.push(`belegte Timeline bis ${formatNumber(endSeconds)} s`);
  }

  if (details.length > 0) {
    return details.join(', ');
  }

  return readString(reportRecord?.summary)
    ?? readString(compileSummary)
    ?? 'Der Auftrag wurde erfolgreich ausgef\u00fchrt.';
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
  };
}

function verificationFailure(
  runId: string,
  detail: unknown,
  fingerprint?: string,
): KernelChatGatewayResult {
  const fingerprintShort = shortFingerprint(fingerprint);
  return {
    handled: true,
    message: failedMessage(
      detail,
      `Kernel-Verifikation fehlgeschlagen (${fingerprintShort})`,
    ),
    runId,
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

  const config = readConfig(storage);
  if (!config) {
    return { handled: false };
  }

  const client = deps.client ?? new KernelServiceClient({
    authToken: config.token,
    baseUrl: config.baseUrl,
    fetchImpl: deps.fetchImpl,
  });
  const executeToolCalls = deps.executeToolCalls ?? executeAIToolCalls;
  const getSnapshot = deps.getSnapshot ?? (() => buildTimelineSnapshot(executeToolCalls));

  let compiled: KernelCompileResponse;
  try {
    const snapshot = await getSnapshot();
    const moments = await buildTranscriptMoments(snapshot, executeToolCalls);
    log.info('kernel compile request', {
      momentCount: moments.length,
      requestLength: request.length,
    });
    const compileResult = await client.compile({
      request,
      snapshot,
      ...(deps.seed === undefined ? {} : { seed: deps.seed }),
      ...(moments.length === 0
        ? {}
        : { moments, indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION }),
    });
    if (!compileResult.ok) {
      log.warn('kernel compile transport failed; falling back', {
        status: compileResult.status,
        error: compileResult.error,
      });
      return { handled: false };
    }

    const parsed = parseCompileResponse(compileResult.data);
    if (!parsed) {
      log.warn('kernel compile response unparseable; falling back', {
        data: compileResult.data,
      });
      return { handled: false };
    }
    compiled = parsed;
  } catch (error) {
    log.warn('kernel gateway threw before execution; falling back', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { handled: false };
  }

  if (compiled.status !== 'compiled') {
    if (compiled.status === 'aborted') {
      log.info('kernel declined the task; falling back to community chat', {
        reason: compiled.reason,
        failures: compiled.failures,
      });
      return { handled: false };
    }
    log.warn('kernel compile failed', {
      runId: compiled.runId,
      failures: compiled.failures,
    });
    return {
      handled: true,
      message: failedMessage(compiled.failures),
      runId: compiled.runId,
    };
  }

  const compiledPlan: KernelCompileCompiledResponse = compiled;
  const transaction = transactionAdapter(deps.transaction);
  let agentTransaction: AgentTransaction | undefined;

  const failureResult = (detail: unknown): KernelChatGatewayResult => {
    // A deferred rollback means our mutations are still applied; falling
    // back to the legacy loop would double-edit the timeline. Report the
    // failure honestly instead.
    if (agentTransaction?.abortNoop) {
      return {
        handled: true,
        message: failedMessage(detail),
        runId: compiledPlan.runId,
      };
    }
    console.warn('Kernel tool execution failed; rolled back and falling back to community chat.', detail);
    return { handled: false };
  };

  try {
    agentTransaction = transaction.begin(`Kernel task: ${compiledPlan.runId}`);

    if (compiledPlan.setup?.newComposition) {
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
        guidedReplay: false,
        suppressHistory: true,
      });
      const setupFailure = toolExecutionFailure([setupCall], setupResults);
      if (setupFailure) {
        transaction.abort(agentTransaction);
        return failureResult(setupFailure);
      }
    }

    // Runtime id binding: reorder calls reference simulated segment ids.
    // After the split executes, map them positionally onto the real ids
    // from the split result's segments payload (plan Â§7.1).
    const simulatedIds = compiledPlan.segments?.simulatedVideoClipIds;
    let simulatedToReal: Map<string, string> | undefined;
    const mapId = (id: string): string => simulatedToReal?.get(id) ?? id;
    const mapArgs = (args: Record<string, unknown>): Record<string, unknown> => {
      if (!simulatedToReal) {
        return args;
      }
      const mapped: Record<string, unknown> = { ...args };
      for (const [key, value] of Object.entries(mapped)) {
        if (typeof value === 'string') {
          mapped[key] = mapId(value);
        } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
          mapped[key] = value.map(mapId);
        }
      }
      return mapped;
    };

    for (const call of compiledPlan.resolvedCalls) {
      const execution: AIToolCallExecution = {
        id: call.stepId,
        tool: call.tool,
        args: mapArgs(call.args),
      };
      const results = await executeToolCalls([execution], 'chat', {
        guidedReplay: false,
        suppressHistory: true,
      });
      const failure = toolExecutionFailure([call], results);
      if (failure) {
        transaction.abort(agentTransaction);
        return failureResult(failure);
      }

      const data = results[0]?.result.data;
      if (simulatedIds
        && !simulatedToReal
        && isRecord(data)
        && isRecord(data.segments)
        && Array.isArray(data.segments.videoClipIds)) {
        const realIds = data.segments.videoClipIds
          .filter((id): id is string => typeof id === 'string');
        if (realIds.length === simulatedIds.length) {
          simulatedToReal = new Map(
            simulatedIds.map((simulatedId, index) => [
              simulatedId,
              realIds[index] as string,
            ]),
          );
        }
      }
    }
    transaction.commit(agentTransaction);
  } catch (error) {
    if (agentTransaction) {
      transaction.abort(agentTransaction);
    }
    return failureResult(error);
  }

  let completion: KernelRunCompleteResponse;
  let finalSnapshot: unknown;
  try {
    finalSnapshot = await getSnapshot();
    const completeResult = await client.completeRun(compiledPlan.runId, { finalSnapshot });
    if (!completeResult.ok) {
      return verificationFailure(compiledPlan.runId, completeResult.error);
    }

    const parsed = parseCompleteResponse(completeResult.data);
    if (!parsed) {
      return verificationFailure(compiledPlan.runId, 'Ung\u00fcltige Antwort der Abschlusspr\u00fcfung.');
    }
    completion = parsed;
  } catch (error) {
    return verificationFailure(compiledPlan.runId, error);
  }

  const fingerprint = readFingerprint(completion.fingerprintAssert)
    ?? readFingerprint(compiledPlan.expectedFingerprint);
  if (completion.fingerprintAssert.matches !== true) {
    return verificationFailure(
      compiledPlan.runId,
      describeFailure(completion.verificationReport)
        ?? 'Der finale Fingerprint stimmt nicht mit dem erwarteten Ergebnis \u00fcberein.',
      fingerprint,
    );
  }
  if (completion.status !== 'succeeded') {
    return verificationFailure(
      compiledPlan.runId,
      completion.verificationReport,
      fingerprint,
    );
  }

  const fingerprintShort = shortFingerprint(fingerprint);
  if (compiledPlan.mode === 'story') {
    const details = formatStoryVerificationDetails(
      finalSnapshot,
      completion.verificationReport,
      compiledPlan.summary,
      compiledPlan.storySummary,
    );
    const assumptionNote = formatAssumptionNote(compiledPlan.storySummary);
    return {
      handled: true,
      message: `Kernel-verifiziert (${fingerprintShort}): ${details}`
        + (assumptionNote ? `\n${assumptionNote}` : ''),
      runId: compiledPlan.runId,
    };
  }

  const details = formatVerificationDetails(
    completion.verificationReport,
    compiledPlan.summary,
  );
  return {
    handled: true,
    message: `Kernel-verifiziert (${fingerprintShort}): ${details}`,
    runId: compiledPlan.runId,
  };
}
