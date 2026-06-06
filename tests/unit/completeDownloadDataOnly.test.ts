import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';
import { completeDownload } from '../../src/stores/timeline/clip/completeDownload';
import { useMediaStore } from '../../src/stores/mediaStore';
import { thumbnailCacheService } from '../../src/services/thumbnailCacheService';

function makePendingDownloadClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'yt-clip-1',
    trackId: 'video-1',
    name: 'Downloaded Clip',
    file: new File([], 'pending.mp4', { type: 'video/mp4' }),
    startTime: 4,
    duration: 30,
    inPoint: 0,
    outPoint: 30,
    source: null,
    transform: {},
    effects: [],
    isLoading: false,
    isPendingDownload: true,
    downloadProgress: 90,
    downloadSpeed: 1024,
    youtubeVideoId: 'youtube-1',
    youtubeThumbnail: 'https://img.youtube.test/thumb.jpg',
    ...overrides,
  } as TimelineClip;
}

describe('completeDownload data-only clip hydration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [],
      folders: [],
      createFolder: vi.fn(() => ({
        id: 'youtube-folder',
        name: 'YouTube',
        parentId: null,
        type: 'folder',
        createdAt: Date.now(),
      })),
      importFile: vi.fn(async (file: File) => ({
        id: 'media-download-1',
        name: file.name,
        type: 'video',
        parentId: 'youtube-folder',
        createdAt: Date.now(),
        file,
        url: 'blob:http://localhost/media-download-1',
        fileHash: 'hash-download-1',
        duration: 12,
      })),
    } as unknown as ReturnType<typeof useMediaStore.getState>);
  });

  it('completes downloaded video/audio clips without creating or storing media elements when import metadata has duration', async () => {
    const downloadedFile = new File(['video'], 'downloaded.mp4', { type: 'video/mp4' });
    const pendingClip = makePendingDownloadClip();
    let clips: TimelineClip[] = [pendingClip];
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => originalCreateElement(tagName));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/download-probe');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const generateForSourceUrl = vi.spyOn(thumbnailCacheService, 'generateForSourceUrl').mockResolvedValue(undefined);
    const set = vi.fn((state: { clips: TimelineClip[] }) => {
      clips = state.clips;
    });

    await completeDownload({
      clipId: 'yt-clip-1',
      file: downloadedFile,
      clips,
      waveformsEnabled: false,
      findAvailableAudioTrack: vi.fn(() => 'audio-1'),
      updateDuration: vi.fn(),
      invalidateCache: vi.fn(),
      set,
      get: () => ({ clips }),
    });

    await vi.waitFor(() => expect(generateForSourceUrl).toHaveBeenCalled());

    const videoClip = clips.find((clip) => clip.id === 'yt-clip-1');
    const audioClip = clips.find((clip) => clip.id !== 'yt-clip-1');
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(videoClip?.source).toEqual({
      type: 'video',
      naturalDuration: 12,
      mediaFileId: 'media-download-1',
    });
    expect((videoClip?.source as { videoElement?: HTMLVideoElement; webCodecsPlayer?: unknown } | undefined)?.videoElement).toBeUndefined();
    expect((videoClip?.source as { videoElement?: HTMLVideoElement; webCodecsPlayer?: unknown } | undefined)?.webCodecsPlayer).toBeUndefined();
    expect(audioClip?.source).toEqual({
      type: 'audio',
      naturalDuration: 12,
      mediaFileId: 'media-download-1',
    });
    expect((audioClip?.source as { audioElement?: HTMLAudioElement } | undefined)?.audioElement).toBeUndefined();
    expect(videoClip?.file).toBe(downloadedFile);
    expect(audioClip?.file).toBe(downloadedFile);
    expect(videoClip?.isPendingDownload).toBe(false);
    expect(videoClip?.linkedClipId).toBe(audioClip?.id);
    expect(audioClip?.linkedClipId).toBe(videoClip?.id);
    expect(generateForSourceUrl).toHaveBeenCalledWith(
      'media-download-1',
      'blob:http://localhost/media-download-1',
      12,
      'hash-download-1',
    );
  });
});
