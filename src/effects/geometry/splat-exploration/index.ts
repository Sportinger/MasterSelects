import type { EffectDefinition, EffectParam } from '../../types';
import { primitiveSplatGraph } from '../../../services/operators/splatGraphDefaults';
import { SCENE_OPERATORS } from '../../../services/operators/sceneOperators';

const initial = primitiveSplatGraph(true);
const params: Record<string, EffectParam> = {};
for (const node of initial.graph.nodes) for (const p of SCENE_OPERATORS.find(o => o.id === node.operator)?.parameters ?? []) {
  const binding = node.bindings[p.id];
  if (typeof binding === 'string') params[binding] = { type: 'number', label: p.label, default: Number(initial.params[binding]),
    min: p.min, max: p.max, step: p.step, animatable: node.operator !== 'splat.surface', hidden: true };
}
/** The shared scene executor consumes the geometry graph; the image stage is an identity. */
export const splatExploration: EffectDefinition = {
  id: 'splat-exploration', name: 'Splat Exploration', category: 'geometry', params,
  shader: `@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(0) var imageSampler: sampler;
@fragment fn splatExplorationFragment(input: VertexOutput) -> @location(0) vec4f { return textureSample(image, imageSampler, input.uv); }`,
  entryPoint: 'splatExplorationFragment', uniformSize: 0, packUniforms: () => null,
};
