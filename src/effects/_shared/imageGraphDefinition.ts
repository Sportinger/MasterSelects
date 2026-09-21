import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { FullscreenEffectDefinition } from '../types';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType } from '../../services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../services/operators/imageOperatorGraph';
import { imageOperatorRuntimeUniformSize, packImageOperatorRuntimeUniforms } from '../../services/operators/imageOperatorRuntimeUniforms';
import type { ImageOperatorPlan } from '../../services/operators/imageOperatorGraph';

export function imageGraphProgramShader(plan: ImageOperatorPlan, entryPoint: string, sourceKind: 'texture' | 'external' = 'texture'): string {
  const needsTime = plan.capabilities.includes('time'), needsResolution = plan.capabilities.includes('resolution'), needsContext = needsTime || needsResolution;
  const resources = plan.resourceInputs ?? [];
  if (resources.length > 8) throw new Error('Image graph pass exceeds the eight-resource input limit.');
  const runtimeDeclaration = plan.values.length && needsContext
    ? `struct ImageGraphRuntimeUniforms { imageParameters: ImageOperatorParameters, timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };\n@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;`
    : plan.values.length ? '@group(0) @binding(2) var<uniform> imageParameters: ImageOperatorParameters;'
      : needsContext ? `struct ImageGraphRuntimeUniforms { timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };\n@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;` : '';
  const sourceDeclaration = sourceKind === 'external' ? '@group(0) @binding(1) var inputTex: texture_external;' : '@group(0) @binding(1) var inputTex: texture_2d<f32>;';
  const sample = sourceKind === 'external' ? 'textureSampleBaseClampToEdge(inputTex, texSampler, input.uv)' : 'textureSample(inputTex, texSampler, input.uv)';
  const sampleAt = (uv: string) => sourceKind === 'external' ? `textureSampleBaseClampToEdge(inputTex, texSampler, ${uv})` : `textureSample(inputTex, texSampler, ${uv})`;
  const resourceDeclarations = resources.map((_, index) => `@group(0) @binding(${3 + index}) var imageGraphResource${index}: texture_2d<f32>;\nfn sampleImageGraphResource${index}(uv: vec2f) -> vec4f { return textureSample(imageGraphResource${index}, texSampler, uv); }`).join('\n');
  return `${plan.wgsl}\n@group(0) @binding(0) var texSampler: sampler;\n${sourceDeclaration}\n${runtimeDeclaration}\n${resourceDeclarations}
${plan.capabilities.includes('sample') ? `fn sampleImageGraphSource(uv: vec2f) -> vec4f { return ${sampleAt('uv')}; }` : ''}
@fragment fn ${entryPoint}(input: VertexOutput) -> @location(0) vec4f {
 return evaluateImageGraph(${sample}${plan.capabilities.includes('uv') ? ', input.uv' : ''}${needsResolution ? ', imageGraphRuntime.inputResolution' : ''}${needsTime ? ', imageGraphRuntime.timelineTimeSeconds' : ''}${plan.values.length ? `, ${needsContext ? 'imageGraphRuntime.imageParameters' : 'imageParameters'}` : ''});
}`;
}

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
  if (plan.passes?.length) throw new Error('Multi-pass image graphs require ImageGraphPassRuntime.');
  return {
    ...definition,
    id: `${definition.id}:${plan.key}`,
    uniformSize: imageOperatorRuntimeUniformSize(plan),
    packUniforms: (_params, width, height) => packImageOperatorRuntimeUniforms(plan, timelineTimeSeconds, width, height),
    shader: imageGraphProgramShader(plan, definition.entryPoint),
  };
}
