// Sheen: a soft specular band sweeping across the layer, limited to its alpha.

struct SheenParams {
  position: f32,
  angle: f32,
  width: f32,
  softness: f32,
  intensity: f32,
  aspect: f32,
  pixelSize: f32,
  highlights: f32,
  color: vec4f,
  plateau: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SheenParams;

@fragment
fn sheenFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  // Aspect-correct coordinates so the band keeps its angle on wide layers.
  let centered = (input.uv - vec2f(0.5)) * vec2f(params.aspect, 1.0);
  let radians = params.angle * 0.017453292;
  let direction = vec2f(cos(radians), sin(radians));
  // Project onto the sweep direction and normalize by the layer's extent along it.
  let extent = 0.5 * (abs(direction.x) * params.aspect + abs(direction.y));
  let along = dot(centered, direction) / max(extent, 1e-4);
  // position 0..1 sweeps the band from fully outside one side to fully outside the other.
  let halfWidth = max(params.width, 1e-4);
  let center = mix(-1.0 - halfWidth, 1.0 + halfWidth, params.position);
  let softness = clamp(params.softness, 0.0, 1.0);
  let pixel = params.pixelSize / max(extent, 1e-4);
  let distanceToCenter = abs(along - center);
  var band: f32;
  if (params.plateau > 0.5) {
    // Saved before 2026-10: flat top, Softness fades the outer part of the width.
    let soft = max(halfWidth * softness, pixel);
    band = 1.0 - smoothstep(halfWidth - soft, halfWidth, distanceToCenter);
  } else {
    // Falloff from the centre: exp(-4.5 t^p) with p = 2 / Softness, so Softness 1 is a Gaussian
    // (Width is where the light has faded out) and lower Softness flattens the top toward a hard
    // band. The curve is lowered by its value at Width (exp(-4.5), 1.1 % of the peak) and scaled
    // back to 1 in the middle, so a soft band fades to nothing instead of ending in a faint step
    // (a visible seam on skies at high Intensity); the band edge gets one pixel of anti-aliasing.
    let t = min(distanceToCenter / halfWidth, 2.0);
    let shape = 2.0 / max(softness, 0.02);
    let edge = min(pixel / halfWidth, 1.0);
    let rim = 0.011108997; // exp(-4.5)
    let falloff = max(exp(-4.5 * pow(t, shape)) - rim, 0.0) / (1.0 - rim);
    band = falloff * (1.0 - smoothstep(1.0 - edge, 1.0, t));
  }
  // Highlights: the light catches bright surfaces more than dark voids (luma weight).
  let luma = dot(clamp(color.rgb, vec3f(0.0), vec3f(1.0)), vec3f(0.2126, 0.7152, 0.0722));
  let catchLight = mix(1.0, luma, clamp(params.highlights, 0.0, 1.0));
  let light = params.color.rgb * band * max(params.intensity, 0.0) * params.color.a * catchLight;
  // Soft additive highlight: c + light for a faint sheen, approaching white without a flat
  // clipped plateau, so the layer's own detail stays visible inside a strong band.
  let headroom = max(vec3f(1.0) - color.rgb, vec3f(1e-4));
  let lit = vec3f(1.0) - headroom * exp(-light / headroom);
  return vec4f(select(color.rgb, lit, color.rgb < vec3f(1.0)), color.a);
}
