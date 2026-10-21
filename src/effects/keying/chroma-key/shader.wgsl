// Chroma Key core (single pass, fixed screen colour; not rendered by the editor). The editable graph
// adds the automatic screen colour, screen subtraction, Edge Softness, Shrink/Grow and the View choice.
// Contract: keyerContract.ts.

struct ChromaKeyParams {
  screen: vec4f,   // straight screen colour (rgb)
  channel: vec4f,  // one-hot screen channel (rgb)
  clipBlack: f32,
  clipWhite: f32,
  spill: f32,
  gentleSpill: f32, // 0 Neutral (limit = mean of the other channels), 1 Gentle (limit = strongest other)
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ChromaKeyParams;

// (primary channel, strongest other channel, mean of the other two) of a colour.
fn screenParts(rgb: vec3f) -> vec3f {
  let c = max(rgb, vec3f(0.0));
  let primary = max(max(c.r * params.channel.r, c.g * params.channel.g), c.b * params.channel.b);
  let others = c * (vec3f(1.0) - params.channel.rgb);
  return vec3f(primary, max(max(others.r, others.g), others.b), 0.5 * (others.r + others.g + others.b));
}

@fragment
fn chromaKeyFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let screen = screenParts(params.screen.rgb);
  let pixel = screenParts(color.rgb);
  let screenDifference = max(screen.x - screen.y, 1e-4);
  // A grey screen colour keys nothing (keyerContract.ts: purity 0.06..0.12).
  let found = smoothstep(0.06, 0.12, (screen.x - screen.y) / max(screen.x, 1e-4));
  // Pixels darker than the screen compare purity (difference / primary), brighter ones the difference.
  let brightness = max(clamp(pixel.x, 0.25 * screen.x, screen.x), 1e-4);
  let transparency = clamp((pixel.x - pixel.y) * screen.x / (screenDifference * brightness) * found, 0.0, 1.0);
  let raw = 1.0 - transparency;
  let clipBlack = clamp(params.clipBlack, 0.0, 1.0);
  let matte = clamp((raw - clipBlack) / max(clamp(params.clipWhite, 0.0, 1.0) - clipBlack, 1e-3), 0.0, 1.0);
  let limit = mix(pixel.z, pixel.y, step(0.5, params.gentleSpill));
  let excess = max(pixel.x - limit, 0.0) * clamp(params.spill, 0.0, 1.0) * found;
  return vec4f(color.rgb - params.channel.rgb * excess, color.a * matte);
}
