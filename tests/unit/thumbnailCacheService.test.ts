import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createThumbnailGenerationVideo,
  thumbnailCacheService,
} from '../../src/services/thumbnailCacheService';

describe('thumbnailCacheService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an isolated thumbnail video from the source element', () => {
    const clonedVideo = {
      src: '',
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
    } as unknown as HTMLVideoElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(clonedVideo as any);

    const sourceVideo = {
      src: 'blob:source-video',
      currentSrc: '',
      crossOrigin: 'anonymous',
    } as HTMLVideoElement;

    const result = createThumbnailGenerationVideo(sourceVideo);

    expect(result).toBe(clonedVideo);
    expect(createElementSpy).toHaveBeenCalledWith('video');
    expect(clonedVideo.src).toBe('blob:source-video');
    expect(clonedVideo.preload).toBe('auto');
    expect(clonedVideo.muted).toBe(true);
    expect(clonedVideo.playsInline).toBe(true);
    expect(clonedVideo.crossOrigin).toBe('anonymous');
    expect(clonedVideo.load).toHaveBeenCalled();
  });

  it('generates thumbnails from the isolated video instead of the preview video', async () => {
    const previewVideo = {
      src: 'blob:preview-video',
      currentSrc: '',
      crossOrigin: 'anonymous',
    } as HTMLVideoElement;
    const isolatedVideo = {
      src: '',
      readyState: 2,
      duration: 12,
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;

    vi.spyOn(document, 'createElement').mockReturnValue(isolatedVideo as any);
    vi.spyOn(thumbnailCacheService as any, 'loadFromDB').mockResolvedValue(false);
    const generateSpy = vi
      .spyOn(thumbnailCacheService as any, 'generateThumbnails')
      .mockResolvedValue(undefined);

    await thumbnailCacheService.generateForSource(
      `media-thumb-test-${Date.now()}`,
      previewVideo,
      12
    );

    expect(generateSpy).toHaveBeenCalledWith(
      expect.any(String),
      isolatedVideo,
      12,
      undefined,
      expect.any(AbortSignal)
    );
    expect(generateSpy).not.toHaveBeenCalledWith(
      expect.any(String),
      previewVideo,
      12,
      undefined,
      expect.any(AbortSignal)
    );
    expect(isolatedVideo.pause).toHaveBeenCalled();
    expect(isolatedVideo.removeAttribute).toHaveBeenCalledWith('src');
  });
});
