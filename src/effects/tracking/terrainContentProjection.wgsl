struct ProjectionParams {
  r0: vec4f, r1: vec4f, r2: vec4f, k: vec4f, lens: vec4f,
  origin: vec4f, axisX: vec4f, axisY: vec4f, normal: vec4f,
  placement: vec4f, options: vec4f, bounds: vec4f, heights: vec4f,
  foreground: array<vec4f, 8>,
  sourceRow0: vec4f, sourceRow1: vec4f, sourceRow2: vec4f,
  contentBounds: vec4f,
}

@group(0) @binding(0) var<uniform> p: ProjectionParams;
@group(0) @binding(1) var projectionSampler: sampler;
@group(0) @binding(2) var background: texture_2d<f32>;
@group(0) @binding(3) var content: texture_2d<f32>;
@group(0) @binding(4) var terrainDepth: texture_depth_2d;

struct ProjectionOutput {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
}

fn terrainGround(world: vec3f) -> vec3f {
  let delta = world - p.origin.xyz;
  return vec3f(dot(delta, p.axisX.xyz), dot(delta, p.axisY.xyz), dot(delta, p.normal.xyz));
}

@vertex fn terrainProjectionVertex(@location(0) world: vec3f) -> ProjectionOutput {
  let cameraPoint = vec3f(
    dot(p.r0.xyz, world) + p.r0.w,
    dot(p.r1.xyz, world) + p.r1.w,
    dot(p.r2.xyz, world) + p.r2.w,
  );
  let normalized = cameraPoint.xy / cameraPoint.z;
  let sourceImage = normalized * (1.0 + p.lens.z * dot(normalized, normalized)) * p.k.xy + p.k.zw;
  let sourcePoint = vec3f(sourceImage, 1.0);
  let sourceDenominator = dot(p.sourceRow2.xyz, sourcePoint);
  let image = vec2f(dot(p.sourceRow0.xyz, sourcePoint), dot(p.sourceRow1.xyz, sourcePoint)) / sourceDenominator;
  return ProjectionOutput(
    vec4f((image.x * 2.0 - 1.0) * cameraPoint.z, (1.0 - image.y * 2.0) * cameraPoint.z, cameraPoint.z - 0.001, cameraPoint.z),
    world,
  );
}

@vertex fn terrainProjectionShadowVertex(@location(0) world: vec3f) -> @builtin(position) vec4f {
  let ground = terrainGround(world);
  let uv = (ground.xy - p.bounds.xy) / p.bounds.zw;
  return vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, (p.heights.y - ground.z) / p.heights.z, 1.0);
}

@vertex fn terrainProjectionCopyVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let vertices = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(vertices[index], 0.0, 1.0);
}

fn projectionCross(left: vec2f, right: vec2f) -> f32 {
  return left.x * right.y - left.y * right.x;
}

fn projectionInsideQuad(uv: vec2f, ab: vec4f, cd: vec4f) -> bool {
  let a = ab.xy;
  let b = ab.zw;
  let c = cd.xy;
  let d = cd.zw;
  let edges = vec4f(projectionCross(b - a, uv - a), projectionCross(c - b, uv - b), projectionCross(d - c, uv - c), projectionCross(a - d, uv - d));
  return all(edges >= vec4f(0.0)) || all(edges <= vec4f(0.0));
}

fn projectionOccluded(uv: vec2f) -> bool {
  for (var index = 0u; index < u32(p.options.z); index++) {
    if (projectionInsideQuad(uv, p.foreground[index * 2u], p.foreground[index * 2u + 1u])) {
      return true;
    }
  }
  return false;
}

@fragment fn terrainProjectionCopyFragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return textureSampleLevel(background, projectionSampler, position.xy / p.lens.xy, 0.0);
}

@fragment fn terrainProjectionFragment(input: ProjectionOutput) -> @location(0) vec4f {
  let screen = input.position.xy / p.lens.xy;
  let original = textureSampleLevel(background, projectionSampler, screen, 0.0);
  let ground = terrainGround(input.world);
  let delta = ground.xy - p.placement.xy;
  let cosine = cos(p.options.x);
  let sine = sin(p.options.x);
  let uv = vec2f(cosine * delta.x + sine * delta.y, -sine * delta.x + cosine * delta.y) / p.placement.zw + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) {
    return original;
  }
  let shadowUv = (ground.xy - p.bounds.xy) / p.bounds.zw;
  let shadowSize = vec2i(textureDimensions(terrainDepth));
  let shadowPixel = clamp(vec2i(shadowUv * vec2f(shadowSize)), vec2i(0), shadowSize - 1);
  // A single quantized ground-space texel causes severe self-shadowing on a
  // sloped/noisy reconstruction. The deepest value in the immediate footprint
  // is a conservative surface envelope: it keeps separated lower geometry out
  // while allowing the mesh that populated the shadow map to shade itself.
  var surfaceEnvelope = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let neighbor = clamp(shadowPixel + vec2i(x, y), vec2i(0), shadowSize - 1);
      surfaceEnvelope = max(surfaceEnvelope, textureLoad(terrainDepth, neighbor, 0));
    }
  }
  if ((p.heights.y - ground.z) / p.heights.z > surfaceEnvelope + 0.0015) {
    return original;
  }
  var sampleUv = uv;
  if (p.options.w > 0.5) {
    let contentSize = max(vec2f(textureDimensions(content)) * p.contentBounds.zw, vec2f(1.0));
    let contentAspect = contentSize.x / contentSize.y;
    let placementAspect = p.placement.z / p.placement.w;
    var fittedUv = uv;
    if (contentAspect > placementAspect) {
      fittedUv.y = (uv.y - 0.5) * contentAspect / placementAspect + 0.5;
    } else {
      fittedUv.x = (uv.x - 0.5) * placementAspect / contentAspect + 0.5;
    }
    if (any(fittedUv < vec2f(0.0)) || any(fittedUv > vec2f(1.0))) {
      return original;
    }
    sampleUv = p.contentBounds.xy + fittedUv * p.contentBounds.zw;
  }
  let sampled = textureSampleLevel(content, projectionSampler, sampleUv, 0.0);
  let alpha = select(sampled.a * p.options.y, 0.0, projectionOccluded(screen));
  return vec4f(mix(original.rgb, sampled.rgb, alpha), original.a + alpha * (1.0 - original.a));
}
