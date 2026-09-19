import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  requiresProjectLocalMediaCopies: vi.fn(() => false),
  settingsState: { copyMediaToProject: true },
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
  prepareRiveAsset: vi.fn(async () => ({
    metadata: {
      provider: 'rive',
      width: 512,
      height: 512,
      fps: 60,
      duration: 5,
      animationNames: ['Idle'],
      artboardNames: ['Main'],
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
    requiresProjectLocalMediaCopies: mocks.requiresProjectLocalMediaCopies,
  },
}));

vi.mock('../../src/services/vectorAnimation/lottieMetadata', () => ({
  prepareLottieAsset: mocks.prepareLottieAsset,
}));

vi.mock('../../src/services/vectorAnimation/riveMetadata', () => ({
  prepareRiveAsset: mocks.prepareRiveAsset,
}));

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mocks.settingsState,
  },
}));

import { processImport } from '../../src/stores/mediaStore/helpers/importPipeline';
import { revokeAllMediaObjectUrls } from '../../src/services/project/mediaObjectUrlManager';

function createFrameIndexSet(count: number): Set<number> {
  return new Set(Array.from({ length: count }, (_, index) => index));
}

describe('processImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.classifyMediaType.mockResolvedValue('video');
    mocks.getMediaInfo.mockResolvedValue({ duration: 12.5, width: 1920, height: 1080 });
    mocks.copyToRawFolder.mockResolvedValue(undefined);
    mocks.getProxyFrameCount.mockResolvedValue(0);
    mocks.getProxyFrameIndices.mockResolvedValue(new Set());
    mocks.isProjectOpen.mockReturnValue(true);
    mocks.requiresProjectLocalMediaCopies.mockReturnValue(false);
    mocks.settingsState.copyMediaToProject = true;
  });

  afterEach(() => {
    revokeAllMediaObjectUrls();
    vi.restoreAllMocks();
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
    expect(mocks.handleThumbnailDedup).toHaveBeenCalledWith('hash-123', undefined, 'media-1');
    expect(revokeObjectURLSpy).not.toHaveBeenCalledWith('blob:original');
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
  });

  it('copies picker files into browser-private projects even when auto-copy is disabled', async () => {
    mocks.settingsState.copyMediaToProject = false;
    mocks.requiresProjectLocalMediaCopies.mockReturnValue(true);
    const originalFile = new File(['original-bytes'], 'ipad-clip.mov', { type: 'video/quicktime' });
    const rawCopyFile = new File(['raw-copy-bytes'], 'ipad-clip.mov', { type: 'video/quicktime' });
    const rawHandle = {
      name: 'ipad-clip.mov',
      getFile: vi.fn(async () => rawCopyFile),
    } as unknown as FileSystemFileHandle;
    mocks.copyToRawFolder.mockResolvedValue({
      handle: rawHandle,
      relativePath: 'Raw/ipad-clip.mov',
      alreadyExisted: false,
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ipad-raw-copy');

    const result = await processImport({ file: originalFile, id: 'media-ipad' });

    expect(mocks.copyToRawFolder).toHaveBeenCalledWith(originalFile, undefined);
    expect(result.mediaFile.file).toBe(rawCopyFile);
    expect(result.mediaFile.projectPath).toBe('Raw/ipad-clip.mov');
  });

  it('keeps source-linked imports when auto-copy is disabled on a persistent picker backend', async () => {
    mocks.settingsState.copyMediaToProject = false;
    mocks.requiresProjectLocalMediaCopies.mockReturnValue(false);
    const file = new File(['desktop-bytes'], 'desktop-clip.mp4', { type: 'video/mp4' });
    const sourceHandle = {
      name: file.name,
      getFile: vi.fn(async () => file),
    } as unknown as FileSystemFileHandle;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:desktop-source');

    const result = await processImport({ file, id: 'media-desktop', handle: sourceHandle });

    expect(mocks.copyToRawFolder).not.toHaveBeenCalled();
    expect(result.mediaFile.file).toBe(file);
    expect(result.mediaFile.projectPath).toBeUndefined();
  });

  it('copies transient picker files into a persistent project for refresh restore', async () => {
    mocks.settingsState.copyMediaToProject = false;
    mocks.requiresProjectLocalMediaCopies.mockReturnValue(false);
    const transientFile = new File(['android-bytes'], 'android-photo.jpg', { type: 'image/jpeg' });
    const rawCopyFile = new File(['android-bytes'], 'android-photo.jpg', { type: 'image/jpeg' });
    const rawHandle = {
      name: rawCopyFile.name,
      getFile: vi.fn(async () => rawCopyFile),
    } as unknown as FileSystemFileHandle;
    mocks.classifyMediaType.mockResolvedValue('image');
    mocks.getMediaInfo.mockResolvedValue({ duration: 5, width: 1920, height: 1080 });
    mocks.copyToRawFolder.mockResolvedValue({
      handle: rawHandle,
      relativePath: 'Raw/android-photo.jpg',
      alreadyExisted: false,
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:android-project-copy');

    const result = await processImport({ file: transientFile, id: 'media-android' });

    expect(mocks.copyToRawFolder).toHaveBeenCalledWith(transientFile, undefined);
    expect(result.mediaFile.file).toBe(rawCopyFile);
    expect(result.mediaFile.projectPath).toBe('Raw/android-photo.jpg');
    expect(result.mediaFile.hasFileHandle).toBe(true);
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

  it('stores Rive metadata without using HTML media probing', async () => {
    mocks.classifyMediaType.mockResolvedValue('rive');
    const riveFile = new File(['rive-bytes'], 'anim.riv', {
      type: 'application/octet-stream',
      lastModified: 3,
    });

    const result = await processImport({
      file: riveFile,
      id: 'media-rive-1',
    });

    expect(mocks.prepareRiveAsset).toHaveBeenCalledWith(riveFile);
    expect(mocks.getMediaInfo).not.toHaveBeenCalled();
    expect(result.mediaFile.type).toBe('rive');
    expect(result.mediaFile.vectorAnimation).toEqual(expect.objectContaining({
      provider: 'rive',
      width: 512,
      height: 512,
      duration: 5,
    }));
    expect(result.mediaFile.width).toBe(512);
    expect(result.mediaFile.height).toBe(512);
    expect(result.mediaFile.fps).toBe(60);
    expect(result.mediaFile.duration).toBe(5);
  });

  it('ignores incomplete JPEG proxy frames during import', async () => {
    const result = await processImport({
      file: new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' }),
      id: 'media-legacy-proxy',
    });

    expect(result.mediaFile.proxyStatus).toBe('none');
    expect(result.mediaFile.proxyFrameCount).toBeUndefined();
    expect(result.mediaFile.proxyProgress).toBeUndefined();
    expect(result.mediaFile.proxyFps).toBeUndefined();
  });

  it('passes authoritative ProRes metadata into thumbnail backend selection', async () => {
    const file = new File(['prores'], 'camera.mov', { type: 'video/quicktime' });
    mocks.getMediaInfo.mockResolvedValue({
      duration: 8,
      width: 1920,
      height: 1080,
      videoCodecId: 'apch',
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:camera');

    await processImport({ file, id: 'media-prores' });

    expect(mocks.createThumbnail).toHaveBeenCalledWith(file, 'video', {
      videoCodecId: 'apch',
      duration: 8,
    });
  });

  it('can finish a media import without waiting for thumbnail generation', async () => {
    const file = new File(['video'], 'ipad-video.mov', { type: 'video/quicktime' });

    const result = await processImport({
      file,
      id: 'media-ipad-fast-import',
      generateThumbnail: false,
    });

    expect(result.mediaFile.thumbnailUrl).toBeUndefined();
    expect(mocks.createThumbnail).not.toHaveBeenCalled();
    expect(mocks.handleThumbnailDedup).not.toHaveBeenCalled();
  });

  it('preserves serializable container-level video metadata', async () => {
    mocks.getMediaInfo.mockResolvedValue({
      duration: 10,
      width: 1920,
      height: 1080,
      codedWidth: 1920,
      codedHeight: 1088,
      fps: 23.98,
      codec: 'ProRes 422 HQ',
      videoCodecId: 'apch',
      rotation: 0,
      pixelAspectRatio: { numerator: 1, denominator: 1 },
      videoColorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
      hasHighDynamicRange: false,
      canBeTransparent: false,
      hasAudio: true,
    });

    const result = await processImport({
      file: new File(['mov-bytes'], 'camera.mov', { type: 'video/quicktime' }),
      id: 'media-prores',
    });

    expect(result.mediaFile).toMatchObject({
      codec: 'ProRes 422 HQ',
      videoCodecId: 'apch',
      codedWidth: 1920,
      codedHeight: 1088,
      rotation: 0,
      pixelAspectRatio: { numerator: 1, denominator: 1 },
      hasHighDynamicRange: false,
      canBeTransparent: false,
    });
  });

  it('marks an existing JPEG proxy sequence as ready during import', async () => {
    mocks.getProxyFrameIndices.mockResolvedValue(createFrameIndexSet(375));

    const result = await processImport({
      file: new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' }),
      id: 'media-complete-proxy',
    });

    expect(result.mediaFile.proxyStatus).toBe('ready');
    expect(result.mediaFile.proxyFrameCount).toBe(375);
    expect(result.mediaFile.proxyProgress).toBe(100);
    expect(result.mediaFile.proxyFps).toBe(30);
    expect(result.mediaFile.proxyFormat).toBe('jpeg-sequence');
  });

  it('uses source fps when restoring a complete lower-fps proxy', async () => {
    mocks.getMediaInfo.mockResolvedValue({ duration: 12.5, width: 1920, height: 1080, fps: 24 });
    mocks.getProxyFrameIndices.mockResolvedValue(createFrameIndexSet(300));

    const result = await processImport({
      file: new File(['video-bytes'], 'clip-24fps.mp4', { type: 'video/mp4' }),
      id: 'media-complete-24fps-proxy',
    });

    expect(result.mediaFile.proxyStatus).toBe('ready');
    expect(result.mediaFile.proxyFrameCount).toBe(300);
    expect(result.mediaFile.proxyProgress).toBe(100);
    expect(result.mediaFile.proxyFps).toBe(24);
    expect(result.mediaFile.proxyFormat).toBe('jpeg-sequence');
  });
});
