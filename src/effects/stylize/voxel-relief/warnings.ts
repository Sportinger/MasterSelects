/**
 * Voxel Relief values the raymarcher clamps (keyframes, curves and tools can set any value),
 * named by parameter id; the inspector shows the label. Ranges are the shader's own limits.
 */
type Params = Record<string, number | boolean | string>;

const LIMITS: readonly [id: string, min: number, max: number][] = [
  ['columns', 4, 240], ['distance', 0.15, 8], ['perspective', 0.15, 1.6], ['gap', 0, 0.42], ['centerX', 0, 1], ['centerY', 0, 1],
  ['temporalBlend', 0, 0.94], ['colorMix', 0, 1], ['floorBrightness', 0, 1], ['edgeDarkness', 0, 1], ['ambient', 0, 1.5],
  ['lightElevation', 1, 89],
];

export function voxelReliefParamWarnings(params: Params): string[] {
  const notes: string[] = [];
  for (const [id, min, max] of LIMITS) {
    const value = params[id];
    if (typeof value !== 'number') continue;
    if (!Number.isFinite(value)) notes.push(`${id}: ${value} is not a finite number.`);
    else if (value < min || value > max) notes.push(`${id}: ${value} is outside ${min}-${max}; it renders as ${value < min ? min : max}.`);
  }
  const steps = params.maxSteps;
  if (typeof steps === 'number' && Number.isFinite(steps) && (steps < 24 || steps > 144)) {
    notes.push(`maxSteps: ${steps} is outside 24-144; the ray budget is clamped to ${steps < 24 ? 24 : 144} steps.`);
  }
  for (const id of ['height', 'baseHeight', 'lightStrength']) {
    const value = params[id];
    if (typeof value === 'number' && value < 0) notes.push(`${id}: ${value} is below 0; it renders as 0.`);
  }
  const contrast = params.heightContrast;
  if (typeof contrast === 'number' && contrast <= 0) notes.push(`heightContrast: ${contrast} is not above 0; every block takes the same height.`);
  return notes;
}
