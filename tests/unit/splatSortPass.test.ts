import { describe, expect, it, vi } from 'vitest';
import { buildBitonicSortPlan, SplatSortPass } from '../../src/engine/gaussian/core/SplatSortPass';

describe('buildBitonicSortPlan', () => {
  it('preserves power-of-two counts', () => {
    expect(buildBitonicSortPlan(1024)).toEqual({
      visibleCount: 1024,
      paddedCount: 1024,
      workgroupCount: 4,
    });
  });

  it('pads non-power-of-two counts for the GPU bitonic network', () => {
    expect(buildBitonicSortPlan(257)).toEqual({
      visibleCount: 257,
      paddedCount: 512,
      workgroupCount: 2,
    });
  });

  it('handles the large-splat regression case without truncating the sort dispatch', () => {
    const plan = buildBitonicSortPlan(149477160);
    expect(plan.visibleCount).toBe(149477160);
    expect(plan.paddedCount).toBe(268435456);
    expect(plan.workgroupCount).toBe(Math.ceil(268435456 / 256));
  });
});

it('retains each sort dispatch uniform until all branches are submitted', () => {
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 });
  vi.stubGlobal('GPUShaderStage', { COMPUTE: 1 });
  try {
    const writes = new Map<object, Uint32Array>();
    const dispatches: object[] = [];
    const device = {
      createShaderModule: () => ({}), createBindGroupLayout: () => ({}),
      createPipelineLayout: () => ({}), createComputePipeline: () => ({}),
      createBuffer: () => ({ destroy() {} }), createBindGroup: (d: unknown) => d,
      queue: { writeBuffer: (buffer: object, _offset: number, data: ArrayBuffer | ArrayBufferView) => {
        const bytes = ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.slice(0);
        writes.set(buffer, new Uint32Array(bytes));
      } },
    } as unknown as GPUDevice;
    const encoder = { copyBufferToBuffer() {}, beginComputePass: () => ({
      setPipeline() {}, setBindGroup: (index: number, group: { entries: { resource: { buffer: object } }[] }) => {
        if (index === 1) dispatches.push(group.entries[0].resource.buffer);
      }, dispatchWorkgroups() {}, end() {},
    }) } as unknown as GPUCommandEncoder;
    const sort = new SplatSortPass(); sort.initialize(device, 8);
    const matrix = new Float32Array(16);
    sort.execute(device, encoder, {} as GPUBuffer, {} as GPUBuffer, 5, matrix, matrix);
    sort.execute(device, encoder, {} as GPUBuffer, {} as GPUBuffer, 3, matrix, matrix);
    expect(new Set(dispatches).size).toBe(11);
    expect(dispatches.slice(0, 7).map(buffer => Array.from(writes.get(buffer)!.slice(32)))).toEqual([
      [5, 8, 0, 0], [5, 8, 2, 1], [5, 8, 4, 2], [5, 8, 4, 1], [5, 8, 8, 4], [5, 8, 8, 2], [5, 8, 8, 1],
    ]);
    sort.dispose();
  } finally { vi.unstubAllGlobals(); }
});
