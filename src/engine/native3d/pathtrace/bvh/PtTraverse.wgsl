// Two-level BVH traversal with the fixed interfaces pt_trace_closest and pt_trace_transmittance,
// and the primitive intersections: round-cone fiber segments, triangles, quads, spheres and boxes.
// Requires PtCommon.wgsl, PtSceneBindings.wgsl and PtSurfaceTexture.wgsl (quad alpha).
//
// Nodes are PtWideNode (both child boxes in the parent, ptWidePack.ts). The TLAS (root frame.scene.x)
// references instances as leaves. An instance leaf transforms the ray into object space (directions
// stay unnormalized, so t is the same in both spaces) and walks the BLAS at refs.x; local node and
// primitive indices are offset by refs.x / refs.y. Empty bounds (hidden primitives, the missing
// child of a one-primitive BLAS: min > max) are rejected explicitly, the slab test would accept them.

const PT_TLAS_STACK: u32 = 32u;
const PT_BLAS_STACK: u32 = 64u;
const PT_RAY_EPSILON: f32 = 1e-4;
// Node visits one trace may make. Far above any real ray (tens to a few hundred); it only bounds a
// pathological ray so a single thread can never stall the GPU into a device reset.
const PT_MAX_VISITS: u32 = 1024u;

/** A ray with NaN or infinite components would pass every slab test (min/max drop NaN) and walk the whole tree. */
fn ptRayValid(origin: vec3f, direction: vec3f) -> bool {
  let d = dot(direction, direction);
  return all(abs(origin) < vec3f(1e30)) && d > 1e-20 && d < 1e30;
}

/** Entry distance of the ray into the box, or PT_INFINITY when it misses [tMin, tMax] or the box is empty. */
fn ptRayBox(origin: vec3f, inverse: vec3f, lo: vec3f, hi: vec3f, tMin: f32, tMax: f32) -> f32 {
  if (any(lo > hi)) {
    return PT_INFINITY;
  }
  let t0 = (lo - origin) * inverse;
  let t1 = (hi - origin) * inverse;
  let near = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), max(min(t0.z, t1.z), tMin));
  let far = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), min(max(t0.z, t1.z), tMax));
  return select(PT_INFINITY, near, near <= far);
}

fn ptSafeInverse(d: vec3f) -> vec3f {
  return 1.0 / select(d, vec3f(1e-20), abs(d) < vec3f(1e-20));
}

/** Round cone between spheres (a, ra) and (b, rb) (Quilez); x: t, yzw: unit normal; t < 0 misses. Needs a unit rd. */
fn ptIntersectRoundCone(ro: vec3f, rd: vec3f, a: vec3f, b: vec3f, ra: f32, rb: f32) -> vec4f {
  let ba = b - a;
  // Shift the ray origin near the segment before subtracting squared distances.
  // At camera distance, that cancellation can erase a subpixel fiber's radius.
  // Keep the computation relative to a to avoid another large world-space sum.
  let relative = ro - a;
  let shift = -dot(rd, relative);
  let oa = relative + rd * shift;
  let ob = oa - ba;
  let rr = ra - rb;
  let m0 = dot(ba, ba);
  let m1 = dot(ba, oa);
  let m2 = dot(ba, rd);
  let m3 = dot(rd, oa);
  let m5 = dot(oa, oa);
  let m6 = dot(ob, rd);
  let m7 = dot(ob, ob);
  let d2 = m0 - rr * rr;
  let k2 = d2 - m2 * m2;
  let k1 = d2 * m3 - m1 * m2 + m2 * rr * ra;
  let k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2.0 - m0 * ra * ra;
  let h = k1 * k1 - k0 * k2;
  if (h < 0.0) {
    return vec4f(-1.0);
  }
  if (abs(k2) > 1e-20) {
    let t = (-sqrt(h) - k1) / k2;
    let y = m1 - ra * rr + t * m2;
    if (y > 0.0 && y < d2) {
      return vec4f(t + shift, normalize(d2 * (oa + t * rd) - ba * y));
    }
  }
  let h1 = m3 * m3 - m5 + ra * ra;
  let h2 = m6 * m6 - m7 + rb * rb;
  if (max(h1, h2) < 0.0) {
    return vec4f(-1.0);
  }
  var r = vec4f(PT_INFINITY, 0.0, 0.0, 0.0);
  if (h1 > 0.0) {
    let t = -m3 - sqrt(h1);
    r = vec4f(t, (oa + t * rd) / max(ra, 1e-12));
  }
  if (h2 > 0.0) {
    let t = -m6 - sqrt(h2);
    if (t < r.x) {
      r = vec4f(t, (ob + t * rd) / max(rb, 1e-12));
    }
  }
  return vec4f(r.x + shift, r.yzw);
}

/** Möller-Trumbore, two-sided; xyz: t, u, v barycentrics; t = PT_INFINITY misses. */
fn ptIntersectTriangle(ro: vec3f, rd: vec3f, p0: vec3f, p1: vec3f, p2: vec3f) -> vec3f {
  let e1 = p1 - p0;
  let e2 = p2 - p0;
  let pv = cross(rd, e2);
  let det = dot(e1, pv);
  if (abs(det) < 1e-14) {
    return vec3f(PT_INFINITY, 0.0, 0.0);
  }
  let inv = 1.0 / det;
  let tv = ro - p0;
  let u = dot(tv, pv) * inv;
  if (u < 0.0 || u > 1.0) {
    return vec3f(PT_INFINITY, 0.0, 0.0);
  }
  let qv = cross(tv, e1);
  let v = dot(rd, qv) * inv;
  if (v < 0.0 || u + v > 1.0) {
    return vec3f(PT_INFINITY, 0.0, 0.0);
  }
  return vec3f(dot(e2, qv) * inv, u, v);
}

/** Parallelogram origin + s·u + t·v; xyz: t, s, t. */
fn ptIntersectQuad(ro: vec3f, rd: vec3f, origin: vec3f, u: vec3f, v: vec3f) -> vec3f {
  let n = cross(u, v);
  let denom = dot(n, rd);
  if (abs(denom) < 1e-14) {
    return vec3f(PT_INFINITY, 0.0, 0.0);
  }
  let t = dot(n, origin - ro) / denom;
  let p = ro + t * rd - origin;
  let uu = dot(u, u);
  let uv = dot(u, v);
  let vv = dot(v, v);
  let pu = dot(p, u);
  let pv = dot(p, v);
  let det = uu * vv - uv * uv;
  let s = (pu * vv - pv * uv) / det;
  let w = (pv * uu - pu * uv) / det;
  if (s < 0.0 || s > 1.0 || w < 0.0 || w > 1.0) {
    return vec3f(PT_INFINITY, 0.0, 0.0);
  }
  return vec3f(t, s, w);
}

fn ptIntersectSphere(ro: vec3f, rd: vec3f, center: vec3f, radius: f32, tMin: f32) -> f32 {
  let oc = ro - center;
  let a = dot(rd, rd);
  let b = dot(oc, rd);
  let c = dot(oc, oc) - radius * radius;
  let h = b * b - a * c;
  if (h < 0.0) {
    return PT_INFINITY;
  }
  let s = sqrt(h);
  let t0 = (-b - s) / a;
  let t1 = (-b + s) / a;
  return select(select(PT_INFINITY, t1, t1 > tMin), t0, t0 > tMin);
}

/** Primitive test; x: t (PT_INFINITY misses), yz: hit uv. Quads with alpha below the stochastic threshold pass through. */
fn ptIntersectPrimitive(kind: u32, index: u32, ro: vec3f, rd: vec3f, tMin: f32, alphaThreshold: f32) -> vec3f {
  if (kind == PT_PRIMITIVE_FIBER) {
    let s = ptFiber(index);
    if ((s.material & PT_FIBER_FLAG_HIDDEN) != 0u) {
      return vec3f(PT_INFINITY, 0.0, 0.0);
    }
    let length = max(sqrt(dot(rd, rd)), 1e-20);
    let hit = ptIntersectRoundCone(ro, rd / length, s.a.xyz, s.b.xyz, s.a.w, s.b.w);
    let t = hit.x / length;
    if (hit.x < 0.0 || t <= tMin) {
      return vec3f(PT_INFINITY, 0.0, 0.0);
    }
    let axis = s.b.xyz - s.a.xyz;
    let along = clamp(dot(ro + t * rd - s.a.xyz, axis) / max(dot(axis, axis), 1e-20), 0.0, 1.0);
    return vec3f(t, along, 0.0);
  }
  if (kind == PT_PRIMITIVE_TRIANGLE) {
    let tri = ptTriangle(index);
    let hit = ptIntersectTriangle(ro, rd, ptVertex(tri.indices.x).position.xyz, ptVertex(tri.indices.y).position.xyz,
      ptVertex(tri.indices.z).position.xyz);
    return select(vec3f(PT_INFINITY, 0.0, 0.0), hit, hit.x > tMin);
  }
  if (kind == PT_PRIMITIVE_QUAD) {
    let q = ptShape(index);
    let hit = ptIntersectQuad(ro, rd, q.p0.xyz, q.p1.xyz, q.p2.xyz);
    if (hit.x <= tMin || hit.x >= PT_INFINITY) {
      return vec3f(PT_INFINITY, 0.0, 0.0);
    }
    if (alphaThreshold > 0.0) {
      let material = materials[bitcast<u32>(q.p0.w)];
      // Planes show uv (0, 0) at the top left like the raster.
      let opacity = ptSurfaceColorOpacity(material, vec2f(hit.y, 1.0 - hit.z)).a;
      if (opacity < alphaThreshold) {
        return vec3f(PT_INFINITY, 0.0, 0.0);
      }
    }
    return hit;
  }
  if (kind == PT_PRIMITIVE_SPHERE) {
    let s = ptShape(index).p0;
    return vec3f(ptIntersectSphere(ro, rd, s.xyz, s.w, tMin), 0.0, 0.0);
  }
  let b = ptShape(index);
  let t = ptRayBox(ro, ptSafeInverse(rd), b.p0.xyz, b.p1.xyz, tMin, PT_INFINITY);
  return vec3f(t, 0.0, 0.0);
}

/** Primitive record index for local primitive `local` of an instance (fibers count records, the rest vec4s). */
fn ptPrimitiveRecord(kind: u32, base: u32, local: u32) -> u32 {
  if (kind == PT_PRIMITIVE_FIBER) {
    return base + local;
  }
  if (kind == PT_PRIMITIVE_TRIANGLE) {
    return base + local;
  }
  return base + local * 4u;
}

/** Tests leaf reference `childRef` of an instance and keeps the hit when it is closer than `best`. */
fn ptBlasLeaf(instanceIndex: u32, inst: PtInstance, childRef: u32, ro: vec3f, rd: vec3f, tMin: f32, best: ptr<function, PtHit>,
  alphaThreshold: f32) {
  let kind = inst.refs.z;
  let local = childRef & ~PT_LEAF_BIT;
  let hit = ptIntersectPrimitive(kind, ptPrimitiveRecord(kind, inst.refs.y, local), ro, rd, tMin, alphaThreshold);
  if (hit.x < (*best).t) {
    (*best).t = hit.x;
    (*best).instance = instanceIndex;
    (*best).primitive = local;
    (*best).kind = kind;
    (*best).uv = hit.yz;
  }
}

fn ptIsLeafRef(childRef: u32) -> bool {
  return (childRef & PT_LEAF_BIT) != 0u && childRef != PT_WIDE_EMPTY;
}

/**
 * Closest hit inside one instance's BLAS; `best` is the current closest distance. A visit loads one
 * traversal node and tests both child boxes; leaf children are intersected right away, inner
 * children are pushed with their entry distance (nearer last), so a pop only compares that
 * distance with the closest hit found since.
 */
fn ptTraceBlas(instanceIndex: u32, inst: PtInstance, origin: vec3f, direction: vec3f, tMin: f32, best: ptr<function, PtHit>,
  alphaThreshold: f32) {
  let ro = ptTransformPoint(inst.worldToObject0, inst.worldToObject1, inst.worldToObject2, origin);
  let rd = ptTransformVector(inst.worldToObject0, inst.worldToObject1, inst.worldToObject2, direction);
  let inverse = ptSafeInverse(rd);
  let root = inst.refs.x;
  var stack: array<u32, PT_BLAS_STACK>;
  var entry: array<f32, PT_BLAS_STACK>;
  var top = 1u;
  stack[0] = 0u;
  entry[0] = tMin;
  loop {
    if (top == 0u) {
      break;
    }
    top -= 1u;
    if (entry[top] >= (*best).t) {
      continue;
    }
    if ((*best).steps >= PT_MAX_VISITS) {
      break;
    }
    let node = ptNode(root + stack[top]);
    (*best).steps += 1u;
    var ta = ptRayBox(ro, inverse, node.leftMin, node.leftMax, tMin, (*best).t);
    var tb = ptRayBox(ro, inverse, node.rightMin, node.rightMax, tMin, (*best).t);
    if (ta < PT_INFINITY && ptIsLeafRef(node.leftRef)) {
      ptBlasLeaf(instanceIndex, inst, node.leftRef, ro, rd, tMin, best, alphaThreshold);
      ta = PT_INFINITY;
    }
    if (tb < PT_INFINITY && ptIsLeafRef(node.rightRef)) {
      ptBlasLeaf(instanceIndex, inst, node.rightRef, ro, rd, tMin, best, alphaThreshold);
      tb = PT_INFINITY;
    }
    let nearFirst = ta <= tb;
    let far = select(node.leftRef, node.rightRef, nearFirst);
    let near = select(node.rightRef, node.leftRef, nearFirst);
    let tFar = max(ta, tb);
    let tNear = min(ta, tb);
    if (tFar < (*best).t && top < PT_BLAS_STACK) {
      stack[top] = far;
      entry[top] = tFar;
      top += 1u;
    }
    if (tNear < (*best).t && top < PT_BLAS_STACK) {
      stack[top] = near;
      entry[top] = tNear;
      top += 1u;
    }
  }
}

/** Closest hit; `alphaThreshold` in (0, 1] makes quads with lower opacity transparent (0: always opaque). */
fn ptTraceClosestAlpha(ray: PtRay, alphaThreshold: f32) -> PtHit {
  var best: PtHit;
  best.t = ray.tMax;
  best.instance = 0xffffffffu;
  best.steps = 0u;
  if (frame.scene.y == 0u || !ptRayValid(ray.origin, ray.direction)) {
    best.t = PT_INFINITY;
    return best;
  }
  let inverse = ptSafeInverse(ray.direction);
  var stack: array<u32, PT_TLAS_STACK>;
  var entry: array<f32, PT_TLAS_STACK>;
  var top = 1u;
  stack[0] = 0u;
  entry[0] = ray.tMin;
  loop {
    if (top == 0u) {
      break;
    }
    top -= 1u;
    if (entry[top] >= best.t) {
      continue;
    }
    if (best.steps >= PT_MAX_VISITS) {
      break;
    }
    let node = ptNode(frame.scene.x + stack[top]);
    best.steps += 1u;
    var ta = ptRayBox(ray.origin, inverse, node.leftMin, node.leftMax, ray.tMin, best.t);
    var tb = ptRayBox(ray.origin, inverse, node.rightMin, node.rightMax, ray.tMin, best.t);
    if (ta < PT_INFINITY && ptIsLeafRef(node.leftRef)) {
      let index = node.leftRef & ~PT_LEAF_BIT;
      ptTraceBlas(index, ptInstance(index), ray.origin, ray.direction, ray.tMin, &best, alphaThreshold);
      ta = PT_INFINITY;
    }
    if (tb < PT_INFINITY && ptIsLeafRef(node.rightRef)) {
      let index = node.rightRef & ~PT_LEAF_BIT;
      ptTraceBlas(index, ptInstance(index), ray.origin, ray.direction, ray.tMin, &best, alphaThreshold);
      tb = PT_INFINITY;
    }
    if (tb < best.t && top < PT_TLAS_STACK) {
      stack[top] = node.rightRef;
      entry[top] = tb;
      top += 1u;
    }
    if (ta < best.t && top < PT_TLAS_STACK) {
      stack[top] = node.leftRef;
      entry[top] = ta;
      top += 1u;
    }
  }
  if (best.instance == 0xffffffffu) {
    best.t = PT_INFINITY;
  }
  return best;
}

fn pt_trace_closest(ray: PtRay) -> PtHit {
  return ptTraceClosestAlpha(ray, 0.5);
}

/** Any-hit test inside one BLAS: true at the first primitive hit within (tMin, tMax). */
fn ptAnyHitBlas(inst: PtInstance, origin: vec3f, direction: vec3f, tMin: f32, tMax: f32, visits: ptr<function, u32>) -> bool {
  let ro = ptTransformPoint(inst.worldToObject0, inst.worldToObject1, inst.worldToObject2, origin);
  let rd = ptTransformVector(inst.worldToObject0, inst.worldToObject1, inst.worldToObject2, direction);
  let inverse = ptSafeInverse(rd);
  let root = inst.refs.x;
  let kind = inst.refs.z;
  var stack: array<u32, PT_BLAS_STACK>;
  var top = 1u;
  stack[0] = 0u;
  loop {
    if (top == 0u) {
      break;
    }
    top -= 1u;
    *visits += 1u;
    if (*visits >= PT_MAX_VISITS) {
      // Treat an exhausted walk as occluded: a dark sample is safer than a hang.
      return true;
    }
    let node = ptNode(root + stack[top]);
    let ta = ptRayBox(ro, inverse, node.leftMin, node.leftMax, tMin, tMax);
    let tb = ptRayBox(ro, inverse, node.rightMin, node.rightMax, tMin, tMax);
    if (ta < PT_INFINITY) {
      if (ptIsLeafRef(node.leftRef)) {
        if (ptIntersectPrimitive(kind, ptPrimitiveRecord(kind, inst.refs.y, node.leftRef & ~PT_LEAF_BIT), ro, rd, tMin, 0.0).x < tMax) {
          return true;
        }
      } else if (top < PT_BLAS_STACK) {
        stack[top] = node.leftRef;
        top += 1u;
      }
    }
    if (tb < PT_INFINITY) {
      if (ptIsLeafRef(node.rightRef)) {
        if (ptIntersectPrimitive(kind, ptPrimitiveRecord(kind, inst.refs.y, node.rightRef & ~PT_LEAF_BIT), ro, rd, tMin, 0.0).x < tMax) {
          return true;
        }
      } else if (top < PT_BLAS_STACK) {
        stack[top] = node.rightRef;
        top += 1u;
      }
    }
  }
  return false;
}

struct PtOcclusion {
  opaque: bool,       // an opaque primitive (fiber, triangle, sphere, box) lies within the segment
  nearQuads: bool,    // the segment passes the bounds of alpha-capable quads (planes)
};

/** Shadow ray test: stops at the first opaque hit; planes are only flagged (their alpha needs the full walk). */
fn ptOcclusion(ray: PtRay, tMax: f32) -> PtOcclusion {
  var result = PtOcclusion(false, false);
  if (frame.scene.y == 0u) {
    return result;
  }
  if (!ptRayValid(ray.origin, ray.direction)) {
    result.opaque = true;
    return result;
  }
  var visits = 0u;
  let inverse = ptSafeInverse(ray.direction);
  var stack: array<u32, PT_TLAS_STACK>;
  var top = 1u;
  stack[0] = 0u;
  loop {
    if (top == 0u) {
      break;
    }
    top -= 1u;
    visits += 1u;
    if (visits >= PT_MAX_VISITS) {
      result.opaque = true;
      return result;
    }
    let node = ptNode(frame.scene.x + stack[top]);
    for (var side = 0u; side < 2u; side++) {
      let childRef = select(node.leftRef, node.rightRef, side == 1u);
      let lo = select(node.leftMin, node.rightMin, side == 1u);
      let hi = select(node.leftMax, node.rightMax, side == 1u);
      if (ptRayBox(ray.origin, inverse, lo, hi, ray.tMin, tMax) >= PT_INFINITY) {
        continue;
      }
      if (!ptIsLeafRef(childRef)) {
        if (top < PT_TLAS_STACK) {
          stack[top] = childRef;
          top += 1u;
        }
        continue;
      }
      let inst = ptInstance(childRef & ~PT_LEAF_BIT);
      if (inst.refs.z == PT_PRIMITIVE_QUAD) {
        result.nearQuads = true;
      } else if (ptAnyHitBlas(inst, ray.origin, ray.direction, ray.tMin, tMax, &visits)) {
        result.opaque = true;
        return result;
      }
    }
  }
  return result;
}

/**
 * Light reaching tMax along the ray: 0 behind an opaque hit, otherwise the product of (1 - opacity)
 * of every alpha surface crossed. Fibers and meshes are opaque, so an any-hit test settles most
 * shadow rays; only rays near planes walk the alpha surfaces one by one.
 */
fn pt_trace_transmittance(ray: PtRay, tMax: f32) -> f32 {
  let occlusion = ptOcclusion(ray, tMax);
  if (occlusion.opaque) {
    return 0.0;
  }
  if (!occlusion.nearQuads) {
    return 1.0;
  }
  var transmittance = 1.0;
  var origin = ray.origin;
  var remaining = tMax;
  // Each pass finds the next surface; alpha surfaces are crossed, at most a few of them.
  for (var crossing = 0u; crossing < 8u; crossing++) {
    let hit = ptTraceClosestAlpha(PtRay(origin, ray.tMin, ray.direction, remaining), 0.0);
    if (hit.t >= remaining || hit.t >= PT_INFINITY) {
      return transmittance;
    }
    if (hit.kind != PT_PRIMITIVE_QUAD) {
      return 0.0;
    }
    let inst = ptInstance(hit.instance);
    let q = ptShape(ptPrimitiveRecord(hit.kind, inst.refs.y, hit.primitive));
    let material = materials[bitcast<u32>(q.p0.w)];
    transmittance *= 1.0 - ptSurfaceColorOpacity(material, vec2f(hit.uv.x, 1.0 - hit.uv.y)).a;
    if (transmittance <= 1e-3) {
      return 0.0;
    }
    origin = origin + ray.direction * (hit.t + PT_RAY_EPSILON);
    remaining = remaining - hit.t - PT_RAY_EPSILON;
  }
  return transmittance;
}
