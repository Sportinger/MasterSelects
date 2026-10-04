import { hexToRgb01 } from '../../../types/light';
import type { SceneLightLayer } from '../../scene/types';
import { packEnvironmentIrradiance } from '../sceneRenderer/environmentIrradiance';

/** Direct scene lights a strand layer receives; further point and panel lights are ignored. */
export const MAX_STRAND_LIGHTS = 4;
/** Floats written by `packStrandLights`: ambient, then 12 per direct light. */
export const STRAND_LIGHT_FLOATS = 4 + MAX_STRAND_LIGHTS * 12;
const BASE_AMBIENT = 0.08;

/**
 * Scene lights with the MeshPass conventions: environment lights add ambient color on a 0.08 base,
 * point and panel lights fall off with 1 / (1 + (distance / diameter)^2), and a panel shines along
 * its -Z axis. Writes [ambient rgb, direct count] then per light [position, kind (1 point, 2 panel),
 * color, intensity, panel direction, diameter]. Without lights the count is -1, which keeps the
 * strand pass on its fixed key light.
 */
export function packStrandLights(lights: readonly SceneLightLayer[], target: Float32Array, offset: number,
  irradianceOffset?: number): void {
  target.fill(0, offset, offset + STRAND_LIGHT_FLOATS);
  // Environment lights with a loaded map light by their irradiance (environmentIrradiance.ts) instead of a flat ambient.
  const covered = irradianceOffset === undefined ? new Set<SceneLightLayer>() : packEnvironmentIrradiance(lights, target, irradianceOffset);
  if (!lights.length) {
    target[offset + 3] = -1;
    return;
  }
  const ambient = [BASE_AMBIENT, BASE_AMBIENT, BASE_AMBIENT];
  let count = 0;
  for (const light of lights) {
    const settings = light.lightSettings, color = hexToRgb01(settings.color);
    const intensity = settings.intensity * Math.max(0, Math.min(1, light.opacity ?? 1));
    if (settings.kind === 'environment') {
      if (!covered.has(light)) color.forEach((value, axis) => { ambient[axis] += value * intensity; });
      continue;
    }
    if (count >= MAX_STRAND_LIGHTS || intensity <= 0) continue;
    const base = offset + 4 + count * 12, matrix = light.worldMatrix;
    const direction = [-(matrix[8] ?? 0), -(matrix[9] ?? 0), -(matrix[10] ?? 1)];
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    target.set([matrix[12] ?? 0, matrix[13] ?? 0, matrix[14] ?? 0, settings.kind === 'panel' ? 2 : 1, ...color, intensity,
      ...(settings.kind === 'panel' && length > 1e-6 ? direction.map(value => value / length) : [0, 0, -1]), settings.diameter], base);
    count++;
  }
  target.set([...ambient, count], offset);
}
