#pragma once
#include "scene.h"
__device__ __constant__ uint32_t sobolDirections[96] = {
    0x80000000u, 0xc0000000u, 0xa0000000u, 0xf0000000u, 0x88000000u, 0xcc000000u, 0xaa000000u, 0xff000000u,
    0x80800000u, 0xc0c00000u, 0xa0a00000u, 0xf0f00000u, 0x88880000u, 0xcccc0000u, 0xaaaa0000u, 0xffff0000u,
    0x80008000u, 0xc000c000u, 0xa000a000u, 0xf000f000u, 0x88008800u, 0xcc00cc00u, 0xaa00aa00u, 0xff00ff00u,
    0x80808080u, 0xc0c0c0c0u, 0xa0a0a0a0u, 0xf0f0f0f0u, 0x88888888u, 0xccccccccu, 0xaaaaaaaau, 0xffffffffu,
    0x80000000u, 0xc0000000u, 0x60000000u, 0x90000000u, 0xe8000000u, 0x5c000000u, 0x8e000000u, 0xc5000000u,
    0x68800000u, 0x9cc00000u, 0xee600000u, 0x55900000u, 0x80680000u, 0xc09c0000u, 0x60ee0000u, 0x90550000u,
    0xe8808000u, 0x5cc0c000u, 0x8e606000u, 0xc5909000u, 0x6868e800u, 0x9c9c5c00u, 0xeeee8e00u, 0x5555c500u,
    0x8000e880u, 0xc0005cc0u, 0x60008e60u, 0x9000c590u, 0xe8006868u, 0x5c009c9cu, 0x8e00eeeeu, 0xc5005555u,
    0x80000000u, 0xc0000000u, 0x20000000u, 0x50000000u, 0xf8000000u, 0x74000000u, 0xa2000000u, 0x93000000u,
    0xd8800000u, 0x25400000u, 0x59e00000u, 0xe6d00000u, 0x78080000u, 0xb40c0000u, 0x82020000u, 0xc3050000u,
    0x208f8000u, 0x51474000u, 0xfbea2000u, 0x75d93000u, 0xa0858800u, 0x914e5400u, 0xdbe79e00u, 0x25db6d00u,
    0x58800080u, 0xe54000c0u, 0x79e00020u, 0xe6d00050u, 0x780800f8u, 0xb40c0074u, 0x820200a2u, 0xc3050093u,
};
D uint32_t scramble(uint32_t v, uint32_t seed) {
  uint32_t x = __brev(v) + seed;
  x ^= x * 0x6c50b47cu;
  x ^= x * 0xb82f1e52u;
  x ^= x * 0xc7afe638u;
  x ^= x * 0x8d22f6e6u;
  return __brev(x);
}
D uint32_t combine(uint32_t seed, uint32_t v) { return seed ^ (v + (seed << 6) + (seed >> 2)); }
struct Sampler {
  uint32_t index, seed, pattern;
  D Sampler(uint32_t x, uint32_t y, uint32_t frame, uint32_t sample) : index(sample), pattern(0) {
    uint32_t h = x * 0x8da6b343u ^ y * 0xd8163841u ^ frame * 0xcb1ab31fu;
    h = (h ^ (h >> 16)) * 0x7feb352du;
    h = (h ^ (h >> 15)) * 0x846ca68bu;
    seed = h ^ (h >> 16);
  }
  D float4 next() {
    uint32_t s = combine(seed, pattern++ * 0x9e3779b9u + 0x632be5abu), i = scramble(index, s);
    float out[4];
    for (uint32_t d = 0; d < 4; d++) {
      uint32_t value = 0;
      if (d == 0)
        value = __brev(i);
      else
        for (uint32_t n = i, bit = 0; n; n >>= 1, bit++)
          if (n & 1)
            value ^= sobolDirections[(d - 1) * 32 + bit];
      out[d] = float(scramble(value, combine(s, d)) >> 8) * (1.f / 16777216);
    }
    return make_float4(out[0], out[1], out[2], out[3]);
  }
};
