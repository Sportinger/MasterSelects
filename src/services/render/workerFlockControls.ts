import type { FlockSimulationRuntime } from '../../engine/flock/runtime/FlockSimulationRuntime';
import type { FlockPrecomputeResult, FlockRuntimeStatus } from '../../engine/flock/runtime/flockRuntimeApi';
import { buildFlockRuntimeStatus } from '../../engine/flock/runtime/flockRuntimeStatus';

export interface WorkerFlockControlCommand {
  readonly type: 'flock.control';
  readonly targetId: string;
  readonly compositionId: string;
  readonly clipId: string;
  readonly jobId: string;
  readonly operation: 'start' | 'status' | 'cancel' | 'clear';
  readonly range?: { start: number; end: number };
  readonly persist?: boolean;
}

export interface WorkerFlockControlReply {
  readonly running: boolean;
  readonly result?: FlockPrecomputeResult;
  readonly status?: FlockRuntimeStatus;
}

interface Job {
  clipId: string;
  compositionId: string;
  runtime: FlockSimulationRuntime;
  result?: FlockPrecomputeResult;
}

/** Start acknowledges immediately so status and cancellation can reach the Worker. */
export class WorkerFlockControls {
  private readonly jobs = new Map<string, Job>();

  private readonly resolve: (compositionId: string, clipId: string) => FlockSimulationRuntime | null;

  constructor(resolve: (compositionId: string, clipId: string) => FlockSimulationRuntime | null) {
    this.resolve = resolve;
  }

  async accept(command: WorkerFlockControlCommand): Promise<WorkerFlockControlReply> {
    const { clipId, compositionId, jobId, operation } = command;
    const fail = (message: string): WorkerFlockControlReply => ({ running: false, result: { ok: false, message } });
    let job = this.jobs.get(jobId);
    if (job && (job.clipId !== clipId || job.compositionId !== compositionId)) return fail('Precompute job belongs to another clip.');
    const runtime = this.resolve(compositionId, clipId);
    if (!runtime || (job && job.runtime !== runtime)) return fail('The prepared Flock scene changed; show the clip and retry.');
    if (operation === 'start') {
      const range = command.range;
      if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start || range.start < 0) {
        return fail('Choose a finite, increasing precompute range.');
      }
      if (!job) {
        if ([...this.jobs.values()].some(value => !value.result && value.runtime === runtime && value.clipId === clipId)) {
          return fail('A precompute for this clip is already running.');
        }
        for (const [id, previous] of this.jobs) if (previous.result) this.jobs.delete(id);
        job = { clipId, compositionId, runtime };
        this.jobs.set(jobId, job);
        const pending = job;
        void runtime.requestPrecompute(clipId, range, { persist: command.persist === true }).then(
          result => { pending.result = result; },
          error => { pending.result = { ok: false, message: error instanceof Error ? error.message : String(error) }; },
        );
      }
    } else if (operation === 'clear') {
      if ([...this.jobs.values()].some(value => !value.result && value.runtime === runtime && value.clipId === clipId)) {
        return fail('Cancel precompute before clearing its cache.');
      }
      await runtime.clearCache(clipId);
    } else if (!job) {
      return fail('Precompute job no longer exists.');
    } else if (operation === 'cancel') {
      runtime.cancelPrecompute(clipId);
    }
    const entry = runtime.entries.get(`${clipId}|preview`);
    const active = runtime.jobs.get(clipId);
    const status = entry ? buildFlockRuntimeStatus({ clipId, state: active && !active.finished ? 'computing' : 'ready',
      program: entry.program, entry, job: active }) : undefined;
    return { running: !!job && !job.result, result: job?.result ?? (operation === 'clear' ? { ok: true } : undefined), status };
  }

  dispose(): void {
    for (const job of this.jobs.values()) if (!job.result) job.runtime.cancelPrecompute(job.clipId);
    this.jobs.clear();
  }
}
