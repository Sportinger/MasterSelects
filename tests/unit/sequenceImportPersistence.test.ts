import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settingsState: {
    copyMediaToProject: false,
  },
  storeFileHandle: vi.fn(),
  storeHandle: vi.fn(async () => undefined),
  copyToRawFolder: vi.fn(),
  isProjectOpen: vi.fn(() => true),
  loadGaussianSplatAsset: vi.fn(),
}));

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mocks.settingsState,
  },
}));

vi.mock('../../src/services/fileSystemService', () => ({
  fileSystemService: {
    storeFileHandle: mocks.storeFileHandle,
  },
}));

vi.mock('../../src/services/projectDB', () => ({
  projectDB: {
    storeHandle: mocks.storeHandle,
  },
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    copyToRawFolder: mocks.copyToRawFolder,
    isProjectOpen: mocks.isProjectOpen,
  },
}));

vi.mock('../../src/engine/gaussian/loaders', () => ({
  loadGaussianSplatAsset: mocks.loadGaussianSplatAsset,
}));

describe('sequence import persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsState.copyMediaToProject = false;
    mocks.isProjectOpen.mockReturnValue(true);
    mocks.copyToRawFolder.mockImplementation(async (file: File, fileName?: string) => ({
      handle: {
        name: fileName ?? file.name,
        getFile: vi.fn(async () => file),
      } as unknown as FileSystemFileHandle,
      relativePath: `Raw/${fileName ?? file.name}`,
    }));
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      if (blob instanceof File) {
        return `blob:${blob.name}`;
      }
      return 'blob:unknown';
    });
    mocks.loadGaussianSplatAsset.mockImplementation(async (file: File) => ({
      metadata: {
        format: 'ply',
        splatCount: 1,
        isTemporal: false,
        frameCount: 1,
        fps: 0,
        totalDuration: 0,
        boundingBox: {
          min: [-1, -2, -3],
          max: [4, 5, 6],
        },
        byteSize: 56,
        perSplatByteStride: 56,
        hasSphericalHarmonics: false,
        shDegree: 0,
        compressionType: 'none',
      },
      frames: [{
        index: 0,
        buffer: {
          data: new Float32Array(14),
          splatCount: 1,
          shDegree: 0,
        },
      }],
      sourceFile: file,
      sourceUrl: `memory://${file.name}`,
    }));
  });

  it('copies gaussian splat sequences into project RAW when imported without handles', async () => {
    const { processGaussianSplatSequenceImport } = await import('../../src/stores/mediaStore/helpers/gaussianSplatSequenceImport');
    const frameA = new File(['a'], 'scan000000.ply', { type: 'application/octet-stream' });
    const frameB = new File(['b'], 'scan000001.ply', { type: 'application/octet-stream' });

    const result = await processGaussianSplatSequenceImport({
      id: 'splat-seq-1',
      sequence: {
        entries: [
          { file: frameA, absolutePath: 'C:/scan000000.ply' },
          { file: frameB, absolutePath: 'C:/scan000001.ply' },
        ],
        extension: '.ply',
        frameCount: 2,
        prefix: 'scan',
        sequenceName: 'scan',
        displayName: 'scan (2f)',
      },
    });

    expect(mocks.copyToRawFolder).toHaveBeenCalledTimes(2);
    expect(mocks.copyToRawFolder).toHaveBeenNthCalledWith(1, frameA, 'scan/scan000000.ply');
    expect(mocks.copyToRawFolder).toHaveBeenNthCalledWith(2, frameB, 'scan/scan000001.ply');
    expect(result.projectPath).toBe('Raw/scan/scan000000.ply');
    expect(result.hasFileHandle).toBe(true);
    expect(mocks.loadGaussianSplatAsset).toHaveBeenCalledTimes(1);
    expect(mocks.loadGaussianSplatAsset).toHaveBeenCalledWith(frameA);
    expect(result.gaussianSplatSequence?.sharedBounds).toEqual({
      min: [-1, -2, -3],
      max: [4, 5, 6],
    });
    expect(result.gaussianSplatSequence?.frames).toEqual([
      expect.objectContaining({
        name: 'scan000000.ply',
        projectPath: 'Raw/scan/scan000000.ply',
        splatUrl: 'blob:scan000000.ply',
      }),
      expect.objectContaining({
        name: 'scan000001.ply',
        projectPath: 'Raw/scan/scan000001.ply',
        splatUrl: 'blob:scan000001.ply',
      }),
    ]);
  });

  it('copies model sequences into project RAW when imported without handles', async () => {
    const { processModelSequenceImport } = await import('../../src/stores/mediaStore/helpers/modelSequenceImport');
    const frameA = new File(['a'], 'hero000000.glb', { type: 'model/gltf-binary' });
    const frameB = new File(['b'], 'hero000001.glb', { type: 'model/gltf-binary' });

    const result = await processModelSequenceImport({
      id: 'model-seq-1',
      sequence: {
        entries: [
          { file: frameA, absolutePath: 'C:/hero000000.glb' },
          { file: frameB, absolutePath: 'C:/hero000001.glb' },
        ],
        extension: '.glb',
        frameCount: 2,
        prefix: 'hero',
        sequenceName: 'hero',
        displayName: 'hero (2f)',
      },
    });

    expect(mocks.copyToRawFolder).toHaveBeenCalledTimes(2);
    expect(mocks.copyToRawFolder).toHaveBeenNthCalledWith(1, frameA, 'hero/hero000000.glb');
    expect(mocks.copyToRawFolder).toHaveBeenNthCalledWith(2, frameB, 'hero/hero000001.glb');
    expect(result.projectPath).toBe('Raw/hero/hero000000.glb');
    expect(result.hasFileHandle).toBe(true);
    expect(mocks.loadGaussianSplatAsset).not.toHaveBeenCalled();
    expect(result.modelSequence?.frames).toEqual([
      expect.objectContaining({
        name: 'hero000000.glb',
        projectPath: 'Raw/hero/hero000000.glb',
        modelUrl: 'blob:hero000000.glb',
      }),
      expect.objectContaining({
        name: 'hero000001.glb',
        projectPath: 'Raw/hero/hero000001.glb',
        modelUrl: 'blob:hero000001.glb',
      }),
    ]);
  });

  it('copies model sequences into project RAW even when source handles exist', async () => {
    const { processModelSequenceImport } = await import('../../src/stores/mediaStore/helpers/modelSequenceImport');
    const frameA = new File(['a'], 'hero000000.glb', { type: 'model/gltf-binary' });
    const frameB = new File(['b'], 'hero000001.glb', { type: 'model/gltf-binary' });
    const handleA = { name: frameA.name } as FileSystemFileHandle;
    const handleB = { name: frameB.name } as FileSystemFileHandle;

    await processModelSequenceImport({
      id: 'model-seq-handles',
      sequence: {
        entries: [
          { file: frameA, handle: handleA, absolutePath: 'C:/hero000000.glb' },
          { file: frameB, handle: handleB, absolutePath: 'C:/hero000001.glb' },
        ],
        extension: '.glb',
        frameCount: 2,
        prefix: 'hero',
        sequenceName: 'hero',
        displayName: 'hero (2f)',
      },
    });

    expect(mocks.copyToRawFolder).toHaveBeenCalledTimes(2);
    expect(mocks.copyToRawFolder).toHaveBeenNthCalledWith(1, frameA, 'hero/hero000000.glb');
    expect(mocks.copyToRawFolder).toHaveBeenNthCalledWith(2, frameB, 'hero/hero000001.glb');
  });
});
