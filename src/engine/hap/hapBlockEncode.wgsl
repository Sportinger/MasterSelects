// HAP BC1/BC3 block compression.
// One invocation compresses one 4x4 pixel block using inset range-fit —
// the same algorithm as the CPU reference in services/hap/dxtEncodeCpu.ts.
// Output words are little-endian, matching tightly packed BC block bytes.

struct Params {
  blocksX: u32,
  blocksY: u32,
  width: u32,
  height: u32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outWords: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

var<private> blockRgb: array<vec3f, 16>;
var<private> blockAlpha: array<f32, 16>;

fn loadBlock(blockX: u32, blockY: u32) {
  let maxX = i32(params.width) - 1;
  let maxY = i32(params.height) - 1;
  for (var py = 0u; py < 4u; py++) {
    let sy = min(i32(blockY * 4u + py), maxY);
    for (var px = 0u; px < 4u; px++) {
      let sx = min(i32(blockX * 4u + px), maxX);
      let texel = textureLoad(srcTex, vec2i(sx, sy), 0);
      blockRgb[py * 4u + px] = texel.rgb * 255.0;
      blockAlpha[py * 4u + px] = texel.a * 255.0;
    }
  }
}

fn pack565(color: vec3f) -> u32 {
  let r = u32(clamp(round(color.r * 31.0 / 255.0), 0.0, 31.0));
  let g = u32(clamp(round(color.g * 63.0 / 255.0), 0.0, 63.0));
  let b = u32(clamp(round(color.b * 31.0 / 255.0), 0.0, 31.0));
  return (r << 11u) | (g << 5u) | b;
}

fn expand565(c: u32) -> vec3f {
  let r5 = (c >> 11u) & 0x1fu;
  let g6 = (c >> 5u) & 0x3fu;
  let b5 = c & 0x1fu;
  return vec3f(
    f32((r5 << 3u) | (r5 >> 2u)),
    f32((g6 << 2u) | (g6 >> 4u)),
    f32((b5 << 3u) | (b5 >> 2u)),
  );
}

// Returns vec2u(colorWord0, colorWord1): endpoints + 2-bit indices.
fn encodeColorBlock() -> vec2u {
  var minC = blockRgb[0];
  var maxC = blockRgb[0];
  for (var i = 1u; i < 16u; i++) {
    minC = min(minC, blockRgb[i]);
    maxC = max(maxC, blockRgb[i]);
  }

  // Inset the bounding box by 1/16th of its range (floor, like the CPU path).
  let inset = floor((maxC - minC) / 16.0);
  minC = minC + inset;
  maxC = maxC - inset;

  var c0 = pack565(maxC);
  var c1 = pack565(minC);
  if (c0 < c1) {
    let swap = c0;
    c0 = c1;
    c1 = swap;
  }
  let endpoints = c0 | (c1 << 16u);
  if (c0 == c1) {
    return vec2u(endpoints, 0u);
  }

  let p0 = expand565(c0);
  let p1 = expand565(c1);
  let p2 = floor((2.0 * p0 + p1 + 1.0) / 3.0);
  let p3 = floor((p0 + 2.0 * p1 + 1.0) / 3.0);

  var indexBits = 0u;
  for (var i = 0u; i < 16u; i++) {
    let pixel = blockRgb[i];
    var best = 0u;
    var bestDist = dot(pixel - p0, pixel - p0);
    let d1 = dot(pixel - p1, pixel - p1);
    if (d1 < bestDist) { bestDist = d1; best = 1u; }
    let d2 = dot(pixel - p2, pixel - p2);
    if (d2 < bestDist) { bestDist = d2; best = 2u; }
    let d3 = dot(pixel - p3, pixel - p3);
    if (d3 < bestDist) { bestDist = d3; best = 3u; }
    indexBits |= best << (i * 2u);
  }
  return vec2u(endpoints, indexBits);
}

// Returns vec2u(alphaWord0, alphaWord1): endpoints + 3-bit indices.
fn encodeAlphaBlock() -> vec2u {
  var minA = blockAlpha[0];
  var maxA = blockAlpha[0];
  for (var i = 1u; i < 16u; i++) {
    minA = min(minA, blockAlpha[i]);
    maxA = max(maxA, blockAlpha[i]);
  }
  let a0 = u32(clamp(round(maxA), 0.0, 255.0));
  let a1 = u32(clamp(round(minA), 0.0, 255.0));
  if (a0 == a1) {
    return vec2u(a0 | (a1 << 8u), 0u);
  }

  var idxLo = 0u;
  var idxHi = 0u;
  for (var i = 0u; i < 16u; i++) {
    let a = blockAlpha[i];
    var best = 0u;
    var bestDist = abs(a - f32(a0));
    let d1 = abs(a - f32(a1));
    if (d1 < bestDist) { bestDist = d1; best = 1u; }
    for (var p = 2u; p < 8u; p++) {
      let value = (f32(8u - p) * f32(a0) + f32(p - 1u) * f32(a1)) / 7.0;
      let d = abs(a - value);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    let shift = i * 3u;
    if (shift < 32u) {
      idxLo |= best << shift;
      if (shift > 29u) {
        idxHi |= best >> (32u - shift);
      }
    } else {
      idxHi |= best << (shift - 32u);
    }
  }
  let word0 = a0 | (a1 << 8u) | ((idxLo & 0xffffu) << 16u);
  let word1 = (idxLo >> 16u) | ((idxHi & 0xffffu) << 16u);
  return vec2u(word0, word1);
}

fn toScaledYCoCg() {
  var maxAbs = 0.0;
  var co: array<f32, 16>;
  var cg: array<f32, 16>;
  var y: array<f32, 16>;
  for (var i = 0u; i < 16u; i++) {
    let rgb = blockRgb[i];
    y[i] = rgb.r * 0.25 + rgb.g * 0.5 + rgb.b * 0.25;
    co[i] = (rgb.r - rgb.b) * 0.5;
    cg[i] = (2.0 * rgb.g - rgb.r - rgb.b) * 0.25;
    maxAbs = max(maxAbs, max(abs(co[i]), abs(cg[i])));
  }
  var scale = 1.0;
  if (maxAbs < 32.0) {
    scale = 4.0;
  } else if (maxAbs < 64.0) {
    scale = 2.0;
  }
  let scaleByte = (scale - 1.0) * 8.0;
  for (var i = 0u; i < 16u; i++) {
    blockRgb[i] = vec3f(
      clamp(round(co[i] * scale + 128.0), 0.0, 255.0),
      clamp(round(cg[i] * scale + 128.0), 0.0, 255.0),
      scaleByte,
    );
    blockAlpha[i] = clamp(round(y[i]), 0.0, 255.0);
  }
}

@compute @workgroup_size(8, 8, 1)
fn encodeBc1(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.blocksX || gid.y >= params.blocksY) { return; }
  loadBlock(gid.x, gid.y);
  let color = encodeColorBlock();
  let base = (gid.y * params.blocksX + gid.x) * 2u;
  outWords[base] = color.x;
  outWords[base + 1u] = color.y;
}

@compute @workgroup_size(8, 8, 1)
fn encodeBc3(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.blocksX || gid.y >= params.blocksY) { return; }
  loadBlock(gid.x, gid.y);
  let alpha = encodeAlphaBlock();
  let color = encodeColorBlock();
  let base = (gid.y * params.blocksX + gid.x) * 4u;
  outWords[base] = alpha.x;
  outWords[base + 1u] = alpha.y;
  outWords[base + 2u] = color.x;
  outWords[base + 3u] = color.y;
}

@compute @workgroup_size(8, 8, 1)
fn encodeYCoCgBc3(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.blocksX || gid.y >= params.blocksY) { return; }
  loadBlock(gid.x, gid.y);
  toScaledYCoCg();
  let alpha = encodeAlphaBlock();
  let color = encodeColorBlock();
  let base = (gid.y * params.blocksX + gid.x) * 4u;
  outWords[base] = alpha.x;
  outWords[base + 1u] = alpha.y;
  outWords[base + 2u] = color.x;
  outWords[base + 3u] = color.y;
}
