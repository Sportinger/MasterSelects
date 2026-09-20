import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openCableDepthReader } from '../../src/services/faceCables/cableDepthReader';
const env = vi.hoisted(() => ({ close: vi.fn(), read: vi.fn(), infer: vi.fn(), prepare: vi.fn() }));
vi.mock('../../src/services/depthEstimation/depthRuntime', () => ({ depthRuntime: env }));
vi.mock('../../src/services/planarTracking/surfaceFrameReader', () => ({
  surfaceFrameIndex: (_: unknown, time: number) => Math.floor(time * 30),
  openSurfaceFrames: async () => ({ frames: [], close: env.close, read: env.read }),
}));
beforeEach(() => {
  vi.clearAllMocks(); env.prepare.mockResolvedValue(undefined);
  env.read.mockImplementation(async time => ({ time, pixels: {} }));
  env.infer.mockResolvedValue({ width: 3, height: 3, values: new Float32Array(9), milliseconds: 1 });
});
describe('cable scene depth reader', () => {
  it('reuses repeated source frames and decodes reverse/speed-mapped timestamps in order', async () => {
    const reader = await openCableDepthReader('blob:source', undefined, new AbortController().signal, vi.fn());
    await reader.read(2); await reader.read(2.001); await reader.read(1); await reader.read(2);
    expect(env.read.mock.calls.map(c => c[0])).toEqual([2, 1, 2]);
    expect(env.infer).toHaveBeenCalledTimes(3);
    reader.close(); expect(env.close).toHaveBeenCalledOnce();
  });
  it('rejects cancelled cached reads instead of completing a partial bake', async () => {
    const controller = new AbortController();
    const reader = await openCableDepthReader('', undefined, controller.signal, vi.fn());
    await reader.read(0); controller.abort();
    await expect(reader.read(0)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
