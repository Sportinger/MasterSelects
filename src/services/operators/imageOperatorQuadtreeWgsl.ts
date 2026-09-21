import type { ImageOperatorCapability, ImageOperatorSampleScope, ImagePlanInstruction } from './imageOperatorPlanTypes';
import { imageScopeReadsPrimaryInput } from './imageOperatorScopes';

export function emitImageQuadtreeWgsl(options: {
  instructions: readonly ImagePlanInstruction[]; sampleScopes: readonly ImageOperatorSampleScope[];
  quadtreeScopes: readonly { id: number; sample: number }[]; capabilities: readonly ImageOperatorCapability[]; hasParameters: boolean;
}) {
  return options.quadtreeScopes.flatMap(descriptor => {
    const contextParams = [...(options.capabilities.includes('time') ? ['timelineTimeSeconds: f32'] : []),
      ...(options.hasParameters ? ['imageParameters: ImageOperatorParameters'] : [])];
    const contextArgs = [...(options.capabilities.includes('time') ? ['timelineTimeSeconds'] : []), ...(options.hasParameters ? ['imageParameters'] : [])];
    const evalArgs = ['sampleColor', '(vec2f(samplePixel) + 0.5) / inputResolution', 'samplePixel',
      ...(options.capabilities.includes('resolution') ? ['inputResolution'] : []), ...contextArgs];
    const loaded = imageScopeReadsPrimaryInput(options.instructions, descriptor.id) ? 'loadImageGraphSource(samplePixel)' : 'vec4f(0.0)';
    const suffix = contextParams.length ? `, ${contextParams.join(', ')}` : '';
    const callSuffix = contextArgs.length ? `, ${contextArgs.join(', ')}` : '';
    return [
      `fn imageQuadtreeTone${descriptor.id}(requestedPixel: vec2i, inputResolution: vec2f${suffix}) -> f32 {
  let samplePixel = imageGraphPixelCoordinate(vec2f(requestedPixel), inputResolution);
  let sampleColor = ${loaded};
  return dot(evaluateImageScope${descriptor.id}(${evalArgs.join(', ')}).rgb, vec3f(0.2126, 0.7152, 0.0722));
}`,
      `fn imageQuadtreeVariance${descriptor.id}(origin: vec2i, size: i32, inputResolution: vec2f${suffix}) -> f32 {
  let half = max(1, size / 2);
  let a = imageQuadtreeTone${descriptor.id}(origin, inputResolution${callSuffix});
  let b = imageQuadtreeTone${descriptor.id}(origin + vec2i(size - 1, 0), inputResolution${callSuffix});
  let c = imageQuadtreeTone${descriptor.id}(origin + vec2i(0, size - 1), inputResolution${callSuffix});
  let d = imageQuadtreeTone${descriptor.id}(origin + vec2i(size - 1, size - 1), inputResolution${callSuffix});
  let e = imageQuadtreeTone${descriptor.id}(origin + vec2i(half, half), inputResolution${callSuffix});
  let mean = (a + b + c + d + e) / 5.0;
  return ((a - mean) * (a - mean) + (b - mean) * (b - mean)
    + (c - mean) * (c - mean) + (d - mean) * (d - mean) + (e - mean) * (e - mean)) / 5.0;
}`,
      `fn imageQuadtreePartition${descriptor.id}(scale: f32, threshold: f32, time: f32, speed: f32,
    inputUv: vec2f, inputResolution: vec2f${suffix}) -> vec3f {
  let pixel = imageGraphPixelCoordinate(inputUv * inputResolution, inputResolution);
  let minimumSize = max(2, i32(round(scale)));
  let pulse = 0.82 + 0.18 * sin(time * speed * 2.0);
  var blockSize = minimumSize * 32;
  for (var level = 0; level < 6; level += 1) {
    let origin = (pixel / blockSize) * blockSize;
    if (blockSize <= minimumSize || imageQuadtreeVariance${descriptor.id}(origin, blockSize, inputResolution${callSuffix}) <= threshold * pulse) { break; }
    blockSize = max(minimumSize, blockSize / 2);
  }
  let origin = (pixel / blockSize) * blockSize;
  return vec3f(vec2f(origin), f32(blockSize));
}`,
    ];
  });
}
