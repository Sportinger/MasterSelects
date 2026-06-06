import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../../src/engine/WebGPUEngine';
import { layerBuilder } from '../../src/services/layerBuilder';
import { NativeHelperClient } from '../../src/services/nativeHelper/NativeHelperClient';
import {
  getPrimaryMediaObjectUrlKey,
  mediaObjectUrlManager,
  revokeAllMediaObjectUrls,
} from '../../src/services/project/mediaObjectUrlManager';
import { projectFileService } from '../../src/services/projectFileService';
import { vectorAnimationRuntimeManager } from '../../src/services/vectorAnimation/VectorAnimationRuntimeManager';
import * as lottieMetadata from '../../src/services/vectorAnimation/lottieMetadata';
import * as riveMetadata from '../../src/services/vectorAnimation/riveMetadata';
import { useMediaStore, type Composition, type MediaFile } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { blobUrlManager } from '../../src/stores/timeline/helpers/blobUrlManager';
import type { CompositionTimelineData, GaussianSplatSequenceData, Keyframe, SerializableClip, TimelineTrack } from '../../src/types';
import {
  createDataOnlyRestoredMediaSource,
  createDataOnlyRestoredVideoSource,
  getReusableModelUrl,
} from '../../src/stores/timeline/restoredMediaSource';

const compositionAudioMixerMocks = vi.hoisted(() => ({
  mixdownComposition: vi.fn(),
  createAudioElement: vi.fn(),
}));

vi.mock('../../src/services/compositionAudioMixer', () => ({
  compositionAudioMixer: compositionAudioMixerMocks,
}));

const initialTimelineState = useTimelineStore.getState();
type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

const transform = {
  opacity: 1,
  blendMode: 'normal' as const,
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
};

function videoTrack(id: string): TimelineTrack {
  return {
    id,
    name: id,
    type: 'video',
    height: 80,
    muted: false,
    solo: false,
    visible: true,
  } as TimelineTrack;
}

function audioTrack(id: string): TimelineTrack {
  return {
    id,
    name: id,
    type: 'audio',
    height: 80,
    muted: false,
    solo: false,
    visible: true,
  } as TimelineTrack;
}

function clip(overrides: Partial<SerializableClip>): SerializableClip {
  return {
    id: 'clip-video',
    trackId: 'track-video',
    name: 'Video.mp4',
    mediaFileId: 'media-video',
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    sourceType: 'video',
    naturalDuration: 10,
    transform,
    effects: [],
    ...overrides,
  };
}

function timelineData(overrides: Partial<CompositionTimelineData> = {}): CompositionTimelineData {
  return {
    tracks: [videoTrack('track-video')],
    clips: [clip({})],
    playheadPosition: 0,
    duration: 10,
    zoom: 50,
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    loopPlayback: false,
    ...overrides,
  };
}

function composition(overrides: Partial<Composition>): Composition {
  return {
    id: 'comp-source',
    name: 'Nested Source',
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 10,
    backgroundColor: '#000000',
    timelineData: timelineData(),
    ...overrides,
  };
}

function mediaFile(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    id: 'media-video',
    name: 'Video.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    file: new File(['video'], 'Video.mp4', { type: 'video/mp4' }),
    url: 'blob:media-video',
    duration: 12,
    absolutePath: 'C:/media/Video.mp4',
    ...overrides,
  } as MediaFile;
}

function gaussianSplatSequence(): GaussianSplatSequenceData {
  return {
    fps: 2,
    frameCount: 2,
    playbackMode: 'clamp',
    sequenceName: 'scan',
    frames: [
      {
        name: 'scan000000.ply',
        projectPath: 'Raw/scan000000.ply',
        splatUrl: 'https://assets.local/scan000000.ply',
      },
      {
        name: 'scan000001.ply',
        projectPath: 'Raw/scan000001.ply',
        splatUrl: 'https://assets.local/scan000001.ply',
      },
    ],
  };
}

function mediaStoreState(overrides: Partial<MediaStoreState> = {}): MediaStoreState {
  return {
    files: [],
    compositions: [],
    folders: [],
    selectedIds: [],
    expandedFolderIds: [],
    textItems: [],
    solidItems: [],
    activeCompositionId: null,
    outputResolution: { width: 1920, height: 1080 },
    sourceMonitorInPoint: null,
    sourceMonitorOutPoint: null,
    addMediaFile: vi.fn(),
    updateComposition: vi.fn(),
    setSourceMonitorInPoint: vi.fn(),
    setSourceMonitorOutPoint: vi.fn(),
    clearSourceMonitorInOut: vi.fn(),
    getActiveComposition: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
    getOrCreateTextFolder: vi.fn().mockReturnValue('text-folder-1'),
    createTextItem: vi.fn(),
    getOrCreateSolidFolder: vi.fn().mockReturnValue('solid-folder-1'),
    createSolidItem: vi.fn(),
    ...overrides,
  } as MediaStoreState;
}

describe('serialization nested video restore', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState());
    compositionAudioMixerMocks.mixdownComposition.mockReset();
    compositionAudioMixerMocks.createAudioElement.mockReset();
    useTimelineStore.setState({ thumbnailsEnabled: false });
    (engine as { clearCaches?: () => void }).clearCaches = vi.fn();
    (engine as { requestRender?: () => void }).requestRender = vi.fn();
    (layerBuilder as { invalidateCache?: () => void }).invalidateCache = vi.fn();
    (layerBuilder as { getVideoSyncManager?: () => { reset: () => void } }).getVideoSyncManager = () => ({
      reset: vi.fn(),
    });
  });

  afterEach(() => {
    blobUrlManager.clear();
    revokeAllMediaObjectUrls();
    const nativeClient = NativeHelperClient as unknown as Record<string, unknown>;
    delete nativeClient.parseFileReferenceUrl;
    delete nativeClient.getReferencedFile;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useTimelineStore.setState(initialTimelineState);
  });

  it('creates data-only video sources with media ids and file paths', () => {
    expect(createDataOnlyRestoredVideoSource(
      { mediaFileId: 'media-video', naturalDuration: undefined },
      8,
      { duration: 12, absolutePath: 'C:/media/Video.mp4' },
    )).toEqual({
      type: 'video',
      naturalDuration: 12,
      mediaFileId: 'media-video',
      filePath: 'C:/media/Video.mp4',
    });
  });

  it('creates data-only audio sources with media ids and file paths', () => {
    expect(createDataOnlyRestoredMediaSource(
      { mediaFileId: 'media-audio', naturalDuration: undefined },
      8,
      { duration: 12, absolutePath: 'C:/media/Audio.mp3' },
      'audio',
    )).toEqual({
      type: 'audio',
      naturalDuration: 12,
      mediaFileId: 'media-audio',
      filePath: 'C:/media/Audio.mp3',
    });
  });

  it('rejects stale model blob URLs without a usable file', () => {
    expect(getReusableModelUrl({ url: 'blob:stale-model' })).toBeUndefined();
    expect(getReusableModelUrl({ url: 'blob:placeholder-model', file: new File([], 'Model.glb') })).toBeUndefined();
    expect(getReusableModelUrl({ url: 'blob:live-model', file: new File(['model'], 'Model.glb') })).toBe('blob:live-model');
    expect(getReusableModelUrl({ url: 'https://assets.local/Model.glb' })).toBe('https://assets.local/Model.glb');
  });

  it('restores top-level video and audio clips without eager media elements or blob URLs', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const createElement = vi.spyOn(document, 'createElement');
    const videoFile = mediaFile();
    const audioFile = mediaFile({
      id: 'media-audio',
      name: 'Audio.mp3',
      type: 'audio',
      file: new File(['audio'], 'Audio.mp3', { type: 'audio/mpeg' }),
      url: 'blob:media-audio',
      absolutePath: 'C:/media/Audio.mp3',
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [videoFile, audioFile],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('video-track'), audioTrack('audio-track')],
      clips: [
        clip({
          id: 'video-clip',
          trackId: 'video-track',
          mediaFileId: videoFile.id,
          sourceType: 'video',
        }),
        clip({
          id: 'audio-clip',
          trackId: 'audio-track',
          name: 'Audio.mp3',
          mediaFileId: audioFile.id,
          sourceType: 'audio',
        }),
      ],
    }));

    const restoredVideo = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'video-clip');
    const restoredAudio = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'audio-clip');

    expect(restoredVideo?.source).toMatchObject({
      type: 'video',
      mediaFileId: videoFile.id,
      naturalDuration: 10,
      filePath: videoFile.absolutePath,
    });
    expect(restoredVideo?.source?.videoElement).toBeUndefined();
    expect(restoredVideo?.source?.webCodecsPlayer).toBeUndefined();
    expect(restoredVideo?.isLoading).toBe(false);
    expect(restoredAudio?.source).toMatchObject({
      type: 'audio',
      mediaFileId: audioFile.id,
      naturalDuration: 10,
      filePath: audioFile.absolutePath,
    });
    expect(restoredAudio?.source?.audioElement).toBeUndefined();
    expect(restoredAudio?.isLoading).toBe(false);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');
  });

  it('restores direct nested video clips without eager video elements or blob URLs', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const createElement = vi.spyOn(document, 'createElement');
    const file = mediaFile();
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({ id: 'nested-video', mediaFileId: file.id })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-video');

    expect(nestedClip?.source).toMatchObject({
      type: 'video',
      mediaFileId: file.id,
      naturalDuration: 10,
      filePath: file.absolutePath,
    });
    expect(nestedClip?.source?.videoElement).toBeUndefined();
    expect(nestedClip?.source?.webCodecsPlayer).toBeUndefined();
    expect(nestedClip?.isLoading).toBe(false);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');
  });

  it('restores direct nested audio clips without eager audio elements or blob URLs', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const createElement = vi.spyOn(document, 'createElement');
    const file = mediaFile({
      id: 'media-audio',
      name: 'Audio.mp3',
      type: 'audio',
      file: new File(['audio'], 'Audio.mp3', { type: 'audio/mpeg' }),
      url: 'blob:media-audio',
      absolutePath: 'C:/media/Audio.mp3',
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        tracks: [audioTrack('nested-audio-track')],
        clips: [clip({
          id: 'nested-audio',
          trackId: 'nested-audio-track',
          name: 'Audio.mp3',
          mediaFileId: file.id,
          sourceType: 'audio',
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-audio');

    expect(nestedClip?.source).toMatchObject({
      type: 'audio',
      mediaFileId: file.id,
      naturalDuration: 10,
      filePath: file.absolutePath,
    });
    expect(nestedClip?.source?.audioElement).toBeUndefined();
    expect(nestedClip?.isLoading).toBe(false);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');
    expect(compositionAudioMixerMocks.mixdownComposition).not.toHaveBeenCalled();
    expect(compositionAudioMixerMocks.createAudioElement).not.toHaveBeenCalled();
  });

  it('restores direct nested primitive mesh clips without media files', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-mesh',
          name: 'Nested Cube',
          mediaFileId: 'missing-mesh-media',
          sourceType: 'model',
          meshType: 'cube',
          threeDEffectorsEnabled: false,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedMesh = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-mesh');

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(nestedMesh).toEqual(expect.objectContaining({
      name: 'Nested Cube',
      is3D: true,
      isLoading: false,
      meshType: 'cube',
      wireframe: false,
    }));
    expect(nestedMesh?.source).toEqual(expect.objectContaining({
      type: 'model',
      meshType: 'cube',
      mediaFileId: 'missing-mesh-media',
      naturalDuration: Number.MAX_SAFE_INTEGER,
      threeDEffectorsEnabled: false,
    }));
  });

  it('uses managed blob ownership for top-level data-only image restore', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:top-level-image');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const imageConstructor = vi.fn(function MockImage() {
      return document.createElement('img');
    });
    vi.stubGlobal('Image', imageConstructor);
    const imageFile = mediaFile({
      id: 'media-image',
      name: 'Still.png',
      type: 'image',
      file: new File(['image'], 'Still.png', { type: 'image/png' }),
      url: '',
      duration: 10,
      absolutePath: 'C:/media/Still.png',
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [imageFile],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      clips: [clip({
        id: 'top-level-image',
        name: 'Still.png',
        mediaFileId: imageFile.id,
        sourceType: 'image',
      })],
    }));

    const loadingClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'top-level-image');

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledWith(imageFile.file);
    expect(blobUrlManager.get('top-level-image', 'image')).toBe('blob:top-level-image');
    expect(imageConstructor).not.toHaveBeenCalled();
    expect(loadingClip?.source).toMatchObject({
      type: 'image',
      imageUrl: 'blob:top-level-image',
    });
    expect(loadingClip?.source?.imageElement).toBeUndefined();
    expect(loadingClip?.isLoading).toBe(false);

    useTimelineStore.getState().clearTimeline();

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:top-level-image');
    expect(blobUrlManager.get('top-level-image', 'image')).toBeUndefined();
  });

  it('replaces stale top-level image blob URLs with clip-owned managed restore URLs', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:managed-image');
    const imageConstructor = vi.fn(function MockImage() {
      return document.createElement('img');
    });
    vi.stubGlobal('Image', imageConstructor);
    const imageFile = mediaFile({
      id: 'media-stale-image',
      name: 'Still.png',
      type: 'image',
      file: new File(['image'], 'Still.png', { type: 'image/png' }),
      url: 'blob:stale-image',
      duration: 10,
      absolutePath: 'C:/media/Still.png',
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [imageFile],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      clips: [clip({
        id: 'top-level-stale-image',
        name: 'Still.png',
        mediaFileId: imageFile.id,
        sourceType: 'image',
      })],
    }));

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledWith(imageFile.file);
    expect(blobUrlManager.get('top-level-stale-image', 'image')).toBe('blob:managed-image');
    expect(imageConstructor).not.toHaveBeenCalled();
    const restoredClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'top-level-stale-image');
    expect(restoredClip?.source).toMatchObject({
      type: 'image',
      imageUrl: 'blob:managed-image',
    });
  });

  it('uses media-scoped primary URL ownership for NativeHelper recovered top-level image files', async () => {
    vi.spyOn(projectFileService, 'activeBackend', 'get').mockReturnValue('native');
    const recoveredFile = new File(['image'], 'Still.png', { type: 'image/png' });
    const nativeClient = NativeHelperClient as unknown as {
      parseFileReferenceUrl: ReturnType<typeof vi.fn>;
      getReferencedFile: ReturnType<typeof vi.fn>;
    };
    nativeClient.parseFileReferenceUrl = vi.fn(() => 'C:/media/Still.png');
    nativeClient.getReferencedFile = vi.fn(async () => recoveredFile);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:native-image');
    const imageConstructor = vi.fn(function MockImage() {
      return document.createElement('img');
    });
    vi.stubGlobal('Image', imageConstructor);
    const imageFile = mediaFile({
      id: 'media-native-image',
      name: 'Still.png',
      type: 'image',
      file: undefined,
      url: 'native-helper-file://C:/media/Still.png',
      duration: 10,
      absolutePath: 'C:/media/Still.png',
      filePath: undefined,
      projectPath: undefined,
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [imageFile],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      clips: [clip({
        id: 'native-top-level-image',
        name: 'Still.png',
        mediaFileId: imageFile.id,
        sourceType: 'image',
      })],
    }));

    expect(nativeClient.parseFileReferenceUrl).toHaveBeenCalledWith('native-helper-file://C:/media/Still.png');
    expect(nativeClient.getReferencedFile).toHaveBeenCalledWith('native-helper-file://C:/media/Still.png', 'Still.png');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledWith(recoveredFile);
    expect(mediaObjectUrlManager.get(imageFile.id, getPrimaryMediaObjectUrlKey())).toBe('blob:native-image');
    expect(blobUrlManager.get('native-top-level-image', 'image')).toBeUndefined();
    expect(imageConstructor).not.toHaveBeenCalled();
    const restoredClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'native-top-level-image');
    expect(restoredClip?.source).toMatchObject({
      type: 'image',
      imageUrl: 'blob:native-image',
    });
  });

  it.each([
    { sourceType: 'video' as const, fileName: 'Native.mp4', mimeType: 'video/mp4' },
    { sourceType: 'audio' as const, fileName: 'Native.wav', mimeType: 'audio/wav' },
  ])('keeps native $sourceType restore data-only without dereferencing NativeHelper files', async ({ sourceType, fileName, mimeType }) => {
    vi.spyOn(projectFileService, 'activeBackend', 'get').mockReturnValue('native');
    const nativeClient = NativeHelperClient as unknown as {
      parseFileReferenceUrl: ReturnType<typeof vi.fn>;
      getReferencedFile: ReturnType<typeof vi.fn>;
    };
    nativeClient.parseFileReferenceUrl = vi.fn(() => 'C:/media/Native');
    nativeClient.getReferencedFile = vi.fn(async () => new File(['native'], fileName, { type: mimeType }));
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const nativeFile = mediaFile({
      id: `media-native-${sourceType}`,
      name: fileName,
      type: sourceType,
      file: undefined,
      url: `native-helper-file://C:/media/${fileName}`,
      duration: 12,
      absolutePath: `C:/media/${fileName}`,
      filePath: undefined,
      projectPath: undefined,
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [nativeFile],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      clips: [clip({
        id: `native-top-level-${sourceType}`,
        name: fileName,
        mediaFileId: nativeFile.id,
        sourceType,
        naturalDuration: 12,
      })],
    }));

    const restoredClip = useTimelineStore.getState().clips.find((candidate) =>
      candidate.id === `native-top-level-${sourceType}`
    );

    expect(nativeClient.parseFileReferenceUrl).not.toHaveBeenCalled();
    expect(nativeClient.getReferencedFile).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(mediaObjectUrlManager.get(nativeFile.id, getPrimaryMediaObjectUrlKey())).toBeUndefined();
    expect(restoredClip?.isLoading).toBe(false);
    expect(restoredClip?.needsReload).toBe(false);
    expect(restoredClip?.source).toMatchObject({
      type: sourceType,
      mediaFileId: nativeFile.id,
      filePath: `C:/media/${fileName}`,
      naturalDuration: 12,
    });
  });

  it.each([
    { sourceType: 'image' as const, fileName: 'Still.png' },
    { sourceType: 'lottie' as const, fileName: 'anim.lottie' },
  ])('marks top-level $sourceType clips needing relink without starting runtime restore', async ({ sourceType, fileName }) => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const imageCtor = vi.fn(() => document.createElement('img'));
    vi.stubGlobal('Image', imageCtor as unknown as typeof Image);
    const prepareSpy = vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource');
    const file = mediaFile({
      id: `media-${sourceType}`,
      name: fileName,
      type: sourceType,
      file: undefined,
      url: '',
      duration: 10,
      absolutePath: undefined,
      filePath: undefined,
      projectPath: undefined,
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      clips: [clip({
        id: `top-level-${sourceType}`,
        name: fileName,
        mediaFileId: file.id,
        sourceType,
        naturalDuration: 7,
      })],
    }));

    const restoredClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === `top-level-${sourceType}`);

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(imageCtor).not.toHaveBeenCalled();
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(restoredClip).toEqual(expect.objectContaining({
      isLoading: false,
      needsReload: true,
      source: expect.objectContaining({
        type: sourceType,
        naturalDuration: 7,
        mediaFileId: file.id,
      }),
    }));
    expect(layerBuilder.invalidateCache).not.toHaveBeenCalled();
    expect(engine.requestRender).not.toHaveBeenCalled();
  });

  it('restores direct nested model clips from existing sequence URLs without new blob URLs', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const modelSequence = {
      fps: 2,
      frameCount: 2,
      playbackMode: 'clamp' as const,
      frames: [
        { name: 'Hero000.glb', modelUrl: 'https://assets.local/Hero000.glb' },
        { name: 'Hero001.glb', modelUrl: 'https://assets.local/Hero001.glb' },
      ],
    };
    const file = mediaFile({
      id: 'media-model',
      name: 'Hero.glb',
      type: 'model',
      file: new File(['model'], 'Hero.glb', { type: 'model/gltf-binary' }),
      url: 'https://assets.local/Hero.glb',
      duration: 12,
      modelSequence,
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-model',
          name: 'Hero.glb',
          mediaFileId: file.id,
          sourceType: 'model',
          modelSequence,
          meshType: 'text3d',
          is3D: true,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-model');

    expect(nestedClip?.source).toMatchObject({
      type: 'model',
      mediaFileId: file.id,
      modelUrl: 'https://assets.local/Hero000.glb',
      naturalDuration: 10,
      modelSequence: expect.objectContaining({ frameCount: 2 }),
      meshType: 'text3d',
    });
    expect(nestedClip?.is3D).toBe(true);
    expect(nestedClip?.isLoading).toBe(false);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('restores direct nested gaussian splat clips from existing sequence URLs without new blob URLs', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const sequence = gaussianSplatSequence();
    const file = mediaFile({
      id: 'media-splat',
      name: 'scan.ply',
      type: 'gaussian-splat',
      file: new File(['splat'], 'scan.ply', { type: 'application/octet-stream' }),
      url: 'https://assets.local/scan.ply',
      duration: 1,
      gaussianSplatSequence: sequence,
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-splat',
          name: 'Scan',
          mediaFileId: file.id,
          sourceType: 'gaussian-splat',
          gaussianSplatSequence: sequence,
          naturalDuration: 1,
          is3D: true,
          threeDEffectorsEnabled: false,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-splat');

    expect(nestedClip?.source).toMatchObject({
      type: 'gaussian-splat',
      mediaFileId: file.id,
      gaussianSplatUrl: 'https://assets.local/scan000000.ply',
      gaussianSplatFileName: 'scan000000.ply',
      gaussianSplatRuntimeKey: 'Raw/scan000000.ply',
      naturalDuration: 1,
      gaussianSplatSequence: expect.objectContaining({ frameCount: 2, sequenceName: 'scan' }),
      threeDEffectorsEnabled: false,
    });
    expect(nestedClip?.is3D).toBe(true);
    expect(nestedClip?.isLoading).toBe(false);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('keeps managed blob URL fallback for top-level model clips and revokes it on clearTimeline', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:top-level-model');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = mediaFile({
      id: 'media-model',
      name: 'Hero.glb',
      type: 'model',
      file: new File(['model'], 'Hero.glb', { type: 'model/gltf-binary' }),
      url: '',
      duration: 12,
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      clips: [clip({
        id: 'top-level-model',
        name: 'Hero.glb',
        mediaFileId: file.id,
        sourceType: 'model',
        is3D: true,
      })],
    }));

    const restoredClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'top-level-model');

    expect(restoredClip?.source).toMatchObject({
      type: 'model',
      mediaFileId: file.id,
      modelUrl: 'blob:top-level-model',
      naturalDuration: 10,
    });
    expect(restoredClip?.is3D).toBe(true);
    expect(restoredClip?.isLoading).toBe(false);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(blobUrlManager.get('top-level-model', 'model')).toBe('blob:top-level-model');

    useTimelineStore.getState().clearTimeline();

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:top-level-model');
    expect(blobUrlManager.get('top-level-model', 'model')).toBeUndefined();
  });

  it('keeps managed blob URL fallback for legacy top-level gaussian avatar clips and revokes it on clearTimeline', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:top-level-avatar');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const file = mediaFile({
      id: 'media-avatar',
      name: 'Avatar.zip',
      type: 'gaussian-avatar',
      file: new File(['avatar'], 'Avatar.zip', { type: 'application/zip' }),
      url: '',
      duration: 3600,
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      clips: [clip({
        id: 'top-level-avatar',
        name: 'Avatar.zip',
        mediaFileId: file.id,
        sourceType: 'gaussian-avatar',
        naturalDuration: 3600,
        is3D: true,
        gaussianBlendshapes: {
          jawOpen: 0.4,
        },
      })],
    }));

    const restoredClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'top-level-avatar');

    expect(restoredClip?.source).toMatchObject({
      type: 'gaussian-avatar',
      mediaFileId: file.id,
      gaussianAvatarUrl: 'blob:top-level-avatar',
      gaussianBlendshapes: {
        jawOpen: 0.4,
      },
      naturalDuration: 3600,
    });
    expect(restoredClip?.is3D).toBe(true);
    expect(restoredClip?.isLoading).toBe(false);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(blobUrlManager.get('top-level-avatar', 'model')).toBe('blob:top-level-avatar');

    useTimelineStore.getState().clearTimeline();

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:top-level-avatar');
    expect(blobUrlManager.get('top-level-avatar', 'model')).toBeUndefined();
  });

  it('keeps blob URL fallback for direct nested model clips without reusable URLs', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:nested-model');
    const file = mediaFile({
      id: 'media-model',
      name: 'Hero.glb',
      type: 'model',
      file: new File(['model'], 'Hero.glb', { type: 'model/gltf-binary' }),
      url: '',
      duration: 12,
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-model',
          name: 'Hero.glb',
          mediaFileId: file.id,
          sourceType: 'model',
          is3D: true,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-model');

    expect(nestedClip?.source).toMatchObject({
      type: 'model',
      mediaFileId: file.id,
      modelUrl: 'blob:nested-model',
      naturalDuration: 10,
    });
    expect(nestedClip?.is3D).toBe(true);
    expect(nestedClip?.isLoading).toBe(false);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(blobUrlManager.get(nestedClip?.id ?? '', 'model')).toBe('blob:nested-model');
  });

  it('keeps blob URL fallback for legacy direct nested gaussian avatar clips without leaving them loading', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:nested-avatar');
    const file = mediaFile({
      id: 'media-avatar',
      name: 'Avatar.zip',
      type: 'gaussian-avatar',
      file: new File(['avatar'], 'Avatar.zip', { type: 'application/zip' }),
      url: '',
      duration: 3600,
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-avatar',
          name: 'Avatar.zip',
          mediaFileId: file.id,
          sourceType: 'gaussian-avatar',
          is3D: true,
          gaussianBlendshapes: {
            eyeBlinkLeft: 0.25,
          },
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-avatar');

    expect(nestedClip?.source).toMatchObject({
      type: 'gaussian-avatar',
      mediaFileId: file.id,
      gaussianAvatarUrl: 'blob:nested-avatar',
      gaussianBlendshapes: {
        eyeBlinkLeft: 0.25,
      },
      naturalDuration: 10,
    });
    expect(nestedClip?.is3D).toBe(true);
    expect(nestedClip?.isLoading).toBe(false);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(blobUrlManager.get(nestedClip?.id ?? '', 'model')).toBe('blob:nested-avatar');
  });

  it('uses managed blob ownership for direct nested data-only image restore', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:nested-image');
    const createElement = vi.spyOn(document, 'createElement');
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);
    const imageFile = mediaFile({
      id: 'media-image',
      name: 'Still.png',
      type: 'image',
      file: new File(['image'], 'Still.png', { type: 'image/png' }),
      url: '',
      duration: 10,
      absolutePath: 'C:/media/Still.png',
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-image',
          name: 'Still.png',
          mediaFileId: imageFile.id,
          sourceType: 'image',
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [imageFile],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-image');

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledWith(imageFile.file);
    expect(blobUrlManager.get(nestedClip?.id ?? '', 'image')).toBe('blob:nested-image');
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');
    expect(nestedClip?.source).toEqual(expect.objectContaining({
      type: 'image',
      mediaFileId: imageFile.id,
      imageUrl: 'blob:nested-image',
      naturalDuration: 10,
      filePath: 'C:/media/Still.png',
    }));
    expect(nestedClip?.source?.imageElement).toBeUndefined();
    expect(nestedClip?.isLoading).toBe(false);
    expect(createdImages).toHaveLength(0);
    expect(layerBuilder.invalidateCache).toHaveBeenCalledTimes(1);
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
  });

  it('restores sub-nested image clips as data-only sources through the nested clip tree', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sub-nested-image');
    const createElement = vi.spyOn(document, 'createElement');
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);
    const imageFile = mediaFile({
      id: 'media-sub-image',
      name: 'NestedStill.png',
      type: 'image',
      file: new File(['image'], 'NestedStill.png', { type: 'image/png' }),
      url: '',
      duration: 10,
      absolutePath: 'C:/media/NestedStill.png',
    });
    const childComp = composition({
      id: 'child-comp',
      timelineData: timelineData({
        clips: [clip({
          id: 'child-image',
          name: 'NestedStill.png',
          mediaFileId: imageFile.id,
          sourceType: 'image',
        })],
      }),
    });
    const parentComp = composition({
      id: 'parent-comp',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-comp-source',
          name: 'Nested Comp',
          sourceType: 'video',
          isComposition: true,
          compositionId: childComp.id,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [imageFile],
      compositions: [parentComp, childComp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: parentComp.id,
        isComposition: true,
        compositionId: parentComp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedCompClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.isComposition);
    const nestedImage = nestedCompClip?.nestedClips?.find((candidate) => candidate.mediaFileId === imageFile.id);

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledWith(imageFile.file);
    expect(blobUrlManager.get(nestedImage?.id ?? '', 'image')).toBe('blob:sub-nested-image');
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');
    expect(nestedImage?.source).toEqual(expect.objectContaining({
      type: 'image',
      mediaFileId: imageFile.id,
      imageUrl: 'blob:sub-nested-image',
      naturalDuration: 10,
      filePath: 'C:/media/NestedStill.png',
    }));
    expect(nestedImage?.source?.imageElement).toBeUndefined();
    expect(nestedImage?.isLoading).toBe(false);
    expect(layerBuilder.invalidateCache).toHaveBeenCalledTimes(1);
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
    expect(createdImages).toHaveLength(0);
  });

  it.each([
    { sourceType: 'lottie' as const, fileName: 'anim.lottie' },
    { sourceType: 'rive' as const, fileName: 'anim.riv' },
  ])('prepares top-level $sourceType runtime without object URLs while restore buffer is pending', async ({ sourceType, fileName }) => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unexpected-vector');
    const readLottieMetadataSpy = vi.spyOn(lottieMetadata, 'readLottieMetadata');
    const readRiveMetadataSpy = vi.spyOn(riveMetadata, 'readRiveMetadata');
    const canvas = document.createElement('canvas');
    const file = mediaFile({
      id: `media-${sourceType}`,
      name: fileName,
      type: sourceType,
      file: new File(['vector'], fileName, { type: 'application/octet-stream' }),
      url: '',
      duration: 4,
      absolutePath: `C:/media/${fileName}`,
    });
    const audioFile = mediaFile({
      id: 'media-audio-filler',
      name: 'Audio.mp3',
      type: 'audio',
      file: new File(['audio'], 'Audio.mp3', { type: 'audio/mpeg' }),
      url: 'blob:media-audio-filler',
      absolutePath: 'C:/media/Audio.mp3',
    });
    let preparedBeforeFlush = false;
    const prepareSpy = vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource').mockImplementation(async (runtimeClip, runtimeFile) => {
      preparedBeforeFlush = !useTimelineStore.getState().clips.some((candidate) => candidate.id === runtimeClip.id);
      expect(runtimeFile).toBe(file.file);
      return {
        canvas,
        metadata: {
          provider: sourceType,
          duration: 8,
        },
      };
    });
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);
    const fillerClips = Array.from({ length: 63 }, (_, index) => clip({
      id: `audio-filler-${index}`,
      trackId: 'audio-track',
      name: 'Audio.mp3',
      mediaFileId: audioFile.id,
      sourceType: 'audio',
    }));
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file, audioFile],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('track-video'), audioTrack('audio-track')],
      clips: [
        clip({
          id: `top-level-${sourceType}`,
          name: fileName,
          mediaFileId: file.id,
          sourceType,
          naturalDuration: 4,
        }),
        ...fillerClips,
      ],
    }));

    const restoredClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === `top-level-${sourceType}`);

    expect(preparedBeforeFlush).toBe(true);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(readLottieMetadataSpy).not.toHaveBeenCalled();
    expect(readRiveMetadataSpy).not.toHaveBeenCalled();
    expect(prepareSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: `top-level-${sourceType}`,
      source: expect.objectContaining({ type: sourceType, mediaFileId: file.id }),
    }), file.file);
    expect(renderSpy).toHaveBeenCalledWith(expect.objectContaining({ id: `top-level-${sourceType}` }), 0);
    expect(restoredClip?.source).toEqual(expect.objectContaining({
      type: sourceType,
      textCanvas: canvas,
      mediaFileId: file.id,
      naturalDuration: 8,
    }));
    expect(restoredClip?.isLoading).toBe(false);
    expect(restoredClip?.needsReload).toBe(false);
  });

  it('does not patch or wake preview for stale top-level vector runtime completions', async () => {
    const canvas = document.createElement('canvas');
    let resolvePrepare!: (value: {
      canvas: HTMLCanvasElement;
      metadata: { provider: 'lottie'; duration: number };
    }) => void;
    const preparePromise = new Promise<{
      canvas: HTMLCanvasElement;
      metadata: { provider: 'lottie'; duration: number };
    }>((resolve) => {
      resolvePrepare = resolve;
    });
    vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource').mockReturnValue(preparePromise);
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);
    const destroySpy = vi.spyOn(vectorAnimationRuntimeManager, 'destroyClipRuntime').mockImplementation(() => undefined);
    const file = mediaFile({
      id: 'media-lottie',
      name: 'anim.lottie',
      type: 'lottie',
      file: new File(['{}'], 'anim.lottie', { type: 'application/json' }),
      url: '',
      duration: 4,
      absolutePath: 'C:/media/anim.lottie',
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      clips: [clip({
        id: 'top-level-lottie',
        name: 'anim.lottie',
        mediaFileId: file.id,
        sourceType: 'lottie',
        naturalDuration: 4,
      })],
    }));

    const restoredClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'top-level-lottie');
    expect(restoredClip?.source).toEqual(expect.objectContaining({
      type: 'lottie',
      mediaFileId: file.id,
    }));
    expect(restoredClip?.source).not.toHaveProperty('textCanvas');
    expect(restoredClip?.isLoading).toBe(true);

    useTimelineStore.setState({ timelineSessionId: useTimelineStore.getState().timelineSessionId + 1 });
    resolvePrepare({
      canvas,
      metadata: {
        provider: 'lottie',
        duration: 6,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const staleClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'top-level-lottie');
    expect(staleClip?.source).toEqual(expect.objectContaining({
      type: 'lottie',
      mediaFileId: file.id,
    }));
    expect(staleClip?.source).not.toHaveProperty('textCanvas');
    expect(staleClip?.isLoading).toBe(true);
    expect(renderSpy).not.toHaveBeenCalled();
    expect(destroySpy).toHaveBeenCalledWith('top-level-lottie', 'lottie');
    expect(layerBuilder.invalidateCache).not.toHaveBeenCalled();
    expect(engine.requestRender).not.toHaveBeenCalled();
  });

  it('restores top-level gaussian splat sequence URLs without duplicate object URLs', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unexpected-splat');
    const gaussianSplatSequence = {
      fps: 2,
      frameCount: 2,
      playbackMode: 'clamp' as const,
      sequenceName: 'scan',
      frames: [
        {
          name: 'scan000000.ply',
          projectPath: 'Raw/scan000000.ply',
          splatUrl: 'https://assets.local/scan000000.ply',
          splatCount: 1000,
        },
        {
          name: 'scan000001.ply',
          projectPath: 'Raw/scan000001.ply',
          splatUrl: 'https://assets.local/scan000001.ply',
          splatCount: 1100,
        },
      ],
    };
    const file = mediaFile({
      id: 'media-splat-seq',
      name: 'scan sequence',
      type: 'gaussian-splat',
      file: new File(['splat'], 'scan000000.ply', { type: 'application/octet-stream' }),
      url: 'https://assets.local/scan-sequence.ply',
      duration: 1,
      gaussianSplatSequence,
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      clips: [clip({
        id: 'top-level-splat-seq',
        name: 'Scan Sequence',
        mediaFileId: file.id,
        sourceType: 'gaussian-splat',
        naturalDuration: 1,
      })],
    }));

    const restoredClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'top-level-splat-seq');

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(restoredClip?.source).toEqual(expect.objectContaining({
      type: 'gaussian-splat',
      gaussianSplatUrl: 'https://assets.local/scan000000.ply',
      gaussianSplatFileName: 'scan000000.ply',
      gaussianSplatRuntimeKey: 'Raw/scan000000.ply',
      gaussianSplatSequence: expect.objectContaining({
        frameCount: 2,
        sequenceName: 'scan',
      }),
      naturalDuration: 1,
      mediaFileId: file.id,
    }));
    expect(restoredClip?.is3D).toBe(true);
    expect(restoredClip?.isLoading).toBe(false);
  });

  it('prepares direct nested vector animation runtime through the shared restore helper', async () => {
    const canvas = document.createElement('canvas');
    const prepareSpy = vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource').mockResolvedValue({
      canvas,
      metadata: {
        provider: 'lottie',
        duration: 6,
      },
    });
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);
    const file = mediaFile({
      id: 'media-lottie',
      name: 'anim.lottie',
      type: 'lottie',
      file: new File(['{}'], 'anim.lottie', { type: 'application/json' }),
      url: '',
      duration: 4,
      absolutePath: 'C:/media/anim.lottie',
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-lottie',
          name: 'anim.lottie',
          mediaFileId: file.id,
          sourceType: 'lottie',
          naturalDuration: 4,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));
    await Promise.resolve();
    await Promise.resolve();

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-lottie');

    expect(prepareSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'nested-comp-clip-nested-lottie',
      source: expect.objectContaining({ type: 'lottie', mediaFileId: file.id }),
    }), file.file);
    expect(renderSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'nested-comp-clip-nested-lottie' }), 0);
    expect(nestedClip?.source).toEqual(expect.objectContaining({
      type: 'lottie',
      textCanvas: canvas,
      mediaFileId: file.id,
      naturalDuration: 6,
    }));
    expect(nestedClip?.isLoading).toBe(false);
    expect(layerBuilder.invalidateCache).toHaveBeenCalledTimes(1);
    expect(engine.requestRender).toHaveBeenCalledTimes(1);
  });

  it('does not patch or wake preview for stale loadState nested vector runtime completions', async () => {
    const canvas = document.createElement('canvas');
    let resolvePrepare!: (value: {
      canvas: HTMLCanvasElement;
      metadata: { provider: 'lottie'; duration: number };
    }) => void;
    const preparePromise = new Promise<{
      canvas: HTMLCanvasElement;
      metadata: { provider: 'lottie'; duration: number };
    }>((resolve) => {
      resolvePrepare = resolve;
    });
    vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource').mockReturnValue(preparePromise);
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);
    const destroySpy = vi.spyOn(vectorAnimationRuntimeManager, 'destroyClipRuntime').mockImplementation(() => undefined);
    const file = mediaFile({
      id: 'media-lottie',
      name: 'anim.lottie',
      type: 'lottie',
      file: new File(['{}'], 'anim.lottie', { type: 'application/json' }),
      url: '',
      duration: 4,
      absolutePath: 'C:/media/anim.lottie',
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-lottie',
          name: 'anim.lottie',
          mediaFileId: file.id,
          sourceType: 'lottie',
          naturalDuration: 4,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-lottie');
    expect(nestedClip?.source).toBeNull();
    expect(nestedClip?.isLoading).toBe(true);

    useTimelineStore.setState({ timelineSessionId: useTimelineStore.getState().timelineSessionId + 1 });
    resolvePrepare({
      canvas,
      metadata: {
        provider: 'lottie',
        duration: 6,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const staleCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const staleNestedClip = staleCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-lottie');
    expect(staleNestedClip?.source).toBeNull();
    expect(staleNestedClip?.isLoading).toBe(true);
    expect(renderSpy).not.toHaveBeenCalled();
    expect(destroySpy).toHaveBeenCalledWith('nested-comp-clip-nested-lottie', 'lottie');
    expect(layerBuilder.invalidateCache).not.toHaveBeenCalled();
    expect(engine.requestRender).not.toHaveBeenCalled();
  });

  it('marks direct nested image clips needing relink without starting runtime restore', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const imageCtor = vi.fn(() => document.createElement('img'));
    vi.stubGlobal('Image', imageCtor as unknown as typeof Image);
    const imageFile = mediaFile({
      id: 'media-image',
      name: 'Still.png',
      type: 'image',
      file: undefined,
      url: '',
      duration: 10,
      absolutePath: undefined,
      filePath: undefined,
      projectPath: undefined,
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-image',
          name: 'Still.png',
          mediaFileId: imageFile.id,
          sourceType: 'image',
          naturalDuration: 7,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [imageFile],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-image');
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(imageCtor).not.toHaveBeenCalled();
    expect(nestedClip).toEqual(expect.objectContaining({
      isLoading: false,
      needsReload: true,
      source: {
        type: 'image',
        naturalDuration: 7,
        mediaFileId: imageFile.id,
        threeDEffectorsEnabled: true,
      },
    }));
    expect(layerBuilder.invalidateCache).not.toHaveBeenCalled();
    expect(engine.requestRender).not.toHaveBeenCalled();
  });

  it('marks sub-nested vector animation clips needing relink without preparing runtime sources', async () => {
    const prepareSpy = vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource');
    const vectorFile = mediaFile({
      id: 'media-lottie',
      name: 'anim.lottie',
      type: 'lottie',
      file: undefined,
      url: '',
      duration: 4,
      absolutePath: undefined,
      filePath: undefined,
      projectPath: undefined,
    });
    const childComp = composition({
      id: 'child-comp',
      timelineData: timelineData({
        clips: [clip({
          id: 'child-lottie',
          name: 'anim.lottie',
          mediaFileId: vectorFile.id,
          sourceType: 'lottie',
          naturalDuration: 4,
        })],
      }),
    });
    const parentComp = composition({
      id: 'parent-comp',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-comp-source',
          name: 'Nested Comp',
          sourceType: 'video',
          isComposition: true,
          compositionId: childComp.id,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [vectorFile],
      compositions: [parentComp, childComp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: parentComp.id,
        isComposition: true,
        compositionId: parentComp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedCompClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.isComposition);
    const nestedVector = nestedCompClip?.nestedClips?.find((candidate) => candidate.mediaFileId === vectorFile.id);
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(nestedVector).toEqual(expect.objectContaining({
      isLoading: false,
      needsReload: true,
      source: {
        type: 'lottie',
        naturalDuration: 4,
        mediaFileId: vectorFile.id,
        threeDEffectorsEnabled: true,
      },
    }));
  });

  it('preserves nested spatial fallback source when a loadState media item needs relink', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const modelFile = mediaFile({
      id: 'media-model',
      name: 'Hero.glb',
      type: 'model',
      file: undefined,
      url: '',
      duration: 3600,
      absolutePath: undefined,
      filePath: undefined,
      projectPath: undefined,
    });
    const comp = composition({
      id: 'comp-source',
      timelineData: timelineData({
        clips: [clip({
          id: 'nested-model',
          name: 'Hero.glb',
          mediaFileId: modelFile.id,
          sourceType: 'model',
          naturalDuration: 12,
          is3D: true,
          threeDEffectorsEnabled: false,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [modelFile],
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'comp-clip',
        trackId: 'parent-track',
        name: 'Comp Clip',
        mediaFileId: comp.id,
        isComposition: true,
        compositionId: comp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-clip');
    const nestedModel = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-comp-clip-nested-model');
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(nestedModel).toEqual(expect.objectContaining({
      isLoading: false,
      needsReload: true,
      is3D: true,
      source: expect.objectContaining({
        type: 'model',
        naturalDuration: 12,
        mediaFileId: modelFile.id,
        threeDEffectorsEnabled: false,
      }),
    }));
  });

  it('restores sub-nested video clips without eager video elements or blob URLs', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const createElement = vi.spyOn(document, 'createElement');
    const file = mediaFile();
    const childComp = composition({
      id: 'child-comp',
      name: 'Child Comp',
      timelineData: timelineData({
        clips: [clip({ id: 'child-video', mediaFileId: file.id })],
      }),
    });
    const parentComp = composition({
      id: 'parent-comp',
      name: 'Parent Comp',
      timelineData: timelineData({
        clips: [clip({
          id: 'child-comp-clip',
          mediaFileId: childComp.id,
          isComposition: true,
          compositionId: childComp.id,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [parentComp, childComp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'parent-comp-clip',
        trackId: 'parent-track',
        name: 'Parent Comp Clip',
        mediaFileId: parentComp.id,
        isComposition: true,
        compositionId: parentComp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'parent-comp-clip');
    const restoredChildCompClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-parent-comp-clip-child-comp-clip');
    const subNestedVideo = restoredChildCompClip?.nestedClips?.find((candidate) =>
      candidate.id === 'nested-nested-parent-comp-clip-child-comp-clip-child-video'
    );

    expect(subNestedVideo?.source).toMatchObject({
      type: 'video',
      mediaFileId: file.id,
      naturalDuration: 10,
      filePath: file.absolutePath,
    });
    expect(subNestedVideo?.source?.videoElement).toBeUndefined();
    expect(subNestedVideo?.source?.webCodecsPlayer).toBeUndefined();
    expect(subNestedVideo?.isLoading).toBe(false);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');
  });

  it('remaps keyframes for nested composition clips and sub-nested media clips', async () => {
    const file = mediaFile();
    const childComp = composition({
      id: 'child-comp',
      name: 'Child Comp',
      timelineData: timelineData({
        clips: [clip({
          id: 'child-video',
          mediaFileId: file.id,
          keyframes: [{
            id: 'kf-child-video',
            clipId: 'child-video',
            property: 'opacity',
            time: 1,
            value: 0.5,
            interpolation: 'linear',
          } as Keyframe],
        })],
      }),
    });
    const parentComp = composition({
      id: 'parent-comp',
      name: 'Parent Comp',
      timelineData: timelineData({
        clips: [clip({
          id: 'child-comp-clip',
          mediaFileId: childComp.id,
          isComposition: true,
          compositionId: childComp.id,
          keyframes: [{
            id: 'kf-child-comp',
            clipId: 'child-comp-clip',
            property: 'scale.x',
            time: 0.5,
            value: 1.25,
            interpolation: 'linear',
          } as Keyframe],
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [file],
      compositions: [parentComp, childComp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'parent-comp-clip',
        trackId: 'parent-track',
        name: 'Parent Comp Clip',
        mediaFileId: parentComp.id,
        isComposition: true,
        compositionId: parentComp.id,
      })],
    }));

    const clipKeyframes = useTimelineStore.getState().clipKeyframes;
    expect(clipKeyframes.get('nested-parent-comp-clip-child-comp-clip')).toEqual([
      expect.objectContaining({
        id: 'kf-child-comp',
        clipId: 'nested-parent-comp-clip-child-comp-clip',
      }),
    ]);
    expect(clipKeyframes.get('nested-nested-parent-comp-clip-child-comp-clip-child-video')).toEqual([
      expect.objectContaining({
        id: 'kf-child-video',
        clipId: 'nested-nested-parent-comp-clip-child-comp-clip-child-video',
      }),
    ]);
  });

  it('restores sub-nested primitive mesh clips without media files', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const childComp = composition({
      id: 'child-comp',
      name: 'Child Comp',
      timelineData: timelineData({
        clips: [clip({
          id: 'child-mesh',
          name: 'Child Cube',
          mediaFileId: 'missing-child-mesh-media',
          sourceType: 'model',
          meshType: 'cube',
        })],
      }),
    });
    const parentComp = composition({
      id: 'parent-comp',
      name: 'Parent Comp',
      timelineData: timelineData({
        clips: [clip({
          id: 'child-comp-clip',
          mediaFileId: childComp.id,
          isComposition: true,
          compositionId: childComp.id,
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      files: [],
      compositions: [parentComp, childComp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [videoTrack('parent-track')],
      clips: [clip({
        id: 'parent-comp-clip',
        trackId: 'parent-track',
        name: 'Parent Comp Clip',
        mediaFileId: parentComp.id,
        isComposition: true,
        compositionId: parentComp.id,
      })],
    }));

    const restoredCompClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'parent-comp-clip');
    const restoredChildCompClip = restoredCompClip?.nestedClips?.find((candidate) => candidate.id === 'nested-parent-comp-clip-child-comp-clip');
    const subNestedMesh = restoredChildCompClip?.nestedClips?.find((candidate) =>
      candidate.id === 'nested-nested-parent-comp-clip-child-comp-clip-child-mesh'
    );

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(subNestedMesh).toEqual(expect.objectContaining({
      name: 'Child Cube',
      is3D: true,
      isLoading: false,
      meshType: 'cube',
    }));
    expect(subNestedMesh?.source).toEqual(expect.objectContaining({
      type: 'model',
      meshType: 'cube',
      mediaFileId: 'missing-child-mesh-media',
      naturalDuration: Number.MAX_SAFE_INTEGER,
      threeDEffectorsEnabled: true,
    }));
  });

  it('restores composition audio clips without eager audio elements or mixdowns', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const createElement = vi.spyOn(document, 'createElement');
    const comp = composition({
      id: 'comp-with-audio',
      timelineData: timelineData({
        tracks: [audioTrack('nested-audio-track')],
        clips: [clip({
          id: 'nested-audio',
          trackId: 'nested-audio-track',
          sourceType: 'audio',
        })],
      }),
    });
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaStoreState({
      compositions: [comp],
    }));

    await useTimelineStore.getState().loadState(timelineData({
      tracks: [audioTrack('parent-audio-track')],
      clips: [clip({
        id: 'comp-audio-clip',
        trackId: 'parent-audio-track',
        name: 'Comp Audio',
        sourceType: 'audio',
        mediaFileId: '',
        isComposition: true,
        compositionId: comp.id,
        waveform: [0, 0.2, 0.4, 0.2, 0],
      })],
    }));
    await Promise.resolve();
    await Promise.resolve();

    const restoredClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === 'comp-audio-clip');

    expect(restoredClip?.source).toMatchObject({
      type: 'audio',
      naturalDuration: 10,
    });
    expect(restoredClip?.source?.audioElement).toBeUndefined();
    expect(restoredClip?.mixdownAudio).toBeUndefined();
    expect(restoredClip?.mixdownBuffer).toBeUndefined();
    expect(restoredClip?.mixdownGenerating).toBe(false);
    expect(restoredClip?.hasMixdownAudio).toBe(false);
    expect(restoredClip?.waveform).toEqual([0, 0.2, 0.4, 0.2, 0]);
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('audio');
    expect(compositionAudioMixerMocks.mixdownComposition).not.toHaveBeenCalled();
    expect(compositionAudioMixerMocks.createAudioElement).not.toHaveBeenCalled();
  });
});
