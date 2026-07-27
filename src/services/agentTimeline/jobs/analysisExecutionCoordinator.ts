import type {
  AgentTimelineJobGraphSnapshot,
  AgentTimelineJobOutcome,
} from '../../../types/agentTimeline/jobGraph';
import {
  runAgentTimelineJobGraph,
  type AgentTimelineRuntimeJob,
} from './analysisJobGraph';

export interface AgentTimelineAnalysisOperation {
  id: string;
  channel: string;
  dependencies?: readonly string[];
  resourceLocks?: readonly string[];
  isCached?: () => boolean | Promise<boolean>;
  run: (signal: AbortSignal) => void | AgentTimelineJobOutcome | Promise<void | AgentTimelineJobOutcome>;
  cancel?: () => void;
}

export interface RunAgentTimelineAnalysisOptions {
  runKey: string;
  operations: readonly AgentTimelineAnalysisOperation[];
  signal?: AbortSignal;
  onUpdate?: (snapshot: AgentTimelineJobGraphSnapshot) => void;
}

interface ActiveAnalysisRun {
  controller: AbortController;
  listeners: Set<(snapshot: AgentTimelineJobGraphSnapshot) => void>;
  operations: readonly AgentTimelineAnalysisOperation[];
  promise: Promise<AgentTimelineJobGraphSnapshot> | null;
  snapshot?: AgentTimelineJobGraphSnapshot;
}

interface AnalysisExecutionRuntime {
  active: Map<string, ActiveAnalysisRun>;
}

type AnalysisExecutionGlobal = typeof globalThis & {
  __MASTERSELECTS_AGENT_TIMELINE_EXECUTION__?: AnalysisExecutionRuntime;
};

const executionGlobal = globalThis as AnalysisExecutionGlobal;
let runtime = executionGlobal.__MASTERSELECTS_AGENT_TIMELINE_EXECUTION__ ?? {
  active: new Map<string, ActiveAnalysisRun>(),
};
executionGlobal.__MASTERSELECTS_AGENT_TIMELINE_EXECUTION__ = runtime;

if (import.meta.hot) {
  import.meta.hot.accept();
  const restored = import.meta.hot.data?.agentTimelineExecution as
    | AnalysisExecutionRuntime
    | undefined;
  if (restored) runtime = restored;
  import.meta.hot.dispose((data) => {
    data.agentTimelineExecution = runtime;
  });
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Analysis was cancelled.', 'AbortError');
  }
  const error = new Error('Analysis was cancelled.');
  error.name = 'AbortError';
  return error;
}

function operationJob(operation: AgentTimelineAnalysisOperation): AgentTimelineRuntimeJob {
  return {
    id: operation.id,
    channel: operation.channel,
    dependencies: operation.dependencies,
    resourceLocks: operation.resourceLocks,
    async run({ signal }) {
      if (signal.aborted) throw abortError();
      if (await operation.isCached?.()) return 'cached';
      const onAbort = () => operation.cancel?.();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const outcome = await operation.run(signal);
        if (signal.aborted) throw abortError();
        return outcome ?? 'completed';
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

function attachExternalAbort(
  signal: AbortSignal | undefined,
  runKey: string,
): () => void {
  if (!signal) return () => undefined;
  const abort = () => cancelAgentTimelineAnalysis(runKey);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return () => signal.removeEventListener('abort', abort);
}

/**
 * Starts one coalesced analysis run for an exact source/scope/profile key.
 * A repeated Analyze All click observes the existing graph instead of
 * scheduling duplicate decoder, model, or provider work.
 */
export function runAgentTimelineAnalysis(
  options: RunAgentTimelineAnalysisOptions,
): Promise<AgentTimelineJobGraphSnapshot> {
  const runKey = options.runKey.trim();
  if (!runKey) throw new TypeError('Analysis run key must not be empty');
  const existing = runtime.active.get(runKey);
  if (existing) {
    if (!existing.promise) {
      throw new Error(`Analysis run ${runKey} is still being initialized`);
    }
    if (options.onUpdate) {
      existing.listeners.add(options.onUpdate);
      if (existing.snapshot) options.onUpdate(existing.snapshot);
    }
    const detachAbort = attachExternalAbort(options.signal, runKey);
    void existing.promise.then(detachAbort, detachAbort);
    return existing.promise;
  }
  if (options.operations.length === 0) {
    throw new TypeError('Analysis execution needs at least one operation');
  }

  const controller = new AbortController();
  const listeners = new Set<(snapshot: AgentTimelineJobGraphSnapshot) => void>();
  if (options.onUpdate) listeners.add(options.onUpdate);
  const run: ActiveAnalysisRun = {
    controller,
    listeners,
    operations: [...options.operations],
    promise: null,
  };
  runtime.active.set(runKey, run);
  const detachAbort = attachExternalAbort(options.signal, runKey);
  run.promise = runAgentTimelineJobGraph({
    graphId: runKey,
    jobs: options.operations.map(operationJob),
    signal: controller.signal,
    onUpdate(snapshot) {
      run.snapshot = snapshot;
      for (const listener of run.listeners) listener(snapshot);
    },
  }).finally(() => {
    detachAbort();
    if (runtime.active.get(runKey) === run) runtime.active.delete(runKey);
  });
  return run.promise;
}

export function cancelAgentTimelineAnalysis(runKey: string): boolean {
  const run = runtime.active.get(runKey);
  if (!run) return false;
  run.controller.abort();
  return true;
}

export function getAgentTimelineAnalysisSnapshot(
  runKey: string,
): AgentTimelineJobGraphSnapshot | undefined {
  return runtime.active.get(runKey)?.snapshot;
}
