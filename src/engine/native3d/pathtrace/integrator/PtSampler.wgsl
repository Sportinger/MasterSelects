// Owen-scrambled, shuffled Sobol samples (Burley 2020); ptSampler.ts is the CPU mirror.
// A sampler walks through "patterns" of four dimensions: pattern 0 the camera (pixel jitter, lens),
// then per bounce one pattern for the BSDF and one for the light. The pattern seed hashes the pixel,
// the export frame seed (or the preview frame) and the pattern index, so export samples depend only
// on (frame, pixel, sample) and are reproducible.

const SOBOL_DIRECTIONS: array<array<u32, 32>, 3> = array<array<u32, 32>, 3>(
  array<u32, 32>(0x80000000u, 0xc0000000u, 0xa0000000u, 0xf0000000u, 0x88000000u, 0xcc000000u, 0xaa000000u, 0xff000000u,
    0x80800000u, 0xc0c00000u, 0xa0a00000u, 0xf0f00000u, 0x88880000u, 0xcccc0000u, 0xaaaa0000u, 0xffff0000u,
    0x80008000u, 0xc000c000u, 0xa000a000u, 0xf000f000u, 0x88008800u, 0xcc00cc00u, 0xaa00aa00u, 0xff00ff00u,
    0x80808080u, 0xc0c0c0c0u, 0xa0a0a0a0u, 0xf0f0f0f0u, 0x88888888u, 0xccccccccu, 0xaaaaaaaau, 0xffffffffu),
  array<u32, 32>(0x80000000u, 0xc0000000u, 0x60000000u, 0x90000000u, 0xe8000000u, 0x5c000000u, 0x8e000000u, 0xc5000000u,
    0x68800000u, 0x9cc00000u, 0xee600000u, 0x55900000u, 0x80680000u, 0xc09c0000u, 0x60ee0000u, 0x90550000u,
    0xe8808000u, 0x5cc0c000u, 0x8e606000u, 0xc5909000u, 0x6868e800u, 0x9c9c5c00u, 0xeeee8e00u, 0x5555c500u,
    0x8000e880u, 0xc0005cc0u, 0x60008e60u, 0x9000c590u, 0xe8006868u, 0x5c009c9cu, 0x8e00eeeeu, 0xc5005555u),
  array<u32, 32>(0x80000000u, 0xc0000000u, 0x20000000u, 0x50000000u, 0xf8000000u, 0x74000000u, 0xa2000000u, 0x93000000u,
    0xd8800000u, 0x25400000u, 0x59e00000u, 0xe6d00000u, 0x78080000u, 0xb40c0000u, 0x82020000u, 0xc3050000u,
    0x208f8000u, 0x51474000u, 0xfbea2000u, 0x75d93000u, 0xa0858800u, 0x914e5400u, 0xdbe79e00u, 0x25db6d00u,
    0x58800080u, 0xe54000c0u, 0x79e00020u, 0xe6d00050u, 0x780800f8u, 0xb40c0074u, 0x820200a2u, 0xc3050093u));

struct PtSampler {
  index: u32,     // sample index inside the pixel's sequence
  pixelSeed: u32, // hash of pixel and frame
  pattern: u32,   // next pattern
};

fn ptSobol(index: u32, dimension: u32) -> u32 {
  if (dimension == 0u) {
    return reverseBits(index);
  }
  var x = 0u;
  var i = index;
  var bit = 0u;
  loop {
    if (i == 0u) {
      break;
    }
    if ((i & 1u) != 0u) {
      x ^= SOBOL_DIRECTIONS[dimension - 1u][bit];
    }
    i >>= 1u;
    bit++;
  }
  return x;
}

fn ptLaineKarras(value: u32, seed: u32) -> u32 {
  var x = value + seed;
  x ^= x * 0x6c50b47cu;
  x ^= x * 0xb82f1e52u;
  x ^= x * 0xc7afe638u;
  x ^= x * 0x8d22f6e6u;
  return x;
}

fn ptNestedUniformScramble(value: u32, seed: u32) -> u32 {
  return reverseBits(ptLaineKarras(reverseBits(value), seed));
}

fn ptHashCombine(seed: u32, value: u32) -> u32 {
  return seed ^ (value + (seed << 6u) + (seed >> 2u));
}

fn ptPatternSeed(pixel: vec2u, frameSeed: u32, pattern: u32) -> u32 {
  var h = (pixel.x * 0x8da6b343u) ^ (pixel.y * 0xd8163841u) ^ (frameSeed * 0xcb1ab31fu) ^ (pattern * 0x165667b1u);
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}

fn ptSobolOwen4(index: u32, seed: u32) -> vec4f {
  let shuffled = ptNestedUniformScramble(index, seed);
  var result: vec4f;
  for (var dimension = 0u; dimension < 4u; dimension++) {
    let x = ptNestedUniformScramble(ptSobol(shuffled, dimension), ptHashCombine(seed, dimension));
    result[dimension] = f32(x >> 8u) * (1.0 / 16777216.0);
  }
  return result;
}

fn ptSamplerStart(pixel: vec2u, frameSeed: u32, index: u32) -> PtSampler {
  return PtSampler(index, ptPatternSeed(pixel, frameSeed, 0u), 0u);
}

/** Next four dimensions of the pixel's sample. */
fn ptNext4(sampler: ptr<function, PtSampler>) -> vec4f {
  let seed = ptHashCombine((*sampler).pixelSeed, (*sampler).pattern * 0x9e3779b9u + 0x632be5abu);
  (*sampler).pattern += 1u;
  return ptSobolOwen4((*sampler).index, seed);
}
