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
 * never fights it), with denser checkpoints. Persistent runs flush each checkpoint
 * before computing the next interval, so VRAM eviction cannot lose earlier ranges.
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
  const endStep = flockStepForSourceTime(program, end).step + 1;
  const startStep = flockStepForSourceTime(program, start).step;
  const persistedSteps = new Set<number>();
  let completed = false;

  const persistCaptured = async () => {
    for (const step of worker.session.listCheckpointSteps()) {
      if (job.cancelled) break;
      if (step < startStep - worker.session.checkpointInterval || step > endStep || persistedSteps.has(step)) continue;
      const bytes = await worker.session.readCheckpoint(step);
      if (!bytes) throw new Error(`Checkpoint ${step} was unavailable before persistence.`);
      const stored = await flockCheckpointStore.put({ cacheKey: worker.cacheKey, clipId, step, state: bytes.state, rings: bytes.rings });
      if (!stored.ok) throw new Error(stored.message ?? 'Could not persist flock checkpoint.');
      persistedSteps.add(step);
      const preview = registry.entries.get(`${clipId}|preview`);
      if (preview?.cacheKey === worker.cacheKey) {
        preview.persistedSteps = [...new Set([...(preview.persistedSteps ?? []), step])].toSorted((a, b) => a - b);
      }
    }
  };

  try {
    while (worker.session.step < endStep && !job.cancelled && !worker.session.isDisposed) {
      const nextCheckpoint = (Math.floor(worker.session.step / worker.session.checkpointInterval) + 1) * worker.session.checkpointInterval;
      const chunkEnd = Math.min(endStep, worker.session.step + CHUNK_STEPS, options.persist ? nextCheckpoint : Infinity);
      worker.session.advanceTo(chunkEnd, CHUNK_STEPS);
      await device.queue.onSubmittedWorkDone();
      if (options.persist) await persistCaptured();
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
      // A concurrent graph edit may have started a newer cache. Never prune it
      // merely because this older precompute job has finished.
      if (preview?.cacheKey === worker.cacheKey) await flockCheckpointStore.pruneClip(clipId, worker.cacheKey);
    }
    log.info('Flock precompute finished', { clipId, start, end, checkpoints: steps.length, persisted: persistedSteps.size, persist: options.persist });
    completed = true;
    return { ok: true, steps: endStep };
  } catch (error) {
    log.error('Flock precompute failed', error);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    job.finished = true;
    if (completed) job.progress = 1;
    worker.session.dispose();
    registry.entries.delete(worker.key);
    renderHostPort.requestRender();
  }
}
