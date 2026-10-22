// Rom1 - frozen snapshot of the current feedback-driven watery smoke shader.

struct Rom1Params {
  opacity: f32,
  gain: f32,
  speed: f32,
  detail: f32,
  strength: f32,
  density: f32,
  gainX: f32,
  gainY: f32,
  width: f32,
  height: f32,
  time: f32,
  trail: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Rom1Params;
@group(0) @binding(3) var feedbackTex: texture_2d<f32>;

fn rom1NoiseVector(p: vec2f, t: f32) -> vec2f {
  let n1 = noise2d(p + vec2f(t * 0.071, t * 0.113));
  let n2 = noise2d(p * 1.173 + vec2f(19.17 - t * 0.097, 7.31 + t * 0.053));
  return vec2f(n1, n2) * 2.0 - vec2f(1.0);
}

fn rom1Fbm(p: vec2f, t: f32, detail: f32) -> vec2f {
  let octaveCount = 4;
  var sum = vec2f(0.0);
  var amplitude = 0.5;
  var frequency = 1.0;
  var normalizer = 0.0;

  for (var i = 0; i < 8; i++) {
    if (i < octaveCount) {
      let octaveTime = t + f32(i) * 13.37;
      sum += rom1NoiseVector(p * frequency, octaveTime) * amplitude;
      normalizer += amplitude;
      frequency *= 2.0;
      amplitude *= 0.53;
    }
  }

  if (normalizer <= 0.0) {
    return vec2f(0.0);
  }

  return sum / normalizer;
}

fn rom1EdgeMask(uv: vec2f) -> f32 {
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  return smoothstep(-0.005, 0.025, edge);
}

@fragment
fn rom1Fragment(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTex, texSampler, input.uv);

  let density = max(params.density, 0.001);
  let frequency = max(params.detail, 0.001);
  let noiseGain = max(params.speed, 0.001);
  let drivenTime = params.time;
  let noiseUv = input.uv * density * frequency;
  var offset = rom1Fbm(noiseUv, drivenTime, params.detail);
  offset *= vec2f(params.gainX, -params.gainY) * params.strength * 0.005 * noiseGain;

  let warpedUv = input.uv + offset;
  let feedbackSampleUv = clamp(warpedUv, vec2f(0.0), vec2f(1.0));
  let feedback = textureSample(feedbackTex, texSampler, feedbackSampleUv);
  let wetSource = textureSample(inputTex, texSampler, feedbackSampleUv);

  // Gain knee (smokeGainUpgrade.ts): unchanged up to 0.25, then eases toward 0.5 instead of lifting to white.
  let gainInput = max(params.gain, 0.0);
  let gain = min(gainInput, 0.25) + 0.25 * (1.0 - exp(0.0 - max(gainInput - 0.25, 0.0) / 0.25));

  // Premultiplied trail (2026-10-22): colour x alpha decays and keeps the brighter value, so smoke outside a
  // cut-out fades in alpha instead of turning dark. With alpha 1 everywhere this equals the straight recipe.
  let feedbackAlpha = feedback.a * rom1EdgeMask(warpedUv);
  let sourcePremultiplied = source.rgb * source.a;
  let liftedPremultiplied = clamp(
    mix(sourcePremultiplied, wetSource.rgb * wetSource.a, 0.18) + vec3f(gain) * source.a,
    vec3f(0.0),
    vec3f(source.a)
  );

  let feedbackDecay = clamp(params.trail, 0.0, 0.995);
  let waterPremultiplied = max(liftedPremultiplied, feedback.rgb * feedbackAlpha * feedbackDecay);
  let waterAlpha = clamp(max(source.a, feedbackAlpha * feedbackDecay), 0.0, 1.0);

  let opacity = clamp(params.opacity, 0.0, 1.0);
  let mixedPremultiplied = mix(sourcePremultiplied, waterPremultiplied, opacity);
  let mixedAlpha = mix(source.a, waterAlpha, opacity);
  return vec4f(clamp(mixedPremultiplied / max(mixedAlpha, 0.001), vec3f(0.0), vec3f(1.0)), mixedAlpha);
}
