import { hexToRgb01 } from '../../../../types/light';
import type { SceneLightLayer } from '../../../scene/types';
import { PT_LIGHT, PT_LIGHT_KIND, PT_MAX_LIGHTS } from '../contracts/ptLayouts';

const FLOATS = PT_LIGHT.size / 4;
/** The raster's fixed key light without light clips (StrandPass): direction toward the light and ambient share. */
const KEY_LIGHT_DIRECTION: [number, number, number] = (() => {
  const v = [-0.4, 0.7, 0.6], l = Math.hypot(...v);
  return v.map(c => c / l) as [number, number, number];
})();
const KEY_AMBIENT = 0.35;

/** Environment lights resolve their HDRI through this; null while it loads or when it failed (color only). */
export type PtEnvironmentLookup = (light: SceneLightLayer) => { averageLuminance: number } | null;

export interface PtLightTable {
  data: Float32Array<ArrayBuffer>;
  count: number;
  /** Index of the environment light bound with a map (-1 none). */
  environmentIndex: number;
  /** The light clip whose HDRI is bound to the environment texture. */
  environmentLayer: SceneLightLayer | null;
}

const luminance = (rgb: readonly number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const column = (m: Float32Array, c: number): [number, number, number] => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];

/**
 * Packs the scene's light clips as path tracer lights with the raster's brightness: the raster lights
 * a Lambert surface with color · intensity · diameter² / d² (point) and the same with the panel's
 * cosine, so a sphere of the clip's diameter gets radiance 4 · intensity and a D × D panel
 * π · intensity. Environment lights emit color · intensity (times their HDRI). Without light clips
 * the raster's key light convention applies: a distant light for 65 % and a uniform environment for
 * 35 %. More than PT_MAX_LIGHTS lights keep the brightest ones. Selection follows estimated power.
 */
export function packPtLights(lights: readonly SceneLightLayer[], environment: PtEnvironmentLookup): PtLightTable {
  const data = new Float32Array(PT_MAX_LIGHTS * FLOATS);
  const records: Array<{ values: number[]; weight: number; environment?: SceneLightLayer }> = [];
  for (const light of lights) {
    const settings = light.lightSettings, color = hexToRgb01(settings.color);
    const intensity = settings.intensity * Math.max(0, Math.min(1, light.opacity ?? 1));
    if (intensity <= 0) continue;
    // Every light shadows in the path tracer; the raster's single-shadow-light limit does not apply.
    const m = light.worldMatrix, cast = 1;
    if (settings.kind === 'environment') {
      const map = environment(light);
      const radiance = color.map(c => c * intensity);
      records.push({ values: [0, 0, 0, PT_LIGHT_KIND.environment, ...radiance, map ? 1 : 0, 0, 0, 0, cast, 0, 0, 0, 0],
        weight: Math.PI * luminance(radiance) * (map ? map.averageLuminance : 1), environment: map ? light : undefined });
    } else if (settings.kind === 'panel') {
      const half = settings.diameter / 2;
      // Half extents follow the clip's X and Y axes, scaled with it.
      const u = column(m, 0).map(c => c * half), v = column(m, 1).map(c => c * half);
      // The raster panel shines along -Z; the shader emits toward -cross(U, V), so V follows +Y and U +X.
      const area = 4 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
      const radiance = color.map(c => c * intensity * Math.PI);
      records.push({ values: [m[12], m[13], m[14], PT_LIGHT_KIND.rect, ...radiance, area, ...u, cast, ...v, 0],
        weight: luminance(radiance) * area / 4 });
    } else {
      const radius = settings.diameter / 2;
      const radiance = color.map(c => c * intensity * 4);
      records.push({ values: [m[12], m[13], m[14], PT_LIGHT_KIND.sphere, ...radiance, radius, 0, 0, 0, cast, 0, 0, 0, 0],
        weight: luminance(radiance) * Math.PI * radius * radius / 4 });
    }
  }
  if (!records.length) {
    const irradiance = (1 - KEY_AMBIENT) * Math.PI;
    records.push({ values: [...KEY_LIGHT_DIRECTION, PT_LIGHT_KIND.distant, irradiance, irradiance, irradiance, 1, 0, 0, 0, 1, 0, 0, 0, 0],
      weight: irradiance });
    records.push({ values: [0, 0, 0, PT_LIGHT_KIND.environment, KEY_AMBIENT, KEY_AMBIENT, KEY_AMBIENT, 0, 0, 0, 0, 1, 0, 0, 0, 0],
      weight: Math.PI * KEY_AMBIENT });
  }
  const kept = records.length > PT_MAX_LIGHTS ? records.toSorted((a, b) => b.weight - a.weight).slice(0, PT_MAX_LIGHTS) : records;
  // Every light keeps a share of the samples, so a dim but visible light is never starved.
  const floor = Math.max(...kept.map(record => record.weight)) * 0.02;
  const weights = kept.map(record => Math.max(record.weight, floor, 1e-6));
  const total = weights.reduce((a, b) => a + b, 0);
  let cdf = 0, environmentIndex = -1, environmentLayer: SceneLightLayer | null = null;
  kept.forEach((record, index) => {
    cdf += weights[index] / total;
    data.set(record.values, index * FLOATS);
    data[index * FLOATS + 15] = index === kept.length - 1 ? 1 : cdf;
    if (record.environment && environmentIndex < 0) { environmentIndex = index; environmentLayer = record.environment; }
  });
  // Only one environment map is bound; further mapped environments fall back to their color.
  kept.forEach((record, index) => { if (record.environment && index !== environmentIndex) data[index * FLOATS + 7] = 0; });
  return { data, count: kept.length, environmentIndex, environmentLayer };
}
