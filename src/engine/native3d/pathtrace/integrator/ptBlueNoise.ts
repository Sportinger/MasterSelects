/**
 * Blue noise for the realtime path tracer's per-pixel seeds (Ulichney 1993, void-and-cluster): a
 * 64 × 64 tileable dither array per channel, four independent channels, generated deterministically
 * once and uploaded as an rgba32float texture (`ptBlueNoise` in PtSceneBindings.wgsl).
 */

export const PT_BLUE_NOISE_SIZE = 64;
const SIGMA = 1.9;
const RADIUS = 7;

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Ranks 0 .. size² - 1 of a void-and-cluster dither array, as values in [0, 1). */
export function voidAndCluster(size = PT_BLUE_NOISE_SIZE, seed = 1): Float32Array {
  const count = size * size, random = lcg(seed);
  const kernel: number[] = [];
  for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++) kernel.push(Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA)));
  const energy = new Float64Array(count), bits = new Uint8Array(count);
  const splat = (index: number, sign: number) => {
    const x = index % size, y = Math.floor(index / size);
    let k = 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const row = ((y + dy + size) % size) * size;
      for (let dx = -RADIUS; dx <= RADIUS; dx++, k++) energy[row + (x + dx + size) % size] += sign * kernel[k];
    }
  };
  const extreme = (value: number, wantMax: boolean) => {
    let best = -1, bestEnergy = wantMax ? -Infinity : Infinity;
    for (let i = 0; i < count; i++) {
      if (bits[i] !== value) continue;
      if (wantMax ? energy[i] > bestEnergy : energy[i] < bestEnergy) { bestEnergy = energy[i]; best = i; }
    }
    return best;
  };
  // Initial pattern: about a tenth of the pixels, spread by swapping the tightest cluster into the largest void.
  const initial = Math.floor(count / 10);
  while ([...bits].filter(Boolean).length < initial) {
    const index = Math.floor(random() * count);
    if (!bits[index]) { bits[index] = 1; splat(index, 1); }
  }
  for (;;) {
    const cluster = extreme(1, true);
    bits[cluster] = 0; splat(cluster, -1);
    const hole = extreme(0, false);
    bits[hole] = 1; splat(hole, 1);
    if (hole === cluster) break;
  }
  const ranks = new Float32Array(count), prototype = bits.slice(), prototypeEnergy = energy.slice();
  for (let rank = initial - 1; rank >= 0; rank--) {
    const cluster = extreme(1, true);
    bits[cluster] = 0; splat(cluster, -1);
    ranks[cluster] = rank;
  }
  bits.set(prototype); energy.set(prototypeEnergy);
  for (let rank = initial; rank < count; rank++) {
    const hole = extreme(0, false);
    bits[hole] = 1; splat(hole, 1);
    ranks[hole] = rank;
  }
  for (let i = 0; i < count; i++) ranks[i] = (ranks[i] + 0.5) / count;
  return ranks;
}

let cached: Float32Array<ArrayBuffer> | null = null;
/** Four channels interleaved (rgba), generated once per page. */
export function ptBlueNoiseRgba(): Float32Array<ArrayBuffer> {
  if (cached) return cached;
  const channels = [11, 23, 37, 53].map(seed => voidAndCluster(PT_BLUE_NOISE_SIZE, seed));
  const rgba = new Float32Array(PT_BLUE_NOISE_SIZE * PT_BLUE_NOISE_SIZE * 4);
  for (let i = 0; i < PT_BLUE_NOISE_SIZE * PT_BLUE_NOISE_SIZE; i++) for (let c = 0; c < 4; c++) rgba[i * 4 + c] = channels[c][i];
  cached = rgba;
  return rgba;
}

const textures = new WeakMap<GPUDevice, GPUTexture>();
export function ptBlueNoiseTexture(device: GPUDevice): GPUTexture {
  let texture = textures.get(device);
  if (!texture) {
    texture = device.createTexture({ label: 'pt-blue-noise', size: [PT_BLUE_NOISE_SIZE, PT_BLUE_NOISE_SIZE], format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture }, ptBlueNoiseRgba(), { bytesPerRow: PT_BLUE_NOISE_SIZE * 16 }, [PT_BLUE_NOISE_SIZE, PT_BLUE_NOISE_SIZE]);
    textures.set(device, texture);
  }
  return texture;
}
