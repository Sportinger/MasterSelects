// Conservative displacement balls, CPU reference: rodMotionGuard.ts.
// Protects previously disjoint, non-adjacent centre lines. Capsule clearance is
// still solved by contacts; initial overlaps and output modifiers are not repaired.
fn guardIndex(segment: u32) -> u32 { return 3u * rod.nodes + 2u * rod.segments + segment; }
fn guardedPoint(p: vec3f, x: vec3f, bound: f32) -> vec3f {
  let delta = p - x;
  let distance = length(delta);
  return x + delta * min(1.0, bound / max(distance, 1e-30));
}
fn guardNodePoint(node: u32, p: vec3f) -> vec3f {
  let links = nodeLinks(node);
  var bound = 0.25 * rod.radius;
  if (links.z != NO_SEGMENT) { bound = min(bound, state[guardIndex(links.z)].x); }
  if (links.w != NO_SEGMENT) { bound = min(bound, state[guardIndex(links.w)].x); }
  return guardedPoint(p, position(node).xyz, bound);
}

// Bound prediction PLUS the stretch/bend corrections before constructing the grid.
@compute @workgroup_size(256)
fn limitMotion(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= rod.nodes) { return; }
  let node = gid.x;
  let p = guardedPoint(state[predictedIndex(node)].xyz, position(node).xyz, 0.25 * rod.radius);
  state[predictedIndex(node)] = vec4f(p, 0.0);
}

@compute @workgroup_size(256)
fn measureSegments(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= rod.segments) { return; }
  let n = segmentNodes(gid.x);
  let distance = length(state[predictedIndex(n.x)].xyz - state[predictedIndex(n.y)].xyz);
  atomicMax(&extentBits[1], bitcast<u32>(distance));
}

// The grid contains the limited predictions. Its cell width includes both old
// segment lengths and both endpoints' maximum movement, so old close pairs remain
// candidates even if they separate during the proposed step.
@compute @workgroup_size(64)
fn motionBounds(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= rod.segments) { return; }
  let nc = segmentNodes(c);
  let a0 = position(nc.x).xyz;
  let a1 = position(nc.y).xyz;
  let home = cellOf(0.5 * (state[predictedIndex(nc.x)].xyz + state[predictedIndex(nc.y)].xyz));
  var bound = 0.25 * rod.radius;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let range = cellRanges[cellKey(home + vec3i(dx,dy,dz))];
        if (range.z != step.stamp) { continue; }
        for (var e = range.x; e < range.y; e++) {
          let d = sorted[e].y;
          if (c == d || adjacent(c,d)) { continue; }
          let nd = segmentNodes(d);
          let b0 = position(nd.x).xyz;
          let b1 = position(nd.y).xyz;
          let reach = length(a1-a0) + length(b1-b0) + 2.0 * rod.radius;
          let mid = a0+a1-b0-b1;
          if (dot(mid,mid) > reach*reach) { continue; }
          let st = closestParameters(a1-a0,b1-b0,a0-b0);
          let distance = length(mix(a0,a1,st.x)-mix(b0,b1,st.y));
          // Each segment moves <= 45% of the OLD distance: two segments together
          // consume <= 90%. This protects the whole linear step, not just its end.
          bound = min(bound, 0.45 * distance);
        }
      }
    }
  }
  state[guardIndex(c)] = vec4f(bound,0.0,0.0,0.0);
}
