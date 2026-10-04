import { RENDER_COMMON } from './flockRenderCommonWgsl';
import { POINT_BASE, POINT_RECORD } from './flockPointsWgsl';

export const FLOCK_PATH_TRACE_WORKGROUP = 256;

/**
 * Flock points for the path tracer (plan 3.7): each cached point record (written by `cachePoints`
 * this frame) becomes a sphere in scene space in the path tracer's object pool, PtShape layout
 * (p0: center, radius; p1.y: unorm4x8 color). The radius follows the sprite size of the raster:
 * scene units for world-sized points, the projected pixel size at the point's depth for
 * screen-sized ones. Hidden points get radius 0 (empty bounds).
 */
export const FLOCK_POINTS_PATH_TRACE_WGSL = /* wgsl */ `
${RENDER_COMMON}
${POINT_BASE}
${POINT_RECORD}

struct PathTraceParams { total: u32, base: u32, dispatchWidth: u32, pad: u32, };

@group(2) @binding(0) var<storage, read> pointCache: array<PointRecord>;
@group(2) @binding(1) var<storage, read_write> spheres: array<vec4f>;
@group(2) @binding(2) var<uniform> traceParams: PathTraceParams;

@compute @workgroup_size(${FLOCK_PATH_TRACE_WORKGROUP})
fn emitSpheres(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x + gid.y * traceParams.dispatchWidth;
  if (index >= traceParams.total) { return; }
  let at = traceParams.base + index * 4u;
  let record = pointCache[index];
  spheres[at + 2u] = vec4f(0.0);
  spheres[at + 3u] = vec4f(0.0);
  if (record.packed == 0u) {
    spheres[at] = vec4f(0.0);
    spheres[at + 1u] = vec4f(0.0);
    return;
  }
  let sizeRnd = select(stateCur[particleSlot(index / max(1u, u32(br.children)))].rnd, flockHash01(index, 911u), br.children > 1.0);
  let size = max(0.0, br.size * (1.0 + br.sizeVariance * (sizeRnd * 2.0 - 1.0)));
  let world = toWorld(record.pos);
  var radius = size * 0.5 * rb.frame.worldUnitsPerSim;
  if (br.sizeMode < 0.5) {
    let depth = max((rb.frame.viewProj * vec4f(world, 1.0)).w, 1e-3);
    radius = max(size * rb.frame.viewport.y / 1080.0, 1.0) * 0.5 * depth / max(rb.frame.focalPx, 1e-3);
  }
  spheres[at] = vec4f(world, radius);
  // The record's alpha holds shadow visibility; the path tracer shades itself.
  spheres[at + 1u] = vec4f(0.0, bitcast<f32>(record.packed | 0xff000000u), 0.0, 0.0);
}
`;
