// Motion Trails: a feedback trail. The feedback texture holds the previous trace (straight alpha; the
// engine renders it at Amount 1, so Amount is a plain opacity); every new frame keeps `trail` of it,
// softened by `softness`, and lets the current picture through wherever that is lighter. The first 16 floats match the tracking family's TrackingParams (landmarkRuntime fills them).
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
  trail: f32,
  tint: f32,
  softness: f32,
  pad1: f32,
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

// The glow around a tracked subject. Without tracking data there is no subject, so no glow
// (it used to sit as a fixed disc in the frame centre).
fn subjectGlow(uv: vec2f) -> f32 {
  if (params.count < 0.5) { return 0.0; }
  return max(landmarkField(uv, 0.04), 1.0 - smoothstep(params.spread, params.spread * 2.4, length(centered(uv))));
}

// The Overlay colour at the brightness of `light`, so a tinted trail keeps its brightness.
fn tinted(light: vec3f) -> vec3f {
  let scale = luminance(light) / max(luminance(params.color.rgb), 0.3);
  return min(params.color.rgb * scale, vec3f(1.0));
}

fn premultipliedFeedback(uv: vec2f) -> vec4f {
  let texel = textureSample(feedbackTex, texSampler, uv);
  return vec4f(texel.rgb * texel.a, texel.a);
}

// The previous trace, premultiplied. Softness spreads it a little every frame (pixels of a 1080-line
// frame; four diagonal taps that each average four texels), so older copies melt into one streak.
fn previousTrace(uv: vec2f) -> vec4f {
  let centre = premultipliedFeedback(uv);
  if (params.softness <= 0.0) { return centre; }
  let reach = params.softness / 1080.0 * vec2f(params.resolution.y / max(1.0, params.resolution.x), 1.0);
  let around = premultipliedFeedback(uv + reach) + premultipliedFeedback(uv - reach)
    + premultipliedFeedback(uv + vec2f(reach.x, -reach.y)) + premultipliedFeedback(uv + vec2f(-reach.x, reach.y));
  return centre * 0.2 + around * 0.2;
}

@fragment
fn kineticTraceFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let previous = previousTrace(input.uv - vec2f(params.motionX, params.motionY) * 2.0);
  let focus = subjectGlow(input.uv);
  let keep = clamp(params.trail, 0.0, 1.0) * (1.0 - focus * 0.08 / 0.9);
  // Premultiplied, so a trail over a transparent area fades with its alpha instead of turning dark.
  let current = vec4f(color.rgb * color.a, color.a);
  let glow = params.color.rgb * focus * 0.08;
  // The feedback texture has 8 bits: below 0.5 / (1 - keep) steps a plain product rounds back to the
  // same value and a faint ghost would stay for ever. Taking 0.6 of a step more lets every trail fade.
  let fade = select(0.6 / 255.0, 0.0, keep >= 1.0);
  let trail = vec4f(max(previous.rgb * keep - vec3f(fade), vec3f(0.0)) + glow, min(1.0, max(previous.a * keep - fade, 0.0) + focus * 0.08));
  // Lighten per channel, as Motion Trails always drew its trail.
  let lighten = max(current, trail);
  // Tint: the trail in the Overlay colour, chosen by brightness instead of per channel. A per-channel
  // max of two hues is brighter than either, so a tinted trail over the stage would feed itself frame
  // after frame and never fade. Repeated every frame, older parts of the trail take on more colour.
  let lighter = smoothstep(-0.02, 0.02, luminance(trail.rgb) - luminance(current.rgb));
  let coloured = mix(current, vec4f(tinted(trail.rgb), trail.a), lighter);
  let trace = mix(lighten, coloured, clamp(params.tint, 0.0, 1.0));
  let mixed = mix(current, trace, clamp(params.amount, 0.0, 1.0));
  return vec4f(select(vec3f(0.0), mixed.rgb / max(mixed.a, 0.00001), mixed.a > 0.0), mixed.a);
}
