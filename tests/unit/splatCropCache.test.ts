import { describe, it, expect, vi } from 'vitest';
import { compactCropIndices, sourceSphereCrops, SplatCropCache } from '../../src/engine/gaussian/graph/SplatCropCache';
import type { SplatGraphOperation } from '../../src/types/splatGraph';

const crop: SplatGraphOperation = { kind: 'sphere-crop', values: [0, 0, 0, 1, 0] };
const source = new Float32Array(5 * 14);
[-2, -1, 0, 1, 2].forEach((x, i) => { source[i * 14] = x; source[i * 14 + 13] = 1; });
const all = { count: 5, offset: 0, remapped: false };

describe('source crop compaction', () => {
  it('removes outside splats while preserving source IDs and source data', () => {
    const before = source.slice();
    expect([...compactCropIndices(source, 5, all, [crop.values])]).toEqual([1, 2, 3]);
    expect([...compactCropIndices(source, 5, all, [[0, 0, 0, 0, 0]])]).toEqual([2]);
    expect([...compactCropIndices(source, 5, all, [[20, 0, 0, 1, 0]])]).toEqual([]);
    expect(source).toEqual(before);
  });
  it('keeps fractional soft-edge splats but removes zero-opacity boundaries', () => {
    expect([...compactCropIndices(source, 5, all, [[0, 0, 0, 2, 2]])]).toEqual([1, 2, 3]);
    expect([...compactCropIndices(source, 5, all, [crop.values, [1, 0, 0, 1, 0]])]).toEqual([2, 3]);
  });
  it('preserves seeded sampling before filtering instead of reseeding surviving particles', () => {
    expect([...compactCropIndices(source, 5, { count: 3, offset: 2, remapped: true }, [crop.values])]).toEqual([2, 3]);
  });
  it('never applies a post-motion crop to original source centers', () => {
    const motion: SplatGraphOperation = { kind: 'noise', values: [0] };
    expect(sourceSphereCrops([motion, crop])).toEqual([]);
    expect(sourceSphereCrops([crop, { kind: 'particles', values: [] }, crop])).toEqual([crop.values]);
  });
  it('reuses buffers during playback and rebuilds after crop or source changes', () => {
    Object.assign(globalThis, { GPUBufferUsage: { STORAGE: 1, COPY_DST: 2 } });
    const createBuffer = vi.fn(() => ({ destroy: vi.fn() }));
    const device = { createBuffer, queue: { writeBuffer: vi.fn() } } as unknown as GPUDevice;
    const cache = new SplatCropCache();
    const first = cache.prepare(device, 'scan', source, 5, all, [crop]);
    expect(first?.count).toBe(3);
    expect(cache.prepare(device, 'scan', source, 5, all, [crop])).toBe(first);
    expect(createBuffer).toHaveBeenCalledTimes(1);
    expect(cache.prepare(device, 'scan', source, 5, all, [{ ...crop, values: [0, 0, 0, 0, 0] }])?.count).toBe(1);
    expect(cache.prepare(device, 'scan', source.slice(), 5, all, [crop])).not.toBe(first);
    cache.beginFrame(); expect(first?.buffer.destroy).toHaveBeenCalledOnce();
    cache.dispose();
  });
});
