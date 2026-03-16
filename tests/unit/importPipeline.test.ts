import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectMediaType: vi.fn(() => 'video'),
  calculateFileHash: vi.fn(async () => 'hash-123'),
  getMediaInfo: vi.fn(async () => ({ duration: 12.5, width: 1920, height: 1080 })),
  createThumbnail: vi.fn(async () => undefined),
  handleThumbnailDedup: vi.fn(async () => undefined),
  storeFileHandle: vi.fn(),
  storeHandle: vi.fn(async () => undefined),
  copyToRawFolder: vi.fn(),
  getProxyFrameCount: vi.fn(async () => 0),
  isProjectOpen: vi.fn(() => true),
}));

vi.mock('../../src/stores/timeline/helpers/mediaTypeHelpers', () => ({
  detectMediaType: mocks.detectMediaType,
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
    isProjectOpen: mocks.isProjectOpen,
  },
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
    mocks.detectMediaType.mockReturnValue('video');
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
});
