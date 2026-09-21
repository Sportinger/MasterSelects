import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { effectOperatorGraph, effectOperatorParams } from '../operators/effectGraphOwner';
import { compileImageOperatorPreview } from '../operators/imageOperatorGraph';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';
import { imageOperatorPreviewPrefix, parseImageOperatorPreviewStage } from './imageOperatorPreviewStages';
import { packImageOperatorRuntimeUniforms } from '../operators/imageOperatorRuntimeUniforms';
import { ImageGraphPassRuntime } from '../../effects/ImageGraphPassRuntime';
import type { ImageGraphPassBatch } from '../../effects/ImageGraphPassRuntime';

export type ImageOperatorPreviewSource =
  | { kind: 'texture'; view: GPUTextureView }
  | { kind: 'external'; texture: GPUExternalTexture };

export interface CaptureImageOperatorPreviewsOptions {
  effect: { id: string; type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  sampler: GPUSampler;
  source: ImageOperatorPreviewSource;
  width: number;
  height: number;
  /** Composition-local render clock. Callers without a render context are deterministic at zero. */
  timelineTimeSeconds?: number;
  passRuntime?: ImageGraphPassRuntime;
  passBatch?: ImageGraphPassBatch;
}

interface DevicePipelines { device: GPUDevice; pipelines: Map<string, GPURenderPipeline> }
interface PassPreviewState { device: GPUDevice; runtime: ImageGraphPassRuntime; outputs: Map<string, { texture: GPUTexture; view: GPUTextureView; width: number; height: number }> }
const hot = import.meta.hot?.data as { imageOperatorPreviewPipelines?: DevicePipelines; imageGraphPassPreviewState?: PassPreviewState } | undefined;
let cache: DevicePipelines | undefined = hot?.imageOperatorPreviewPipelines;
let passState: PassPreviewState | undefined = hot?.imageGraphPassPreviewState;
const MAX_PIPELINES = 32;
if (import.meta.hot) import.meta.hot.dispose(data => { data.imageOperatorPreviewPipelines = cache; data.imageGraphPassPreviewState = passState; });
function passPreviewState(device: GPUDevice) {
  if (passState?.device === device) return passState;
  if (passState) { passState.runtime.dispose(); for (const output of passState.outputs.values()) output.texture.destroy(); }
  passState = { device, runtime: new ImageGraphPassRuntime(device), outputs: new Map() };
  const owner = passState; void device.lost.then(() => { if (passState === owner) { owner.runtime.dispose(); for (const output of owner.outputs.values()) output.texture.destroy(); owner.outputs.clear(); passState = undefined; } });
  return passState;
}
function passPreviewOutput(state: PassPreviewState, key: string, width: number, height: number) {
  const found = state.outputs.get(key);
  if (found?.width === width && found.height === height) { state.outputs.delete(key); state.outputs.set(key, found); return found; }
  if (found) state.outputs.delete(key);
  const texture = state.device.createTexture({ size: { width, height }, format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const output = { texture, view: texture.createView(), width, height }; state.outputs.set(key, output);
  if (state.outputs.size > 16) state.outputs.delete(state.outputs.keys().next().value!);
  return output;
}

const fullscreenVertex = `
struct ImagePreviewVertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn imagePreviewVertex(@builtin(vertex_index) index: u32) -> ImagePreviewVertex {
  let positions = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var result: ImagePreviewVertex;
  result.position = vec4f(positions[index], 0, 1);
  result.uv = vec2f((positions[index].x + 1) * 0.5, (1 - positions[index].y) * 0.5);
  return result;
}`;

function pipelineFor(device: GPUDevice, key: string, wgsl: string, source: ImageOperatorPreviewSource, needsUv: boolean, needsResolution: boolean, needsTime: boolean, hasValues: boolean, needsSample: boolean): GPURenderPipeline {
  if (cache?.device !== device) {
    cache = { device, pipelines: new Map() };
    const owner = cache;
    void device.lost.then(() => { if (cache === owner) cache = undefined; });
  }
  const cacheKey = `${source.kind}:${needsUv ? 'uv' : 'pixel'}:${needsResolution ? 'resolution' : 'size-free'}:${needsTime ? 'time' : 'static'}:${hasValues ? 'values' : 'literal'}:${needsSample ? 'sample' : 'direct'}:${key}`;
  const existing = cache.pipelines.get(cacheKey); if (existing) return existing;
  const textureDeclaration = source.kind === 'external'
    ? '@group(0) @binding(1) var imagePreviewSource: texture_external;'
    : '@group(0) @binding(1) var imagePreviewSource: texture_2d<f32>;';
  const sample = source.kind === 'external'
    ? 'textureSampleBaseClampToEdge(imagePreviewSource, imagePreviewSampler, input.uv)'
    : 'textureSample(imagePreviewSource, imagePreviewSampler, input.uv)';
  const sampleAt = source.kind === 'external'
    ? 'textureSampleBaseClampToEdge(imagePreviewSource, imagePreviewSampler, uv)'
    : 'textureSample(imagePreviewSource, imagePreviewSampler, uv)';
  const needsContext = needsTime || needsResolution;
  const runtimeDeclaration = hasValues && needsContext
    ? `struct ImagePreviewRuntime { imageParameters: ImageOperatorParameters, timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };
@group(0) @binding(2) var<uniform> imagePreviewRuntime: ImagePreviewRuntime;`
    : hasValues
      ? '@group(0) @binding(2) var<uniform> imageParameters: ImageOperatorParameters;'
      : needsContext
        ? `struct ImagePreviewRuntime { timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };
@group(0) @binding(2) var<uniform> imagePreviewRuntime: ImagePreviewRuntime;`
        : '';
  const module = device.createShaderModule({ label: 'image-operator-node-preview', code: `${wgsl}\n${fullscreenVertex}\n
@group(0) @binding(0) var imagePreviewSampler: sampler;
${textureDeclaration}
${runtimeDeclaration}
${needsSample ? `fn sampleImageGraphSource(uv: vec2f) -> vec4f { return ${sampleAt}; }` : ''}
@fragment fn imagePreviewFragment(input: ImagePreviewVertex) -> @location(0) vec4f {
  return evaluateImageGraph(${sample}${needsUv ? ', input.uv' : ''}${needsResolution ? ', imagePreviewRuntime.inputResolution' : ''}${needsTime ? ', imagePreviewRuntime.timelineTimeSeconds' : ''}${hasValues ? `, ${needsContext ? 'imagePreviewRuntime.imageParameters' : 'imageParameters'}` : ''});
}` });
  const pipeline = device.createRenderPipeline({ label: 'image-operator-node-preview', layout: 'auto', vertex: { module, entryPoint: 'imagePreviewVertex' },
    fragment: { module, entryPoint: 'imagePreviewFragment', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
  if (cache.pipelines.size >= MAX_PIPELINES) cache.pipelines.delete(cache.pipelines.keys().next().value!);
  cache.pipelines.set(cacheKey, pipeline);
  return pipeline;
}

/** Materializes only demanded image-IR ports. The plan is lowered by the canonical image compiler. */
export function captureImageOperatorPreviews(options: CaptureImageOperatorPreviewsOptions): number {
  const demands = nodePreviewTextureTap.matching(imageOperatorPreviewPrefix(options.effect.id));
  if (!demands.length) return 0;
  const graph = effectOperatorGraph(options.effect);
  const multiPassState = passPreviewState(options.device), runtime = options.passRuntime ?? multiPassState.runtime;
  const batch = options.passBatch ?? runtime.createBatch();
  let captured = 0;
  for (const { stage } of demands) {
    const target = parseImageOperatorPreviewStage(stage); if (!target) continue;
    try {
      const plan = compileImageOperatorPreview(graph, effectOperatorParams(options.effect), target);
      if (plan.passes?.length) {
        const state = multiPassState;
        if (plan.previewResourceId) {
          runtime.encode({ encoder: options.encoder, sampler: options.sampler, source: options.source, width: options.width, height: options.height,
            timelineTimeSeconds: options.timelineTimeSeconds ?? 0, plan, instanceId: `preview:${options.effect.id}:${stage}`, batch,
            stopAtResourceId: plan.previewResourceId });
          const view = runtime.getBatchResourceView(batch, plan.previewResourceId);
          if (!view) throw new Error(`Materialized preview resource ${plan.previewResourceId} was not produced.`);
          nodePreviewTextureTap.capture(stage, options.device, options.encoder, options.sampler, view, options.width, options.height);
          captured++; continue;
        }
        const output = passPreviewOutput(state, `${options.effect.id}:${stage}`, options.width, options.height);
        runtime.encode({ encoder: options.encoder, sampler: options.sampler, source: options.source, width: options.width, height: options.height,
          timelineTimeSeconds: options.timelineTimeSeconds ?? 0, plan, outputView: output.view, outputFormat: 'rgba8unorm', instanceId: `preview:${options.effect.id}:${stage}`, batch });
        nodePreviewTextureTap.capture(stage, options.device, options.encoder, options.sampler, output.view, options.width, options.height);
        captured++; continue;
      }
      const needsTime = plan.capabilities.includes('time');
      const needsResolution = plan.capabilities.includes('resolution');
      const pipeline = pipelineFor(options.device, plan.key, plan.wgsl, options.source, plan.capabilities.includes('uv'), needsResolution,
        needsTime, plan.values.length > 0, plan.capabilities.includes('sample'));
      nodePreviewTextureTap.draw(stage, options.device, options.encoder, options.width, options.height, pass => {
        const resource = options.source.kind === 'external' ? options.source.texture : options.source.view;
        const entries: GPUBindGroupEntry[] = [
          { binding: 0, resource: options.sampler }, { binding: 1, resource },
        ];
        const packed = packImageOperatorRuntimeUniforms(plan, options.timelineTimeSeconds ?? 0, options.width, options.height);
        if (packed) {
          const buffer = options.device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          options.device.queue.writeBuffer(buffer, 0, packed);
          entries.push({ binding: 2, resource: { buffer } });
        }
        const bind = options.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
        pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3);
      });
      captured++;
    } catch { /* Invalid/stale demand expires through the tap's bounded timeout. */ }
  }
  return captured;
}
