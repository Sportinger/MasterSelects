/**
 * WGSL mirror of `latticeNoise.ts`. Include LATTICE_HASH_WGSL before
 * LATTICE_NOISE_WGSL; the Flock shader library embeds both verbatim.
 */

export const LATTICE_HASH_WGSL = /* wgsl */ `fn hashU32(value: u32) -> u32 {
  var s = value * 747796405u + 2891336453u;
  s = (s ^ (s >> 16u)) * 0x45d9f3bu;
  s = (s ^ (s >> 16u)) * 0x45d9f3bu;
  return s ^ (s >> 16u);
}

fn toUnit(value: u32) -> f32 {
  return min(f32(value) / 4294967296.0, 0.99999994);
}
`;

export const LATTICE_NOISE_WGSL = /* wgsl */ `fn cellHash(c: vec3i) -> u32 {
  return (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u) ^ (bitcast<u32>(c.z) * 83492791u);
}

fn lattice(c: vec3i, channel: u32) -> f32 {
  return toUnit(hashU32(cellHash(c) ^ ((channel + 1u) * 0x9e3779b9u)));
}

fn fade1(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise3(p: vec3f, channel: u32) -> f32 {
  let fl = floor(p);
  let i = vec3i(fl);
  let fr = p - fl;
  let ux = fade1(fr.x);
  let uy = fade1(fr.y);
  let uz = fade1(fr.z);
  let c000 = lattice(i, channel);
  let c100 = lattice(i + vec3i(1, 0, 0), channel);
  let c010 = lattice(i + vec3i(0, 1, 0), channel);
  let c110 = lattice(i + vec3i(1, 1, 0), channel);
  let c001 = lattice(i + vec3i(0, 0, 1), channel);
  let c101 = lattice(i + vec3i(1, 0, 1), channel);
  let c011 = lattice(i + vec3i(0, 1, 1), channel);
  let c111 = lattice(i + vec3i(1, 1, 1), channel);
  let x00 = c000 + (c100 - c000) * ux;
  let x10 = c010 + (c110 - c010) * ux;
  let x01 = c001 + (c101 - c001) * ux;
  let x11 = c011 + (c111 - c011) * ux;
  let y0 = x00 + (x10 - x00) * uy;
  let y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

fn valueNoise1(t: f32, channel: u32) -> f32 {
  let c = f32(channel);
  return valueNoise3(vec3f(t, c * 17.13, c * 5.71), channel);
}

const CURL_EPS: f32 = 0.25;

fn curlPotential(q: vec3f) -> vec3f {
  return vec3f(valueNoise3(q, 1u), valueNoise3(q + vec3f(31.4, 0.0, 0.0), 2u), valueNoise3(q + vec3f(0.0, 47.2, 0.0), 3u));
}

/** Curl of a value-noise vector potential via central differences (divergence-free flow). */
fn curlNoise3(q: vec3f) -> vec3f {
  let dx = vec3f(CURL_EPS, 0.0, 0.0);
  let dy = vec3f(0.0, CURL_EPS, 0.0);
  let dz = vec3f(0.0, 0.0, CURL_EPS);
  let gx = (curlPotential(q + dx) - curlPotential(q - dx)) / (2.0 * CURL_EPS);
  let gy = (curlPotential(q + dy) - curlPotential(q - dy)) / (2.0 * CURL_EPS);
  let gz = (curlPotential(q + dz) - curlPotential(q - dz)) / (2.0 * CURL_EPS);
  return vec3f(gy.z - gz.y, gz.x - gx.z, gx.y - gy.x);
}
`;
