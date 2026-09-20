import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { FullscreenEffectDefinition } from '../types';
import { effectOperatorGraph, effectOperatorParams, isLocalImageEffectType } from '../../services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../services/operators/imageOperatorGraph';

/** Fullscreen chains use the same lowering as the zero-extra-pass compositor. */
export function imageGraphDefinition(
  effect: { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph },
  definition: FullscreenEffectDefinition,
): FullscreenEffectDefinition {
  if (!isLocalImageEffectType(effect.type)) return definition;
  const graph = effectOperatorGraph(effect);
  if (graph.incomplete) throw new Error(`Cannot render incomplete ${effect.type} operator graph.`);
  const plan = compileImageOperatorGraph(graph, effectOperatorParams(effect));
  return {
    ...definition,
    id: `${definition.id}:${plan.key}`,
    shader: `${plan.wgsl}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@fragment
fn ${definition.entryPoint}(input: VertexOutput) -> @location(0) vec4f {
  return evaluateImageGraph(textureSample(inputTex, texSampler, input.uv));
}`,
  };
}
