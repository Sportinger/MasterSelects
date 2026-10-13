import { beforeEach, describe, expect, it, vi } from 'vitest';

const parse = vi.hoisted(() => ({ pending: [] as Array<{ name: string; resolve: () => void }> }));
const renderer = vi.hoisted(() => ({
  isInitialized: true,
  scenes: new Map<string, number>(),
  uploadScene: vi.fn((key: string, data: { splatCount: number }) => { renderer.scenes.set(key, data.splatCount); return true; }),
  hasScene: (key: string) => renderer.scenes.has(key),
  releaseScene: vi.fn((key: string) => { renderer.scenes.delete(key); }),
  initialize: vi.fn(),
}));
const cache = vi.hoisted(() => new Map<string, unknown>());

function asset(splatCount: number) {
  return { metadata: {}, frames: [{ buffer: { splatCount, data: new Float32Array(splatCount * 14) } }] };
}

vi.mock('../../src/engine/gaussian/loaders', () => {
  const load = (file: File) => new Promise(resolve => {
    parse.pending.push({ name: file.name, resolve: () => resolve(asset(Number(file.name.split('.')[0]))) });
  });
  return {
    loadGaussianSplatAsset: load,
    loadGaussianSplatAssetCached: async (key: string, file: File) => { const result = await load(file); cache.set(key, result); return result; },
    getSplatCache: () => ({ put: (key: string, value: unknown) => cache.set(key, value), remove: (key: string) => cache.delete(key) }),
  };
});
vi.mock('../../src/engine/gaussian/core/GaussianSplatGpuRenderer', () => ({ getGaussianSplatGpuRenderer: () => renderer }));
vi.mock('../../src/stores/engineStore', () => ({
  useEngineStore: { getState: () => ({ setGaussianSplatLoadProgress: vi.fn(), clearGaussianSplatLoadProgress: vi.fn() }) },
}));
vi.mock('../../src/services/nativeHelper/NativeHelperClient', () => ({ NativeHelperClient: { parseFileReferenceUrl: () => null } }));

const { forgetSplatSceneReplacement, replaceGaussianSplatScene } = await import('../../src/engine/gaussian/core/splatSceneReplacement');
const { GaussianSplatSceneLoader } = await import('../../src/engine/render/dispatcher/gaussianSplatSceneLoader');

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const finish = async (name: string) => { parse.pending.find(entry => entry.name === name)!.resolve(); await flush(); };

describe('live splat scene replacement', () => {
  beforeEach(() => { parse.pending = []; renderer.scenes.clear(); renderer.uploadScene.mockClear(); cache.clear(); });

  it('drops a superseded replacement and keeps the newest data', async () => {
    const older = replaceGaussianSplatScene('scene-a', new File([], '10.ply'));
    const newer = replaceGaussianSplatScene('scene-a', new File([], '20.ply'));
    await finish('20.ply');
    await finish('10.ply');
    await expect(newer).resolves.toBe(true);
    await expect(older).resolves.toBe(false);
    expect(renderer.scenes.get('scene-a')).toBe(20);
  });

  it('never lets a stale media load overwrite a live replacement, and reuses it after a reload', async () => {
    const loader = new GaussianSplatSceneLoader({ getDevice: () => ({}) as GPUDevice, requestRender: vi.fn() });
    const staleLoad = loader.ensureSceneLoaded({ sceneKey: 'scene-b', file: new File([], '5.ply') });
    await flush();
    const live = replaceGaussianSplatScene('scene-b', new File([], '30.ply'));
    await finish('30.ply');
    await live;
    await finish('5.ply');
    await staleLoad;
    expect(renderer.scenes.get('scene-b')).toBe(30);

    // A released scene (e.g. after device loss) reloads the replacement, not the stale file.
    renderer.scenes.delete('scene-b');
    await loader.ensureSceneLoaded({ sceneKey: 'scene-b', file: new File([], '5.ply') });
    expect(renderer.scenes.get('scene-b')).toBe(30);

    forgetSplatSceneReplacement('scene-b');
    expect(renderer.scenes.has('scene-b')).toBe(false);
    expect(cache.has('scene-b')).toBe(false);
  });
});
