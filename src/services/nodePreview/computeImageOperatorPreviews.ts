import type { Effect } from '../../types/effects';
import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type { PreviewFrame, PreviewRequest } from './previewTypes';
import { compileComputeImagePreview } from '../operators/computeImageGraph';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../operators/effectGraphOwner';
import { getEffectOperator } from '../operators/operatorRegistry';
import { imageOperatorKnownValues, imageOperatorValuePreview } from './imageOperatorPreviews';
import { captureImageOperatorPreviews, type CaptureImageOperatorPreviewsOptions } from './imageOperatorTexturePreviews';
import type { ResolvedImageGraphExternalResource } from '../../effects/_shared/imageGraphExternalResources';
import { imageOperatorPreviewPrefix, parseImageOperatorPreviewStage } from './imageOperatorPreviewStages';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';

const compilePreviewFor = (effect: Effect) => (graph: Parameters<typeof compileComputeImagePreview>[0], params: Record<string, unknown>,
  target: Parameters<typeof compileComputeImagePreview>[2]) => compileComputeImagePreview(graph, params, target, effectOperatorCompileContext(effect)).plan;

/** Compute fields are records, not colors. Until numeric GPU extraction exists their preview stays textual. */
export function computeImageOperatorValuePreview(request: PreviewRequest, clip: TimelineClip, effect: Effect,
  keys: Keyframe[] = [], time = Math.max(0, request.time - clip.startTime)): PreviewFrame | undefined {
  const binding = request.node.binding;
  if (binding?.kind !== 'effect-operator') return undefined;
  const node = effectOperatorGraph(effect).nodes.find(value => value.id === binding.nodeId);
  const definition = node ? getEffectOperator(node.operator) : undefined;
  const port = request.port && definition?.[request.port.direction === 'input' ? 'inputs' : 'outputs']
    .find(value => value.id === request.port!.id);
  if (port?.type === 'nearest-seed-field' || (node?.operator === 'field.read-nearest-seed' && port?.type === 'vec4')) return {
    key: request.key, revision: request.revision, time: request.time, status: 'live', label: 'Nearest-seed field', presentation: 'text',
    drawing: { kind: 'text', lines: ['XY: nearest seed pixel', 'Z > 0: valid; otherwise empty', 'W: reserved'] },
  };
  return imageOperatorValuePreview(request, clip, effect, keys, time, compilePreviewFor(effect));
}

export interface CaptureComputeImageOperatorPreviewsOptions extends Omit<CaptureImageOperatorPreviewsOptions,
  'externalResources' | 'compilePreview'> {
  /** Borrowed outputs of the already encoded compute stages, keyed by canonical resource id. */
  fieldResources: ReadonlyMap<string, ResolvedImageGraphExternalResource>;
}

/** Captures demanded image-island ports without dispatching compute stages a second time. */
export function captureComputeImageOperatorPreviews(options: CaptureComputeImageOperatorPreviewsOptions): number {
  return captureImageOperatorPreviews({ ...options, externalResources: options.fieldResources,
    compilePreview: (graph, params, target) => {
      // The final compute output is already materialized by the authoritative
      // output adapter; capture it afterward instead of recomputing the graph.
      if (graph.nodes.find(node => node.id === target.nodeId)?.operator === 'image.output') {
        throw new Error('Compute image output preview uses the rendered final texture.');
      }
      const compilation = compileComputeImagePreview(graph, params, target, effectOperatorCompileContext(options.effect));
      for (const resource of compilation.plan.fieldResources ?? []) {
        if (!options.fieldResources.has(resource.resourceId)) {
          throw new Error(`Compute preview field ${resource.resourceId} is unavailable from the encoded stages.`);
        }
      }
      return compilation.plan;
    } });
}

interface CaptureComputeImageOutputPreviewsOptions {
  effect: { id: string; type: string; params: Record<string, unknown>; operatorGraph?: import('../../types/operatorGraph').EffectOperatorGraph };
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  sampler: GPUSampler;
  view: GPUTextureView;
  width: number;
  height: number;
}

/** Captures image.output from the already quantized compute result. */
export function captureComputeImageOutputPreviews(options: CaptureComputeImageOutputPreviewsOptions): number {
  const graph = effectOperatorGraph(options.effect);
  const operators = new Map(graph.nodes.map(node => [node.id, node.operator]));
  let captured = 0;
  for (const { stage } of nodePreviewTextureTap.matching(imageOperatorPreviewPrefix(options.effect.id))) {
    const target = parseImageOperatorPreviewStage(stage);
    if (!target || operators.get(target.nodeId) !== 'image.output') continue;
    nodePreviewTextureTap.capture(stage, options.device, options.encoder, options.sampler, options.view, options.width, options.height);
    captured++;
  }
  return captured;
}

/** Numeric labels use the same sampled owner parameters but never invent field-dependent values. */
export function computeImageOperatorKnownValues(request: PreviewRequest, clip: TimelineClip, effect: Effect,
  keys: Keyframe[] = [], time = Math.max(0, request.time - clip.startTime)) {
  return imageOperatorKnownValues(request, clip, effect, keys, time, compilePreviewFor(effect));
}

export function computeImageOperatorPreviewParams(effect: Effect) {
  return effectOperatorParams(effect);
}
