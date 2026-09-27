import { RENDER_COMMON } from './flockRenderCommonWgsl';
import { POINT_BASE, POINT_RECORD } from './flockPointsWgsl';

export const FLOCK_RASTER_WORKGROUP = 256;

// Separate depth and identity atomics retain full float depth precision.
// Equal-depth fragments choose the last instance, matching less-equal sprites.
const COMMON = /* wgsl */ `
${RENDER_COMMON}
${POINT_BASE}
${POINT_RECORD}
struct RasterParams { width: u32, height: u32, count: u32, dispatchWidth: u32, };
@group(2) @binding(0) var<storage, read> pointCache: array<PointRecord>;
@group(3) @binding(1) var<uniform> raster: RasterParams;
const EMPTY: u32 = 0xffffffffu;

fn pointDiameter(index: u32) -> f32 {
  let parent = index / max(1u, u32(br.children));
  let rnd = select(stateCur[particleSlot(parent)].rnd, flockHash01(index, 911u), br.children > 1.0);
  return max(1.0, br.size * (1.0 + br.sizeVariance * (rnd * 2.0 - 1.0)) * rb.frame.viewport.y / 1080.0);
}

// Matches the opaque cutoff used by fsPoints, including square/ring/star shapes.
fn opaqueCoverage(uv: vec2f) -> bool {
  let d = length(uv);
  let shape = u32(br.shape);
  var a = 0.0;
  if (shape == 0u) { a = 1.0 - smoothstep(0.75, 1.0, d); }
  else if (shape == 1u) { a = min(1.0, 1.35 * exp(-2.4 * d * d)) * (1.0 - smoothstep(0.85, 1.0, d)); }
  else if (shape == 2u) { a = 1.0 - smoothstep(0.85, 1.0, max(abs(uv.x), abs(uv.y))); }
  else if (shape == 3u) { a = 1.0 - smoothstep(0.1, 0.22, abs(d - 0.72)); }
  else { a = (1.0 - smoothstep(0.02, 0.09, abs(uv.x * uv.y))) * (1.0 - smoothstep(0.7, 1.0, d)); }
  return a >= 0.5;
}

fn pixelCenter(clip: vec4f) -> vec2f {
  return (clip.xy / clip.w * vec2f(0.5, -0.5) + 0.5) * vec2f(f32(raster.width), f32(raster.height));
}
`;

export const FLOCK_POINT_RASTER_COMPUTE_WGSL = /* wgsl */ `
${COMMON}
struct AtomicPixel { depth: atomic<u32>, winner: atomic<u32>, };
@group(3) @binding(0) var<storage, read_write> pixels: array<AtomicPixel>;

fn invocationIndex(gid: vec3u) -> u32 { return gid.x + gid.y * raster.dispatchWidth; }

@compute @workgroup_size(${FLOCK_RASTER_WORKGROUP})
fn clearPixels(@builtin(global_invocation_id) gid: vec3u) {
  let index = invocationIndex(gid);
  if (index >= raster.width * raster.height) { return; }
  atomicStore(&pixels[index].depth, EMPTY);
  atomicStore(&pixels[index].winner, EMPTY);
}

fn splat(index: u32, clip: vec4f, radius: f32, shadow: bool, identify: bool) {
  if (clip.w <= 0.0 || clip.z < 0.0 || clip.z > clip.w) { return; }
  let center = pixelCenter(clip);
  let dims = vec2i(i32(raster.width), i32(raster.height));
  // Reject before float->integer conversion (also keeps extreme offscreen input bounded).
  if (any(center + radius < vec2f(0.0)) || any(center - radius > vec2f(dims))) { return; }
  let lo = max(vec2i(0), vec2i(ceil(center - radius - 0.5)));
  let hi = min(dims - 1, vec2i(floor(center + radius - 0.5)));
  let depth = bitcast<u32>(max(0.0, clip.z / clip.w));
  for (var y = lo.y; y <= hi.y; y += 1) {
    for (var x = lo.x; x <= hi.x; x += 1) {
      let uv = (vec2f(f32(x), f32(y)) + 0.5 - center) / radius * vec2f(1.0, -1.0);
      if (shadow) { if (dot(uv, uv) > 1.0) { continue; } }
      else if (!opaqueCoverage(uv)) { continue; }
      let pixel = u32(y) * raster.width + u32(x);
      let previous = atomicLoad(&pixels[pixel].depth);
      if (identify) {
        if (depth == previous) { atomicMin(&pixels[pixel].winner, EMPTY - 1u - index); }
      } else if (depth < previous) { atomicMin(&pixels[pixel].depth, depth); }
    }
  }
}

fn rasterPoint(index: u32, identify: bool) {
  if (index >= raster.count) { return; }
  let record = pointCache[index];
  if (record.packed == 0u) { return; }
  splat(index, toClip(record.pos), pointDiameter(index) * 0.5, false, identify);
}

@compute @workgroup_size(${FLOCK_RASTER_WORKGROUP})
fn pointDepth(@builtin(global_invocation_id) gid: vec3u) { rasterPoint(invocationIndex(gid), false); }

@compute @workgroup_size(${FLOCK_RASTER_WORKGROUP})
fn pointWinner(@builtin(global_invocation_id) gid: vec3u) { rasterPoint(invocationIndex(gid), true); }

@compute @workgroup_size(${FLOCK_RASTER_WORKGROUP})
fn shadowDepth(@builtin(global_invocation_id) gid: vec3u) {
  let index = invocationIndex(gid);
  if (index >= raster.count) { return; }
  let sample = pointSample(index);
  if (!sample.visible) { return; }
  let radius = (1.0 + br.size * 0.35) * max(1.0, br.ext0.z);
  splat(index, lightClip(sample.simPos), radius, true, false);
}
`;

export const FLOCK_POINT_RASTER_RESOLVE_WGSL = /* wgsl */ `
${COMMON}
struct Pixel { depth: u32, winner: u32, };
@group(3) @binding(0) var<storage, read> pixels: array<Pixel>;

@vertex
fn fullscreen(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
}

struct ResolvedPoint { @location(0) color: vec4f, @builtin(frag_depth) depth: f32, };
@fragment
fn resolvePoint(@builtin(position) fragment: vec4f) -> ResolvedPoint {
  let pixel = pixels[u32(fragment.y) * raster.width + u32(fragment.x)];
  if (pixel.winner == EMPTY) { discard; }
  let index = EMPTY - 1u - pixel.winner;
  let record = pointCache[index];
  var rgb = unpack4x8unorm(record.packed).rgb;
  if (pointsLit()) {
    let center = pixelCenter(toClip(record.pos));
    let uv = (fragment.xy - center) / (pointDiameter(index) * 0.5) * vec2f(1.0, -1.0);
    let nz = sqrt(max(0.0, 1.0 - min(dot(uv, uv), 1.0)));
    let viewDir = normalize(rb.frame.cameraPos - toWorld(record.pos));
    let normal = normalize(rb.frame.cameraRight * uv.x + rb.frame.cameraUp * uv.y + viewDir * nz);
    rgb = litColor(rgb, normal, shadowVisibility(record.pos));
  }
  return ResolvedPoint(vec4f(rgb, 1.0), bitcast<f32>(pixel.depth));
}

@fragment
fn resolveShadow(@builtin(position) fragment: vec4f) -> @builtin(frag_depth) f32 {
  let pixel = pixels[u32(fragment.y) * raster.width + u32(fragment.x)];
  if (pixel.depth == EMPTY) { discard; }
  return bitcast<f32>(pixel.depth);
}
`;
