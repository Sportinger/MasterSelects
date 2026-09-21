import type { ImageOperatorPlan } from '../../services/operators/imageOperatorGraph';

/** Shared binding-2 declaration for render and compute Image IR adapters. */
export function imageGraphRuntimeDeclaration(plan: Pick<ImageOperatorPlan, 'capabilities' | 'values' | 'resourceInputs' | 'resourceSampling'>): string {
  const context = plan.capabilities.includes('time') || plan.capabilities.includes('resolution');
  const metadataSlots = plan.resourceSampling?.includes('exact-u32-pixel-load') ? plan.resourceInputs?.length ?? 0 : 0;
  if (!metadataSlots) return plan.values.length && context
    ? 'struct ImageGraphRuntimeUniforms { imageParameters: ImageOperatorParameters, timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };\n@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;'
    : plan.values.length ? '@group(0) @binding(2) var<uniform> imageParameters: ImageOperatorParameters;'
      : context ? 'struct ImageGraphRuntimeUniforms { timelineTimeSeconds: f32, _pad0: f32, inputResolution: vec2f, };\n@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;' : '';
  const fields = [
    ...(plan.values.length ? ['imageParameters: ImageOperatorParameters'] : []),
    ...(context ? ['timelineTimeSeconds: f32', '_pad0: f32', 'inputResolution: vec2f'] : []),
    `resourceMetadata: array<vec4f, ${metadataSlots}>`,
  ];
  return `struct ImageGraphRuntimeUniforms { ${fields.join(', ')}, };\n@group(0) @binding(2) var<uniform> imageGraphRuntime: ImageGraphRuntimeUniforms;`;
}
