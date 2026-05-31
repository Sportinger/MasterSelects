// Wipe: a soft directional edge sweeps across the frame, revealing the incoming
// clip. Direction is provided via uniforms (p1,p2 = unit direction vector) so the
// same shader serves wipe-left and wipe-right (and any future diagonal wipes).
//   p0 = softness (edge half-width in UV units)
@fragment
fn wipeFragment(input: VertexOutput) -> @location(0) vec4f {
  let a = getFromColor(input.uv);
  let b = getToColor(input.uv);
  let softness = max(u.p0, 0.0001);
  let dir = vec2f(u.p1, u.p2);

  // Coordinate along the wipe direction, normalized to roughly [0,1].
  let c = clamp(0.5 + dot(input.uv - vec2f(0.5), dir), 0.0, 1.0);

  // Expand the edge travel so progress=0 is fully "from" and progress=1 fully "to".
  let span = 1.0 + 2.0 * softness;
  let edge = u.progress * span - softness;
  let toAmount = 1.0 - smoothstep(edge - softness, edge + softness, c);

  return mix(a, b, toAmount);
}
