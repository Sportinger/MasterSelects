import { hexToRgb01 } from '../../../types/light';
import type { SceneLightLayer } from '../../scene/types';
import { decodeImage, downsample, parseRadianceHdr, type PtEnvironmentImage } from '../pathtrace/lights/ptEnvironment';

/**
 * Environment lighting of the raster (plan 3.8): an environment light's HDRI is projected once onto
 * spherical harmonics up to band 1 (constant plus a linear term per channel), giving the diffuse
 * irradiance from any direction. Strands and meshes evaluate it at their normal instead of a flat
 * ambient color. Scaled so a uniform map equals the old flat ambient (color × intensity), and with
 * the same equirectangular convention as the path tracer (u = atan2(z, x) / 2π, v = acos(y) / π).
 */
export const IRRADIANCE_FLOATS = 16;

const SH0 = 0.282095;
const SH1 = 0.488603;

interface Entry {
  status: 'loading' | 'ready' | 'failed';
  /** Irradiance / π: c0 rgb, then the linear term per channel (r xyz, g xyz, b xyz). */
  coefficients?: Float32Array;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

/** Called whenever an environment map finished loading (renderers request a new frame). */
export function onEnvironmentIrradianceReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Order-1 SH irradiance (divided by π) of an equirectangular radiance image. */
export function projectIrradiance(image: PtEnvironmentImage): Float32Array {
  const { width, height, rgba } = image;
  const l0 = [0, 0, 0], l1 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const dPhi = 2 * Math.PI / width, dTheta = Math.PI / height;
  for (let y = 0; y < height; y++) {
    const theta = (y + 0.5) * dTheta, sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
    const solidAngle = sinTheta * dTheta * dPhi;
    for (let x = 0; x < width; x++) {
      const phi = (x + 0.5) * dPhi;
      const dir = [sinTheta * Math.cos(phi), cosTheta, sinTheta * Math.sin(phi)];
      const at = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const radiance = rgba[at + c] * solidAngle;
        l0[c] += radiance * SH0;
        for (let axis = 0; axis < 3; axis++) l1[c][axis] += radiance * SH1 * dir[axis];
      }
    }
  }
  // Irradiance E = π L00 Y00 + (2π/3) Σ L1m Y1m(n); stored divided by π (radiance a Lambert surface reflects per unit albedo).
  const out = new Float32Array(12);
  for (let c = 0; c < 3; c++) {
    out[c] = l0[c] * SH0;
    for (let axis = 0; axis < 3; axis++) out[3 + c * 3 + axis] = (2 / 3) * l1[c][axis] * SH1;
  }
  return out;
}

async function load(url: string, name: string, entry: Entry): Promise<void> {
  try {
    const blob = await (await fetch(url)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (/\.exr$/i.test(name)) throw new Error('OpenEXR is not supported');
    const isHdr = /\.hdr$/i.test(name) || (bytes[0] === 0x23 && bytes[1] === 0x3f);
    entry.coefficients = projectIrradiance(downsample(isHdr ? parseRadianceHdr(bytes) : await decodeImage(blob)));
    entry.status = 'ready';
    listeners.forEach(listener => listener());
  } catch {
    entry.status = 'failed';
  }
}

/** The light's irradiance coefficients once its map is loaded (starts loading on first use), else null. */
export function environmentIrradiance(light: SceneLightLayer): Float32Array | null {
  const url = light.lightSettings.environmentMapUrl;
  if (light.lightSettings.kind !== 'environment' || !url) return null;
  let entry = entries.get(url);
  if (!entry) {
    entry = { status: 'loading' };
    entries.set(url, entry);
    void load(url, light.lightSettings.environmentMapFileName ?? url, entry);
  }
  return entry.status === 'ready' ? entry.coefficients ?? null : null;
}

/**
 * Sums the irradiance of all environment lights whose maps are loaded, scaled by their color and
 * intensity, into `target` at `offset` (IRRADIANCE_FLOATS: [c0 rgb, 1], [r xyz, 0], [g xyz, 0], [b xyz, 0]).
 * Returns the environment lights it covered; the caller leaves those out of its flat ambient.
 */
export function packEnvironmentIrradiance(lights: readonly SceneLightLayer[], target: Float32Array, offset: number): Set<SceneLightLayer> {
  target.fill(0, offset, offset + IRRADIANCE_FLOATS);
  const covered = new Set<SceneLightLayer>();
  for (const light of lights) {
    const coefficients = environmentIrradiance(light);
    if (!coefficients) continue;
    const color = hexToRgb01(light.lightSettings.color);
    const scale = light.lightSettings.intensity * Math.max(0, Math.min(1, light.opacity ?? 1));
    for (let c = 0; c < 3; c++) {
      target[offset + c] += coefficients[c] * color[c] * scale;
      for (let axis = 0; axis < 3; axis++) target[offset + 4 + c * 4 + axis] += coefficients[3 + c * 3 + axis] * color[c] * scale;
    }
    covered.add(light);
  }
  if (covered.size) target[offset + 3] = 1;
  return covered;
}
