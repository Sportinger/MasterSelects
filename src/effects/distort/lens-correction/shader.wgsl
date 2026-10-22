struct LensCorrectionParams {
  distortion: f32, fineDistortion: f32, scale: f32, aspect: f32,
  centerX: f32, centerY: f32, redFringe: f32, blueFringe: f32,
  vignette: f32, midpoint: f32, cropFactor: f32, kneeRadius: f32,
  distortionProfile: vec4f,
  tcaProfile: vec4f,
  vignetteProfile: vec4f,
  // Source radius and slope at kneeRadius (lensFrameFit.lensKnee); unused when kneeRadius is huge.
  knee: vec4f,
};
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: LensCorrectionParams;

// Soft coverage of the source frame: one source pixel wide, so curved borders do not stair-step.
fn lensInside(uv: vec2f) -> f32 {
  let size = vec2f(textureDimensions(inputTex));
  let low = uv * size;
  let high = (vec2f(1.0) - uv) * size;
  return clamp(min(min(low.x, low.y), min(high.x, high.y)) + 0.5, 0.0, 1.0);
}

fn lensLinear(color: vec3f) -> vec3f {
  return select(pow((color + 0.055) / 1.055, vec3f(2.4)), color / 12.92, color <= vec3f(0.04045));
}
fn lensSrgb(color: vec3f) -> vec3f {
  return select(1.055 * pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055,
    color * 12.92, color <= vec3f(0.0031308));
}

@fragment
fn lensCorrectionFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  // Radial distance in image-height units, normalized to the centered corner.
  let aspect = vec2f(params.aspect, 1.0);
  let radiusScale = 2.0 / length(aspect);
  let delta = (input.uv - center) * aspect * radiusScale / params.scale;
  let r2 = dot(delta, delta);
  let outputRadius = length(delta);
  // Full-frame 3:2 calibration uses half the short sensor side for PTLens/TCA.
  let profileRadius = outputRadius * 1.80277564 / params.cropFactor;
  let terms = params.distortionProfile;
  let measured = 1.0 + terms.w * (terms.x * pow(profileRadius, 3.0) + terms.y * profileRadius * profileRadius + terms.z * profileRadius);
  let polynomial = max(0.05, measured * (1.0 + params.distortion * r2 + params.fineDistortion * r2 * r2));
  // Beyond the knee (strong barrel removal) the mapping continues in a straight line instead of folding back,
  // so the outer picture stays visible and never mirrors (lensFrameFit.lensSourceRadius).
  let line = (params.knee.x + params.knee.y * (outputRadius - params.kneeRadius)) / max(outputRadius, 1e-6);
  let radial = select(polynomial, line, outputRadius > params.kneeRadius);
  let sourceDelta = delta * radial / (aspect * radiusScale);
  let uv = center + sourceDelta;
  let tcaRadius2 = profileRadius * profileRadius * radial * radial;
  let redUv = center + sourceDelta * (params.tcaProfile.y + params.tcaProfile.x * tcaRadius2) * (1.0 + params.redFringe);
  let blueUv = center + sourceDelta * (params.tcaProfile.w + params.tcaProfile.z * tcaRadius2) * (1.0 + params.blueFringe);
  // Explicit LOD allows transparent borders without derivative control-flow restrictions.
  let base = textureSampleLevel(inputTex, texSampler, uv, 0.0);
  let red = textureSampleLevel(inputTex, texSampler, redUv, 0.0);
  let blue = textureSampleLevel(inputTex, texSampler, blueUv, 0.0);
  let start = params.midpoint * 0.95;
  let falloff = smoothstep(start, 1.0, length(delta));
  // Positive amount lifts dark lens corners; negative amount darkens them.
  let gain = exp2(2.0 * params.vignette * falloff);
  // Fringe channels sample the clamped border instead of turning black, so no coloured line runs along the frame.
  let rgb = vec3f(red.r, base.g, blue.b);
  // PA vignetting uses the source sensor corner radius and acts on linear light.
  let vignetteR2 = r2 * radial * radial / (params.cropFactor * params.cropFactor);
  let v = params.vignetteProfile;
  let attenuation = max(0.05, 1.0 + v.x * vignetteR2 + v.y * vignetteR2 * vignetteR2 + v.z * pow(vignetteR2, 3.0));
  let corrected = select(rgb, lensSrgb(lensLinear(rgb) / attenuation), v.w > 0.5);
  return vec4f(corrected * gain, base.a * lensInside(uv));
}
