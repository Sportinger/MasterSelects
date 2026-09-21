struct ComputeParams {
  resolution: vec2f,
  amount: f32,
  scale: f32,
  threshold: f32,
  time: f32,
  speed: f32,
  variant: f32,
  colorA: vec4f,
  colorB: vec4f,
};

@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ComputeParams;
@group(0) @binding(5) var outputTex: texture_storage_2d<rgba8unorm, write>;

fn random2(cell: vec2f) -> vec2f {
  let x = fract(sin(dot(cell, vec2f(127.1, 311.7))) * 43758.5453);
  let y = fract(sin(dot(cell, vec2f(269.5, 183.3))) * 43758.5453);
  return vec2f(x, y);
}

fn luma(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn loadClamped(pixel: vec2i) -> vec4f {
  let maximum = vec2i(params.resolution) - 1;
  return textureLoad(inputTex, clamp(pixel, vec2i(0), maximum), 0);
}

fn tonePixel(pixel: vec2i) -> f32 {
  return luma(loadClamped(pixel).rgb);
}

fn blockVariance(origin: vec2i, size: i32) -> f32 {
  let half = max(1, size / 2);
  let a = tonePixel(origin);
  let b = tonePixel(origin + vec2i(size - 1, 0));
  let c = tonePixel(origin + vec2i(0, size - 1));
  let d = tonePixel(origin + vec2i(size - 1, size - 1));
  let e = tonePixel(origin + vec2i(half, half));
  let mean = (a + b + c + d + e) / 5.0;
  return ((a - mean) * (a - mean) + (b - mean) * (b - mean)
    + (c - mean) * (c - mean) + (d - mean) * (d - mean)
    + (e - mean) * (e - mean)) / 5.0;
}

@compute @workgroup_size(8, 8)
fn quadtreeZoomCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(params.resolution.x) || invocation.y >= u32(params.resolution.y)) { return; }
  let pixel = vec2i(invocation.xy);
  let minimumSize = max(2, i32(round(params.scale)));
  let pulse = 0.82 + 0.18 * sin(params.time * params.speed * 2.0);
  var blockSize = minimumSize * 32;
  for (var level = 0; level < 6; level += 1) {
    let origin = (pixel / blockSize) * blockSize;
    if (blockSize <= minimumSize || blockVariance(origin, blockSize) <= params.threshold * pulse) { break; }
    blockSize = max(minimumSize, blockSize / 2);
  }
  let origin = (pixel / blockSize) * blockSize;
  let center = origin + vec2i(blockSize / 2);
  let sampled = loadClamped(center);
  let local = pixel - origin;
  let border = select(0.0, 1.0, local.x == 0 || local.y == 0);
  let styled = sampled.rgb * (0.82 + 0.18 * border);
  let original = loadClamped(pixel);
  textureStore(outputTex, pixel, vec4f(mix(original.rgb, styled, params.amount), original.a));
}

fn edgePosition(a: f32, b: f32) -> f32 {
  return clamp((params.threshold - a) / max(abs(b - a), 0.00001), 0.0, 1.0);
}

fn segmentDistance(point: vec2f, start: vec2f, finish: vec2f) -> f32 {
  let segment = finish - start;
  let along = clamp(dot(point - start, segment) / max(dot(segment, segment), 0.00001), 0.0, 1.0);
  return length(point - (start + segment * along));
}

@compute @workgroup_size(8, 8)
fn marchingSquaresCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(params.resolution.x) || invocation.y >= u32(params.resolution.y)) { return; }
  let pixel = vec2i(invocation.xy);
  let cellSize = max(4, i32(round(params.scale)));
  let origin = (pixel / cellSize) * cellSize;
  let tl = tonePixel(origin);
  let tr = tonePixel(origin + vec2i(cellSize, 0));
  let br = tonePixel(origin + vec2i(cellSize, cellSize));
  let bl = tonePixel(origin + vec2i(0, cellSize));
  let top = vec2f(edgePosition(tl, tr), 0.0);
  let right = vec2f(1.0, edgePosition(tr, br));
  let bottom = vec2f(edgePosition(bl, br), 1.0);
  let left = vec2f(0.0, edgePosition(tl, bl));
  let topology = imageMarchingSquaresTopology(vec4f(step(params.threshold, tl), step(params.threshold, tr),
    step(params.threshold, br), step(params.threshold, bl)), top, right, bottom, left);
  let local = vec2f(pixel - origin) / f32(cellSize);
  var distance = 10.0;
  if (topology.count > 0u) { distance = segmentDistance(local, topology.a, topology.b); }
  if (topology.count > 1u) { distance = min(distance, segmentDistance(local, topology.c, topology.d)); }
  let line = 1.0 - smoothstep(0.035, 0.1, distance);
  let original = loadClamped(pixel);
  let contourColor = mix(params.colorB.rgb, params.colorA.rgb, line);
  textureStore(outputTex, pixel, vec4f(mix(original.rgb, contourColor, params.amount), original.a));
}

@compute @workgroup_size(8, 8)
fn pixelSortCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(params.resolution.x) || invocation.y >= u32(params.resolution.y)) { return; }
  let segmentSize = max(4, min(16, i32(round(params.scale))));
  let segmentStart = i32(invocation.x) - i32(invocation.x) % segmentSize;
  var colors: array<vec4f, 16>;
  for (var index = 0; index < 16; index = index + 1) {
    let sourceIndex = min(index, segmentSize - 1);
    colors[index] = loadClamped(vec2i(segmentStart + sourceIndex, i32(invocation.y)));
  }
  colors = imageStableSort16ByRec709(colors);
  let localIndex = min(15, i32(invocation.x) - segmentStart);
  let original = loadClamped(vec2i(invocation.xy));
  let sorted = colors[localIndex];
  let eligible = step(params.threshold, luma(original.rgb));
  textureStore(outputTex, vec2i(invocation.xy), vec4f(mix(original.rgb, sorted.rgb, params.amount * eligible), original.a));
}

// Jump-flood resources use a dedicated pipeline layout. A valid seed stores
// pixel coordinates in xy and 1 in z; invalid pixels store a negative z.
@group(0) @binding(3) var seedInput: texture_2d<f32>;
@group(0) @binding(4) var seedOutput: texture_storage_2d<rgba16float, write>;

struct JumpStep {
  distance: f32,
  _padding: vec3f,
};
@group(0) @binding(7) var<uniform> jump: JumpStep;

@compute @workgroup_size(8, 8)
fn voronoiSeedCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(params.resolution.x) || invocation.y >= u32(params.resolution.y)) { return; }
  let pixel = vec2i(invocation.xy);
  let cellSize = max(4.0, params.scale);
  let cell = floor(vec2f(pixel) / cellSize);
  let jitter = random2(cell);
  let motion = 0.14 * sin(params.time * params.speed + jitter * 6.2831853);
  let seed = vec2i(clamp((cell + clamp(jitter + motion, vec2f(0.08), vec2f(0.92))) * cellSize, vec2f(0.0), params.resolution - 1.0));
  let value = select(vec4f(-1.0), vec4f(vec2f(seed), 1.0, 0.0), all(pixel == seed));
  textureStore(seedOutput, pixel, value);
}

@compute @workgroup_size(8, 8)
fn voronoiJumpCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(params.resolution.x) || invocation.y >= u32(params.resolution.y)) { return; }
  let pixel = vec2i(invocation.xy);
  let maximum = vec2i(params.resolution) - 1;
  let stepSize = i32(jump.distance);
  var closest = vec4f(-1.0);
  var closestDistance = 1e20;
  for (var y = -1; y <= 1; y += 1) {
    for (var x = -1; x <= 1; x += 1) {
      let candidate = textureLoad(seedInput, clamp(pixel + vec2i(x, y) * stepSize, vec2i(0), maximum), 0);
      if (candidate.z > 0.0) {
        let distance = dot(candidate.xy - vec2f(pixel), candidate.xy - vec2f(pixel));
        if (distance < closestDistance) {
          closest = candidate;
          closestDistance = distance;
        }
      }
    }
  }
  textureStore(seedOutput, pixel, closest);
}

@compute @workgroup_size(8, 8)
fn voronoiResolveCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(params.resolution.x) || invocation.y >= u32(params.resolution.y)) { return; }
  let pixel = vec2i(invocation.xy);
  let maximum = vec2i(params.resolution) - 1;
  let seed = textureLoad(seedInput, pixel, 0);
  let rightSeed = textureLoad(seedInput, clamp(pixel + vec2i(1, 0), vec2i(0), maximum), 0);
  let downSeed = textureLoad(seedInput, clamp(pixel + vec2i(0, 1), vec2i(0), maximum), 0);
  let valid = seed.z > 0.0;
  let sourcePixel = vec2i(select(vec2f(pixel), seed.xy, valid));
  let sampled = loadClamped(sourcePixel);
  let original = loadClamped(pixel);
  let border = select(0.0, 1.0, any(abs(seed.xy - rightSeed.xy) > vec2f(0.5)) || any(abs(seed.xy - downSeed.xy) > vec2f(0.5)));
  let styled = sampled.rgb * (0.82 + 0.18 * border);
  textureStore(outputTex, pixel, vec4f(mix(original.rgb, styled, params.amount), original.a));
}
