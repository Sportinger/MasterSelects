import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GaussianSplatAsset } from '../../src/engine/gaussian/loaders';

const loadGaussianSplatAssetMock = vi.fn<(file: File) => Promise<GaussianSplatAsset>>();

vi.mock('../../src/engine/gaussian/loaders', () => ({
  loadGaussianSplatAsset: loadGaussianSplatAssetMock,
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: () => false,
    getGaussianSplatRuntime: vi.fn(),
    saveGaussianSplatRuntime: vi.fn(),
  },
}));

function createAsset(sourceFile: File): GaussianSplatAsset {
  return {
    metadata: {
      format: 'ply',
      splatCount: 1,
      isTemporal: false,
      frameCount: 1,
      fps: 0,
      totalDuration: 0,
      boundingBox: {
        min: [0, 0, 0],
        max: [1, 1, 1],
      },
      byteSize: 56,
      perSplatByteStride: 56,
      hasSphericalHarmonics: false,
      shDegree: 0,
      compressionType: 'none',
    },
    frames: [
      {
        index: 0,
        buffer: {
          data: new Float32Array([
            0, 0, 0,
            1, 1, 1,
            0, 0, 0, 1,
            1, 1, 1,
            1,
          ]),
          splatCount: 1,
          shDegree: 0,
        },
      },
    ],
    sourceFile,
    sourceUrl: 'memory://test-frame.ply',
  };
}

describe('splatRuntimeCache', () => {
  beforeEach(() => {
    vi.resetModules();
    loadGaussianSplatAssetMock.mockReset();
  });

  it('retries the same cache key after a failed asset load', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'frame0000000.ply', {
      type: 'application/octet-stream',
    });

    loadGaussianSplatAssetMock
      .mockRejectedValueOnce(new Error('first load failed'))
      .mockResolvedValueOnce(createAsset(file));

    const { resolvePreparedSplatRuntime } = await import('../../src/engine/three/splatRuntimeCache');
    const options = {
      cacheKey: 'sequence/frame0000000.ply',
      file,
      fileName: file.name,
      requestedMaxSplats: 0,
    };

    await expect(resolvePreparedSplatRuntime(options)).rejects.toThrow('first load failed');
    await expect(resolvePreparedSplatRuntime(options)).resolves.toMatchObject({
      usingBase: true,
      runtime: expect.objectContaining({
        totalSplats: 1,
        splatCount: 1,
      }),
    });

    expect(loadGaussianSplatAssetMock).toHaveBeenCalledTimes(2);
  });
});
