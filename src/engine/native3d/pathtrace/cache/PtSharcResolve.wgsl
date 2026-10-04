// Once per realtime frame: folds the radiance the training paths added to every cache entry into
// its resolved value (an average over at most PT_SHARC_HISTORY samples, so lighting changes fade in)
// and clears entries nobody touched for PT_SHARC_STALE_FRAMES frames. Entry layout: PtSharc.wgsl.

const PT_SHARC_CAPACITY: u32 = 524288u;
const PT_SHARC_HISTORY: f32 = 64.0;
const PT_SHARC_STALE_FRAMES: u32 = 120u;
const PT_SHARC_SCALE: f32 = 1024.0;

struct SharcResolveParams {
  frame: u32,
  dispatchWidth: u32,
  clear: u32,          // 1: empty the whole cache (scene or lighting replaced)
  pad: u32,
};

@group(0) @binding(0) var<storage, read_write> sharc: array<atomic<u32>>;
@group(0) @binding(1) var<uniform> params: SharcResolveParams;

@compute @workgroup_size(256)
fn resolveSharc(@builtin(global_invocation_id) id: vec3u) {
  let entry = id.y * params.dispatchWidth + id.x;
  if (entry >= PT_SHARC_CAPACITY) {
    return;
  }
  let base = entry * 8u;
  if (params.clear == 1u) {
    for (var word = 0u; word < 8u; word++) {
      atomicStore(&sharc[base + word], 0u);
    }
    return;
  }
  if (atomicLoad(&sharc[base]) == 0u) {
    return;
  }
  let last = atomicLoad(&sharc[base + 1u]);
  if (params.frame - last > PT_SHARC_STALE_FRAMES) {
    for (var word = 0u; word < 8u; word++) {
      atomicStore(&sharc[base + word], 0u);
    }
    return;
  }
  let count = atomicExchange(&sharc[base + 5u], 0u);
  if (count == 0u) {
    return;
  }
  let sum = vec3f(f32(atomicExchange(&sharc[base + 2u], 0u)), f32(atomicExchange(&sharc[base + 3u], 0u)),
    f32(atomicExchange(&sharc[base + 4u], 0u))) / PT_SHARC_SCALE;
  let rg = unpack2x16float(atomicLoad(&sharc[base + 6u]));
  let bn = unpack2x16float(atomicLoad(&sharc[base + 7u]));
  let old = vec3f(rg, bn.x);
  let samples = min(bn.y + f32(count), PT_SHARC_HISTORY);
  let mean = sum / f32(count);
  let resolved = old + (mean - old) * (f32(count) / samples);
  atomicStore(&sharc[base + 6u], pack2x16float(resolved.rg));
  atomicStore(&sharc[base + 7u], pack2x16float(vec2f(resolved.b, samples)));
}
