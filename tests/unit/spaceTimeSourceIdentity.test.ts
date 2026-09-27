import { describe, expect, it, vi } from 'vitest';
import { SpaceTimeGeometry } from '../../src/effects/time/slit-scan/SpaceTimeGeometry';
import { encodeSpaceTime } from '../../src/effects/time/slit-scan/spaceTimeData';

describe('space-time source identity supplied by scene host', () => {
  it('rejects unavailable and replaced sources even when GPU geometry is cached', () => {
    Object.assign(globalThis, { GPUBufferUsage: { STORAGE: 1, COPY_DST: 2 } });
    const createBuffer = vi.fn(() => ({ destroy: vi.fn() }));
    const device = { createBuffer, queue: { writeBuffer: vi.fn(), onSubmittedWorkDone: () => Promise.resolve() } } as unknown as GPUDevice;
    const geometry = new SpaceTimeGeometry(device);
    const params = { spaceTimeData: encodeSpaceTime({ sourceId: 'source', fingerprint: '', from: 0, to: 1 }, new Float32Array(8)) };
    expect(() => geometry.resolve(params, 'source', undefined)).toThrow('different source');
    expect(createBuffer).not.toHaveBeenCalled();
    expect(geometry.resolve(params, 'source', '').count).toBe(1);
    expect(() => geometry.resolve(params, 'source', 'replacement')).toThrow('different source');
    expect(() => geometry.resolve(params, 'other', '')).toThrow('different source');
    expect(() => geometry.resolve(params, 'source', undefined)).toThrow('different source');
    expect(createBuffer).toHaveBeenCalledTimes(1);
    geometry.destroy();
  });
});
