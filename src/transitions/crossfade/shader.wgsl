// Crossfade: straight linear blend from the outgoing clip to the incoming clip.
@fragment
fn crossfadeFragment(input: VertexOutput) -> @location(0) vec4f {
  let a = getFromColor(input.uv);
  let b = getToColor(input.uv);
  return mix(a, b, u.progress);
}
