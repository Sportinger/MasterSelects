import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  classifyMediaType: vi.fn(async () => 'video'),
  calculateFileHash: vi.fn(async () => 'hash-123'),
  getMediaInfo: vi.fn(async () => ({ duration: 12.5, width: 1920, height: 1080 })),
  createThumbnail: vi.fn(async () => undefined),
  handleThumbnailDedup: vi.fn(async () => undefined),
  storeFileHandle: vi.fn(),
  storeHandle: vi.fn(async () => undefined),
  copyToRawFolder: vi.fn(),
  getProxyFrameCount: vi.fn(async () => 0),
  getProxyFrameIndices: vi.fn(async () => new Set<number>()),
  isProjectOpen: vi.fn(() => true),
  prepareLottieAsset: vi.fn(async () => ({
    metadata: {
      provider: 'lottie',
      width: 640,
      height: 360,
      fps: 30,
      duration: 4,
      totalFrames: 120,
    },
  })),
}));

vi.mock('../../src/stores/timeline/helpers/mediaTypeHelpers', () => ({
  classifyMediaType: mocks.classifyMediaType,
}));

vi.mock('../../src/stores/mediaStore/helpers/fileHashHelpers', () => ({
  calculateFileHash: mocks.calculateFileHash,
}));

vi.mock('../../src/stores/mediaStore/helpers/mediaInfoHelpers', () => ({
  getMediaInfo: mocks.getMediaInfo,
}));

vi.mock('../../src/stores/mediaStore/helpers/thumbnailHelpers', () => ({
  createThumbnail: mocks.createThumbnail,
  handleThumbnailDedup: mocks.handleThumbnailDedup,
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
    getProxyFrameCount: mocks.getProxyFrameCount,
    getProxyFrameIndices: mocks.getProxyFrameIndices,
    isProjectOpen: mocks.isProjectOpen,
  },
}));

vi.mock('../../src/services/vectorAnimation/lottieMetadata', () => ({
  prepareLottieAsset: mocks.prepareLottieAsset,
}));

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ copyMediaToProject: true }),
  },
}));

import { processImport } from '../../src/stores/mediaStore/helpers/importPipeline';

describe('processImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.classifyMediaType.mockResolvedValue('video');
    mocks.getMediaInfo.mockResolvedValue({ duration: 12.5, width: 1920, height: 1080 });
    mocks.copyToRawFolder.mockResolvedValue(undefined);
    mocks.getProxyFrameCount.mockResolvedValue(0);
    mocks.getProxyFrameIndices.mockResolvedValue(new Set());
    mocks.isProjectOpen.mockReturnValue(true);
  });

  it('promotes the project RAW copy to the canonical media source', async () => {
    const originalFile = new File(['original-bytes'], 'clip.mp4', { type: 'video/mp4' });
    const rawCopyFile = new File(['raw-copy-bytes'], 'clip.mp4', { type: 'video/mp4' });
    const rawHandle = {
      name: 'clip.mp4',
      getFile: vi.fn(async () => rawCopyFile),
    } as unknown as FileSystemFileHandle;

    mocks.copyToRawFolder.mockResolvedValue({
      handle: rawHandle,
      relativePath: 'Raw/clip.mp4',
      alreadyExisted: false,
    });

    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((value: Blob | MediaSource) => value === rawCopyFile ? 'blob:raw-copy' : 'blob:original');
    const revokeObjectURLSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    const result = await processImport({
      file: originalFile,
      id: 'media-1',
    });

    expect(result.mediaFile.file).toBe(rawCopyFile);
    expect(result.mediaFile.url).toBe('blob:raw-copy');
    expect(result.mediaFile.projectPath).toBe('Raw/clip.mp4');
    expect(result.mediaFile.hasFileHandle).toBe(true);

    expect(mocks.storeFileHandle).toHaveBeenCalledWith('media-1_project', rawHandle);
    expect(mocks.storeFileHandle).toHaveBeenCalledWith('media-1', rawHandle);
    expect(mocks.storeHandle).toHaveBeenCalledWith('media_media-1_project', rawHandle);
    expect(mocks.storeHandle).toHaveBeenCalledWith('media_media-1', rawHandle);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:original');
    expect(createObjectURLSpy).toHaveBeenCalledTimes(2);
  });

  it('stores Lottie metadata without using HTML media probing', async () => {
    mocks.classifyMediaType.mockResolvedValue('lottie');
    const lottieFile = new File(['{"v":"5.8.1"}'], 'anim.lottie', {
      type: 'application/zip',
      lastModified: 2,
    });

    const result = await processImport({
      file: lottieFile,
      id: 'media-lottie-1',
    });

    expect(mocks.prepareLottieAsset).toHaveBeenCalledWith(lottieFile);
    expect(mocks.getMediaInfo).not.toHaveBeenCalled();
    expect(result.mediaFile.type).toBe('lottie');
    expect(result.mediaFile.vectorAnimation).toEqual(expect.objectContaining({
      provider: 'lottie',
      width: 640,
      height: 360,
      duration: 4,
    }));
    expect(result.mediaFile.width).toBe(640);
    expect(result.mediaFile.height).toBe(360);
    expect(result.mediaFile.fps).toBe(30);
    expect(result.mediaFile.duration).toBe(4);
  });

  it('does not mark a partial existing proxy as ready during import', async () => {
    mocks.getProxyFrameCount.mockResolvedValue(300);
    mocks.getProxyFrameIndices.mockResolvedValue(
      new Set(Array.from({ length: 300 }, (_, index) => index))
    );

    const result = await processImport({
      file: new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' }),
      id: 'media-partial-proxy',
    });

    expect(result.mediaFile.proxyStatus).toBe('none');
    expect(result.mediaFile.proxyFrameCount).toBe(300);
    expect(result.mediaFile.proxyProgress).toBe(80);
    expect(result.mediaFile.proxyFps).toBeUndefined();
  });

  it('marks an existing proxy as ready only when enough frames are present', async () => {
    mocks.getProxyFrameCount.mockResolvedValue(370);
    mocks.getProxyFrameIndices.mockResolvedValue(
      new Set(Array.from({ length: 370 }, (_, index) => index))
    );

    const result = await processImport({
      file: new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' }),
      id: 'media-complete-proxy',
    });

    expect(result.mediaFile.proxyStatus).toBe('ready');
    expect(result.mediaFile.proxyFrameCount).toBe(370);
    expect(result.mediaFile.proxyProgress).toBe(100);
    expect(result.mediaFile.proxyFps).toBe(30);
  });

  it('uses source fps when restoring a complete lower-fps proxy', async () => {
    mocks.getMediaInfo.mockResolvedValue({ duration: 12.5, width: 1920, height: 1080, fps: 24 });
    mocks.getProxyFrameIndices.mockResolvedValue(
      new Set(Array.from({ length: 300 }, (_, index) => index))
    );

    const result = await processImport({
      file: new File(['video-bytes'], 'clip-24fps.mp4', { type: 'video/mp4' }),
      id: 'media-complete-24fps-proxy',
    });

    expect(result.mediaFile.proxyStatus).toBe('ready');
    expect(result.mediaFile.proxyFrameCount).toBe(300);
    expect(result.mediaFile.proxyProgress).toBe(100);
    expect(result.mediaFile.proxyFps).toBe(24);
  });
});
