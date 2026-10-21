// Integer hash of the exact float bits: each key is first spread over all 32 bits (lowbias32
// mix, since float bit patterns of small or round numbers end in zeros), then mixed by PCG2D
// (Jarzynski & Olano 2020). No sine, so it stays uniform and free of lattice stripes for any
// input size. Returns [0, 1) with 24-bit steps.
fn hashPcg2d(p: vec2f) -> f32 {
  var v = bitcast<vec2u>(p);
  v = v ^ (v >> vec2u(16u));
  v = v * vec2u(0x7feb352du, 0x846ca68bu);
  v = v ^ (v >> vec2u(15u));
  v = v * 1664525u + 1013904223u;
  v.x = v.x + v.y * 1664525u;
  v.y = v.y + v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  v.x = v.x + v.y * 1664525u;
  v.y = v.y + v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  return f32(v.x >> 8u) * (1.0 / 16777216.0);
}
