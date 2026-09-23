import { SOURCE_MOTION_SAMPLING_WGSL } from './sourceMotionSampling';

/** Bounded, iterative Lucas–Kanade estimator. Inputs are explicitly materialized
 * to a small analysis grid. No assumption of consecutive playback frames. */
export const OPTICAL_FLOW_WGSL = /* wgsl */`
fn flowLuma(image: texture_2d<f32>, s: sampler, uv: vec2f) -> f32 {
  return dot(textureSampleLevel(image, s, uv, 0.0).rgb, vec3f(.299, .587, .114));
}
fn imageOpticalFlow(reference: texture_2d<f32>, target: texture_2d<f32>, s: sampler,
  uv: vec2f, delta: f32, resolution: vec2f) -> vec4f {
  if (abs(delta) < .000001) { return vec4f(0.0); }
  let size = max(min(resolution, vec2f(textureDimensions(reference))), vec2f(1.0));
  var velocity = vec2f(0.0); var confidence = 0.0;
  for (var level = 2; level >= 0; level--) {
    let stride = exp2(f32(level)); let pixel = vec2f(stride) / size;
    for (var iteration = 0; iteration < 3; iteration++) {
      var xx = 0.0; var yy = 0.0; var xy = 0.0;
      var xt = 0.0; var yt = 0.0; var weights = 0.0;
      for (var y = -2; y <= 2; y++) { for (var x = -2; x <= 2; x++) {
        let p = uv + vec2f(f32(x), f32(y)) * pixel; let q = p + velocity;
        if (any(p < pixel) || any(p > vec2f(1.0)-pixel) || any(q < pixel) || any(q > vec2f(1.0)-pixel)) { continue; }
        let weight = exp(-.25 * f32(x*x+y*y));
        let dx = .5 * (flowLuma(target, s, q + vec2f(pixel.x, 0.0)) - flowLuma(target, s, q - vec2f(pixel.x, 0.0)));
        let dy = .5 * (flowLuma(target, s, q + vec2f(0.0, pixel.y)) - flowLuma(target, s, q - vec2f(0.0, pixel.y)));
        let dt = flowLuma(reference, s, p) - flowLuma(target, s, q);
        xx += weight*dx*dx; yy += weight*dy*dy; xy += weight*dx*dy;
        xt += weight*dx*dt; yt += weight*dy*dt; weights += weight;
      } }
      let determinant = xx*yy - xy*xy;
      let trace = xx+yy;
      let eigen = .5 * (trace - sqrt(max(0.0, trace*trace - 4.0*determinant))) / max(weights, 1.0);
      if (determinant <= .00000001 || weights < 4.0) { confidence = 0.0; continue; }
      let update = vec2f(yy*xt - xy*yt, xx*yt - xy*xt) / determinant;
      velocity += clamp(update, vec2f(-2.0), vec2f(2.0)) * pixel;
      velocity = clamp(velocity, -32.0/size, 32.0/size);
      confidence = clamp(eigen/(eigen+.0001), 0.0, 1.0);
    }
  }
  if (any(uv + velocity < vec2f(0.0)) || any(uv + velocity > vec2f(1.0))) { return vec4f(0.0); }
  // Validate the converged warp. The last iteration's residual belongs to the
  // previous displacement and can make confidence pulse as subpixel phase changes.
  var residual = 0.0; var support = 0.0;
  for (var y = -2; y <= 2; y++) { for (var x = -2; x <= 2; x++) {
    let p = uv + vec2f(f32(x), f32(y)) / size; let q = p + velocity;
    if (any(p < vec2f(0.0)) || any(p > vec2f(1.0)) || any(q < vec2f(0.0)) || any(q > vec2f(1.0))) { continue; }
    let w = exp(-.25*f32(x*x+y*y));
    let error = flowLuma(reference, s, p) - flowLuma(target, s, q);
    residual += w*error*error; support += w;
  } }
  confidence *= exp(-residual / max(support, .0001) / .01);
  return vec4f(velocity / delta, confidence, select(0.0, 1.0, confidence > .0001));
}
`;

/** Same estimator, with a fixed time for every patch sample. Evaluating a time
 * map separately at each neighbor would estimate already-distorted motion. */
export const HISTORY_OPTICAL_FLOW_WGSL = SOURCE_MOTION_SAMPLING_WGSL
  + OPTICAL_FLOW_WGSL.slice(OPTICAL_FLOW_WGSL.indexOf('fn imageOpticalFlow'))
  .replace('fn imageOpticalFlow(reference: texture_2d<f32>, target: texture_2d<f32>, s: sampler,\n  uv: vec2f, delta: f32, resolution: vec2f)',
    'fn imageHistoryOpticalFlow(atlas: texture_2d_array<f32>, ages: texture_2d<f32>, s: sampler,\n  uv: vec2f, delay: f32, interval: f32, resolution: vec2f)')
  .replace('  if (abs(delta)', `  let header = textureLoad(ages, vec2i(i32(textureDimensions(ages).x - 1u), 0), 0);
  if (header.z > 4.5) { return sampleDisMotion(atlas, ages, s, uv, delay, header); }
  if (header.x < 2.0 || header.z < 3.5) { return vec4f(0.0); }
  let delta = -clamp(interval, 0.0, 1.0);
  if (abs(delta)`)
  .replace('  let size =', `  let grid = vec2u(textureLoad(ages, vec2i(i32(textureDimensions(ages).x - 1u), 1), 0).xy);
  let referencePoint = resolveMotionHistoryPoint(ages, u32(header.x), delay);
  let targetPoint = resolveMotionHistoryPoint(ages, u32(header.x), delay - delta);
  let size =`)
  // The history cache can reduce source images below the output field size.
  // LK gradients/patches must span real source pixels, not subpixel samples of
  // an upscaled tile; those produce weak, texture-dependent confidence specks.
  // Decimate the output field during interaction, not the LK measurement grid:
  // every estimate must use the same source-pixel patch on play, pause and seek.
  .replace('min(resolution, vec2f(textureDimensions(reference)))', 'vec2f(textureDimensions(atlas)) / vec2f(grid)')
  .replaceAll('flowLuma(target, s, ', 'flowHistoryLuma(atlas, s, targetPoint, grid, ')
  .replaceAll('flowLuma(reference, s, ', 'flowHistoryLuma(atlas, s, referencePoint, grid, ');
