// Glow Effect Shader - High Quality Multi-Ring Blur

struct GlowParams {
  amount: f32,
  threshold: f32,
  radius: f32,
  softness: f32,
  width: f32,
  height: f32,
  rings: f32,
  samplesPerRing: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GlowParams;

@fragment
fn glowFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);

  // Multi-ring gaussian blur for glow
  var glow = vec3f(0.0);
  var totalWeight = 0.0;

  // Direct control over rings and samples
  let rings = i32(clamp(params.rings, 1.0, 32.0));
  let samplesPerRing = i32(clamp(params.samplesPerRing, 4.0, 64.0));

  for (var ring = 1; ring <= rings; ring++) {
    let ringRadius = f32(ring) * params.radius * 10.0;
    let ringWeight = gaussian(f32(ring) / f32(rings), params.softness + 0.3);

    for (var i = 0; i < samplesPerRing; i++) {
      let angle = f32(i) * TAU / f32(samplesPerRing) + f32(ring) * 0.5; // Offset each ring
      let offset = vec2f(cos(angle), sin(angle)) * texelSize * ringRadius;

      let sampleColor = textureSample(inputTex, texSampler, input.uv + offset);
      let sampleLuma = luminance(sampleColor.rgb);

      // Soft threshold with smoothstep
      let brightFactor = smoothstep(params.threshold - 0.1, params.threshold + 0.1, sampleLuma);
      let brightColor = sampleColor.rgb * sampleColor.a * brightFactor;

      glow += brightColor * ringWeight;
      totalWeight += ringWeight;
    }
  }

  // Also sample center
  let centerLuma = luminance(color.rgb);
  let centerBright = smoothstep(params.threshold - 0.1, params.threshold + 0.1, centerLuma);
  glow += color.rgb * color.a * centerBright * 2.0;
  totalWeight += 2.0;

  glow /= totalWeight;

  // Combine: original + glow (additive)
  let halo = glow * params.amount * 2.0;
  let coverage = clamp(max(halo.r, max(halo.g, halo.b)), 0.0, 1.0);
  let alpha = color.a + coverage * (1.0 - color.a);
  let result = (color.rgb * color.a + halo) / max(alpha, 0.000001);
  return vec4f(clamp(result, vec3f(0.0), vec3f(1.0)), alpha);
}
