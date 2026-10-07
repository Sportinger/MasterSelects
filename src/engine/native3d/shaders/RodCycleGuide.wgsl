// Arc-length-resampled periodic needle targets, shared with the CPU guide table.
fn cycleTarget(material: f32, row: f32, time: f32) -> vec4f {
  let n = u32(rod.cycle3.y); let frames = u32(rod.cycle3.z);
  let clock = time / rod.cycle2.w;
  let phase = fract(clock) * f32(frames);
  let p0 = u32(floor(phase)); let p1 = (p0 + 1u) % frames;
  let arc = fract(material + clock / rod.cycle0.z) * f32(n);
  let i0 = u32(floor(arc)); let i1 = (i0 + 1u) % n;
  let base = u32(row) * frames * n;
  let a = mix(cycleGuides[base + p0*n+i0], cycleGuides[base + p0*n+i1], fract(arc));
  let b = mix(cycleGuides[base + p1*n+i0], cycleGuides[base + p1*n+i1], fract(arc));
  var point = mix(a, b, fract(phase));
  return point;
}
