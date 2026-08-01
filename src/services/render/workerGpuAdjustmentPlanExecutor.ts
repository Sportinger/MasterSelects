import type { LayerRenderData } from '../../engine/core/types';
import type { CompositorPipeline } from '../../engine/pipeline/CompositorPipeline';
import type { Compositor } from '../../engine/render/Compositor';
import type { MaskTextureManager } from '../../engine/texture/MaskTextureManager';
import type { Layer } from '../../types/layers';
import {
  assertMotionAdjustmentWorkerGpuExecutionPlan,
  type MotionAdjustmentWorkerGpuExecutionPlan,
  type MotionAdjustmentWorkerGpuPass,
} from '../motionDesign/adjustment/workerGpuAdjustmentPlan';
import { workerGpuAdjustmentMaskLookupId } from './workerGpuAdjustmentMaskRenderer';

const FULLSCREEN_VERTEX_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var out: VertexOutput;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}
`;

const COLOR_MATRIX_FRAGMENT_SHADER = `
@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> matrix: array<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(frameTexture, frameSampler, input.uv);
  return vec4f(
    dot(color, vec4f(matrix[0], matrix[1], matrix[2], matrix[3])) + matrix[4],
    dot(color, vec4f(matrix[5], matrix[6], matrix[7], matrix[8])) + matrix[9],
    dot(color, vec4f(matrix[10], matrix[11], matrix[12], matrix[13])) + matrix[14],
    dot(color, vec4f(matrix[15], matrix[16], matrix[17], matrix[18])) + matrix[19]
  );
}
`;

const BLUR_FRAGMENT_SHADER = `
struct BlurParams {
  direction: vec2f,
  texelSize: vec2f,
  radius: f32,
  samples: f32,
  _pad: vec2f,
};

@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlurParams;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  if (params.radius < 0.5) {
    return textureSample(frameTexture, frameSampler, input.uv);
  }
  let sampleRadius = i32(clamp(params.samples, 1.0, 64.0));
  let sigma = max(params.radius / 3.0, 0.0001);
  let denominator = 2.0 * sigma * sigma;
  let stepSize = params.radius / f32(sampleRadius);
  var color = vec4f(0.0);
  var totalWeight = 0.0;
  for (var index = -sampleRadius; index <= sampleRadius; index += 1) {
    let distancePixels = f32(index) * stepSize;
    let weight = exp(-(distancePixels * distancePixels) / denominator);
    let offset = params.direction * params.texelSize * distancePixels;
    color += textureSample(frameTexture, frameSampler, input.uv + offset) * weight;
    totalWeight += weight;
  }
  return color / max(totalWeight, 0.000001);
}
`;

interface AdjustmentEffectPipelineResources {
  readonly colorMatrixPipeline: GPURenderPipeline;
  readonly colorMatrixLayout: GPUBindGroupLayout;
  readonly blurPipeline: GPURenderPipeline;
  readonly blurLayout: GPUBindGroupLayout;
}

export interface WorkerGpuAdjustmentExecutorResources {
  readonly compositorPipeline: CompositorPipeline;
  readonly compositor: Compositor;
  readonly maskTextureManager: MaskTextureManager;
  readonly sampler: GPUSampler;
}

export interface WorkerGpuAdjustmentSourceFrame {
  readonly layerId: string;
  readonly sourceId: string;
  readonly data: LayerRenderData;
}

export interface WorkerGpuAdjustmentSourceResolveRequest {
  readonly passId: string;
  readonly layerId: string;
  readonly sourceId: string;
  readonly sourceKind: Extract<MotionAdjustmentWorkerGpuPass, {
    readonly kind: 'resolve-source';
  }>['sourceKind'];
}

export type WorkerGpuAdjustmentSourceResolver = (
  request: WorkerGpuAdjustmentSourceResolveRequest,
) => WorkerGpuAdjustmentSourceFrame | null | undefined;

export interface WorkerGpuAdjustmentExecutionResult {
  readonly finalView: GPUTextureView;
  readonly transientResources: ReadonlyArray<{ destroy(): void }>;
  readonly executedPassIds: readonly string[];
}

const effectResourcesByDevice = new WeakMap<GPUDevice, AdjustmentEffectPipelineResources>();

function getEffectResources(device: GPUDevice): AdjustmentEffectPipelineResources {
  const existing = effectResourcesByDevice.get(device);
  if (existing) return existing;
  const colorModule = device.createShaderModule({
    label: 'worker-gpu-adjustment-plan-color-matrix',
    code: `${FULLSCREEN_VERTEX_SHADER}\n${COLOR_MATRIX_FRAGMENT_SHADER}`,
  });
  const blurModule = device.createShaderModule({
    label: 'worker-gpu-adjustment-plan-blur',
    code: `${FULLSCREEN_VERTEX_SHADER}\n${BLUR_FRAGMENT_SHADER}`,
  });
  const colorMatrixLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const blurLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const colorMatrixPipeline = device.createRenderPipeline({
    label: 'worker-gpu-adjustment-color-matrix-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [colorMatrixLayout] }),
    vertex: { module: colorModule, entryPoint: 'vertexMain' },
    fragment: { module: colorModule, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  const blurPipeline = device.createRenderPipeline({
    label: 'worker-gpu-adjustment-separable-blur-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [blurLayout] }),
    vertex: { module: blurModule, entryPoint: 'vertexMain' },
    fragment: { module: blurModule, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  const created = { colorMatrixPipeline, colorMatrixLayout, blurPipeline, blurLayout };
  effectResourcesByDevice.set(device, created);
  return created;
}

function createRenderTexture(
  device: GPUDevice,
  width: number,
  height: number,
  label: string,
  transientResources: Array<{ destroy(): void }>,
): GPUTexture {
  const texture = device.createTexture({
    label,
    size: { width, height },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST,
  });
  transientResources.push(texture);
  return texture;
}

function clearTexture(commandEncoder: GPUCommandEncoder, view: GPUTextureView): void {
  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view,
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  let ended = false;
  try {
    pass.end();
    ended = true;
  } finally {
    if (!ended) {
      try {
        pass.end();
      } catch {
        // Preserve the original render-pass failure.
      }
    }
  }
}

function compositeLayer(
  input: {
    readonly plan: MotionAdjustmentWorkerGpuExecutionPlan;
    readonly layerId: string;
    readonly kind: 'source' | 'adjustment';
    readonly mix: Extract<MotionAdjustmentWorkerGpuPass, {
      readonly kind: 'composite-source' | 'mix-adjustment-result';
    }>['mix'];
    readonly baseView: GPUTextureView;
    readonly layerView: GPUTextureView;
    readonly outputView: GPUTextureView;
    readonly commandEncoder: GPUCommandEncoder;
    readonly resources: WorkerGpuAdjustmentExecutorResources;
    readonly width: number;
    readonly height: number;
  },
): void {
  const maskLookupId = input.mix.masks.length > 0
    ? workerGpuAdjustmentMaskLookupId(input.plan, input.layerId)
    : undefined;
  const maskInfo = maskLookupId
    ? input.resources.maskTextureManager.getMaskInfo(maskLookupId)
    : input.resources.maskTextureManager.getMaskInfo('__worker-gpu-adjustment-no-mask__');
  const layer: Layer = {
    id: `worker-gpu-plan:${input.plan.resourceNamespace}:${input.kind}:${input.layerId}`,
    name: input.layerId,
    sourceClipId: input.layerId,
    visible: true,
    opacity: input.mix.opacity,
    blendMode: input.mix.blendMode,
    source: { type: 'image', intrinsicWidth: input.width, intrinsicHeight: input.height },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    ...(maskLookupId ? { maskClipId: maskLookupId } : {}),
  };
  const aspect = input.width / input.height;
  const uniformBuffer = input.resources.compositorPipeline.getOrCreateUniformBuffer(layer.id);
  input.resources.compositorPipeline.updateLayerUniforms(
    layer,
    aspect,
    aspect,
    maskInfo.hasMask,
    uniformBuffer,
    undefined,
    1,
  );
  const pipeline = input.resources.compositorPipeline.getCompositePipeline();
  if (!pipeline) throw new Error('Worker GPU adjustment composite pipeline is unavailable');
  input.resources.compositorPipeline.invalidateBindGroupCache(layer.id);
  const bindGroup = input.resources.compositorPipeline.createCompositeBindGroup(
    input.resources.sampler,
    input.baseView,
    input.layerView,
    uniformBuffer,
    maskInfo.view,
  );
  const pass = input.commandEncoder.beginRenderPass({
    colorAttachments: [{ view: input.outputView, loadOp: 'clear', storeOp: 'store' }],
  });
  let ended = false;
  try {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    ended = true;
  } finally {
    if (!ended) {
      try {
        pass.end();
      } catch {
        // Preserve the original render-pass failure.
      }
    }
  }
}

function preRenderSource(
  input: {
    readonly plan: MotionAdjustmentWorkerGpuExecutionPlan;
    readonly source: WorkerGpuAdjustmentSourceFrame;
    readonly device: GPUDevice;
    readonly commandEncoder: GPUCommandEncoder;
    readonly resources: WorkerGpuAdjustmentExecutorResources;
    readonly width: number;
    readonly height: number;
    readonly transientResources: Array<{ destroy(): void }>;
  },
): GPUTextureView {
  const textures = ['ping', 'pong', 'effect-a', 'effect-b'].map((kind) => createRenderTexture(
    input.device,
    input.width,
    input.height,
    `worker-gpu-adjustment-source:${input.source.layerId}:${kind}`,
    input.transientResources,
  ));
  const [pingTexture, pongTexture, effectTexture, effectTexture2] = textures;
  const data: LayerRenderData = {
    ...input.source.data,
    layer: {
      ...input.source.data.layer,
      opacity: 1,
      blendMode: 'normal',
      maskClipId: undefined,
      masks: undefined,
    },
  };
  return input.resources.compositor.composite([data], input.commandEncoder, {
    device: input.device,
    sampler: input.resources.sampler,
    pingView: pingTexture.createView(),
    pongView: pongTexture.createView(),
    outputWidth: input.width,
    outputHeight: input.height,
    effectTempTexture: effectTexture,
    effectTempView: effectTexture.createView(),
    effectTempTexture2: effectTexture2,
    effectTempView2: effectTexture2.createView(),
    motionTime: input.plan.frame.timelineTime,
    particleQuality: 'preview',
    resourceNamespace: JSON.stringify([
      input.plan.resourceNamespace,
      'source',
      input.source.layerId,
    ]),
  }).finalView;
}

function encodeEffectPass(
  input: {
    readonly pass: Extract<MotionAdjustmentWorkerGpuPass, { readonly kind: 'apply-adjustment-effect' }>;
    readonly device: GPUDevice;
    readonly commandEncoder: GPUCommandEncoder;
    readonly sampler: GPUSampler;
    readonly sourceView: GPUTextureView;
    readonly outputView: GPUTextureView;
    readonly width: number;
    readonly height: number;
    readonly transientResources: Array<{ destroy(): void }>;
  },
): void {
  const resources = getEffectResources(input.device);
  const isColorMatrix = input.pass.primitive === 'color-matrix-4x5';
  const buffer = input.device.createBuffer({
    size: isColorMatrix ? 80 : 32,
    usage: (isColorMatrix ? GPUBufferUsage.STORAGE : GPUBufferUsage.UNIFORM) | GPUBufferUsage.COPY_DST,
  });
  input.transientResources.push(buffer);
  if (isColorMatrix) {
    input.device.queue.writeBuffer(buffer, 0, new Float32Array(input.pass.matrix));
  } else {
    const values = new Float32Array(8);
    values[0] = input.pass.direction === 'horizontal' ? 1 : 0;
    values[1] = input.pass.direction === 'vertical' ? 1 : 0;
    values[2] = 1 / input.width;
    values[3] = 1 / input.height;
    values[4] = input.pass.parameters.radius;
    values[5] = input.pass.parameters.samples;
    input.device.queue.writeBuffer(buffer, 0, values);
  }
  const layout = isColorMatrix ? resources.colorMatrixLayout : resources.blurLayout;
  const pipeline = isColorMatrix ? resources.colorMatrixPipeline : resources.blurPipeline;
  const bindGroup = input.device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: input.sampler },
      { binding: 1, resource: input.sourceView },
      { binding: 2, resource: { buffer } },
    ],
  });
  const renderPass = input.commandEncoder.beginRenderPass({
    colorAttachments: [{ view: input.outputView, loadOp: 'clear', storeOp: 'store' }],
  });
  let ended = false;
  try {
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(6);
    renderPass.end();
    ended = true;
  } finally {
    if (!ended) {
      try {
        renderPass.end();
      } catch {
        // Preserve the original render-pass failure.
      }
    }
  }
}

function requireView(values: ReadonlyMap<string, GPUTextureView>, resourceId: string): GPUTextureView {
  const view = values.get(resourceId);
  if (!view) throw new Error(`Worker GPU adjustment resource was not executed: ${resourceId}`);
  return view;
}

function indexWorkerGpuAdjustmentSources(
  plan: MotionAdjustmentWorkerGpuExecutionPlan,
  sources: readonly WorkerGpuAdjustmentSourceFrame[],
): {
  readonly resolvePassesByLayerId: ReadonlyMap<
    string,
    Extract<MotionAdjustmentWorkerGpuPass, { readonly kind: 'resolve-source' }>
  >;
  readonly sourcesByLayerId: ReadonlyMap<string, WorkerGpuAdjustmentSourceFrame>;
} {
  const resolvePassesByLayerId = new Map<
    string,
    Extract<MotionAdjustmentWorkerGpuPass, { readonly kind: 'resolve-source' }>
  >();
  for (const pass of plan.passes) {
    if (pass.kind !== 'resolve-source') continue;
    if (resolvePassesByLayerId.has(pass.layerId)) {
      throw new Error(`Worker GPU adjustment duplicate resolve-source pass: ${pass.layerId}`);
    }
    resolvePassesByLayerId.set(pass.layerId, pass);
  }

  const sourcesByLayerId = new Map<string, WorkerGpuAdjustmentSourceFrame>();
  for (const source of sources) {
    if (sourcesByLayerId.has(source.layerId)) {
      throw new Error(`Worker GPU adjustment duplicate source binding: ${source.layerId}`);
    }
    if (!resolvePassesByLayerId.has(source.layerId)) {
      throw new Error(`Worker GPU adjustment source is not consumed by plan: ${source.layerId}`);
    }
    sourcesByLayerId.set(source.layerId, source);
  }
  return { resolvePassesByLayerId, sourcesByLayerId };
}

export function encodeWorkerGpuAdjustmentPlan(
  input: {
    readonly plan: MotionAdjustmentWorkerGpuExecutionPlan;
    readonly device: GPUDevice;
    readonly commandEncoder: GPUCommandEncoder;
    readonly resources: WorkerGpuAdjustmentExecutorResources;
    readonly sources?: readonly WorkerGpuAdjustmentSourceFrame[];
    readonly resolveSource?: WorkerGpuAdjustmentSourceResolver;
    readonly width: number;
    readonly height: number;
  },
): WorkerGpuAdjustmentExecutionResult {
  assertMotionAdjustmentWorkerGpuExecutionPlan(input.plan);
  const { resolvePassesByLayerId, sourcesByLayerId } = indexWorkerGpuAdjustmentSources(
    input.plan,
    input.sources ?? [],
  );
  const consumedSourceLayerIds = new Set<string>();
  const values = new Map<string, GPUTextureView>();
  const transientResources: Array<{ destroy(): void }> = [];
  const executedPassIds: string[] = [];
  try {
    input.resources.compositorPipeline.beginFrame();
    for (const pass of input.plan.passes) {
      switch (pass.kind) {
        case 'initialize-accumulator': {
          const texture = createRenderTexture(
            input.device,
            input.width,
            input.height,
            pass.outputResourceId,
            transientResources,
          );
          const view = texture.createView();
          clearTexture(input.commandEncoder, view);
          values.set(pass.outputResourceId, view);
          break;
        }
        case 'resolve-source': {
          if (consumedSourceLayerIds.has(pass.layerId)) {
            throw new Error(`Worker GPU adjustment source was resolved more than once: ${pass.layerId}`);
          }
          const eagerSource = sourcesByLayerId.get(pass.layerId);
          const source = eagerSource ?? input.resolveSource?.(Object.freeze({
            passId: pass.passId,
            layerId: pass.layerId,
            sourceId: pass.sourceId,
            sourceKind: pass.sourceKind,
          }));
          if (
            !source
            || source.layerId !== pass.layerId
            || source.sourceId !== pass.sourceId
          ) {
            throw new Error(`Worker GPU adjustment source binding mismatch: ${pass.layerId}`);
          }
          consumedSourceLayerIds.add(pass.layerId);
          values.set(pass.outputResourceId, preRenderSource({
            plan: input.plan,
            source,
            device: input.device,
            commandEncoder: input.commandEncoder,
            resources: input.resources,
            width: input.width,
            height: input.height,
            transientResources,
          }));
          break;
        }
        case 'snapshot-accumulator':
          values.set(pass.outputResourceId, requireView(values, pass.inputResourceId));
          break;
        case 'composite-source': {
          const texture = createRenderTexture(
            input.device,
            input.width,
            input.height,
            pass.outputResourceId,
            transientResources,
          );
          const view = texture.createView();
          compositeLayer({
            plan: input.plan,
            layerId: pass.layerId,
            kind: 'source',
            mix: pass.mix,
            baseView: requireView(values, pass.lowerAccumulatorResourceId),
            layerView: requireView(values, pass.sourceResourceId),
            outputView: view,
            commandEncoder: input.commandEncoder,
            resources: input.resources,
            width: input.width,
            height: input.height,
          });
          values.set(pass.outputResourceId, view);
          break;
        }
        case 'apply-adjustment-effect': {
          const texture = createRenderTexture(
            input.device,
            input.width,
            input.height,
            pass.outputResourceId,
            transientResources,
          );
          const view = texture.createView();
          encodeEffectPass({
            pass,
            device: input.device,
            commandEncoder: input.commandEncoder,
            sampler: input.resources.sampler,
            sourceView: requireView(values, pass.inputResourceId),
            outputView: view,
            width: input.width,
            height: input.height,
            transientResources,
          });
          values.set(pass.outputResourceId, view);
          break;
        }
        case 'mix-adjustment-result': {
          const texture = createRenderTexture(
            input.device,
            input.width,
            input.height,
            pass.outputResourceId,
            transientResources,
          );
          const view = texture.createView();
          compositeLayer({
            plan: input.plan,
            layerId: pass.layerId,
            kind: 'adjustment',
            mix: pass.mix,
            baseView: requireView(values, pass.preEffectSnapshotResourceId),
            layerView: requireView(values, pass.processedAccumulatorResourceId),
            outputView: view,
            commandEncoder: input.commandEncoder,
            resources: input.resources,
            width: input.width,
            height: input.height,
          });
          values.set(pass.outputResourceId, view);
          break;
        }
      }
      executedPassIds.push(pass.passId);
    }
    if (consumedSourceLayerIds.size !== resolvePassesByLayerId.size) {
      throw new Error('Worker GPU adjustment did not consume every planned source');
    }
    return {
      finalView: requireView(values, input.plan.finalAccumulatorResourceId),
      transientResources,
      executedPassIds,
    };
  } catch (error) {
    for (const resource of transientResources.reverse()) {
      try {
        resource.destroy();
      } catch {
        // Preserve the original plan execution error.
      }
    }
    throw error;
  }
}
