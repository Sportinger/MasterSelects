// Acuarela - feedback-driven watercolor smoke.

struct AcuarelaParams {
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
  pad0: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: AcuarelaParams;
@group(0) @binding(3) var feedbackTex: texture_2d<f32>;

fn acuarelaNoiseVector(p: vec2f, t: f32) -> vec2f {
  let n1 = noise2d(p + vec2f(t * 0.19, t * 0.31));
  let n2 = noise2d(p * 1.173 + vec2f(19.17 - t * 0.27, 7.31 + t * 0.16));
  return vec2f(n1, n2) * 2.0 - vec2f(1.0);
}

fn acuarelaFbm(p: vec2f, t: f32) -> vec2f {
  let octaveCount = 4;
  var sum = vec2f(0.0);
  var amplitude = 0.5;
  var frequency = 1.0;
  var normalizer = 0.0;

  for (var i = 0; i < 8; i++) {
    if (i < octaveCount) {
      let octaveTime = t + f32(i) * 13.37;
      sum += acuarelaNoiseVector(p * frequency, octaveTime) * amplitude;
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

fn acuarelaEdgeMask(uv: vec2f) -> f32 {
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  return smoothstep(-0.005, 0.025, edge);
}

fn acuarelaScreen(base: vec3f, blend: vec3f) -> vec3f {
  return vec3f(1.0) - (vec3f(1.0) - base) * (vec3f(1.0) - blend);
}

@fragment
fn acuarelaFragment(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTex, texSampler, input.uv);

  let density = max(params.density, 0.001);
  let frequency = max(params.detail, 0.001);
  let speed = max(params.speed, 0.0);
  let drivenTime = params.time * speed * 0.75;
  let noiseUv = input.uv * density * frequency;
  var offset = acuarelaFbm(noiseUv, drivenTime);
  offset *= vec2f(params.gainX, -params.gainY) * params.strength * 0.024;

  let warpedUv = input.uv + offset;
  let feedbackSampleUv = clamp(warpedUv, vec2f(0.0), vec2f(1.0));
  let feedback = textureSample(feedbackTex, texSampler, feedbackSampleUv) * acuarelaEdgeMask(warpedUv);
  let wetSource = textureSample(inputTex, texSampler, feedbackSampleUv);
  let smearA = textureSample(inputTex, texSampler, clamp(input.uv + offset * 0.45, vec2f(0.0), vec2f(1.0)));
  let smearB = textureSample(inputTex, texSampler, clamp(input.uv - offset * 0.65, vec2f(0.0), vec2f(1.0)));
  let smearC = textureSample(inputTex, texSampler, clamp(input.uv + vec2f(-offset.y, offset.x) * 0.5, vec2f(0.0), vec2f(1.0)));

  let gain = max(params.gain, 0.0) * 0.35;
  let liftedSource = vec4f(
    clamp(source.rgb + vec3f(gain) * source.a, vec3f(0.0), vec3f(1.0)),
    source.a
  );

  let feedbackDecay = 0.98;
  let delayedRgb = clamp(feedback.rgb * feedbackDecay, vec3f(0.0), vec3f(1.0));
  let washRgb = (wetSource.rgb + smearA.rgb + smearB.rgb + smearC.rgb) * 0.25;
  let warpMix = clamp(params.strength * 0.92, 0.0, 0.92);
  let warpedCurrentRgb = mix(liftedSource.rgb, washRgb, warpMix);
  let feedbackMix = clamp(params.strength * 0.1 + params.opacity * 0.04, 0.0, 0.14);
  let memoryRgb = mix(warpedCurrentRgb, delayedRgb, feedbackMix);
  let paperLimit = max(source.rgb, washRgb) + vec3f(0.1 + gain * 2.0);
  let waterRgb = min(memoryRgb, paperLimit);
  let waterAlpha = clamp(max(liftedSource.a, feedback.a * feedbackDecay), 0.0, 1.0);
  let water = vec4f(waterRgb, waterAlpha);

  return mix(source, water, clamp(params.opacity, 0.0, 1.0));
}
