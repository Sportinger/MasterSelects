export type ImageGraphSourceKind = 'texture' | 'external';

/**
 * Scoped graph evaluation may run below non-uniform control flow. Editor image
 * textures have one mip level, so explicit level zero preserves filtering and
 * addressing while avoiding implicit-derivative requirements.
 */
export function imageGraphSampleExpression(
  sourceKind: ImageGraphSourceKind,
  texture: string,
  sampler: string,
  uv: string,
  scoped: boolean,
): string {
  if (sourceKind === 'external') return `textureSampleBaseClampToEdge(${texture}, ${sampler}, ${uv})`;
  return scoped
    ? `textureSampleLevel(${texture}, ${sampler}, ${uv}, 0.0)`
    : `textureSample(${texture}, ${sampler}, ${uv})`;
}

export function imageGraphResourceSampleExpression(texture: string, sampler: string, uv: string): string {
  return `textureSampleLevel(${texture}, ${sampler}, ${uv}, 0.0)`;
}

/** Exact integer clamp-to-edge load. External textures use the WGSL overload without a mip level. */
export function imageGraphLoadFunction(name: string, texture: string, sourceKind: ImageGraphSourceKind = 'texture'): string {
  const load = sourceKind === 'external' ? `textureLoad(${texture}, coordinate)` : `textureLoad(${texture}, coordinate, 0)`;
  return `fn ${name}(pixel: vec2i) -> vec4f {
  let maximum = vec2i(textureDimensions(${texture})) - 1;
  let coordinate = clamp(pixel, vec2i(0), maximum);
  return ${load};
}`;
}

/** Manual clamp-to-edge bilinear sampling shared with compute-style image resources. */
export function imageGraphManualBilinearFunction(name: string, texture: string): string {
  return `fn ${name}(uv: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(${texture}));
  let maximum = dimensions - 1;
  let position = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(dimensions) - 0.5;
  let origin = vec2i(floor(position));
  let fraction = fract(position);
  let a = textureLoad(${texture}, clamp(origin, vec2i(0), maximum), 0);
  let b = textureLoad(${texture}, clamp(origin + vec2i(1, 0), vec2i(0), maximum), 0);
  let c = textureLoad(${texture}, clamp(origin + vec2i(0, 1), vec2i(0), maximum), 0);
  let d = textureLoad(${texture}, clamp(origin + vec2i(1, 1), vec2i(0), maximum), 0);
  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}`;
}
