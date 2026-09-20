import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { effectOperatorGraph, effectOperatorParams } from '../operators/effectGraphOwner';
import { compileImageOperatorPreview } from '../operators/imageOperatorGraph';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';
import { imageOperatorPreviewPrefix, parseImageOperatorPreviewStage } from './imageOperatorPreviewStages';

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
}

interface DevicePipelines { device: GPUDevice; pipelines: Map<string, GPURenderPipeline> }
const hot = import.meta.hot?.data as { imageOperatorPreviewPipelines?: DevicePipelines } | undefined;
let cache: DevicePipelines | undefined = hot?.imageOperatorPreviewPipelines;
const MAX_PIPELINES = 32;
if (import.meta.hot) import.meta.hot.dispose(data => { data.imageOperatorPreviewPipelines = cache; });

const fullscreenVertex = `
struct ImagePreviewVertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn imagePreviewVertex(@builtin(vertex_index) index: u32) -> ImagePreviewVertex {
  let positions = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var result: ImagePreviewVertex;
  result.position = vec4f(positions[index], 0, 1);
  result.uv = vec2f((positions[index].x + 1) * 0.5, (1 - positions[index].y) * 0.5);
  return result;
}`;

function pipelineFor(device: GPUDevice, key: string, wgsl: string, source: ImageOperatorPreviewSource): GPURenderPipeline {
  if (cache?.device !== device) {
    cache = { device, pipelines: new Map() };
    const owner = cache;
    void device.lost.then(() => { if (cache === owner) cache = undefined; });
  }
  const cacheKey = `${source.kind}:${key}`;
  const existing = cache.pipelines.get(cacheKey); if (existing) return existing;
  const textureDeclaration = source.kind === 'external'
    ? '@group(0) @binding(1) var imagePreviewSource: texture_external;'
    : '@group(0) @binding(1) var imagePreviewSource: texture_2d<f32>;';
  const sample = source.kind === 'external'
    ? 'textureSampleBaseClampToEdge(imagePreviewSource, imagePreviewSampler, input.uv)'
    : 'textureSample(imagePreviewSource, imagePreviewSampler, input.uv)';
  const module = device.createShaderModule({ label: 'image-operator-node-preview', code: `${wgsl}\n${fullscreenVertex}\n
@group(0) @binding(0) var imagePreviewSampler: sampler;
${textureDeclaration}
@fragment fn imagePreviewFragment(input: ImagePreviewVertex) -> @location(0) vec4f {
  return evaluateImageGraph(${sample});
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
  let captured = 0;
  for (const { stage } of demands) {
    const target = parseImageOperatorPreviewStage(stage); if (!target) continue;
    try {
      const plan = compileImageOperatorPreview(graph, effectOperatorParams(options.effect), target);
      const pipeline = pipelineFor(options.device, plan.key, plan.wgsl, options.source);
      nodePreviewTextureTap.draw(stage, options.device, options.encoder, options.width, options.height, pass => {
        const resource = options.source.kind === 'external' ? options.source.texture : options.source.view;
        const bind = options.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: options.sampler }, { binding: 1, resource },
        ] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3);
      });
      captured++;
    } catch { /* Invalid/stale demand expires through the tap's bounded timeout. */ }
  }
  return captured;
}
