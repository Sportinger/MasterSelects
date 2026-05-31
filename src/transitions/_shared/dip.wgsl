// Dip: fade the outgoing clip to a solid color, then fade that color to the
// incoming clip. The dip color is provided via uniforms (p0,p1,p2 = r,g,b),
// so the same shader serves dip-to-black and dip-to-white.
@fragment
fn dipFragment(input: VertexOutput) -> @location(0) vec4f {
  let a = getFromColor(input.uv);
  let b = getToColor(input.uv);
  let dip = vec4f(u.p0, u.p1, u.p2, 1.0);
  let p = u.progress;
  if (p < 0.5) {
    return mix(a, dip, p * 2.0);
  }
  return mix(dip, b, (p - 0.5) * 2.0);
}
