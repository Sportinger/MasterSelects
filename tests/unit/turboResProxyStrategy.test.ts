import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
  readMetadata: vi.fn(),
}));

vi.mock('../../src/services/mediaMetadata/isobmffMetadata', () => ({
  readIsobmffMetadata: mocks.readMetadata,
}));
vi.mock('../../src/services/mediaRuntime/prores/TurboResFrameProvider', () => ({
  createTurboResFrameProvider: mocks.createProvider,
}));
vi.mock('../../src/services/proxyGeneration/workerCapabilities', () => ({
  canUseDedicatedFrameWorkers: () => false,
}));

import { generateTurboResProxy } from '../../src/services/proxyGeneration/turboResProxyStrategy';

describe('TurboRes proxy strategy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.createProvider.mockReset();
    mocks.readMetadata.mockReset();
  });

  it('seeks exact provider frames and preserves proxy cache indices without HTML video', async () => {
    mocks.readMetadata.mockResolvedValue({
      duration: 2,
      fps: 2,
      width: 640,
      height: 360,
    });
    const frame = {} as VideoFrame;
    const provider = {
      seekExact: vi.fn(async () => undefined),
      getCurrentFrame: vi.fn(() => frame),
      destroyAsync: vi.fn(async () => undefined),
    };
    mocks.createProvider.mockResolvedValue(provider);
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['jpeg'], { type: 'image/jpeg' }))),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas' ? canvas : originalCreateElement(tagName)
    ));
    const saveFrame = vi.fn(async () => undefined);
    const onProgress = vi.fn();
    const file = new File(['prores'], 'camera.mov', { type: 'video/quicktime' });

    const result = await generateTurboResProxy({
      file,
      mediaFileId: 'media-prores',
      fourCC: 'apch',
      onProgress,
      checkCancelled: () => false,
      saveFrame,
      existingFrameIndices: new Set([1]),
    });

    expect(result).toMatchObject({ frameCount: 4, fps: 2 });
    expect(result?.frameIndices).toEqual(new Set([0, 1, 2, 3]));
    expect(provider.seekExact.mock.calls).toEqual([[0], [1], [1.5]]);
    expect(saveFrame).toHaveBeenCalledTimes(3);
    expect(drawImage).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(100);
    expect(provider.destroyAsync).toHaveBeenCalledOnce();
    expect(createElement.mock.calls.some(([tag]) => tag === 'video')).toBe(false);
  });
});
