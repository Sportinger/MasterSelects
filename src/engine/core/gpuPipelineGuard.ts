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
 * Build a pipeline and learn whether the driver accepted it. Uses the device guard
 * when installed (no second, competing error scope), else scopes the call itself.
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
  return { pipeline, settled: settled.catch(() => null) };
}

function report(source: string, label: string, stage: 'render' | 'compute', failure: PipelineCreationFailure): void {
  const record = { feature: gpuFeatureName(label), label, stage, kind: failure.kind, message: failure.message, source };
  if (!records.some(item => item.source === source && item.label === label && item.message === failure.message)) {
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
      if (failure) { failedPipelines.add(pipeline); failedPipelineCount += 1; report(source, label, stage, failure); }
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
