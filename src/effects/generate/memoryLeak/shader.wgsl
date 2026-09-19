// Memory Leak: reinterprets a raw block of the FFmpeg wasm heap as pixels.
// Binding 5 holds the block as u32 words (4 little-endian bytes per texel).

struct MemoryLeakParams {
  resolution: vec2f,
  memSize: vec2f,      // interpreted pixel columns / rows
  depth: f32,          // 0 = 8-bit, 1 = 16-bit, 2 = 32-bit float
  available: f32,      // 0 = no memory block bound (pass source through)
  mixAmount: f32,
  opaque: f32,
  floatMode: f32,      // 0 = clamp, 1 = wrap, 2 = absolute
  floatGain: f32,
  padding: vec2f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: MemoryLeakParams;
@group(0) @binding(5) var memoryTex: texture_2d<u32>;

fn memWord(x: i32, y: i32) -> u32 {
  let dims = vec2i(textureDimensions(memoryTex));
  let coord = clamp(vec2i(x, y), vec2i(0), dims - vec2i(1));
  return textureLoad(memoryTex, coord, 0).r;
}

fn floatChannel(word: u32) -> f32 {
  // Exponent all ones = NaN or Inf: render that memory as a hole.
  if ((word & 0x7f800000u) == 0x7f800000u) {
    return 0.0;
  }
  let value = bitcast<f32>(word) * params.floatGain;
  if (params.floatMode < 0.5) {
    return clamp(value, 0.0, 1.0);
  }
  if (params.floatMode < 1.5) {
    return fract(abs(value));
  }
  return clamp(abs(value), 0.0, 1.0);
}

fn memoryPixel(px: i32, py: i32) -> vec4f {
  if (params.depth < 0.5) {
    return unpack4x8unorm(memWord(px, py));
  }
  if (params.depth < 1.5) {
    let lo = unpack2x16unorm(memWord(px * 2, py));
    let hi = unpack2x16unorm(memWord(px * 2 + 1, py));
    return vec4f(lo, hi);
  }
  let base = px * 4;
  return vec4f(
    floatChannel(memWord(base, py)),
    floatChannel(memWord(base + 1, py)),
    floatChannel(memWord(base + 2, py)),
    floatChannel(memWord(base + 3, py)),
  );
}

@fragment
fn memoryLeakFragment(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTex, texSampler, input.uv);
  if (params.available < 0.5) {
    return source;
  }
  let cell = vec2i(floor(input.uv * params.memSize));
  var memory = memoryPixel(cell.x, cell.y);
  if (params.opaque > 0.5) {
    memory.a = 1.0;
  }
  return mix(source, memory, params.mixAmount);
}
