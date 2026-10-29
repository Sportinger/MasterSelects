/**
 * Device-wide guard for GPU pipelines the driver cannot build.
 *
 * A pipeline that fails in validation, in the driver compiler (internal error, e.g.
 * `VK_ERROR_UNKNOWN` on mobile Vulkan drivers) or for lack of memory is still
 * returned as an object. Setting it, or a bind group made from its `auto` layout,
 * invalidates the whole command buffer, so every layer of the frame disappears.
 * The guard scopes every synchronous pipeline creation, remembers failed
 * pipelines, and makes render/compute passes and render bundles skip their
 * `setPipeline`, draws, dispatches and derived bind groups. The feature is
 * missing; the rest of the frame renders, and the failure is reported.
 *
 * The verdict arrives asynchronously. Work encoded with a pipeline before its
 * verdict is known is not protected: by the WebGPU spec a pass that set an invalid
 * pipeline invalidates its parent encoder when it ends, so the whole command
 * buffer is lost in every browser. Shipping Safari also leaves the encoder locked,
 * so its next `beginComputePass` reports "encoder state is invalid". Features that
 * encode right after creating a pipeline must wait for `gpuPipelineSettled`
 * (as the effect pipeline cache, the flock session gate and the flock renderer do).
 */
import { Logger } from '../../services/logger';
import {
  canScopePipelineErrors,
  popPipelineErrorScopes,
  pushPipelineErrorScopes,
  type PipelineCreationFailure,
} from './gpuPipelineErrorScopes';

const log = Logger.create('GpuPipelineGuard');

export interface GpuPipelineFailureRecord {
  /** Human-readable feature, derived from the pipeline or shader module label. */
  feature: string;
  label: string;
  stage: 'render' | 'compute';
  kind: GPUErrorFilter;
  message: string;
  /** Which device owner created it (editor, thumbnails, ...). */
  source: string;
}

type AnyFn = (...args: unknown[]) => unknown;
type Patchable = Record<string, AnyFn>;

const guardedDevices = new WeakMap<GPUDevice, string>();
const failedPipelines = new WeakSet<object>();
/** Passes are only wrapped once some pipeline failed, so healthy devices pay nothing. */
let failedPipelineCount = 0;
const settledPipelines = new WeakMap<object, Promise<PipelineCreationFailure | null>>();
const layoutOwners = new WeakMap<object, object>();
/** Pipelines whose owner switches to another implementation when they fail. */
const fallbacks = new WeakMap<object, string>();
const bindGroupLayouts = new WeakMap<object, object>();
/** Replaced, never mutated, so it works as a `useSyncExternalStore` snapshot. */
let records: readonly GpuPipelineFailureRecord[] = [];
const listeners = new Set<() => void>();

const FEATURES: ReadonlyArray<[RegExp, string]> = [
  [/voxel/i, 'Voxel Relief'],
  [/flock|fluid|boids?/i, 'Flocking simulation'],
  [/splat|gaussian/i, 'Gaussian splats'],
  [/^pt[-_]|path.?trac/i, 'Path tracer'],
  [/rod|strand|cable/i, '3D strands'],
  [/temporal|slit|time-?stack|history/i, 'Time effect'],
  [/^(compute-)?effect-|image-graph|operator/i, 'Effect'],
  [/composit|copy|output|slice|mask/i, 'Compositing'],
  [/thumbnail|look/i, 'Thumbnail'],
];

const MAX_REPORTED_MESSAGE = 1200;

/**
 * Driver messages can be huge: WebKit puts the whole generated Metal source in
 * front of the compiler log ("Failed to compile the shader source, generated
 * metal: ..."), so a capped diagnostic shows only boilerplate. Keep the first
 * line and the compiler's error lines, which name the failing construct.
 */
export function condenseGpuPipelineMessage(message: string): string {
  if (message.length <= MAX_REPORTED_MESSAGE) return message;
  const lines = message.split('\n').map(line => line.trim()).filter(Boolean);
  const errors = lines.slice(1).filter(line => /\berror\b|program_source:\d+|^\d+:\d+:/i.test(line));
  const condensed = [lines[0] ?? '', ...errors.slice(0, 8)].join(' | ');
  const text = errors.length ? condensed : `${lines[0] ?? ''} | ... ${message.slice(-600).replace(/\s+/g, ' ')}`;
  return `${text.slice(0, MAX_REPORTED_MESSAGE)} [${message.length} chars]`;
}

export function gpuFeatureName(label: string): string {
  return FEATURES.find(([pattern]) => pattern.test(label))?.[1] ?? 'GPU rendering';
}

function descriptorLabel(descriptor: Partial<GPURenderPipelineDescriptor & GPUComputePipelineDescriptor> | undefined): string {
  const stageModule = descriptor?.compute?.module ?? descriptor?.fragment?.module ?? descriptor?.vertex?.module;
  return descriptor?.label || stageModule?.label || '(unlabeled)';
}

export function subscribeGpuPipelineFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getGpuPipelineFailures(): readonly GpuPipelineFailureRecord[] {
  return records;
}

/** A new device rebuilds all pipelines; its predecessor's failures no longer apply. */
export function clearGpuPipelineFailures(source: string): void {
  const kept = records.filter(record => record.source !== source);
  if (kept.length === records.length) return;
  records = kept;
  for (const listener of listeners) listener();
}

export function isGpuDeviceGuarded(device: GPUDevice): boolean {
  return guardedDevices.has(device);
}

export function isGpuPipelineFailed(pipeline: object): boolean {
  return failedPipelines.has(pipeline);
}

/** Resolves once the driver verdict of a pipeline created on a guarded device is known. */
export function gpuPipelineSettled(pipeline: object): Promise<PipelineCreationFailure | null> | undefined {
  return settledPipelines.get(pipeline);
}

/**
 * Declare that the owner of `pipeline` switches to another implementation when the
 * driver rejects it. No "feature skipped" notice is raised, because the feature
 * still works; the failure is reported once per page session as a non-fatal
 * "GPU pipeline fallback used" error, so production diagnostics still carry the
 * condensed driver message that names the failing construct.
 */
export function markGpuPipelineFallback(pipeline: object, note: string): void {
  fallbacks.set(pipeline, note);
}

/**
 * Build a pipeline and learn whether the driver accepted it. Uses the device guard
 * when installed (no second, competing error scope), else scopes the call itself.
 * Either way `gpuPipelineSettled` returns the verdict afterwards.
 */
export function createCheckedPipeline<P extends object>(device: GPUDevice, create: () => P): { pipeline: P; settled: Promise<PipelineCreationFailure | null> } {
  if (guardedDevices.has(device)) {
    const pipeline = create();
    return { pipeline, settled: settledPipelines.get(pipeline) ?? Promise.resolve(null) };
  }
  if (!canScopePipelineErrors(device)) return { pipeline: create(), settled: Promise.resolve(null) };
  pushPipelineErrorScopes(device);
  let pipeline: P;
  let settled: Promise<PipelineCreationFailure | null>;
  try { pipeline = create(); } finally { settled = popPipelineErrorScopes(device); }
  const verdict = settled.catch(() => null).then(failure => {
    // The owner handles the failure itself (it skips or degrades); only a declared
    // fallback is reported here, because no other path would report it.
    const fallback = failure ? fallbacks.get(pipeline) : undefined;
    if (failure && fallback) reportFallback(recordFor('unguarded', pipelineLabel(pipeline), 'compute', failure), fallback);
    return failure;
  });
  settledPipelines.set(pipeline, verdict);
  return { pipeline, settled: verdict };
}

/** Prefix of the non-fatal report; diagnostics triage classifies it as `gpu_pipeline_fallback`. */
export const GPU_PIPELINE_FALLBACK_MESSAGE = 'GPU pipeline fallback used';
const reportedFallbacks = new Set<string>();

function pipelineLabel(pipeline: object): string {
  return (pipeline as { label?: string }).label || '(unlabeled)';
}

function recordFor(source: string, label: string, stage: 'render' | 'compute', failure: PipelineCreationFailure): GpuPipelineFailureRecord {
  return { feature: gpuFeatureName(label), label, stage, kind: failure.kind, message: condenseGpuPipelineMessage(failure.message), source };
}

/**
 * Once per page session and failure: an ERROR-level log, because only errors
 * reach the production diagnostics feed. The wording marks it as non-fatal.
 */
function reportFallback(record: GpuPipelineFailureRecord, fallback: string): void {
  const key = `${record.source}|${record.label}|${record.message}`;
  if (reportedFallbacks.has(key)) return;
  reportedFallbacks.add(key);
  log.error(`${GPU_PIPELINE_FALLBACK_MESSAGE}: GPU could not build ${record.feature} (${record.label}, ${record.kind}); ${fallback}. Non-fatal, no feature is skipped`, record);
}

function report(source: string, pipeline: object, label: string, stage: 'render' | 'compute', failure: PipelineCreationFailure): void {
  const record = recordFor(source, label, stage, failure);
  const { message } = record;
  const fallback = fallbacks.get(pipeline);
  if (fallback) {
    reportFallback(record, fallback);
    return;
  }
  if (!records.some(item => item.source === source && item.label === label && item.message === message)) {
    records = [...records, record];
    for (const listener of listeners) listener();
  }
  log.error(`GPU could not build ${record.feature} (${label}, ${failure.kind}); it is skipped so the rest of the frame renders`, record);
}

function failedBindGroup(group: unknown): boolean {
  if (!group || typeof group !== 'object') return false;
  const layout = bindGroupLayouts.get(group);
  const owner = layout ? layoutOwners.get(layout) : undefined;
  return !!owner && failedPipelines.has(owner);
}

const SKIPPED_WHILE_FAILED = ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect', 'dispatchWorkgroups', 'dispatchWorkgroupsIndirect'];

/** Encoders that set a failed pipeline skip its work instead of invalidating the command buffer. */
function guardEncoder<T extends object>(encoder: T): T {
  if (failedPipelineCount === 0) return encoder;
  const target = encoder as unknown as Patchable;
  let skipping = false;
  const setPipeline = target.setPipeline?.bind(encoder);
  if (setPipeline) target.setPipeline = (pipeline: unknown) => {
    skipping = !!pipeline && failedPipelines.has(pipeline as object);
    if (!skipping) setPipeline(pipeline);
  };
  for (const name of SKIPPED_WHILE_FAILED) {
    const original = target[name]?.bind(encoder);
    if (original) target[name] = (...args: unknown[]) => { if (!skipping) return original(...args); };
  }
  const setBindGroup = target.setBindGroup?.bind(encoder);
  if (setBindGroup) target.setBindGroup = (index: unknown, group: unknown, ...rest: unknown[]) => {
    if (!failedBindGroup(group)) setBindGroup(index, group, ...rest);
  };
  return encoder;
}

function wrapPipelineFactory(device: GPUDevice, source: string, name: 'createRenderPipeline' | 'createComputePipeline'): void {
  const target = device as unknown as Patchable;
  const original = target[name].bind(device);
  const stage = name === 'createRenderPipeline' ? 'render' : 'compute';
  target[name] = (descriptor: unknown) => {
    pushPipelineErrorScopes(device);
    let pipeline: object;
    let verdict: Promise<PipelineCreationFailure | null>;
    try { pipeline = original(descriptor) as object; } finally { verdict = popPipelineErrorScopes(device); }
    const label = descriptorLabel(descriptor as GPURenderPipelineDescriptor | undefined);
    const pipelineTarget = pipeline as unknown as Patchable;
    const getBindGroupLayout = pipelineTarget.getBindGroupLayout?.bind(pipeline);
    if (getBindGroupLayout) pipelineTarget.getBindGroupLayout = (index: unknown) => {
      const layout = getBindGroupLayout(index) as object;
      layoutOwners.set(layout, pipeline);
      return layout;
    };
    settledPipelines.set(pipeline, verdict.then(failure => {
      if (failure) { failedPipelines.add(pipeline); failedPipelineCount += 1; report(source, pipeline, label, stage, failure); }
      return failure;
    }, () => null));
    return pipeline;
  };
}

/** Install once per device, right after `requestDevice`. */
export function guardGpuDevice(device: GPUDevice, source: string): GPUDevice {
  if (guardedDevices.has(device) || !canScopePipelineErrors(device)) return device;
  guardedDevices.set(device, source);
  clearGpuPipelineFailures(source);
  wrapPipelineFactory(device, source, 'createRenderPipeline');
  wrapPipelineFactory(device, source, 'createComputePipeline');
  const target = device as unknown as Patchable;
  const createBindGroup = target.createBindGroup.bind(device);
  target.createBindGroup = (descriptor: unknown) => {
    const group = createBindGroup(descriptor) as object;
    const layout = (descriptor as GPUBindGroupDescriptor).layout as unknown as object;
    if (layoutOwners.has(layout)) bindGroupLayouts.set(group, layout);
    return group;
  };
  const createCommandEncoder = target.createCommandEncoder?.bind(device);
  if (createCommandEncoder) target.createCommandEncoder = (...args: unknown[]) => {
    const encoder = createCommandEncoder(...args) as Patchable;
    if (failedPipelineCount === 0) return encoder;
    const beginRenderPass = encoder.beginRenderPass.bind(encoder);
    const beginComputePass = encoder.beginComputePass.bind(encoder);
    encoder.beginRenderPass = (descriptor: unknown) => guardEncoder(beginRenderPass(descriptor) as object);
    encoder.beginComputePass = (descriptor: unknown) => guardEncoder(beginComputePass(descriptor) as object);
    return encoder;
  };
  if (typeof target.createRenderBundleEncoder === 'function') {
    const createRenderBundleEncoder = target.createRenderBundleEncoder.bind(device);
    target.createRenderBundleEncoder = (descriptor: unknown) => guardEncoder(createRenderBundleEncoder(descriptor) as object);
  }
  return device;
}
