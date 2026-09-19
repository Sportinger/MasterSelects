import { Logger } from '../../../services/logger';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { flockStepForSourceTime } from '../../../services/flock/time/flockTimeMapper';
import { flockCheckpointStore } from './flockCheckpointStore';
import { flockRuntime, type FlockPrecomputeResult } from './flockRuntimeApi';
import { buildFlockRuntimeStatus } from './flockRuntimeStatus';
import type { FlockSimulationRegistry } from './FlockSimulationRegistry';

const log = Logger.create('FlockPrecompute');
const CHUNK_STEPS = 240;

export interface FlockPrecomputeJob {
  clipId: string;
  start: number;
  end: number;
  progress: number;
  cancelled: boolean;
  finished: boolean;
}

/**
 * Simulates a source-time range in a dedicated session (so preview scrubbing
 * never fights it), with denser checkpoints, then hands the checkpoints to the
 * preview session and optionally persists them for a reopened project.
 */
export async function runFlockPrecompute(
  registry: FlockSimulationRegistry,
  clipId: string,
  range: { start: number; end: number },
  options: { persist: boolean },
): Promise<FlockPrecomputeResult> {
  const device = registry.device;
  const input = registry.latestInputs.get(clipId);
  if (!device) return { ok: false, message: 'The GPU device is not ready; show the clip in the preview first.' };
  if (!input) return { ok: false, message: 'Show the flock clip in the preview once before precomputing.' };
  if (!input.program) return { ok: false, message: 'The flock graph is invalid; fix it before precomputing.' };
  if (registry.jobs.get(clipId) && !registry.jobs.get(clipId)!.finished) {
    return { ok: false, message: 'A precompute for this clip is already running.' };
  }
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(range.start, range.end);
  const program = input.program;
  const job: FlockPrecomputeJob = { clipId, start, end, progress: 0, cancelled: false, finished: false };
  registry.jobs.set(clipId, job);

  const worker = registry.acquire(device, clipId, 'precompute', program, input.keyframes);
  if (!worker) {
    job.finished = true;
    return { ok: false, message: flockRuntime.getStatus(clipId)?.message ?? 'Flock simulation is not supported on this GPU.' };
  }
  worker.session.checkpointInterval = Math.max(1, Math.round(program.stepRate / 4));
  worker.session.maxCheckpointBytes = 768 * 1024 * 1024;
  const endStep = flockStepForSourceTime(program, end).step + 1;
  const startStep = flockStepForSourceTime(program, start).step;

  try {
    while (worker.session.step < endStep && !job.cancelled && !worker.session.isDisposed) {
      worker.session.advanceTo(Math.min(endStep, worker.session.step + CHUNK_STEPS), CHUNK_STEPS);
      await device.queue.onSubmittedWorkDone();
      job.progress = Math.min(1, worker.session.step / Math.max(1, endStep));
      const preview = registry.entries.get(`${clipId}|preview`);
      flockRuntime.publishStatus(buildFlockRuntimeStatus({
        clipId,
        state: 'computing',
        program,
        entry: preview ?? worker,
        job,
      }));
    }
    if (job.cancelled) {
      return { ok: false, message: 'Precompute cancelled.' };
    }
    const steps = worker.session.listCheckpointSteps().filter((step) => step >= startStep - worker.session.checkpointInterval && step <= endStep);
    const preview = registry.entries.get(`${clipId}|preview`);
    if (preview && preview.cacheKey === worker.cacheKey) {
      preview.session.adoptCheckpoints(worker.session, steps);
    }
    if (options.persist) {
      let persisted = 0;
      for (const step of steps) {
        if (job.cancelled) break;
        const bytes = await worker.session.readCheckpoint(step);
        if (!bytes) continue;
        const stored = await flockCheckpointStore.put({ cacheKey: worker.cacheKey, clipId, step, state: bytes.state, rings: bytes.rings });
        if (!stored.ok) return { ok: false, message: stored.message, steps: persisted };
        persisted += 1;
      }
      await flockCheckpointStore.pruneClip(clipId, worker.cacheKey);
      if (preview && preview.cacheKey === worker.cacheKey) preview.persistedSteps = steps;
    }
    log.info('Flock precompute finished', { clipId, start, end, checkpoints: steps.length, persist: options.persist });
    return { ok: true, steps: endStep };
  } catch (error) {
    log.error('Flock precompute failed', error);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    job.finished = true;
    job.progress = job.cancelled ? job.progress : 1;
    worker.session.dispose();
    registry.entries.delete(worker.key);
    renderHostPort.requestRender();
  }
}
