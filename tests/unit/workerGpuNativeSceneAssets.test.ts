import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerGpuNativeSceneAssets } from '../../src/services/render/WorkerGpuNativeSceneAssets';
import { loadFlockPigmentBitmap } from '../../src/engine/flock/gpu/flockPigmentBitmap';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';

const operations = vi.hoisted(() => ({ setPigment: vi.fn(), setModel: vi.fn(), remove: vi.fn(), dispose: vi.fn() }));
vi.mock('../../src/engine/flock/gpu/FlockGpuAssetRegistry', () => ({ FlockGpuAssetRegistry: class {
  setPigment = operations.setPigment; setModel = operations.setModel; remove = operations.remove; dispose = operations.dispose;
} }));
vi.mock('../../src/engine/flock/gpu/flockPigmentBitmap', () => ({ loadFlockPigmentBitmap: vi.fn() }));

describe('Worker native scene resource lifetime', () => {
  beforeEach(() => vi.clearAllMocks());
  it('loads once, replaces changed URLs, closes decode handles and prunes inactive media', async () => {
    const close = vi.fn();
    vi.mocked(loadFlockPigmentBitmap).mockResolvedValue({ close } as unknown as ImageBitmap);
    const owner = new WorkerGpuNativeSceneAssets({} as GPUDevice);
    const { stack, payload } = nativeSceneFixture();
    const asset = { id: 'image', kind: 'image' as const, url: 'blob:https://localhost/a', fileName: 'a.png' };
    Object.assign(payload, { assets: [asset] });
    await owner.prepare(stack, () => {});
    await owner.prepare(stack, () => {});
    expect(loadFlockPigmentBitmap).toHaveBeenCalledTimes(1);
    expect(() => owner.require('image', 'image')).not.toThrow();
    asset.url = 'blob:https://localhost/b';
    await owner.prepare(stack, () => {});
    expect(operations.setPigment).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    Object.assign(payload, { assets: [] });
    await owner.prepare(stack, () => {});
    expect(operations.remove).toHaveBeenCalledWith('image');
    expect(() => owner.require('image', 'image')).toThrow('missing');
    owner.dispose();
    expect(operations.dispose).toHaveBeenCalledOnce();
  });

  it('releases a decoded bitmap when the target expires during loading', async () => {
    const close = vi.fn(); let current = true;
    vi.mocked(loadFlockPigmentBitmap).mockImplementation(async () => { current = false; return { close } as unknown as ImageBitmap; });
    const owner = new WorkerGpuNativeSceneAssets({} as GPUDevice);
    const { stack, payload } = nativeSceneFixture();
    Object.assign(payload, { assets: [{ id: 'image', kind: 'image', url: 'blob:https://localhost/a', fileName: 'a.png' }] });
    await expect(owner.prepare(stack, () => { if (!current) throw new Error('expired'); })).rejects.toThrow('expired');
    expect(close).toHaveBeenCalledOnce();
    expect(operations.setPigment).not.toHaveBeenCalled();
  });

  it('propagates load failure instead of using fallback pixels', async () => {
    vi.mocked(loadFlockPigmentBitmap).mockRejectedValue(new Error('decode failed'));
    const owner = new WorkerGpuNativeSceneAssets({} as GPUDevice);
    const { stack, payload } = nativeSceneFixture();
    Object.assign(payload, { assets: [{ id: 'image', kind: 'image', url: 'blob:https://localhost/a', fileName: 'a.png' }] });
    await expect(owner.prepare(stack, () => {})).rejects.toThrow('decode failed');
    expect(() => owner.require('image', 'image')).toThrow('missing');
  });
});
