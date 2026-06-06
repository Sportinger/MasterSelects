import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipboardClipData } from '../../src/stores/timeline/types';
import { DEFAULT_TRACKS, DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { vectorAnimationRuntimeManager } from '../../src/services/vectorAnimation/VectorAnimationRuntimeManager';

function createFile(name: string, type: string): File {
  return new File(['media'], name, { type });
}

function createClipboardClip(overrides: Partial<ClipboardClipData>): ClipboardClipData {
  return {
    id: 'source-clip',
    trackId: 'video-1',
    trackType: 'video',
    name: 'Source Clip',
    mediaFileId: 'media-video',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    sourceType: 'video',
    naturalDuration: 5,
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}

async function flushPasteReload(): Promise<void> {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('clipboard paste data-only media reload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS,
      clips: [],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      clipboardData: null,
      playheadPosition: 10,
      duration: 60,
      targetTrackIdByType: {},
    });
  });

  it('pastes video and audio clips without creating runtime media elements or blob URLs', async () => {
    const videoFile = createFile('video.mp4', 'video/mp4');
    const audioFile = createFile('audio.wav', 'audio/wav');
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        { id: 'media-video', name: 'video.mp4', file: videoFile, duration: 12 },
        { id: 'media-audio', name: 'audio.wav', file: audioFile, duration: 8 },
      ],
    } as unknown as ReturnType<typeof useMediaStore.getState>);

    const createElement = vi.spyOn(document, 'createElement');
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unexpected-paste-media');

    useTimelineStore.setState({
      clipboardData: [
        createClipboardClip({
          id: 'source-video',
          trackId: 'video-1',
          trackType: 'video',
          name: 'video.mp4',
          mediaFileId: 'media-video',
          sourceType: 'video',
          naturalDuration: 12,
          duration: 12,
          outPoint: 12,
          linkedClipId: 'source-audio',
        }),
        createClipboardClip({
          id: 'source-audio',
          trackId: 'audio-1',
          trackType: 'audio',
          name: 'audio.wav',
          mediaFileId: 'media-audio',
          sourceType: 'audio',
          naturalDuration: 8,
          duration: 8,
          outPoint: 8,
          linkedClipId: 'source-video',
        }),
      ],
    });

    useTimelineStore.getState().pasteClips();
    await flushPasteReload();

    const pasted = useTimelineStore.getState().clips.toSorted((left, right) => left.trackId.localeCompare(right.trackId));
    const pastedAudio = pasted.find(clip => clip.source?.type === 'audio')!;
    const pastedVideo = pasted.find(clip => clip.source?.type === 'video')!;

    expect(createElement.mock.calls.some(([tag]) => tag === 'video' || tag === 'audio')).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(pastedVideo.file).toBe(videoFile);
    expect(pastedVideo.isLoading).toBe(false);
    expect(pastedVideo.needsReload).toBe(false);
    expect(pastedVideo.source).toEqual({ type: 'video', naturalDuration: 12, mediaFileId: 'media-video' });
    expect(pastedVideo.source).not.toHaveProperty('videoElement');
    expect(pastedVideo.source).not.toHaveProperty('webCodecsPlayer');
    expect(pastedAudio.file).toBe(audioFile);
    expect(pastedAudio.isLoading).toBe(false);
    expect(pastedAudio.needsReload).toBe(false);
    expect(pastedAudio.source).toEqual({ type: 'audio', naturalDuration: 8, mediaFileId: 'media-audio' });
    expect(pastedAudio.source).not.toHaveProperty('audioElement');
  });

  it('pastes model clips with media-owned urls instead of unmanaged object urls', async () => {
    const modelFile = createFile('hero.glb', 'model/gltf-binary');
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        {
          id: 'media-model',
          name: 'hero.glb',
          type: 'model',
          file: modelFile,
          url: 'blob:http://localhost/media-model-primary',
          duration: 10,
        },
      ],
    } as unknown as ReturnType<typeof useMediaStore.getState>);

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unexpected-model-paste');
    useTimelineStore.setState({
      clipboardData: [
        createClipboardClip({
          id: 'source-model',
          trackId: 'video-1',
          trackType: 'video',
          name: 'hero.glb',
          mediaFileId: 'media-model',
          sourceType: 'model',
          naturalDuration: 3600,
          duration: 10,
          outPoint: 10,
        }),
      ],
    });

    useTimelineStore.getState().pasteClips();
    await flushPasteReload();

    const pastedModel = useTimelineStore.getState().clips.find(clip => clip.source?.type === 'model')!;
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(pastedModel.file).toBe(modelFile);
    expect(pastedModel.isLoading).toBe(false);
    expect(pastedModel.needsReload).toBe(false);
    expect(pastedModel.source).toEqual({
      type: 'model',
      modelUrl: 'blob:http://localhost/media-model-primary',
      naturalDuration: 3600,
      mediaFileId: 'media-model',
    });
  });

  it('pastes vector animation clips without preparing runtime canvases', async () => {
    const lottieFile = createFile('anim.lottie', 'application/json');
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        {
          id: 'media-lottie',
          name: 'anim.lottie',
          type: 'lottie',
          file: lottieFile,
          duration: 6,
        },
      ],
    } as unknown as ReturnType<typeof useMediaStore.getState>);

    const prepareClipSource = vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource');
    useTimelineStore.setState({
      clipboardData: [
        createClipboardClip({
          id: 'source-lottie',
          trackId: 'video-1',
          trackType: 'video',
          name: 'anim.lottie',
          mediaFileId: 'media-lottie',
          sourceType: 'lottie',
          naturalDuration: 6,
          duration: 6,
          outPoint: 6,
        }),
      ],
    });

    useTimelineStore.getState().pasteClips();
    await flushPasteReload();

    const pastedVector = useTimelineStore.getState().clips.find(clip => clip.source?.type === 'lottie')!;
    expect(prepareClipSource).not.toHaveBeenCalled();
    expect(pastedVector.file).toBe(lottieFile);
    expect(pastedVector.isLoading).toBe(false);
    expect(pastedVector.needsReload).toBe(false);
    expect(pastedVector.source).toEqual(expect.objectContaining({
      type: 'lottie',
      naturalDuration: 6,
      mediaFileId: 'media-lottie',
    }));
    expect(pastedVector.source).not.toHaveProperty('textCanvas');
  });
});
