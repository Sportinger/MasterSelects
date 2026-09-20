import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { FullscreenEffectDefinition } from '../types';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType } from '../../services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../services/operators/imageOperatorGraph';
import { imageOperatorRuntimeUniformSize, packImageOperatorRuntimeUniforms } from '../../services/operators/imageOperatorRuntimeUniforms';

/** Fullscreen chains use the same lowering as the zero-extra-pass compositor. */
export function imageGraphDefinition(
  effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph },
  definition: FullscreenEffectDefinition,
  timelineTimeSeconds = 0,
): FullscreenEffectDefinition {
  if (!isImageGraphEffectType(effect.type)) return definition;
  const graph = effectOperatorGraph(effect);
  if (graph.incomplete) throw new Error(`Cannot render incomplete ${effect.type} operator graph.`);
  const plan = compileImageOperatorGraph(graph, effectOperatorParams(effect));
  const needsTime = plan.capabilities.includes('time');
  const runtimeDeclaration = plan.values.length && needsTime
    ? `struct ImageGraphRuntimeUniforms { imageParameters: ImageOperatorParameters, timelineTimeSeconds: f32, _pad0: f32, _pad1: f32, _pad2: f32, };
@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;`
    : plan.values.length
      ? '@group(0) @binding(2) var<uniform> imageParameters: ImageOperatorParameters;'
      : needsTime
        ? `struct ImageGraphRuntimeUniforms { timelineTimeSeconds: f32, _pad0: f32, _pad1: f32, _pad2: f32, };
@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;`
        : '';
  return {
    ...definition,
    id: `${definition.id}:${plan.key}`,
    uniformSize: imageOperatorRuntimeUniformSize(plan),
    packUniforms: () => packImageOperatorRuntimeUniforms(plan, timelineTimeSeconds),
    shader: `${plan.wgsl}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
${runtimeDeclaration}
@fragment
fn ${definition.entryPoint}(input: VertexOutput) -> @location(0) vec4f {
  return evaluateImageGraph(textureSample(inputTex, texSampler, input.uv)${plan.capabilities.includes('uv') ? ', input.uv' : ''}${needsTime ? ', imageGraphRuntime.timelineTimeSeconds' : ''}${plan.values.length ? `, ${needsTime ? 'imageGraphRuntime.imageParameters' : 'imageParameters'}` : ''});
}`,
  };
}
