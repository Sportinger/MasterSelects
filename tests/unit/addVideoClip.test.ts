import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';

const webCodecsHelperMocks = vi.hoisted(() => ({
  createVideoElement: vi.fn(),
  createAudioElement: vi.fn(),
  releaseTemporaryMediaElement: vi.fn(),
  waitForVideoMetadata: vi.fn(),
}));

const mp4MetadataMocks = vi.hoisted(() => ({
  getMP4MetadataFast: vi.fn(),
  estimateDurationFromFileSize: vi.fn(() => 5),
}));

vi.mock('../../src/stores/timeline/helpers/webCodecsHelpers', () => ({
  createVideoElement: webCodecsHelperMocks.createVideoElement,
  createAudioElement: webCodecsHelperMocks.createAudioElement,
  releaseTemporaryMediaElement: webCodecsHelperMocks.releaseTemporaryMediaElement,
  waitForVideoMetadata: webCodecsHelperMocks.waitForVideoMetadata,
}));

vi.mock('../../src/stores/timeline/helpers/mp4MetadataHelper', () => ({
  getMP4MetadataFast: mp4MetadataMocks.getMP4MetadataFast,
  estimateDurationFromFileSize: mp4MetadataMocks.estimateDurationFromFileSize,
}));

vi.mock('../../src/stores/timeline/helpers/audioDetection', () => ({
  detectVideoAudio: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/services/audio/timelineWaveformPyramidCache', () => ({
  SOURCE_WAVEFORM_MAX_PREVIEW_SAMPLES: 1000,
  SOURCE_WAVEFORM_PREVIEW_SAMPLES_PER_SECOND: 10,
  generateTimelineWaveformAnalysisForFile: vi.fn().mockResolvedValue({
    waveform: [],
    waveformChannels: [],
  }),
  mapSourceWaveformPreviewProgress: vi.fn((value: number) => value),
  mapSourceWaveformPyramidProgress: vi.fn((value: number) => value),
}));

vi.mock('../../src/services/project/ProjectFileService', () => ({
  projectFileService: {
    isProjectOpen: vi.fn(() => false),
  },
}));
import { useMediaStore } from '../../src/stores/mediaStore';
import { loadAudioMedia } from '../../src/stores/timeline/clip/addAudioClip';
import { loadVideoMedia } from '../../src/stores/timeline/clip/addVideoClip';

function createFile(name: string, type: string): File {
  return new File(['media'], name, { type });
}

function createTimelineClip(id: string, duration: number): TimelineClip {
  return {
    id,
    trackId: 'audio-1',
    name: `${id}.wav`,
    startTime: 0,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: { type: 'audio', naturalDuration: duration },
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
    effects: [],
  };
}

describe('direct video/audio add runtime sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [],
      getFileByName: vi.fn(() => true),
      importFile: vi.fn(),
    } as unknown as ReturnType<typeof useMediaStore.getState>);
    webCodecsHelperMocks.waitForVideoMetadata.mockResolvedValue(undefined);
    mp4MetadataMocks.getMP4MetadataFast.mockResolvedValue({ duration: 12, hasAudio: true });
  });

  it('loads browser video metadata without persisting video/audio elements on linked clips', async () => {
    const videoElement = {
      duration: 12,
      videoWidth: 1920,
      videoHeight: 1080,
      currentSrc: 'blob:temp-video',
      src: 'blob:temp-video',
      crossOrigin: 'anonymous',
      removeAttribute: vi.fn(),
      load: vi.fn(),
    } as unknown as HTMLVideoElement;
    webCodecsHelperMocks.createVideoElement.mockReturnValue(videoElement);

    const updates = new Map<string, Partial<TimelineClip>>();
    await loadVideoMedia({
      clipId: 'video-clip',
      audioClipId: 'audio-clip',
      file: createFile('clip.mp4', 'video/mp4'),
      mediaFileId: 'media-video',
      thumbnailsEnabled: false,
      waveformsEnabled: false,
      updateClip: (id, patch) => {
        updates.set(id, { ...(updates.get(id) ?? {}), ...patch });
      },
      setClips: vi.fn(),
    });

    const videoPatch = updates.get('video-clip')!;
    const audioPatch = updates.get('audio-clip')!;

    expect(videoPatch.source).toEqual({ type: 'video', naturalDuration: 12, mediaFileId: 'media-video' });
    expect(videoPatch.source).not.toHaveProperty('videoElement');
    expect(videoPatch.source).not.toHaveProperty('webCodecsPlayer');
    expect(videoPatch.transform).toEqual(expect.objectContaining({ scale: { x: 1, y: 1 } }));
    expect(videoPatch.isLoading).toBe(false);
    expect(audioPatch.source).toEqual({ type: 'audio', naturalDuration: 12, mediaFileId: 'media-video' });
    expect(audioPatch.source).not.toHaveProperty('audioElement');
    expect(audioPatch.isLoading).toBe(false);
    expect(webCodecsHelperMocks.releaseTemporaryMediaElement).toHaveBeenCalledWith(videoElement);
  });

  it('keeps an imported WebM duration when browser metadata reports only a short fragment', async () => {
    const videoElement = {
      duration: 1.3281195640563965,
      removeAttribute: vi.fn(),
      load: vi.fn(),
    } as unknown as HTMLVideoElement;
    webCodecsHelperMocks.createVideoElement.mockReturnValue(videoElement);
    mp4MetadataMocks.getMP4MetadataFast.mockResolvedValue(null);

    const updates = new Map<string, Partial<TimelineClip>>();
    await loadVideoMedia({
      clipId: 'video-clip',
      audioClipId: 'audio-clip',
      file: createFile('Screen Recording.webm', 'video/webm'),
      mediaFileId: 'media-video',
      authoritativeNaturalDuration: 24.585,
      thumbnailsEnabled: false,
      waveformsEnabled: false,
      updateClip: (id, patch) => {
        updates.set(id, { ...(updates.get(id) ?? {}), ...patch });
      },
      setClips: vi.fn(),
    });

    expect(updates.get('video-clip')).toEqual(expect.objectContaining({
      duration: 24.585,
      outPoint: 24.585,
      source: { type: 'video', naturalDuration: 24.585, mediaFileId: 'media-video' },
    }));
    expect(updates.get('audio-clip')).toEqual(expect.objectContaining({
      duration: 24.585,
      outPoint: 24.585,
      source: { type: 'audio', naturalDuration: 24.585, mediaFileId: 'media-video' },
    }));
  });

  it('loads audio metadata without persisting an audio element on the clip source', async () => {
    const audioElement = {
      duration: 8,
      currentSrc: 'blob:temp-audio',
      src: 'blob:temp-audio',
      removeAttribute: vi.fn(),
      load: vi.fn(),
      onloadedmetadata: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
    } as unknown as HTMLAudioElement;
    webCodecsHelperMocks.createAudioElement.mockImplementation(() => {
      queueMicrotask(() => {
        const handler = audioElement.onloadedmetadata as ((event: Event) => void) | null;
        handler?.(new Event('loadedmetadata'));
      });
      return audioElement;
    });

    const updates = new Map<string, Partial<TimelineClip>>();
    await loadAudioMedia({
      clip: createTimelineClip('audio-clip', 5),
      file: createFile('clip.wav', 'audio/wav'),
      mediaFileId: 'media-audio',
      waveformsEnabled: false,
      updateClip: (id, patch) => {
        updates.set(id, { ...(updates.get(id) ?? {}), ...patch });
      },
    });

    const patch = updates.get('audio-clip')!;
    expect(patch.duration).toBe(8);
    expect(patch.outPoint).toBe(8);
    expect(patch.source).toEqual({ type: 'audio', naturalDuration: 8, mediaFileId: 'media-audio' });
    expect(patch.source).not.toHaveProperty('audioElement');
    expect(patch.isLoading).toBe(false);
    expect(webCodecsHelperMocks.releaseTemporaryMediaElement).toHaveBeenCalledWith(audioElement);
  });
});
