import { imageGraphLoadFunction, imageGraphManualBilinearFunction } from '../../_shared/imageGraphSampling';
import { imageOperatorRuntimeUniformSize } from '../../../services/operators/imageOperatorRuntimeUniforms';
import type { ImageOperatorPlan } from '../../../services/operators/imageOperatorGraph';

export interface AnalogImageResolveProgram {
  shader: string;
  uniformSize: number;
}

export function analogImageResolveShader(plan: ImageOperatorPlan): AnalogImageResolveProgram {
  if (plan.capabilities.includes('derivative')) throw new Error('Analog compute resolve does not support fragment derivatives.');
  if (plan.passes?.length) throw new Error('Analog image resolve does not support multi-pass image programs.');
  if ((plan.resourceInputs?.length ?? 0) > 2) throw new Error('Analog image resolve supports at most two named image inputs.');
  const resourceInputs = plan.resourceInputs ?? [];
  if (new Set(resourceInputs).size !== resourceInputs.length
    || resourceInputs.some(id => id !== 'source' && id !== 'decoded')) throw new Error('Analog image resolve contains an unknown named image input.');
  if ((plan.resourceSampling?.length ?? 0) !== resourceInputs.length
    || plan.resourceSampling?.some(mode => mode !== 'manual-bilinear-clamp')) {
    throw new Error('Analog image resolve requires aligned manual-bilinear named inputs.');
  }
  const needsTime = plan.capabilities.includes('time'), needsResolution = plan.capabilities.includes('resolution');
  const needsContext = needsTime || needsResolution, uniformSize = imageOperatorRuntimeUniformSize(plan);
  const runtime = plan.values.length && needsContext
    ? 'struct ImageGraphRuntimeUniforms { imageParameters: ImageOperatorParameters, timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };\n@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;'
    : plan.values.length ? '@group(0) @binding(2) var<uniform> imageParameters: ImageOperatorParameters;'
      : needsContext ? 'struct ImageGraphRuntimeUniforms { timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };\n@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;' : '';
  const resources = resourceInputs.map((id, index) => {
    const texture = id === 'source' ? 'analogOriginalInput' : 'analogDecodedInput';
    return `${imageGraphManualBilinearFunction(`sampleImageGraphResource${index}`, texture)}${plan.capabilities.includes('pixel-load')
      ? `\n${imageGraphLoadFunction(`loadImageGraphResource${index}`, texture)}` : ''}`;
  }).join('\n');
  const args = ['original', ...(plan.capabilities.includes('uv') ? ['uv'] : []), ...(needsResolution ? ['vec2f(dimensions)'] : []),
    ...(needsTime ? ['imageGraphRuntime.timelineTimeSeconds'] : []), ...(plan.values.length ? [needsContext ? 'imageGraphRuntime.imageParameters' : 'imageParameters'] : [])];
  return { uniformSize, shader: `${plan.wgsl}
@group(0) @binding(1) var analogOriginalInput: texture_2d<f32>;
@group(0) @binding(3) var analogDecodedInput: texture_2d<f32>;
@group(0) @binding(5) var analogImageOutput: texture_storage_2d<rgba8unorm, write>;
${runtime}
${imageGraphManualBilinearFunction('sampleImageGraphSource', 'analogOriginalInput')}
${plan.capabilities.includes('pixel-load') ? imageGraphLoadFunction('loadImageGraphSource', 'analogOriginalInput') : ''}
${resources}
@compute @workgroup_size(8, 8)
fn analogImageResolveCompute(@builtin(global_invocation_id) id: vec3u) {
  let dimensions = textureDimensions(analogImageOutput);
  if (id.x >= dimensions.x || id.y >= dimensions.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(dimensions);
  let original = sampleImageGraphSource(uv);
  textureStore(analogImageOutput, vec2i(id.xy), evaluateImageGraph(${args.join(', ')}));
}`, };
}
