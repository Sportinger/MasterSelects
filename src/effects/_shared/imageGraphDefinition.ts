import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { FullscreenEffectDefinition } from '../types';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, isImageGraphEffectType } from '../../services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../services/operators/imageOperatorGraph';
import { imageOperatorRuntimeUniformSize, packImageOperatorRuntimeUniforms } from '../../services/operators/imageOperatorRuntimeUniforms';
import type { ImageOperatorPlan } from '../../services/operators/imageOperatorGraph';
import { imageGraphLoadFunction, imageGraphSampleExpression } from './imageGraphSampling';
import { imageGraphRuntimeDeclaration } from './imageGraphShaderRuntime';
import { imageGraphResourceDeclarations, validateImageGraphResourceSampling } from './imageGraphShaderResources';

export function imageGraphProgramShader(plan: ImageOperatorPlan, entryPoint: string, sourceKind: 'texture' | 'external' = 'texture'): string {
  const needsTime = plan.capabilities.includes('time'), needsResolution = plan.capabilities.includes('resolution'), needsContext = needsTime || needsResolution;
  validateImageGraphResourceSampling(plan);
  const needsMetadata = plan.resourceSampling?.includes('exact-u32-pixel-load') ?? false;
  const runtimeDeclaration = imageGraphRuntimeDeclaration(plan);
  const sourceDeclaration = sourceKind === 'external' ? '@group(0) @binding(1) var inputTex: texture_external;' : '@group(0) @binding(1) var inputTex: texture_2d<f32>;';
  const sample = imageGraphSampleExpression(sourceKind, 'inputTex', 'texSampler', 'input.uv', false);
  const sampleAt = (uv: string) => imageGraphSampleExpression(sourceKind, 'inputTex', 'texSampler', uv, true);
  const resourceDeclarations = imageGraphResourceDeclarations(plan);
  return `${plan.wgsl}\n@group(0) @binding(0) var texSampler: sampler;\n${sourceDeclaration}\n${runtimeDeclaration}\n${resourceDeclarations}
${plan.capabilities.includes('sample') ? `fn sampleImageGraphSource(uv: vec2f) -> vec4f { return ${sampleAt('uv')}; }` : ''}
${plan.capabilities.includes('pixel-load') ? imageGraphLoadFunction('loadImageGraphSource', 'inputTex', sourceKind) : ''}
@fragment fn ${entryPoint}(input: VertexOutput) -> @location(0) vec4f {
 return evaluateImageGraph(${sample}${plan.capabilities.includes('uv') ? ', input.uv' : ''}${needsResolution ? ', imageGraphRuntime.inputResolution' : ''}${needsTime ? ', imageGraphRuntime.timelineTimeSeconds' : ''}${plan.values.length ? `, ${needsContext || needsMetadata ? 'imageGraphRuntime.imageParameters' : 'imageParameters'}` : ''});
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
  const plan = compileImageOperatorGraph(graph, effectOperatorParams(effect), effectOperatorCompileContext(effect));
  if (plan.passes?.length) throw new Error('Multi-pass image graphs require ImageGraphPassRuntime.');
  return {
    ...definition,
    // Generated Image-IR shaders declare only sampler/source/runtime bindings.
    // Resource-backed plans are handled by ImageGraphPassRuntime instead.
    usesFeedback: false,
    glyphAtlas: undefined,
    byteTexture: undefined,
    landmarkPoints: undefined,
    passes: undefined,
    id: `${definition.id}:${plan.key}`,
    uniformSize: imageOperatorRuntimeUniformSize(plan),
    packUniforms: (_params, width, height) => packImageOperatorRuntimeUniforms(plan, timelineTimeSeconds, width, height),
    shader: imageGraphProgramShader(plan, definition.entryPoint),
  };
}
