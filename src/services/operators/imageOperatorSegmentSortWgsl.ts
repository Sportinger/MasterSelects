import stableSortWgsl from '../../effects/_shared/stablePixelSort16.wgsl?raw';
import type { ImageOperatorCapability, ImageOperatorSampleScope, ImagePlanInstruction } from './imageOperatorPlanTypes';
import { imageScopeReadsPrimaryInput } from './imageOperatorScopes';

export const IMAGE_SEGMENT_SORT_WGSL = stableSortWgsl;

export function emitImageSegmentSortWgsl(options: {
  instructions: readonly ImagePlanInstruction[];
  sampleScopes: readonly ImageOperatorSampleScope[];
  segmentSortScopes: readonly { id: number; sample: number }[];
  capabilities: readonly ImageOperatorCapability[];
  hasParameters: boolean;
}) {
  return options.segmentSortScopes.map(descriptor => {
    const args = ['sampleColor', '(vec2f(samplePixel) + 0.5) / inputResolution', 'samplePixel',
      ...(options.capabilities.includes('resolution') ? ['inputResolution'] : []),
      ...(options.capabilities.includes('time') ? ['timelineTimeSeconds'] : []),
      ...(options.hasParameters ? ['imageParameters'] : [])];
    const loaded = imageScopeReadsPrimaryInput(options.instructions, descriptor.id) ? 'loadImageGraphSource(samplePixel)' : 'vec4f(0.0)';
    const parameters = ['scale: f32', 'inputUv: vec2f', 'inputResolution: vec2f',
      ...(options.capabilities.includes('time') ? ['timelineTimeSeconds: f32'] : []),
      ...(options.hasParameters ? ['imageParameters: ImageOperatorParameters'] : [])];
    return `fn imageSegmentSort${descriptor.id}(${parameters.join(', ')}) -> vec4f {
  let segmentSize = max(4, min(16, i32(round(scale))));
  let currentPixel = imageGraphPixelCoordinate(inputUv * inputResolution, inputResolution);
  let segmentStart = currentPixel.x - currentPixel.x % segmentSize;
  var colors: array<vec4f, 16>;
  for (var index = 0; index < 16; index = index + 1) {
    let sourceIndex = min(index, segmentSize - 1);
    let samplePixel = imageGraphPixelCoordinate(vec2f(f32(segmentStart + sourceIndex), f32(currentPixel.y)), inputResolution);
    let sampleColor = ${loaded};
    colors[index] = evaluateImageScope${descriptor.id}(${args.join(', ')});
  }
  colors = imageStableSort16ByRec709(colors);
  return colors[min(15, currentPixel.x - segmentStart)];
}`;
  }).join('\n');
}
