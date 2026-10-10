// Glow reference shader (three passes). The editable Glow operator graph owns
// rendering; this WGSL follows the same contract (glowSampling.ts) so GPU parity
// probes can check the generated passes against an independent implementation.
//
// 1. glowPrefilterHorizontal: bright pass (rgb * alpha * soft threshold) with a
//    horizontal Gaussian whose taps sit on texel boundaries two pixels apart.
// 2. glowPrefilterVertical: the same Gaussian along Y over pass 1 (bound as inputTex).
// 3. glowResolve: ring sampling of the prefiltered light (binding 3) with per-axis
//    pixel offsets, then a premultiplied additive resolve whose alpha carries the halo.
// glowFragment is the registered single-pass entry: the same rings and resolve
// without the prefilter, valid under the generic three-binding effect layout.

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

struct GlowSampling {
  rings: f32,
  samplesPerRing: f32,
  effectiveSamples: f32,
  ringStep: f32,
  sigma: f32,
  prefilterWidth: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GlowParams;
@group(0) @binding(3) var prefilteredTex: texture_2d<f32>;

fn glowSampling() -> GlowSampling {
  let rings = floor(clamp(params.rings, 1.0, 32.0));
  let samples = floor(clamp(params.samplesPerRing, 4.0, 64.0));
  let circumference = TAU * rings;
  // Enough samples per ring that the outer arc spacing stays within one ring step.
  let effective = min(max(samples, floor(circumference) + 1.0), 64.0);
  let ringStep = params.radius * 10.0;
  let spacing = abs(ringStep) * max(1.0, circumference / effective);
  let sigma = max(spacing * 0.5, 0.5);
  let taps = min(floor(sigma * 1.5) + 1.0, 32.0);
  return GlowSampling(rings, samples, effective, ringStep, sigma, taps * 2.0);
}

fn glowBright(color: vec4f) -> f32 {
  return smoothstep(params.threshold - 0.1, params.threshold + 0.1, luminance(color.rgb));
}

fn glowPrefilter(uv: vec2f, axis: vec2f, emit: bool) -> vec4f {
  let sampling = glowSampling();
  let resolution = vec2f(params.width, params.height);
  var sum = vec4f(0.0);
  var weightSum = 0.0;
  for (var i = 0; i < i32(sampling.prefilterWidth); i++) {
    let offsetPx = f32(i) * 2.0 - sampling.prefilterWidth + 0.5;
    var sampleColor = textureSample(inputTex, texSampler, uv + axis * offsetPx / resolution);
    if (emit) {
      sampleColor = sampleColor * glowBright(sampleColor) * sampleColor.a;
    }
    let weight = gaussian(offsetPx, sampling.sigma);
    sum += sampleColor * weight;
    weightSum += weight;
  }
  return sum / vec4f(weightSum);
}

@fragment
fn glowPrefilterHorizontal(input: VertexOutput) -> @location(0) vec4f {
  return glowPrefilter(input.uv, vec2f(1.0, 0.0), true);
}

@fragment
fn glowPrefilterVertical(input: VertexOutput) -> @location(0) vec4f {
  return glowPrefilter(input.uv, vec2f(0.0, 1.0), false);
}

// Rings over a light texture: the prefiltered light (glowResolve) or, for the
// single-pass entry, the bright pass evaluated directly on the source.
fn glowRings(uv: vec2f, color: vec4f, lightTex: texture_2d<f32>, emit: bool) -> vec4f {
  let sampling = glowSampling();
  let resolution = vec2f(params.width, params.height);
  // Each ring keeps its legacy total weight (samplesPerRing * ring weight).
  let share = sampling.samplesPerRing / sampling.effectiveSamples;

  var glow = vec3f(0.0);
  var totalWeight = 0.0;
  for (var ring = 1; ring <= i32(sampling.rings); ring++) {
    let weight = gaussian(f32(ring) / sampling.rings, params.softness + 0.3) * share;
    for (var i = 0; i < i32(sampling.effectiveSamples); i++) {
      let angle = f32(i) * TAU / sampling.effectiveSamples + f32(ring) * 0.5;
      // Pixel offsets converted per axis: round on non-square layers.
      let offset = vec2f(cos(angle), sin(angle)) * (f32(ring) * sampling.ringStep) / resolution;
      var light = textureSample(lightTex, texSampler, uv + offset);
      if (emit) {
        light = light * glowBright(light) * light.a;
      }
      glow += light.rgb * weight;
      totalWeight += weight;
    }
  }

  glow = (glow + color.rgb * glowBright(color) * color.a * 2.0) / (totalWeight + 2.0);

  // Premultiplied additive resolve; alpha grows just enough to carry the halo.
  let premultiplied = color.rgb * color.a + glow * params.amount * 2.0;
  let coverage = clamp(max(color.a, max(premultiplied.r, max(premultiplied.g, premultiplied.b))), 0.0, 1.0);
  return vec4f(clamp(premultiplied / max(coverage, 1e-6), vec3f(0.0), vec3f(1.0)), coverage);
}

// Pass 3 of the reference: rings over the prefiltered light bound at binding 3.
@fragment
fn glowResolve(input: VertexOutput) -> @location(0) vec4f {
  return glowRings(input.uv, textureSample(inputTex, texSampler, input.uv), prefilteredTex, false);
}

// Registered single-pass entry (bindings 0-2 only, so the generic effect layout can
// prewarm it): the same rings without the prefilter. Rendering uses the graph.
@fragment
fn glowFragment(input: VertexOutput) -> @location(0) vec4f {
  return glowRings(input.uv, textureSample(inputTex, texSampler, input.uv), inputTex, true);
}
