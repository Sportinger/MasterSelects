import { describe, expect, it } from 'vitest';
import { flockFluidBlockTransferWgsl, FLOCK_FLUID_BLOCK_SLOTS } from '../../src/engine/flock/shaders/flockFluidTransferWgsl';
import { flockFluidWgsl } from '../../src/engine/flock/shaders/flockFluidWgsl';
import { flockFluidSeparationWgsl } from '../../src/engine/flock/shaders/flockFluidSeparationWgsl';
import { flockParticleOrderWgsl } from '../../src/engine/flock/shaders/flockParticleOrderWgsl';
import { FLOCK_CELLS_WGSL, FLOCK_GRID_WGSL, FLOCK_LINKS_WGSL, FLOCK_SIMULATE_WGSL, FLOCK_SORT_WGSL, FLOCK_TRAIL_WGSL } from '../../src/engine/flock/shaders/flockComputeWgsl';
import { FLOCK_PRESSURE_WGSL } from '../../src/engine/flock/shaders/flockPressureWgsl';
import { FLOCK_RADIX_SORT_WGSL } from '../../src/engine/flock/shaders/flockRadixSortWgsl';
import { FLOCK_POINT_RASTER_COMPUTE_WGSL } from '../../src/engine/flock/shaders/flockPointRasterWgsl';

/**
 * Spec-default WebGPU (what Safari exposes): 16384 bytes of workgroup storage and
 * 256 invocations per workgroup. The compare-exchange ban is a portability
 * guard, not a WGSL rule: `atomicCompareExchangeWeak` on workgroup memory is
 * valid WGSL, but shipping Safari's Metal compiler rejected the earlier
 * `fluidP2GBlock` that used it, most likely in WebKit's MSL codegen for that
 * built-in (strong inference; the production compiler line was truncated). Flock
 * compute shaders therefore claim slots with order-independent atomics instead.
 */
const MAX_WORKGROUP_BYTES = 16384;
const MAX_INVOCATIONS = 256;
const SCALAR_BYTES: Record<string, number> = { u32: 4, i32: 4, f32: 4, 'atomic<u32>': 4, 'atomic<i32>': 4, vec2f: 8, vec2u: 8, vec2i: 8, vec3f: 16, vec3u: 16, vec4f: 16, vec4u: 16, vec4i: 16 };

function workgroupBytes(code: string): number {
  let total = 0;
  for (const match of code.matchAll(/var<workgroup>\s+\w+\s*:\s*([^;]+);/g)) {
    const type = match[1].trim();
    const array = /^array<(.+),\s*(\d+)u?>$/.exec(type);
    const element = array ? array[1].trim() : type;
    const size = SCALAR_BYTES[element];
    if (size === undefined) throw new Error(`Unknown workgroup type ${element}`);
    total += size * (array ? Number(array[2]) : 1);
  }
  return total;
}

function maxInvocations(code: string): number {
  return Math.max(0, ...[...code.matchAll(/@workgroup_size\(([^)]*)\)/g)].map((match) => match[1].split(',')
    .map((value) => Number.parseInt(value.trim(), 10) || 1).reduce((product, value) => product * value, 1)));
}

const shaders = (['full64', 'fluid32'] as const).flatMap((layout) => [
  { name: `fluidP2GBlock/${layout}`, code: flockFluidBlockTransferWgsl(layout) },
  { name: `fluid/${layout}`, code: flockFluidWgsl(layout) },
  { name: `separation/${layout}`, code: flockFluidSeparationWgsl(layout) },
  { name: `particle-order/${layout}`, code: flockParticleOrderWgsl(layout) },
]).concat(Object.entries({
  grid: FLOCK_GRID_WGSL, sort: FLOCK_SORT_WGSL, cells: FLOCK_CELLS_WGSL, simulate: FLOCK_SIMULATE_WGSL, trail: FLOCK_TRAIL_WGSL,
  links: FLOCK_LINKS_WGSL, pressure: FLOCK_PRESSURE_WGSL, radix: FLOCK_RADIX_SORT_WGSL, raster: FLOCK_POINT_RASTER_COMPUTE_WGSL,
}).map(([name, code]) => ({ name, code })));

describe('flock compute WGSL on spec-default WebGPU (Safari)', () => {
  it.each(shaders)('$name fits the default workgroup limits and avoids compare-exchange', ({ code }) => {
    expect(workgroupBytes(code)).toBeLessThanOrEqual(MAX_WORKGROUP_BYTES);
    expect(maxInvocations(code)).toBeLessThanOrEqual(MAX_INVOCATIONS);
    expect(code).not.toContain('atomicCompareExchangeWeak');
    expect(code).not.toMatch(/atomic<f32>|enable f16|subgroup/);
  });

  it('claims block-transfer slots in a separate phase so both phases see one owner', () => {
    const code = flockFluidBlockTransferWgsl();
    expect(workgroupBytes(code)).toBe(FLOCK_FLUID_BLOCK_SLOTS * 12);
    expect(code).toMatch(/atomicMin\(&faceKeys\[blockSlot\(face\)\], face\)/);
    // Init, claim, accumulate and flush are separated by three uniform barriers.
    expect(code.match(/^\s*workgroupBarrier\(\);/gm)).toHaveLength(3);
  });
});
