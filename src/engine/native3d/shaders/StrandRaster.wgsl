// Analytic strand raster ("Analytic" antialiasing). Appended to StrandScene.wgsl, so it shares the
// strand uniforms, curve buffers, spline and shading functions.
// 1. rasterExpand: one thread per fiber piece (segment × spline piece × fiber instance) projects
//    both piece ends to framebuffer pixels and counts the 16 × 16 tiles its padded bounds touch.
// 2. An exclusive prefix sum of the counts (StrandRasterScan.wgsl) gives every piece fixed entry
//    slots, so rasterScatter writes (tile, depth) keys in piece order, and the stable radix sort
//    keeps equal keys in that order: the result never depends on atomic timing.
// 3. rasterFindRanges finds each tile's run in the sorted keys.
// 4. rasterTiles: one workgroup per tile walks its pieces front to back. Coverage is the overlap
//    of the pixel square with the piece's strip, separable across and along the piece, so
//    neighbouring pieces split their joint exactly; consecutive pieces of one fiber add their
//    coverage instead of blending over each other. Pieces behind the scene depth are skipped,
//    blending stops at 1 % transmittance, and shading reuses shadeStrandPoint.

const RASTER_TILE: u32 = 16u;
const RASTER_GROUP: u32 = 256u;

struct RasterParams {
  pieces: u32,
  subdivisions: u32,
  instances: u32,
  tilesX: u32,
  tilesY: u32,
  capacity: u32,      // sorted entry slots
  depthBits: u32,     // low key bits holding the depth; the tile index + 1 sits above them
  dispatchWidth: u32, // workgroups per row of a 2D dispatch
  depthRange: vec2f,  // NDC depth range of the layer, spread over the depth key
  pad: vec2f,
};
/** ends: start and end pixel; depth: start and end NDC depth, start and end fiber width in pixels. */
struct RasterPiece { ends: vec4f, depth: vec4f };
struct RasterEntry { key: u32, piece: u32 };

@group(1) @binding(0) var<uniform> raster: RasterParams;
@group(1) @binding(1) var<storage, read_write> rasterPieces: array<RasterPiece>;
@group(1) @binding(2) var<storage, read_write> rasterCounts: array<u32>;
@group(1) @binding(3) var<storage, read_write> rasterOffsets: array<u32>;
@group(1) @binding(4) var<storage, read_write> rasterEntries: array<RasterEntry>;
@group(1) @binding(5) var<storage, read_write> rasterSorted: array<RasterEntry>;
@group(1) @binding(6) var<storage, read_write> rasterRanges: array<vec2u>;
@group(1) @binding(7) var rasterSceneDepth: texture_depth_2d;
@group(1) @binding(8) var rasterColor: texture_storage_2d<rgba16float, write>;
@group(1) @binding(9) var rasterDepth: texture_storage_2d<r32float, write>;

fn rasterIndex(gid: vec3u) -> u32 {
  return gid.x + gid.y * raster.dispatchWidth * RASTER_GROUP;
}

/** Framebuffer pixel of a clip position: x right, y down, pixel centers at +0.5. */
fn framebufferPixel(clip: vec4f) -> vec2f {
  let ndc = clip.xy / clip.w;
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * u.params.yz;
}

/** The spline of one fiber over one curve segment, as the vertex stage builds it. */
struct PieceSpline {
  before: vec3f,
  a: vec3f,
  b: vec3f,
  after: vec3f,
  scaleA: f32,
  scaleB: f32,
  piece: u32,
  visible: bool,
};

fn pieceSpline(index: u32) -> PieceSpline {
  var spline: PieceSpline;
  spline.visible = false;
  let fiber = index % raster.instances;
  let rest = index / raster.instances;
  spline.piece = rest % raster.subdivisions;
  let packed = segments[rest / raster.subdivisions];
  let first = packed & 0x3fffffffu;
  let yarnFibers = u32(max(u.yarn.x, 1.0)) * u32(max(u.yarn.y, 1.0));
  var fly: Flyaway;
  if (fiber >= yarnFibers) {
    let startArc = points[first * 3u].w;
    let endArc = points[(first + 1u) * 3u].w;
    fly = flyawayAt(u32(points[first * 3u + 2u].w), fiber - yarnFibers, 0.5 * (startArc + endArc));
    if (endArc <= fly.start || startArc >= fly.start + fly.length) {
      return spline;
    }
  }
  spline.a = fiberPoint(first, fiber, fly);
  spline.b = fiberPoint(first + 1u, fiber, fly);
  spline.before = spline.a;
  spline.after = spline.b;
  if ((packed & 0x80000000u) != 0u) {
    spline.before = fiberPoint(first - 1u, fiber, fly);
  }
  if ((packed & 0x40000000u) != 0u) {
    spline.after = fiberPoint(first + 2u, fiber, fly);
  }
  spline.scaleA = clamp(points[first * 3u + 1u].w, 0.0, 1.0);
  spline.scaleB = clamp(points[(first + 1u) * 3u + 1u].w, 0.0, 1.0);
  let viewProjection = u.projection * u.view;
  spline.visible = max(spline.scaleA, spline.scaleB) > 0.0 && u.params.w > 0.0
    && (viewProjection * vec4f(spline.a, 1.0)).w > 1e-5 && (viewProjection * vec4f(spline.b, 1.0)).w > 1e-5;
  return spline;
}

fn splineTangent(spline: PieceSpline, t: f32) -> vec3f {
  let span = spline.b - spline.a;
  let spanTangent = select(vec3f(1.0, 0.0, 0.0), normalize(span), dot(span, span) > 1e-18);
  let derivative = catmullRomTangent(spline.before, spline.a, spline.b, spline.after, t);
  return select(spanTangent, normalize(derivative), dot(derivative, derivative) > 1e-18);
}

/** World direction across the fiber, facing the camera. */
fn splineWidthDirection(p: vec3f, tangent: vec3f) -> vec3f {
  let widthAxis = cross(tangent, normalize(u.camera.xyz - p));
  return select(vec3f(0.0, 1.0, 0.0), normalize(widthAxis), dot(widthAxis, widthAxis) > 1e-12);
}

struct PieceEnd { pixel: vec2f, depth: f32, width: f32, visible: bool };

/** Spline point `t` of the segment: framebuffer pixel, NDC depth and projected fiber width. */
fn pieceEnd(spline: PieceSpline, t: f32) -> PieceEnd {
  var end: PieceEnd;
  let viewProjection = u.projection * u.view;
  let p = catmullRom(spline.before, spline.a, spline.b, spline.after, t);
  let clip = viewProjection * vec4f(p, 1.0);
  let edge = viewProjection * vec4f(p + splineWidthDirection(p, splineTangent(spline, t)) * u.params.x
    * mix(spline.scaleA, spline.scaleB, t), 1.0);
  end.visible = clip.w > 1e-5 && edge.w > 1e-5;
  end.pixel = framebufferPixel(clip);
  end.depth = clip.z / clip.w;
  end.width = select(0.0, length(framebufferPixel(edge) - end.pixel), end.visible);
  return end;
}

/** Tiles touched by a piece's bounds, padded by half its width and one pixel: (low.xy, high.xy). */
fn pieceTiles(piece: RasterPiece) -> vec4i {
  let pad = 0.5 * max(piece.depth.z, piece.depth.w) + 1.0;
  let low = max(min(piece.ends.xy, piece.ends.zw) - pad, vec2f(0.0));
  let high = min(max(piece.ends.xy, piece.ends.zw) + pad, u.params.yz - vec2f(1.0));
  if (any(high < low)) {
    return vec4i(0, 0, -1, -1);
  }
  return vec4i(vec2i(low) / i32(RASTER_TILE), vec2i(high) / i32(RASTER_TILE));
}

@compute @workgroup_size(256)
fn rasterExpand(@builtin(global_invocation_id) gid: vec3u) {
  let index = rasterIndex(gid);
  if (index >= raster.pieces) {
    return;
  }
  rasterCounts[index] = 0u;
  let spline = pieceSpline(index);
  if (!spline.visible) {
    return;
  }
  let pieces = f32(raster.subdivisions);
  let start = pieceEnd(spline, f32(spline.piece) / pieces);
  let end = pieceEnd(spline, f32(spline.piece + 1u) / pieces);
  if (!start.visible || !end.visible || max(start.width, end.width) <= 0.0
    || min(start.depth, end.depth) < 0.0 || max(start.depth, end.depth) > 1.0) {
    return;
  }
  let piece = RasterPiece(vec4f(start.pixel, end.pixel), vec4f(start.depth, end.depth, start.width, end.width));
  let tiles = pieceTiles(piece);
  if (tiles.z < tiles.x || tiles.w < tiles.y) {
    return;
  }
  rasterPieces[index] = piece;
  rasterCounts[index] = u32((tiles.z - tiles.x + 1) * (tiles.w - tiles.y + 1));
}

@compute @workgroup_size(256)
fn rasterScatter(@builtin(global_invocation_id) gid: vec3u) {
  let index = rasterIndex(gid);
  if (index >= raster.pieces || rasterCounts[index] == 0u) {
    return;
  }
  let piece = rasterPieces[index];
  let tiles = pieceTiles(piece);
  let span = max(raster.depthRange.y - raster.depthRange.x, 1e-12);
  let nearest = clamp((min(piece.depth.x, piece.depth.y) - raster.depthRange.x) / span, 0.0, 1.0);
  let depthKey = u32(nearest * f32((1u << raster.depthBits) - 1u));
  var slot = rasterOffsets[index];
  for (var y = tiles.y; y <= tiles.w; y++) {
    for (var x = tiles.x; x <= tiles.z; x++) {
      if (slot < raster.capacity) {
        let tile = u32(y) * raster.tilesX + u32(x) + 1u;
        rasterEntries[slot] = RasterEntry((tile << raster.depthBits) | depthKey, index);
      }
      slot++;
    }
  }
}

@compute @workgroup_size(256)
fn rasterFindRanges(@builtin(global_invocation_id) gid: vec3u) {
  let index = rasterIndex(gid);
  if (index >= raster.capacity) {
    return;
  }
  let tile = rasterSorted[index].key >> raster.depthBits;
  if (tile == 0u) {
    return;
  }
  var previous = 0u;
  if (index > 0u) {
    previous = rasterSorted[index - 1u].key >> raster.depthBits;
  }
  var next = 0u;
  if (index + 1u < raster.capacity) {
    next = rasterSorted[index + 1u].key >> raster.depthBits;
  }
  if (tile != previous) {
    rasterRanges[tile - 1u].x = index;
  }
  if (tile != next) {
    rasterRanges[tile - 1u].y = index + 1u;
  }
}

/** Length of [low, high] inside the unit interval around zero. */
fn unitOverlap(low: f32, high: f32) -> f32 {
  return max(0.0, min(high, 0.5) - max(low, -0.5));
}

/** Coverage of the pixel centered at `center` by a piece strip, with where it meets the strip. */
struct PieceHit { alpha: f32, t: f32, across: f32, width: f32, normal: vec2f };

fn pieceHit(ends: vec4f, depth: vec4f, center: vec2f) -> PieceHit {
  var hit: PieceHit;
  hit.alpha = 0.0;
  let span = ends.zw - ends.xy;
  let length = sqrt(dot(span, span));
  if (length < 1e-4) {
    return hit;
  }
  let direction = span / length;
  hit.normal = vec2f(-direction.y, direction.x);
  let along = dot(center - ends.xy, direction);
  hit.t = clamp(along / length, 0.0, 1.0);
  hit.width = mix(depth.z, depth.w, hit.t);
  let distance = dot(center - ends.xy, hit.normal);
  hit.across = distance / max(0.5 * hit.width, 1e-6);
  hit.alpha = unitOverlap(-along, length - along) * unitOverlap(-distance - 0.5 * hit.width, -distance + 0.5 * hit.width);
  return hit;
}

/** Whether piece `lower` and the next piece of the same fiber (`lower` + instances) join along it. */
fn piecesJoin(lower: u32) -> bool {
  let rest = lower / raster.instances;
  if (rest % raster.subdivisions + 1u < raster.subdivisions) {
    return true;
  }
  return (segments[rest / raster.subdivisions] & 0x40000000u) != 0u;
}

/** Shades a piece where it covers a pixel; the width axis is oriented like the hit's screen normal. */
fn shadeRasterHit(index: u32, hit: PieceHit) -> vec3f {
  let spline = pieceSpline(index);
  let t = (f32(spline.piece) + hit.t) / f32(raster.subdivisions);
  let p = catmullRom(spline.before, spline.a, spline.b, spline.after, t);
  let tangent = splineTangent(spline, t);
  let widthDirection = splineWidthDirection(p, tangent);
  let viewProjection = u.projection * u.view;
  let side = framebufferPixel(viewProjection * vec4f(p + widthDirection * max(u.params.x, 1e-6), 1.0))
    - framebufferPixel(viewProjection * vec4f(p, 1.0));
  let widthAxis = widthDirection * select(1.0, -1.0, dot(side, hit.normal) < 0.0);
  return shadeStrandPoint(tangent, u.camera.xyz - p, hit.across, widthAxis, hit.width);
}

var<workgroup> tileEnds: array<vec4f, 256>;
var<workgroup> tileDepths: array<vec4f, 256>;
var<workgroup> tilePieces: array<u32, 256>;
var<workgroup> tileRange: vec2u;
var<workgroup> tileFinished: atomic<u32>;
var<workgroup> tileFinishedCount: u32;

@compute @workgroup_size(16, 16)
fn rasterTiles(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_id) local: vec3u,
  @builtin(local_invocation_index) lane: u32) {
  let pixel = group.xy * RASTER_TILE + local.xy;
  let inside = all(vec2f(pixel) < u.params.yz);
  let center = vec2f(pixel) + 0.5;
  var sceneDepth = 1.0;
  if (inside) {
    sceneDepth = textureLoad(rasterSceneDepth, vec2i(pixel), 0);
  }
  var transmittance = 1.0;
  var rgb = vec3f(0.0);
  var depth = sceneDepth;
  var alive = inside;
  // The run of joined pieces of one fiber blended last: its lowest and highest piece, the
  // transmittance in front of it and its summed coverage.
  var runLow = 0xffffffffu;
  var runHigh = 0u;
  var runFront = 1.0;
  var runAlpha = 0.0;
  if (lane == 0u) {
    atomicStore(&tileFinished, 0u);
    tileRange = rasterRanges[group.x + group.y * raster.tilesX];
  }
  let range = workgroupUniformLoad(&tileRange);
  if (!alive) {
    atomicAdd(&tileFinished, 1u);
  }
  for (var base = range.x; base < range.y; base += RASTER_GROUP) {
    if (base + lane < range.y) {
      let piece = rasterSorted[base + lane].piece;
      tilePieces[lane] = piece;
      tileEnds[lane] = rasterPieces[piece].ends;
      tileDepths[lane] = rasterPieces[piece].depth;
    }
    workgroupBarrier();
    if (alive) {
      let available = min(RASTER_GROUP, range.y - base);
      for (var k = 0u; k < available; k++) {
        let hit = pieceHit(tileEnds[k], tileDepths[k], center);
        let alpha = min(hit.alpha, 1.0) * clamp(u.params.w, 0.0, 1.0);
        let z = mix(tileDepths[k].x, tileDepths[k].y, hit.t);
        if (alpha <= 1.0 / 1024.0 || z > sceneDepth) {
          continue;
        }
        let index = tilePieces[k];
        let joins = runLow != 0xffffffffu && ((index + raster.instances == runLow && piecesJoin(index))
          || (index == runHigh + raster.instances && piecesJoin(runHigh)));
        if (!joins) {
          runFront = transmittance;
          runAlpha = 0.0;
          runLow = index;
          runHigh = index;
        }
        runLow = min(runLow, index);
        runHigh = max(runHigh, index);
        runAlpha = min(runAlpha + alpha, 1.0);
        rgb += runFront * alpha * shadeRasterHit(index, hit);
        let behind = runFront * (1.0 - runAlpha);
        // The shared depth takes the fiber that makes the pixel at least half covered.
        if (transmittance > 0.5 && behind <= 0.5) {
          depth = z;
        }
        transmittance = behind;
        if (transmittance < 0.01) {
          alive = false;
          atomicAdd(&tileFinished, 1u);
          break;
        }
      }
    }
    workgroupBarrier();
    if (lane == 0u) {
      tileFinishedCount = atomicLoad(&tileFinished);
    }
    if (workgroupUniformLoad(&tileFinishedCount) == RASTER_GROUP) {
      break;
    }
  }
  if (inside) {
    textureStore(rasterColor, vec2i(pixel), vec4f(rgb, 1.0 - transmittance));
    textureStore(rasterDepth, vec2i(pixel), vec4f(depth, 0.0, 0.0, 0.0));
  }
}
