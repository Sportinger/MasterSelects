export const MOTION_IMAGE_WGSL = /* wgsl */`
fn motionSpatialConsensus(field: texture_2d<f32>, s: sampler, uv: vec2f, radius: f32, resolution: vec2f) -> vec4f {
  if (radius <= 0.0) { return textureSampleLevel(field, s, uv, 0.0); }
  let size = max(resolution, vec2f(1.0));
  let step = clamp(radius, 0.0, .1) * max(size.x, size.y) * .5 / size;
  let halfPixel = .5 / vec2f(textureDimensions(field));
  var velocity = vec2f(0.0); var square = 0.0; var weight = 0.0; var area = 0.0;
  for (var y = -2; y <= 2; y++) { for (var x = -2; x <= 2; x++) {
    let spatial = exp(-.5*f32(x*x+y*y));
    let motion = textureSampleLevel(field, s, clamp(uv + vec2f(f32(x),f32(y))*step, halfPixel, vec2f(1.0)-halfPixel), 0.0);
    let w = spatial * clamp(motion.b, 0.0, 1.0) * clamp(motion.a, 0.0, 1.0);
    velocity += motion.xy*w; square += dot(motion.xy,motion.xy)*w; weight += w; area += spatial;
  } }
  if (weight < .000001) { return vec4f(0.0); }
  velocity /= weight;
  let variance = max(0.0, square/weight - dot(velocity,velocity));
  let tolerance = .25*dot(velocity,velocity) + .000001;
  let confidence = clamp(weight/area, 0.0, 1.0) * tolerance/(tolerance+variance);
  return vec4f(velocity, confidence, select(0.0, 1.0, confidence > .0001));
}
fn motionTemporalDeformation(motion: vec4f, gradient: vec2f, resolution: vec2f) -> vec4f {
  if (motion.a <= 0.0 || motion.b <= 0.0) { return vec4f(1.0, 1.0, 0.0, 1.0); }
  let v = motion.xy * resolution;
  let a = 1.0 + v.x * gradient.x; let b = v.x * gradient.y;
  let c = v.y * gradient.x; let d = 1.0 + v.y * gradient.y;
  let determinant = a * d - b * c;
  let trace = a*a + b*b + c*c + d*d;
  let disc = sqrt(max(0.0, trace*trace - 4.0*determinant*determinant));
  let large = sqrt(max(0.0, (trace + disc) * .5));
  let small = abs(determinant) / max(large, .000001);
  return vec4f(min(64.0, 1.0/max(small, 1.0/64.0)), min(64.0, 1.0/max(large, 1.0/64.0)), clamp(motion.b, 0.0, 1.0), determinant);
}
fn motionMaskOverlay(color: vec4f, mask: f32, tint: vec3f, opacity: f32) -> vec4f {
  return vec4f(mix(color.rgb, tint, clamp(mask, 0.0, 1.0) * clamp(opacity, 0.0, 1.0)), color.a);
}
fn motionDirectionalSmooth(image: texture_2d<f32>, s: sampler, uv: vec2f, direction: vec2f,
  radius: f32, mask: f32, resolution: vec2f) -> vec4f {
  let center = textureSampleLevel(image, s, uv, 0.0);
  let magnitude = length(direction);
  if (radius <= 0.0 || mask <= 0.0 || magnitude <= .000001) { return center; }
  let offset = direction / magnitude * clamp(radius, 0.0, 16.0) / max(resolution, vec2f(1.0));
  let halfPixel = .5 / vec2f(textureDimensions(image));
  var sum = center; var weights = 1.0;
  for (var i = 1; i <= 4; i++) {
    let t = f32(i) / 4.0; let w = exp(-2.0*t*t);
    sum += (textureSampleLevel(image, s, clamp(uv + offset*t, halfPixel, vec2f(1.0)-halfPixel), 0.0)
      + textureSampleLevel(image, s, clamp(uv - offset*t, halfPixel, vec2f(1.0)-halfPixel), 0.0)) * w;
    weights += 2.0*w;
  }
  return mix(center, sum/weights, clamp(mask, 0.0, 1.0));
}
`;
