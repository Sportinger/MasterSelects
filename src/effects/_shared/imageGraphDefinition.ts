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
  const needsResolution = plan.capabilities.includes('resolution');
  const needsContext = needsTime || needsResolution;
  const runtimeDeclaration = plan.values.length && needsContext
    ? `struct ImageGraphRuntimeUniforms { imageParameters: ImageOperatorParameters, timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };
@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;`
    : plan.values.length
      ? '@group(0) @binding(2) var<uniform> imageParameters: ImageOperatorParameters;'
      : needsContext
        ? `struct ImageGraphRuntimeUniforms { timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };
@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;`
        : '';
  return {
    ...definition,
    id: `${definition.id}:${plan.key}`,
    uniformSize: imageOperatorRuntimeUniformSize(plan),
    packUniforms: (_params, width, height) => packImageOperatorRuntimeUniforms(plan, timelineTimeSeconds, width, height),
    shader: `${plan.wgsl}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
${runtimeDeclaration}
${plan.capabilities.includes('sample') ? 'fn sampleImageGraphSource(uv: vec2f) -> vec4f { return textureSample(inputTex, texSampler, uv); }' : ''}
@fragment
fn ${definition.entryPoint}(input: VertexOutput) -> @location(0) vec4f {
  return evaluateImageGraph(textureSample(inputTex, texSampler, input.uv)${plan.capabilities.includes('uv') ? ', input.uv' : ''}${needsResolution ? ', imageGraphRuntime.inputResolution' : ''}${needsTime ? ', imageGraphRuntime.timelineTimeSeconds' : ''}${plan.values.length ? `, ${needsContext ? 'imageGraphRuntime.imageParameters' : 'imageParameters'}` : ''});
}`,
  };
}
