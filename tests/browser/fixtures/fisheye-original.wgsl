// Projection-correct fisheye / defisheye effect with optional optical artifacts.

struct FisheyeParams {
  strength: f32,
  fieldOfView: f32,
  radius: f32,
  zoom: f32,
  centerX: f32,
  centerY: f32,
  squeeze: f32,
  rotation: f32,
  frameAspect: f32,
  projection: f32,
  edgeMode: f32,
  outsideMode: f32,
  feather: f32,
  edgeFeather: f32,
  chromaticAberration: f32,
  vignette: f32,
  vignetteSoftness: f32,
  samples: f32,
  preserveAspect: f32,
  curveBias: f32,
  texelSizeX: f32,
  texelSizeY: f32,
  _padding0: f32,
  _padding1: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: FisheyeParams;

fn rotate2d(value: vec2f, angle: f32) -> vec2f {
  let sine = sin(angle);
  let cosine = cos(angle);
  return vec2f(
    value.x * cosine - value.y * sine,
    value.x * sine + value.y * cosine,
  );
}

fn uvToLensSpace(uv: vec2f) -> vec2f {
  var delta = uv - vec2f(params.centerX, params.centerY);
  if (params.preserveAspect > 0.5) {
    delta.x *= params.frameAspect;
  }
  delta = rotate2d(delta, -params.rotation);
  delta.x *= params.squeeze;
  return delta / max(params.radius * 0.5, 0.0001);
}

fn lensSpaceToUv(lensPosition: vec2f) -> vec2f {
  var delta = lensPosition * max(params.radius * 0.5, 0.0001);
  delta.x /= max(params.squeeze, 0.0001);
  delta = rotate2d(delta, params.rotation);
  if (params.preserveAspect > 0.5) {
    delta.x /= max(params.frameAspect, 0.0001);
  }
  return vec2f(params.centerX, params.centerY) + delta;
}

fn projectionRadius(theta: f32, maxTheta: f32) -> f32 {
  if (params.projection < 0.5) {
    return theta / max(maxTheta, 0.0001);
  }
  if (params.projection < 1.5) {
    return sin(theta * 0.5) / max(sin(maxTheta * 0.5), 0.0001);
  }
  if (params.projection < 2.5) {
    return tan(theta * 0.5) / max(tan(maxTheta * 0.5), 0.0001);
  }
  return sin(theta) / max(sin(maxTheta), 0.0001);
}

fn inverseProjectionRadius(radius: f32, maxTheta: f32) -> f32 {
  if (params.projection < 0.5) {
    return radius * maxTheta;
  }
  if (params.projection < 1.5) {
    return 2.0 * asin(clamp(radius * sin(maxTheta * 0.5), -1.0, 1.0));
  }
  if (params.projection < 2.5) {
    return 2.0 * atan(radius * tan(maxTheta * 0.5));
  }
  return asin(clamp(radius * sin(maxTheta), -1.0, 1.0));
}

fn mappedLensRadius(radius: f32) -> f32 {
  let maxTheta = clamp(params.fieldOfView * 0.5, 0.01, PI * 0.4861);
  let rectilinearScale = max(tan(maxTheta), 0.0001);
  var targetRadius = radius;

  if (params.strength >= 0.0) {
    let theta = inverseProjectionRadius(radius, maxTheta);
    targetRadius = tan(theta) / rectilinearScale;
  } else {
    let theta = atan(radius * rectilinearScale);
    targetRadius = projectionRadius(theta, maxTheta);
  }

  let direction = select(-1.0, 1.0, params.strength >= 0.0);
  let curveDelta = (radius * radius * radius - radius) * 0.35;
  targetRadius = max(0.0, targetRadius + params.curveBias * direction * curveDelta);
  return mix(radius, targetRadius, abs(params.strength)) / max(params.zoom, 0.0001);
}

fn mirrorCoordinate(value: f32) -> f32 {
  let wrapped = fract(value * 0.5) * 2.0;
  return 1.0 - abs(wrapped - 1.0);
}

fn edgeAdjustedUv(uv: vec2f) -> vec2f {
  if (params.edgeMode < 1.5) {
    return clamp(uv, vec2f(0.0), vec2f(1.0));
  }
  if (params.edgeMode < 2.5) {
    return vec2f(mirrorCoordinate(uv.x), mirrorCoordinate(uv.y));
  }
  return fract(uv);
}

fn sampleWithEdges(uv: vec2f) -> vec4f {
  let color = textureSample(inputTex, texSampler, edgeAdjustedUv(uv));
  if (params.edgeMode >= 0.5) {
    return color;
  }

  let insideDistance = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  if (params.edgeFeather <= 0.00001) {
    return color * select(0.0, 1.0, insideDistance >= 0.0);
  }
  return color * smoothstep(0.0, params.edgeFeather, insideDistance);
}

fn lensCoverage(radius: f32) -> f32 {
  if (params.feather <= 0.00001) {
    return select(0.0, 1.0, radius <= 1.0);
  }
  return 1.0 - smoothstep(max(0.0, 1.0 - params.feather), 1.0, radius);
}

fn renderFisheyeSample(outputUv: vec2f) -> vec4f {
  let lensPosition = uvToLensSpace(outputUv);
  let radius = length(lensPosition);
  let safeRadius = max(radius, 0.000001);
  let direction = lensPosition / safeRadius;
  let sampleRadius = mappedLensRadius(radius);
  let chromaShift = params.chromaticAberration * radius * radius;

  var lensColor: vec4f;
  if (params.chromaticAberration <= 0.000001) {
    lensColor = sampleWithEdges(lensSpaceToUv(direction * sampleRadius));
  } else {
    let red = sampleWithEdges(lensSpaceToUv(direction * sampleRadius * (1.0 + chromaShift)));
    let green = sampleWithEdges(lensSpaceToUv(direction * sampleRadius));
    let blue = sampleWithEdges(lensSpaceToUv(direction * sampleRadius * (1.0 - chromaShift)));
    lensColor = vec4f(red.r, green.g, blue.b, (red.a + green.a + blue.a) / 3.0);
  }

  let vignetteStart = max(0.0, 1.0 - params.vignetteSoftness);
  let vignetteMask = smoothstep(vignetteStart, 1.0, radius);
  lensColor = vec4f(
    lensColor.rgb * (1.0 - params.vignette * vignetteMask),
    lensColor.a,
  );

  let originalColor = textureSample(inputTex, texSampler, outputUv);
  let outsideColor = select(originalColor, vec4f(0.0), params.outsideMode > 0.5);
  return mix(outsideColor, lensColor, lensCoverage(radius));
}

fn sampleJitter(index: u32, count: u32) -> vec2f {
  if (count <= 1u) { return vec2f(0.0); }
  switch index {
    case 0u: { return vec2f(-0.375, -0.125); }
    case 1u: { return vec2f(0.125, -0.375); }
    case 2u: { return vec2f(0.375, 0.125); }
    case 3u: { return vec2f(-0.125, 0.375); }
    case 4u: { return vec2f(-0.4375, 0.3125); }
    case 5u: { return vec2f(-0.3125, -0.4375); }
    case 6u: { return vec2f(0.4375, -0.3125); }
    default: { return vec2f(0.3125, 0.4375); }
  }
}

@fragment
fn fisheyeFragment(input: VertexOutput) -> @location(0) vec4f {
  let sampleTotal = u32(clamp(round(params.samples), 1.0, 8.0));
  var accumulated = vec4f(0.0);
  for (var sampleIndex = 0u; sampleIndex < 8u; sampleIndex += 1u) {
    if (sampleIndex < sampleTotal) {
      let jitter = sampleJitter(sampleIndex, sampleTotal)
        * vec2f(params.texelSizeX, params.texelSizeY);
      accumulated += renderFisheyeSample(input.uv + jitter);
    }
  }
  return accumulated / f32(sampleTotal);
}
