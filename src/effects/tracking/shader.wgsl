struct TrackingParams {
  resolution: vec2f,
  amount: f32,
  time: f32,
  speed: f32,
  centerX: f32,
  centerY: f32,
  spread: f32,
  motionX: f32,
  motionY: f32,
  count: f32,
  variant: f32,
  color: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: TrackingParams;
@group(0) @binding(3) var feedbackTex: texture_2d<f32>;

struct LandmarkData {
  header: vec4f,
  points: array<vec4f>,
};
@group(0) @binding(6) var<storage, read> landmarks: LandmarkData;

fn source(uv: vec2f) -> vec4f {
  return textureSample(inputTex, texSampler, clamp(uv, vec2f(0.001), vec2f(0.999)));
}

fn centered(uv: vec2f) -> vec2f {
  let aspect = params.resolution.x / max(1.0, params.resolution.y);
  return (uv - vec2f(params.centerX, params.centerY)) * vec2f(aspect, 1.0);
}

fn landmarkField(uv: vec2f, radius: f32) -> f32 {
  let aspect = params.resolution.x / max(1.0, params.resolution.y);
  let count = u32(min(64.0, landmarks.header.x));
  var field = 0.0;
  for (var index = 0u; index < 64u; index += 1u) {
    if (index >= count) { break; }
    let delta = (uv - landmarks.points[index].xy) * vec2f(aspect, 1.0);
    field = max(field, 1.0 - smoothstep(radius * 0.3, radius, length(delta)));
  }
  return field;
}

fn landmarkLines(uv: vec2f) -> f32 {
  let aspect = params.resolution.x / max(1.0, params.resolution.y);
  let count = u32(min(64.0, landmarks.header.x));
  var field = 0.0;
  for (var index = 1u; index < 64u; index += 1u) {
    if (index >= count) { break; }
    let a = landmarks.points[index - 1u].xy;
    let b = landmarks.points[index].xy;
    let segment = (b - a) * vec2f(aspect, 1.0);
    let delta = (uv - a) * vec2f(aspect, 1.0);
    let along = clamp(dot(delta, segment) / max(dot(segment, segment), 0.00001), 0.0, 1.0);
    field = max(field, 1.0 - smoothstep(0.002, 0.008, length(delta - segment * along)));
  }
  return field;
}

fn trackerBox(p: vec2f, radius: f32) -> f32 {
  let distance = abs(p);
  let outer = max(distance.x, distance.y);
  let inner = max(distance.x - 0.018, distance.y - 0.018);
  let frame = step(inner, radius) - step(outer, radius);
  let corners = step(min(distance.x, distance.y), radius * 0.72);
  return frame * corners;
}

@fragment
fn subjectFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let focus = max(
    landmarkField(input.uv, max(0.035, params.spread * 0.8)),
    1.0 - smoothstep(params.spread * 1.4, params.spread * 2.8, length(centered(input.uv))) * step(params.count, 0.5)
  );
  let isolated = vec4f(color.rgb * (0.75 + focus * 0.35), color.a * max(focus, color.a));
  return mix(color, isolated, params.amount);
}

@fragment
fn trackedSceneFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let mesh = max(landmarkField(input.uv, 0.012), landmarkLines(input.uv) * 0.72);
  return vec4f(mix(color.rgb, params.color.rgb, mesh * params.amount), color.a);
}

@fragment
fn hudTrackerFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let box = trackerBox(centered(input.uv), max(0.08, params.spread * 1.4));
  let sweep = 1.0 - smoothstep(0.004, 0.015, abs(input.uv.y - fract(params.time * params.speed * 0.25)));
  let points = landmarkField(input.uv, 0.018);
  return vec4f(mix(color.rgb, params.color.rgb, max(max(box, points), sweep * 0.22) * params.amount), color.a);
}

@fragment
fn cctvFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let monochrome = vec3f(luminance(color.rgb) * 0.55, luminance(color.rgb), luminance(color.rgb) * 0.62);
  let scan = 0.82 + 0.18 * sin(input.uv.y * params.resolution.y * PI);
  let box = max(trackerBox(centered(input.uv), max(0.08, params.spread * 1.5)), landmarkField(input.uv, 0.014));
  let noise = (hash(floor(input.uv * params.resolution) + floor(params.time * 24.0)) - 0.5) * 0.08;
  return vec4f(mix(color.rgb, monochrome * scan + noise + params.color.rgb * box, params.amount), color.a);
}

@fragment
fn kineticTraceFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let previous = textureSample(feedbackTex, texSampler, input.uv - vec2f(params.motionX, params.motionY) * 2.0);
  let focus = max(landmarkField(input.uv, 0.04), 1.0 - smoothstep(params.spread, params.spread * 2.4, length(centered(input.uv))));
  let trace = max(color.rgb, previous.rgb * (0.9 - focus * 0.08) + params.color.rgb * focus * 0.08);
  return vec4f(mix(color.rgb, trace, params.amount), color.a);
}

@fragment
fn rainRevealFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let column = floor(input.uv.x * 110.0);
  let drop = 1.0 - smoothstep(0.01, 0.045, abs(fract(input.uv.y * 5.0 - params.time * params.speed - hash(vec2f(column, 0.0))) - 0.5));
  let subject = max(landmarkField(input.uv, 0.045), 1.0 - smoothstep(params.spread * 1.2, params.spread * 2.5, length(centered(input.uv))));
  let rain = params.color.rgb * drop * (1.0 - subject * 0.75);
  return vec4f(mix(color.rgb * (0.45 + subject * 0.55), color.rgb + rain, params.amount), color.a);
}

fn particles(uv: vec2f, density: f32) -> f32 {
  let grid = max(12.0, density);
  let id = floor(uv * grid);
  let local = fract(uv * grid) - vec2f(hash(id), hash(id + 19.0));
  return 1.0 - smoothstep(0.03, 0.13, length(local));
}

@fragment
fn stardustFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let p = centered(input.uv);
  let contour = max(landmarkField(input.uv, 0.026), 1.0 - smoothstep(0.025, 0.07, abs(length(p) - params.spread * 1.5)));
  let sparkle = particles(input.uv + vec2f(0.0, params.time * params.speed * 0.02), 45.0 + min(params.count, 300.0) * 0.08);
  let stars = contour * sparkle;
  return vec4f(mix(color.rgb, color.rgb + params.color.rgb * stars * 1.4, params.amount), color.a);
}

@fragment
fn handParticlesFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let p = centered(input.uv);
  let cloud = max(landmarkField(input.uv, 0.035), 1.0 - smoothstep(params.spread * 0.5, params.spread * 2.0, length(p)) * step(params.count, 0.5));
  let drift = vec2f(sin(params.time * params.speed), -params.time * params.speed) * 0.015;
  let particle = particles(input.uv + drift, 28.0 + min(params.count, 480.0) * 0.12) * cloud;
  return vec4f(mix(color.rgb, color.rgb + params.color.rgb * particle * 1.25, params.amount), color.a);
}
