import { condenseGpuPipelineMessage, createCheckedPipeline, gpuPipelineSettled, markGpuPipelineFallback } from '../../core/gpuPipelineGuard';

/**
 * Flock compute pipelines are created synchronously, but whether the driver
 * accepted them is only known when the error scope resolves. Encoding a rejected
 * pipeline invalidates the command buffer; on Safari it also leaves the command
 * encoder locked, so the next pass fails with "encoder state is invalid".
 * A flock session therefore encodes nothing until every pipeline it uses has a
 * verdict (production: Safari rejected `flock-fluidP2GBlock` on its first frame).
 */
export interface FlockPipelineFailure {
  label: string;
  kind: GPUErrorFilter;
  message: string;
}

const verdicts = new WeakMap<object, Promise<FlockPipelineFailure | null>>();
const failures = new WeakMap<object, FlockPipelineFailure>();

function track(pipeline: object, label: string, settled: Promise<{ kind: GPUErrorFilter; message: string } | null>): void {
  verdicts.set(pipeline, settled.then((failure) => {
    if (!failure) return null;
    const record = { label, kind: failure.kind, message: failure.message };
    failures.set(pipeline, record);
    return record;
  }, () => null));
}

/**
 * Builds a flock compute pipeline and records its driver verdict. `fallback`
 * names what the owner runs instead when the driver rejects it (logged as a
 * warning rather than a skipped feature).
 */
export function createFlockComputePipeline(device: GPUDevice, descriptor: GPUComputePipelineDescriptor, fallback?: string): GPUComputePipeline {
  const { pipeline, settled } = createCheckedPipeline(device, () => device.createComputePipeline(descriptor));
  if (fallback) markGpuPipelineFallback(pipeline, fallback);
  track(pipeline, descriptor.label || descriptor.compute.entryPoint || 'flock-compute', settled);
  return pipeline;
}

/** Verdict of a flock pipeline; resolves `null` once it is known to be valid. */
export function flockPipelineVerdict(pipeline: object, label = 'flock-compute'): Promise<FlockPipelineFailure | null> {
  const known = verdicts.get(pipeline);
  if (known) return known;
  const settled = gpuPipelineSettled(pipeline);
  if (!settled) return Promise.resolve(null);
  track(pipeline, (pipeline as { label?: string }).label || label, settled);
  return verdicts.get(pipeline)!;
}

/** Synchronous failure lookup, available once the verdict has resolved. */
export function flockPipelineFailure(pipeline: object): FlockPipelineFailure | null {
  return failures.get(pipeline) ?? null;
}

/** Inspector / export text for a required pipeline the driver rejected. */
export function flockPipelineFailureMessage(failure: FlockPipelineFailure): string {
  return `This GPU could not build the flock pipeline ${failure.label} (${failure.kind}); the simulation does not run on this device. Driver: ${condenseGpuPipelineMessage(failure.message)}`;
}

/** Resolves once a session may encode; throws the visible reason if a required pipeline was rejected. */
export async function awaitFlockPipelines(session: {
  whenPipelinesSettled(): Promise<FlockPipelineGateState>;
  readonly pipelineFailure: FlockPipelineFailure | null;
}): Promise<void> {
  if (await session.whenPipelinesSettled() === 'failed') throw new Error(flockPipelineFailureMessage(session.pipelineFailure!));
}

export interface FlockPipelineCheck {
  pipeline: GPUComputePipeline;
  /** The owner has an equivalent fallback; this failure does not stop the simulation. */
  optional?: boolean;
}

export type FlockPipelineGateState = 'pending' | 'ready' | 'failed';

/** Waits for the verdict of every pipeline a session uses. */
export class FlockPipelineGate {
  state: FlockPipelineGateState = 'pending';
  /** First required pipeline the driver rejected. */
  failure: FlockPipelineFailure | null = null;
  /** Optional pipelines that failed and run their fallback. */
  fallbacks: FlockPipelineFailure[] = [];
  readonly settled: Promise<FlockPipelineGateState>;

  constructor(checks: FlockPipelineCheck[]) {
    this.settled = Promise.all(checks.map(async (check) => ({ check, failure: await flockPipelineVerdict(check.pipeline) })))
      .then((results) => {
        this.fallbacks = results.filter(({ check, failure }) => failure && check.optional).map(({ failure }) => failure!);
        this.failure = results.find(({ check, failure }) => failure && !check.optional)?.failure ?? null;
        this.state = this.failure ? 'failed' : 'ready';
        return this.state;
      });
  }
}
