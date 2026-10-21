/**
 * Fractal Noise (`noise.fractal2d.vec2`): smooth gradient noise summed over octaves.
 *
 * The lattice hash is the integer PCG2D hash (Jarzynski & Olano 2020) on the cell coordinates,
 * so the pattern stays free of the diagonal streaks a sine hash shows at large coordinates
 * (Random (Hash) is only clean for small inputs), and the CPU evaluation below reproduces the
 * shader bit for bit up to float rounding of the interpolation. Each octave doubles the
 * frequency, turns by 37.5 degrees and moves by an irrational offset, so octaves never line up
 * on the lattice. Octaves are truncated and clamped to 1..8; roughness (the amplitude ratio
 * between octaves) is clamped to 0..1; non-finite inputs read as 0 (one octave, roughness 0).
 * The result is normalized by the summed amplitudes and mapped to 0..1 (0.5 = mean).
 */
export const FRACTAL_NOISE_MAX_OCTAVES = 8;
const OCTAVE_TURN = 37.5 * Math.PI / 180;
const OCTAVE_SHIFT: readonly [number, number] = [19.19, 7.73];
const TAU = Math.PI * 2;

/** PCG2D integer hash of two u32 values (the WGSL `imageGraphPcg2d`). */
export function pcg2d(x: number, y: number): number {
  let vx = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  let vy = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  vx = (vx + Math.imul(vy, 1664525)) >>> 0; vy = (vy + Math.imul(vx, 1664525)) >>> 0;
  vx = (vx ^ (vx >>> 16)) >>> 0; vy = (vy ^ (vy >>> 16)) >>> 0;
  vx = (vx + Math.imul(vy, 1664525)) >>> 0;
  return (vx ^ (vx >>> 16)) >>> 0;
}

/** Signed gradient noise of one octave, about -0.71..0.71. */
function gradientNoise(px: number, py: number): number {
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const corner = (cx: number, cy: number) => {
    // WGSL: bitcast<vec2u>(vec2i(cell)); i32 wraps like `| 0` for the reachable range.
    const angle = (pcg2d((ix + cx) | 0, (iy + cy) | 0) >>> 8) * (TAU / 16777216);
    return Math.cos(angle) * (fx - cx) + Math.sin(angle) * (fy - cy);
  };
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const bottom = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * ux;
  const top = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * ux;
  return bottom + (top - bottom) * uy;
}

const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function fractalNoiseOctaves(value: number): number {
  return Math.min(FRACTAL_NOISE_MAX_OCTAVES, Math.max(1, Math.trunc(finiteOr(value, 1))));
}

export function evaluateFractalNoise2d(position: readonly number[], octavesInput: number, roughnessInput: number): number {
  const octaves = fractalNoiseOctaves(octavesInput);
  const roughness = Math.min(1, Math.max(0, finiteOr(roughnessInput, 0)));
  let x = finiteOr(position[0], 0), y = finiteOr(position[1], 0);
  let amplitude = 1, sum = 0, total = 0;
  const c = Math.cos(OCTAVE_TURN), s = Math.sin(OCTAVE_TURN);
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += gradientNoise(x, y) * amplitude; total += amplitude;
    const nx = (c * x - s * y) * 2 + OCTAVE_SHIFT[0], ny = (s * x + c * y) * 2 + OCTAVE_SHIFT[1];
    x = nx; y = ny; amplitude *= roughness;
  }
  return Math.min(1, Math.max(0, 0.5 + 0.7071 * sum / total));
}

export const IMAGE_FRACTAL_NOISE_WGSL = `
fn imageGraphPcg2d(cell: vec2u) -> u32 {
  var v = cell * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  let x = v.x + v.y * 1664525u;
  return x ^ (x >> 16u);
}
fn imageGraphGradientCorner(cell: vec2f, offset: vec2f, fraction: vec2f) -> f32 {
  let angle = f32(imageGraphPcg2d(bitcast<vec2u>(vec2i(cell + offset))) >> 8u) * ${(TAU / 16777216).toPrecision(17)};
  return dot(vec2f(cos(angle), sin(angle)), fraction - offset);
}
fn imageGraphGradientNoise(p: vec2f) -> f32 {
  let cell = floor(p); let f = p - cell;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let bottom = mix(imageGraphGradientCorner(cell, vec2f(0.0, 0.0), f), imageGraphGradientCorner(cell, vec2f(1.0, 0.0), f), u.x);
  let top = mix(imageGraphGradientCorner(cell, vec2f(0.0, 1.0), f), imageGraphGradientCorner(cell, vec2f(1.0, 1.0), f), u.x);
  return mix(bottom, top, u.y);
}
fn imageGraphFractalNoise(position: vec2f, octavesInput: f32, roughnessInput: f32) -> f32 {
  let finiteOctaves = select(1.0, octavesInput, octavesInput == octavesInput && abs(octavesInput) < 3.0e38);
  let octaves = i32(clamp(trunc(finiteOctaves), 1.0, ${FRACTAL_NOISE_MAX_OCTAVES}.0));
  let roughness = clamp(select(0.0, roughnessInput, roughnessInput == roughnessInput), 0.0, 1.0);
  var p = select(vec2f(0.0), position, (position == position) & (abs(position) < vec2f(3.0e38)));
  var amplitude = 1.0; var sum = 0.0; var total = 0.0;
  let turn = mat2x2f(${Math.cos(OCTAVE_TURN).toPrecision(9)}, ${Math.sin(OCTAVE_TURN).toPrecision(9)}, ${(-Math.sin(OCTAVE_TURN)).toPrecision(9)}, ${Math.cos(OCTAVE_TURN).toPrecision(9)});
  for (var octave = 0; octave < ${FRACTAL_NOISE_MAX_OCTAVES}; octave++) {
    if (octave >= octaves) { break; }
    sum += imageGraphGradientNoise(p) * amplitude; total += amplitude;
    p = turn * p * 2.0 + vec2f(${OCTAVE_SHIFT[0]}, ${OCTAVE_SHIFT[1]});
    amplitude *= roughness;
  }
  return clamp(0.5 + 0.7071 * sum / total, 0.0, 1.0);
}`;
