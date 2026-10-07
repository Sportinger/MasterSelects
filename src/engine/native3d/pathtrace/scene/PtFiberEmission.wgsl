// Fiber emission: the strand layer's curve points become round-cone fiber segments for the path
// tracer, built with the same yarn geometry as the raster (StrandFiberGeometry.wgsl): plies, fibers,
// twist, flyaway windows and the Catmull-Rom spline, split into `subdivisions` linear pieces per curve
// segment. One thread per output slot ((segment * instances + fiber) * subdivisions + piece); the
// slot layout is fixed for a topology, so moving curves only need a BLAS refit.
// Preview level of detail keeps a hashed share `keep` of the fibers of every yarn (the same fibers
// along the whole yarn and across frames) and widens them by 1 / keep; export keeps all (keep = 1).
// Requires PtCommon.wgsl and StrandFiberGeometry.wgsl.

struct EmissionParams {
  fiber: StrandFiberParams,
  emit: vec4f,   // x: fiber radius (scene units), y: subdivisions, z: fiber instances per yarn, w: keep fraction
  info: vec4u,   // x: curve segments, y: 1 when per-point attributes are bound, z: default material, w: output base
  extra: vec4f,  // x: widest allowed fiber radius (scene units)
};

@group(0) @binding(0) var<uniform> emission: EmissionParams;
@group(0) @binding(1) var<storage, read> points: array<vec4f>;
@group(0) @binding(2) var<storage, read> segments: array<u32>;
@group(0) @binding(3) var<storage, read> pointAttributes: array<vec2u>;
@group(0) @binding(4) var<storage, read_write> emitted: array<PtFiberSegment>;

/** Default attributes: white (material color applies), roughness scale 1, no melanin. */
fn emissionAttributes(point: u32) -> vec2u {
  if (emission.info.y == 0u) {
    return vec2u(pack4x8unorm(vec4f(1.0, 1.0, 1.0, 1.0 / PT_ROUGHNESS_SCALE_RANGE)), emission.info.z);
  }
  return pointAttributes[point];
}

fn emissionHidden(slot: u32) {
  emitted[emission.info.w + slot] = PtFiberSegment(vec4f(0.0), vec4f(0.0), PT_FIBER_FLAG_HIDDEN, 0u, 0u, 0u);
}

@compute @workgroup_size(256)
fn emitFibers(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let slot = id.y * groups.x * 256u + id.x;
  let subdivisions = max(u32(emission.emit.y), 1u);
  let instances = max(u32(emission.emit.z), 1u);
  let perSegment = subdivisions * instances;
  if (slot >= emission.info.x * perSegment) {
    return;
  }
  let segment = slot / perSegment;
  let fiber = (slot / subdivisions) % instances;
  let piece = slot % subdivisions;
  let packed = segments[segment];
  let first = packed & 0x3fffffffu;
  let params = emission.fiber;
  let strand = u32(points[first * 3u + 2u].w);
  // Instances past the yarn fibers are flyaway channels, present only where their window overlaps.
  let yarnFibers = strandYarnFibers(params);
  var fly: Flyaway;
  var flags = 0u;
  if (fiber >= yarnFibers) {
    let startArc = points[first * 3u].w + params.twist.z;
    let endArc = points[(first + 1u) * 3u].w + params.twist.z;
    fly = strandFlyawayAt(params, strand, fiber - yarnFibers, 0.5 * (startArc + endArc));
    if (endArc <= fly.start || startArc >= fly.start + fly.length) {
      emissionHidden(slot);
      return;
    }
    flags = PT_FIBER_FLAG_FLYAWAY;
  }
  // Level of detail: the same hashed fibers of a yarn survive at every segment.
  let keep = clamp(emission.emit.w, 1e-4, 1.0);
  if (keep < 1.0 && hash3(strand, fiber, 0x5f3759dfu) >= keep) {
    emissionHidden(slot);
    return;
  }
  let scaleA = clamp(points[first * 3u + 1u].w, 0.0, 1.0);
  let scaleB = clamp(points[(first + 1u) * 3u + 1u].w, 0.0, 1.0);
  if (max(scaleA, scaleB) <= 0.0 || emission.emit.x <= 0.0) {
    emissionHidden(slot);
    return;
  }
  let a = strandFiberPoint(params, first, fiber, fly);
  let b = strandFiberPoint(params, first + 1u, fiber, fly);
  let before = select(a, strandFiberPoint(params, first - 1u, fiber, fly), (packed & 0x80000000u) != 0u);
  let after = select(b, strandFiberPoint(params, first + 2u, fiber, fly), (packed & 0x40000000u) != 0u);
  let t0 = f32(piece) / f32(subdivisions);
  let t1 = f32(piece + 1u) / f32(subdivisions);
  let radius = min(emission.emit.x / keep, emission.extra.x);
  let attributesA = emissionAttributes(first);
  let attributesB = emissionAttributes(first + 1u);
  let colorA = unpack4x8unorm(attributesA.x);
  let colorB = unpack4x8unorm(attributesB.x);
  let melaninA = f32(attributesA.y >> 16u) / 65535.0;
  let melaninB = f32(attributesB.y >> 16u) / 65535.0;
  emitted[emission.info.w + slot] = PtFiberSegment(
    vec4f(catmullRom(before, a, b, after, t0), radius * mix(scaleA, scaleB, t0)),
    vec4f(catmullRom(before, a, b, after, t1), radius * mix(scaleA, scaleB, t1)),
    (attributesA.y & 0xffffu) | flags,
    pack4x8unorm(mix(colorA, colorB, t0)),
    pack4x8unorm(mix(colorA, colorB, t1)),
    pack2x16unorm(vec2f(mix(melaninA, melaninB, t0), mix(melaninA, melaninB, t1))));
}
