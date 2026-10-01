import { LATTICE_HASH_WGSL, LATTICE_NOISE_WGSL } from '../../../engine/procedural/latticeNoiseWgsl';

/**
 * WGSL mirrors of fieldFunctions.ts for GPU executors of per-element fields (`requires:
 * 'field-functions'` in the pointwise table). Same names, arguments and results as the CPU functions,
 * in f32.
 */
export const FIELD_FUNCTIONS_WGSL = /* wgsl */ `${LATTICE_HASH_WGSL}
${LATTICE_NOISE_WGSL}
fn fieldShapeDistance(position: vec3f, center: vec3f, size: f32, shape: u32) -> f32 {
  let d = position - center;
  if (shape == 2u) {
    return d.y;
  }
  if (shape == 1u) {
    let q = abs(d) - vec3f(size);
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
  }
  return length(d) - size;
}

fn fieldNoise(position: vec3f, frequency: f32, amplitude: f32, seed: f32, octaves: u32) -> f32 {
  let channel = u32(max(0.0, trunc(seed)));
  var sum = 0.0;
  var weight = 1.0;
  var total = 0.0;
  var scale = frequency;
  for (var octave = 0u; octave < max(1u, min(6u, octaves)); octave++) {
    sum += (valueNoise3(position * scale, channel + octave) * 2.0 - 1.0) * weight;
    total += weight;
    weight *= 0.5;
    scale *= 2.03;
  }
  return select(0.0, sum / total * amplitude, total > 0.0);
}

fn fieldRampSegment(value: f32, a: f32, ya: f32, b: f32, yb: f32) -> f32 {
  var t = select(1.0, 0.0, value < a);
  if (b > a) {
    t = clamp((value - a) / (b - a), 0.0, 1.0);
  }
  return ya + (yb - ya) * t * t * (3.0 - 2.0 * t);
}

fn fieldRamp(value: f32, x0: f32, y0: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
  return select(fieldRampSegment(value, x1, y1, x2, y2), fieldRampSegment(value, x0, y0, x1, y1), value <= x1);
}
`;
