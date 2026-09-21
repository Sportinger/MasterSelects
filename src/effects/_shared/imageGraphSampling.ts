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
