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

function createAsset(
  sourceFile: File,
  options?: {
    bounds?: {
      min: [number, number, number];
      max: [number, number, number];
    };
    center?: [number, number, number];
  },
): GaussianSplatAsset {
  const center = options?.center ?? [0, 0, 0];
  const bounds = options?.bounds ?? {
    min: [0, 0, 0] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
  };
  return {
    metadata: {
      format: 'ply',
      splatCount: 1,
      isTemporal: false,
      frameCount: 1,
      fps: 0,
      totalDuration: 0,
      boundingBox: bounds,
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
            center[0], center[1], center[2],
            1, 1, 1,
            1, 0, 0, 0,
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

    const { resolvePreparedSplatRuntime } = await import('../../src/engine/scene/runtime/SharedSplatRuntimeCache');
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

  it('normalizes later sequence frames against the first frame bounds when shared bounds are missing', async () => {
    const frameA = new File([new Uint8Array([1])], 'frame0000000.ply', {
      type: 'application/octet-stream',
    });
    const frameB = new File([new Uint8Array([2])], 'frame0000001.ply', {
      type: 'application/octet-stream',
    });

    loadGaussianSplatAssetMock.mockImplementation(async (file: File) => {
      if (file.name === frameA.name) {
        return createAsset(file, {
          bounds: {
            min: [0, 0, 0],
            max: [10, 10, 10],
          },
          center: [5, 5, 5],
        });
      }

      return createAsset(file, {
        bounds: {
          min: [10, 0, 0],
          max: [30, 10, 10],
        },
        center: [20, 5, 5],
      });
    });

    const { waitForBasePreparedSplatRuntime } = await import('../../src/engine/scene/runtime/SharedSplatRuntimeCache');
    const runtime = await waitForBasePreparedSplatRuntime({
      cacheKey: 'Raw/frame0000001.ply',
      file: frameB,
      fileName: frameB.name,
      gaussianSplatSequence: {
        fps: 24,
        frameCount: 2,
        frames: [
          {
            name: frameA.name,
            projectPath: 'Raw/frame0000000.ply',
            file: frameA,
            splatUrl: 'blob:frame-a',
          },
          {
            name: frameB.name,
            projectPath: 'Raw/frame0000001.ply',
            file: frameB,
            splatUrl: 'blob:frame-b',
          },
        ],
      },
    });

    expect(loadGaussianSplatAssetMock).toHaveBeenCalledTimes(2);
    expect(loadGaussianSplatAssetMock.mock.calls.map(([file]) => file.name).sort()).toEqual([
      frameA.name,
      frameB.name,
    ]);
    expect(runtime.rawBounds).toEqual({
      min: [0, 0, 0],
      max: [10, 10, 10],
    });
    expect(runtime.normalizationScale).toBeCloseTo(0.1);
    expect(runtime.centers[0]).toBeCloseTo(1.5);
    expect(runtime.centers[1]).toBeCloseTo(0);
    expect(runtime.centers[2]).toBeCloseTo(0);
  });
});
