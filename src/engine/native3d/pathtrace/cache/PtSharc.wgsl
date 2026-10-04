// Radiance cache in a spatial hash grid (SHaRC, plan 3.3), fixed interfaces pt_cache_query and
// pt_cache_update. Requires PtCommon.wgsl.
//
// A key is the cell of the scene position at a level of detail (cell edge 2^level, chosen from the
// spread the caller passes, which grows with the camera distance) plus the octant of the normal.
// Entries (PtCacheEntry, 8 words) are found by linear probing from a hash; a second hash is the
// checksum. Training paths add fixed point radiance to an entry; the resolve pass (PtSharcResolve.wgsl)
// folds the frame's sum into the resolved value once per frame and evicts entries left unused.

const PT_SHARC_CAPACITY: u32 = 524288u;    // entries, a power of two (keep in sync with ptSharc.ts)
const PT_SHARC_PROBES: u32 = 8u;
const PT_SHARC_MIN_SAMPLES: f32 = 1.0;

@group(3) @binding(2) var<storage, read_write> sharc: array<atomic<u32>>;

struct PtSharcKey {
  slot: u32,
  checksum: u32,
};

fn ptSharcKey(p: vec3f, n: vec3f, spread: f32) -> PtSharcKey {
  let level = clamp(i32(ceil(log2(max(spread, 1e-6)))), -16, 15);
  let cell = vec3i(floor(p * exp2(f32(-level))));
  let octant = u32(n.x >= 0.0) | (u32(n.y >= 0.0) << 1u) | (u32(n.z >= 0.0) << 2u);
  let a = bitcast<vec3u>(cell);
  let tag = (u32(level + 16) << 3u) | octant;
  let h = ptPcg(a.x ^ ptPcg(a.y ^ ptPcg(a.z ^ ptPcg(tag))));
  let c = ptPcg(h ^ 0x9e3779b9u ^ (a.x * 73856093u) ^ (a.y * 19349663u) ^ (a.z * 83492791u) ^ tag);
  return PtSharcKey(h & (PT_SHARC_CAPACITY - 1u), max(c, 1u));
}

/** Cached outgoing radiance near p (rgb, w: samples behind it; w = 0 when the cache has nothing usable). */
fn pt_cache_query(p: vec3f, n: vec3f, spread: f32) -> vec4f {
  let key = ptSharcKey(p, n, spread);
  for (var i = 0u; i < PT_SHARC_PROBES; i++) {
    let base = ((key.slot + i) & (PT_SHARC_CAPACITY - 1u)) * 8u;
    let checksum = atomicLoad(&sharc[base]);
    if (checksum == 0u) {
      break;
    }
    if (checksum == key.checksum) {
      atomicStore(&sharc[base + 1u], frame.counters.x);
      let rg = unpack2x16float(atomicLoad(&sharc[base + 6u]));
      let bn = unpack2x16float(atomicLoad(&sharc[base + 7u]));
      if (bn.y < PT_SHARC_MIN_SAMPLES) {
        return vec4f(0.0);
      }
      return vec4f(rg, bn.x, bn.y);
    }
  }
  return vec4f(0.0);
}

/** Adds one radiance estimate leaving p (a training path's vertex). */
fn pt_cache_update(p: vec3f, n: vec3f, spread: f32, radiance: vec3f) {
  if (any(radiance != radiance) || any(radiance < vec3f(0.0))) {
    return;
  }
  let key = ptSharcKey(p, n, spread);
  let fixed = vec3u(min(radiance, vec3f(256.0)) * PT_CACHE_RADIANCE_SCALE);
  for (var i = 0u; i < PT_SHARC_PROBES; i++) {
    let base = ((key.slot + i) & (PT_SHARC_CAPACITY - 1u)) * 8u;
    let exchanged = atomicCompareExchangeWeak(&sharc[base], 0u, key.checksum);
    if (exchanged.old_value == 0u || exchanged.old_value == key.checksum) {
      if (exchanged.old_value == 0u && !exchanged.exchanged) {
        // Lost a race for an empty slot (weak exchange); the next frame tries again.
        return;
      }
      atomicStore(&sharc[base + 1u], frame.counters.x);
      atomicAdd(&sharc[base + 2u], fixed.x);
      atomicAdd(&sharc[base + 3u], fixed.y);
      atomicAdd(&sharc[base + 4u], fixed.z);
      atomicAdd(&sharc[base + 5u], 1u);
      return;
    }
  }
}
