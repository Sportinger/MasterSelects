import type { FlockDiagnostic } from '../../../types/flock';
import type { FlockProgram } from '../../../services/flock/compiler/flockProgramTypes';
import type { FlockRuntimeState, FlockRuntimeStatus } from './flockRuntimeApi';
import type { FlockSessionEntry } from './FlockSimulationRegistry';
import type { FlockPrecomputeJob } from './flockPrecompute';

export interface FlockStatusInput {
  clipId: string;
  state: FlockRuntimeState;
  message?: string;
  program?: FlockProgram | null;
  entry?: FlockSessionEntry;
  diagnostics?: FlockDiagnostic[];
  job?: FlockPrecomputeJob;
}

/** Bounded status snapshot for UI and automation (never per-particle data). */
export function buildFlockRuntimeStatus(input: FlockStatusInput): FlockRuntimeStatus {
  const { program, entry, job } = input;
  const session = entry?.session;
  const stepRate = program?.stepRate ?? 60;
  const warmup = program?.simulation.warmupSteps ?? 0;
  const checkpointSteps = session?.stats.checkpointSteps ?? [];
  const toSeconds = (step: number) => Math.max(0, (step - warmup) / stepRate);
  const linkCapacity = program?.branches
    .filter((branch) => branch.kind === 'links')
    .reduce((sum, branch) => sum + program.capacity * (branch.params.integers.perParticle ?? 2), 0) ?? 0;
  const trailSamples = program?.trails.reduce((sum, trail) => sum + trail.slotCount * trail.samples, 0) ?? 0;
  const diagnostics = input.diagnostics ?? program?.diagnostics ?? [];
  return {
    clipId: input.clipId,
    state: input.state,
    ...(input.message ? { message: input.message } : {}),
    requestedCount: program?.capacity ?? 0,
    simulatedCount: session ? program?.capacity ?? 0 : 0,
    aliveCount: session?.stats.alive ?? 0,
    drawnInstances: session?.stats.alive ?? 0,
    linkCapacity,
    trailSamples,
    neighborSaturatedCells: session?.stats.sampled ?? 0,
    step: session?.step ?? 0,
    targetStep: entry?.targetStep ?? 0,
    sourceTime: entry?.sourceTime ?? 0,
    stepRate,
    memoryBytes: (session?.stats.gpuBytes ?? 0) + (session?.stats.checkpointBytes ?? 0),
    estimatedMemoryBytes: program?.estimate.totalBytes ?? 0,
    phaseTimingsMs: Object.fromEntries(Object.entries(entry?.timings ?? {}).map(([key, value]) => [key, Math.round(value * 100) / 100])),
    cache: {
      checkpointCount: checkpointSteps.length,
      checkpointBytes: session?.stats.checkpointBytes ?? 0,
      coveredSourceRange: checkpointSteps.length > 0
        ? [toSeconds(checkpointSteps[0]), toSeconds(checkpointSteps[checkpointSteps.length - 1])]
        : null,
      persistedCheckpointCount: entry?.persistedSteps?.length ?? 0,
      precomputeProgress: job && !job.finished ? job.progress : null,
      precomputeRange: job ? [job.start, job.end] : null,
      current: !entry?.stale,
    },
    hashes: program ? { topology: program.hashes.topology, behavior: program.hashes.behavior } : null,
    diagnostics,
    updatedAt: Date.now(),
  };
}
