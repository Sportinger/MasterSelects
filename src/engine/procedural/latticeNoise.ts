/**
 * Deterministic lattice hash and value/curl noise shared by procedural nodes and
 * the Flock solver. `latticeNoiseWgsl.ts` mirrors these functions line by line
 * (u32 wrapping arithmetic). Changing either changes simulation results: bump
 * FLOCK_SOLVER_VERSION and every dependent cache version.
 */

export type NoiseVec3 = [number, number, number];

export function hashU32(value: number): number {
  let state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
  return (state ^ (state >>> 16)) >>> 0;
}

/** Unmasked 32-bit hash of an integer lattice cell. Mirrors WGSL cellHash. */
export function latticeCellHash(ix: number, iy: number, iz: number): number {
  return (Math.imul(ix | 0, 73856093) ^ Math.imul(iy | 0, 19349663) ^ Math.imul(iz | 0, 83492791)) >>> 0;
}

function lattice(ix: number, iy: number, iz: number, channel: number): number {
  return hashU32(latticeCellHash(ix, iy, iz) ^ Math.imul(channel + 1, 0x9e3779b9)) / 4294967296;
}

/** Cubic Hermite fade used by the lattice interpolation and falloff curves. Mirrors WGSL fade1. */
export function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Trilinear lattice value noise in [0,1). */
export function valueNoise3(x: number, y: number, z: number, channel: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const c000 = lattice(ix, iy, iz, channel);
  const c100 = lattice(ix + 1, iy, iz, channel);
  const c010 = lattice(ix, iy + 1, iz, channel);
  const c110 = lattice(ix + 1, iy + 1, iz, channel);
  const c001 = lattice(ix, iy, iz + 1, channel);
  const c101 = lattice(ix + 1, iy, iz + 1, channel);
  const c011 = lattice(ix, iy + 1, iz + 1, channel);
  const c111 = lattice(ix + 1, iy + 1, iz + 1, channel);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

export function valueNoise1(t: number, channel: number): number {
  return valueNoise3(t, channel * 17.13, channel * 5.71, channel);
}

const CURL_EPS = 0.25;

function curlPotential(x: number, y: number, z: number): NoiseVec3 {
  return [valueNoise3(x, y, z, 1), valueNoise3(x + 31.4, y, z, 2), valueNoise3(x, y + 47.2, z, 3)];
}

/** Curl of a value-noise vector potential via central differences (divergence-free flow). Mirrors WGSL curlNoise3. */
export function curlNoise3(x: number, y: number, z: number): NoiseVec3 {
  const inv = 1 / (2 * CURL_EPS);
  const px1 = curlPotential(x + CURL_EPS, y, z);
  const px0 = curlPotential(x - CURL_EPS, y, z);
  const py1 = curlPotential(x, y + CURL_EPS, z);
  const py0 = curlPotential(x, y - CURL_EPS, z);
  const pz1 = curlPotential(x, y, z + CURL_EPS);
  const pz0 = curlPotential(x, y, z - CURL_EPS);
  const gx = [(px1[0] - px0[0]) * inv, (px1[1] - px0[1]) * inv, (px1[2] - px0[2]) * inv];
  const gy = [(py1[0] - py0[0]) * inv, (py1[1] - py0[1]) * inv, (py1[2] - py0[2]) * inv];
  const gz = [(pz1[0] - pz0[0]) * inv, (pz1[1] - pz0[1]) * inv, (pz1[2] - pz0[2]) * inv];
  return [gy[2] - gz[1], gz[0] - gx[2], gx[1] - gy[0]];
}
