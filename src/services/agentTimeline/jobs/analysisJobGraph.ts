import {
  AGENT_TIMELINE_JOB_GRAPH_SCHEMA_VERSION,
  type AgentTimelineJobGraphSnapshot,
  type AgentTimelineJobOutcome,
  type AgentTimelineJobSnapshot,
  type AgentTimelineJobStatus,
} from '../../../types/agentTimeline/jobGraph';
import { analysisResourceCoordinator } from './analysisResourceCoordinator';

export interface AgentTimelineRuntimeJobContext {
  signal: AbortSignal;
  reportProgress: (progress: number) => void;
}

export interface AgentTimelineRuntimeJob {
  id: string;
  channel: string;
  dependencies?: readonly string[];
  resourceLocks?: readonly string[];
  run: (context: AgentTimelineRuntimeJobContext) => Promise<AgentTimelineJobOutcome>;
}

export interface RunAgentTimelineJobGraphOptions {
  graphId: string;
  jobs: readonly AgentTimelineRuntimeJob[];
  signal?: AbortSignal;
  onUpdate?: (snapshot: AgentTimelineJobGraphSnapshot) => void;
}

interface MutableJobState {
  definition: AgentTimelineRuntimeJob;
  snapshot: AgentTimelineJobSnapshot;
}

const SUCCESS_STATUSES = new Set<AgentTimelineJobStatus>(['completed', 'cached', 'partial']);
const TERMINAL_STATUSES = new Set<AgentTimelineJobStatus>([
  ...SUCCESS_STATUSES,
  'failed',
  'cancelled',
  'blocked',
]);

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

function normalizeJob(job: AgentTimelineRuntimeJob): AgentTimelineRuntimeJob {
  if (!job.id.trim()) throw new TypeError('Analysis job IDs must not be empty');
  if (!job.channel.trim()) throw new TypeError(`Analysis job ${job.id} needs a channel`);
  return {
    ...job,
    dependencies: [...new Set(job.dependencies ?? [])].toSorted(),
    resourceLocks: [...new Set(job.resourceLocks ?? [])].filter(Boolean).toSorted(),
  };
}

function assertGraph(jobs: readonly AgentTimelineRuntimeJob[]): void {
  const byId = new Map<string, AgentTimelineRuntimeJob>();
  for (const job of jobs) {
    if (byId.has(job.id)) throw new TypeError(`Duplicate analysis job ID: ${job.id}`);
    byId.set(job.id, job);
  }
  for (const job of jobs) {
    for (const dependency of job.dependencies ?? []) {
      if (!byId.has(dependency)) {
        throw new TypeError(`Analysis job ${job.id} has unknown dependency ${dependency}`);
      }
      if (dependency === job.id) throw new TypeError(`Analysis job ${job.id} depends on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new TypeError(`Analysis job graph contains a cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const job of jobs) visit(job.id);
}

function graphStatus(
  states: readonly MutableJobState[],
  running: boolean,
  aborted: boolean,
): AgentTimelineJobGraphSnapshot['status'] {
  if (running) return 'running';
  if (aborted || states.some((state) => state.snapshot.status === 'cancelled')) return 'cancelled';
  if (states.some((state) => state.snapshot.status === 'failed')) return 'failed';
  if (states.some((state) => state.snapshot.status === 'blocked'
    || state.snapshot.status === 'partial')) return 'partial';
  return 'completed';
}

function immutableSnapshot(
  graphId: string,
  states: readonly MutableJobState[],
  running: boolean,
  aborted: boolean,
): AgentTimelineJobGraphSnapshot {
  return {
    schemaVersion: AGENT_TIMELINE_JOB_GRAPH_SCHEMA_VERSION,
    graphId,
    status: graphStatus(states, running, aborted),
    jobs: states.map((state) => ({
      ...state.snapshot,
      dependencies: [...state.snapshot.dependencies],
      resourceLocks: [...state.snapshot.resourceLocks],
      error: state.snapshot.error ? { ...state.snapshot.error } : undefined,
    })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Analysis job failed';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function cancelledError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Analysis cancelled.', 'AbortError');
  }
  const error = new Error('Analysis cancelled.');
  error.name = 'AbortError';
  return error;
}

export async function runAgentTimelineJobGraph(
  options: RunAgentTimelineJobGraphOptions,
): Promise<AgentTimelineJobGraphSnapshot> {
  if (!options.graphId.trim()) throw new TypeError('Analysis job graph ID must not be empty');
  const jobs = options.jobs.map(normalizeJob);
  assertGraph(jobs);
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();

  const states = jobs.map((definition): MutableJobState => ({
    definition,
    snapshot: {
      id: definition.id,
      channel: definition.channel,
      status: 'queued',
      progress: 0,
      dependencies: definition.dependencies ?? [],
      resourceLocks: definition.resourceLocks ?? [],
    },
  }));
  const stateById = new Map(states.map((state) => [state.definition.id, state]));
  const active = new Map<string, Promise<void>>();
  let running = true;
  const emit = () => options.onUpdate?.(
    immutableSnapshot(options.graphId, states, running, controller.signal.aborted),
  );
  emit();

  const start = (state: MutableJobState): void => {
    const promise = (async () => {
      let release: () => void = () => undefined;
      try {
        release = await analysisResourceCoordinator.acquire(
          state.definition.resourceLocks ?? [],
          controller.signal,
        );
        if (controller.signal.aborted) throw cancelledError();
        state.snapshot = {
          ...state.snapshot,
          status: 'running',
          startedAt: Date.now(),
        };
        emit();
        const outcome = await state.definition.run({
          signal: controller.signal,
          reportProgress(progress) {
            if (state.snapshot.status !== 'running') return;
            state.snapshot = { ...state.snapshot, progress: normalizeProgress(progress) };
            emit();
          },
        });
        if (!SUCCESS_STATUSES.has(outcome)) {
          throw new TypeError(`Analysis job ${state.definition.id} returned invalid outcome ${outcome}`);
        }
        state.snapshot = {
          ...state.snapshot,
          status: outcome,
          progress: 1,
          finishedAt: Date.now(),
        };
      } catch (error) {
        const cancelled = controller.signal.aborted || isAbortError(error);
        state.snapshot = {
          ...state.snapshot,
          status: cancelled ? 'cancelled' : 'failed',
          finishedAt: Date.now(),
          error: cancelled ? undefined : { message: errorMessage(error), retryable: true },
        };
      } finally {
        release();
        active.delete(state.definition.id);
        emit();
      }
    })();
    active.set(state.definition.id, promise);
  };

  while (states.some((state) => !TERMINAL_STATUSES.has(state.snapshot.status))) {
    let changed = false;
    for (const state of states) {
      if (state.snapshot.status !== 'queued') continue;
      const dependencies = (state.definition.dependencies ?? [])
        .map((dependency) => stateById.get(dependency)!);
      if (dependencies.some((dependency) => (
        dependency.snapshot.status === 'failed'
        || dependency.snapshot.status === 'cancelled'
        || dependency.snapshot.status === 'blocked'
      ))) {
        state.snapshot = {
          ...state.snapshot,
          status: controller.signal.aborted ? 'cancelled' : 'blocked',
          finishedAt: Date.now(),
        };
        changed = true;
      } else if (dependencies.every((dependency) => SUCCESS_STATUSES.has(dependency.snapshot.status))) {
        start(state);
        changed = true;
      }
    }
    if (controller.signal.aborted) {
      for (const state of states) {
        if (state.snapshot.status === 'queued') {
          state.snapshot = {
            ...state.snapshot,
            status: 'cancelled',
            finishedAt: Date.now(),
          };
          changed = true;
        }
      }
    }
    if (changed) emit();
    if (active.size > 0) await Promise.race(active.values());
    else if (!changed) throw new Error('Analysis job graph could not make progress');
  }

  running = false;
  options.signal?.removeEventListener('abort', onExternalAbort);
  const result = immutableSnapshot(
    options.graphId,
    states,
    running,
    controller.signal.aborted,
  );
  options.onUpdate?.(result);
  return result;
}
