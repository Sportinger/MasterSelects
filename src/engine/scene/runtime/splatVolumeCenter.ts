import type { PreparedSplatRuntime } from './SharedSplatRuntimeCache';

export interface SplatVolumeCenter {
  x: number;
  y: number;
  z: number;
}

export function computeSplatVolumeCenter(runtime: PreparedSplatRuntime): SplatVolumeCenter {
  let weightedX = 0;
  let weightedY = 0;
  let weightedZ = 0;
  let totalWeight = 0;

  for (let index = 0; index < runtime.splatCount; index += 1) {
    const offset = index * 4;
    const x = runtime.centerOpacityTextureData[offset] ?? 0;
    const y = runtime.centerOpacityTextureData[offset + 1] ?? 0;
    const z = runtime.centerOpacityTextureData[offset + 2] ?? 0;
    const opacity = Math.max(0, runtime.centerOpacityTextureData[offset + 3] ?? 0);
    if (![x, y, z, opacity].every(Number.isFinite) || opacity === 0) continue;

    // Splat density already samples the reconstructed volume. Weighting again
    // by covariance volume lets huge, translucent background splats dominate
    // the origin, even though they contribute little to the visible object.
    const red = Math.max(0, runtime.colorTextureData[offset] ?? 0);
    const green = Math.max(0, runtime.colorTextureData[offset + 1] ?? 0);
    const blue = Math.max(0, runtime.colorTextureData[offset + 2] ?? 0);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const weight = opacity * opacity * (0.02 + luminance);
    weightedX += x * weight;
    weightedY += y * weight;
    weightedZ += z * weight;
    totalWeight += weight;
  }

  return totalWeight > 0
    ? { x: weightedX / totalWeight, y: weightedY / totalWeight, z: weightedZ / totalWeight }
    : { x: 0, y: 0, z: 0 };
}
