import { afterEach, describe, expect, it, vi } from 'vitest';
import { vectorAnimationRuntimeManager } from '../../src/services/vectorAnimation/VectorAnimationRuntimeManager';
import {
  buildAndApplyNestedClipSegments,
  calculateNestedClipBoundaries,
  generateCompThumbnails,
  loadNestedClips,
  mergeNestedClipKeyframes,
  type NestedMediaRestoreEvent,
} from '../../src/stores/timeline/nestedCompositionLoader';
import { createCompLinkedAudioClip } from '../../src/stores/timeline/clip/addCompClip';
import { thumbnailRenderer } from '../../src/services/thumbnailRenderer';
import { blobUrlManager } from '../../src/stores/timeline/helpers/blobUrlManager';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { Composition, MediaFile } from '../../src/stores/mediaStore/types';
import type {
  CompositionTimelineData,
  GaussianSplatSequenceData,
  Keyframe,
  SerializableClip,
  Text3DProperties,
  TimelineClip,
  TimelineTrack,
} from '../../src/types';

const compositionAudioMixerMocks = vi.hoisted(() => ({
  mixdownComposition: vi.fn(),
  createAudioElement: vi.fn(),
}));

vi.mock('../../src/services/compositionAudioMixer', () => ({
  compositionAudioMixer: compositionAudioMixerMocks,
}));

const baseTransform = {
  opacity: 1,
  blendMode: 'normal',
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1 },
  rotation: { x: 0, y: 0, z: 0 },
};

const text3DProperties: Text3DProperties = {
  text: 'Nested Hero',
  fontFamily: 'helvetiker',
  fontWeight: 'bold',
  size: 1,
  depth: 0.2,
  color: '#4c9aff',
  letterSpacing: 0,
  lineHeight: 1,
  textAlign: 'center',
  curveSegments: 8,
  bevelEnabled: true,
  bevelThickness: 0.02,
  bevelSize: 0.01,
  bevelSegments: 2,
};

function track(id: string, type: TimelineTrack['type']): TimelineTrack {
  return {
    id,
    name: id,
    type,
    height: 64,
    visible: true,
    muted: false,
    solo: false,
  };
}

function serializedClip(
  id: string,
  sourceType: SerializableClip['sourceType'],
  mediaFileId: string,
  trackId: string,
): SerializableClip {
  return {
    id,
    trackId,
    name: `${id}.mp4`,
    sourceType,
    mediaFileId,
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    transform: baseTransform,
    effects: [],
  } as SerializableClip;
}

function mediaFile(id: string, type: MediaFile['type'], duration: number): MediaFile {
  const extension = type === 'audio' ? 'mp3' : 'mp4';
  return {
    id,
    name: `${id}.${extension}`,
    type,
    file: new File([id], `${id}.${extension}`, { type: type === 'audio' ? 'audio/mpeg' : 'video/mp4' }),
    duration,
    absolutePath: `C:/media/${id}.${extension}`,
  } as MediaFile;
}

function modelMediaFile(
  id: string,
  input: Partial<Pick<MediaFile, 'file' | 'url' | 'duration' | 'modelSequence' | 'absolutePath' | 'name'>> = {},
): MediaFile {
  const name = input.name || `${id}.glb`;
  return {
    id,
    name,
    type: 'model',
    file: input.file,
    url: input.url ?? '',
    duration: input.duration ?? 3600,
    absolutePath: input.absolutePath ?? `C:/media/${name}`,
    modelSequence: input.modelSequence,
  } as MediaFile;
}

function gaussianSplatMediaFile(
  id: string,
  input: Partial<Pick<MediaFile, 'file' | 'url' | 'duration' | 'gaussianSplatSequence' | 'absolutePath' | 'name'>> = {},
): MediaFile {
  const name = input.name || `${id}.ply`;
  return {
    id,
    name,
    type: 'gaussian-splat',
    file: input.file,
    url: input.url ?? '',
    duration: input.duration ?? 3600,
    absolutePath: input.absolutePath ?? `C:/media/${name}`,
    gaussianSplatSequence: input.gaussianSplatSequence,
  } as MediaFile;
}

function gaussianAvatarMediaFile(
  id: string,
  input: Partial<Pick<MediaFile, 'file' | 'url' | 'duration' | 'absolutePath' | 'name'>> = {},
): MediaFile {
  const name = input.name || `${id}.zip`;
  return {
    id,
    name,
    type: 'gaussian-avatar',
    file: input.file,
    url: input.url ?? '',
    duration: input.duration ?? 3600,
    absolutePath: input.absolutePath ?? `C:/media/${name}`,
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

function composition(id: string, clips: SerializableClip[], tracks: TimelineTrack[]): Composition {
  return {
    id,
    name: id,
    type: 'composition',
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    timelineData: {
      clips,
      tracks,
      duration: 10,
    },
  } as Composition;
}

function createStoreHarness() {
  const state = {
    clips: [] as TimelineClip[],
    tracks: [] as TimelineTrack[],
    thumbnailsEnabled: false,
    clipKeyframes: new Map<string, Keyframe[]>(),
    invalidateCache: vi.fn(),
  };
  const setCalls: Partial<typeof state>[] = [];

  return {
    get: () => state,
    set: (patch: Partial<typeof state>) => {
      setCalls.push(patch);
      Object.assign(state, patch);
    },
    state,
    setCalls,
  };
}

describe('addCompClip nested restore', () => {
  afterEach(() => {
    blobUrlManager.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    compositionAudioMixerMocks.mixdownComposition.mockReset();
    compositionAudioMixerMocks.createAudioElement.mockReset();
  });

  it('creates linked composition audio as a lazy placeholder without eager mixdown or audio element allocation', async () => {
    const videoTrack = track('video-1', 'video');
    const audioTrack = track('audio-1', 'audio');
    const nestedAudioTrack = track('nested-audio-1', 'audio');
    const nestedAudio = serializedClip('nested-audio-clip', 'audio', 'media-audio', nestedAudioTrack.id);
    const comp = composition('Nested Comp', [nestedAudio], [nestedAudioTrack]);
    const harness = createStoreHarness();
    harness.state.tracks = [videoTrack, audioTrack];
    harness.state.clips = [{
      id: 'comp-clip',
      trackId: videoTrack.id,
      name: 'Nested Comp',
      file: new File([], 'Nested Comp'),
      startTime: 2,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
      transform: baseTransform,
      effects: [],
      isComposition: true,
      compositionId: comp.id,
      mixdownGenerating: true,
      hasMixdownAudio: true,
    } as TimelineClip];
    const createElementSpy = vi.spyOn(document, 'createElement');

    await createCompLinkedAudioClip({
      compClipId: 'comp-clip',
      composition: comp,
      compClipStartTime: 2,
      compDuration: 10,
      tracks: harness.state.tracks,
      set: harness.set,
      get: harness.get,
    });

    expect(compositionAudioMixerMocks.mixdownComposition).not.toHaveBeenCalled();
    expect(compositionAudioMixerMocks.createAudioElement).not.toHaveBeenCalled();
    expect(createElementSpy).not.toHaveBeenCalledWith('audio');

    const parentClip = harness.state.clips.find((clip) => clip.id === 'comp-clip');
    const audioClip = harness.state.clips.find((clip) => clip.id !== 'comp-clip' && clip.isComposition);
    expect(parentClip).toEqual(expect.objectContaining({
      linkedClipId: audioClip?.id,
      mixdownGenerating: false,
      hasMixdownAudio: false,
    }));
    expect(audioClip).toEqual(expect.objectContaining({
      trackId: audioTrack.id,
      name: 'Nested Comp (Audio)',
      startTime: 2,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      linkedClipId: 'comp-clip',
      isComposition: true,
      compositionId: comp.id,
      mixdownGenerating: false,
      hasMixdownAudio: false,
      mixdownBuffer: undefined,
    }));
    expect(audioClip?.source).toEqual({
      type: 'audio',
      naturalDuration: 10,
    });
    expect(audioClip?.waveform?.length).toBeGreaterThan(0);
  });

  it('builds and applies nested clip segments from fresh composition clip state', async () => {
    const videoTrack = track('video-1', 'video');
    const video = serializedClip('clip-video', 'video', 'media-video', videoTrack.id);
    const harness = createStoreHarness();
    harness.state.clips = [{
      id: 'comp-clip',
      name: 'Comp Clip',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      transform: baseTransform,
      effects: [],
      nestedClips: [{
        id: 'nested-comp-clip-clip-video',
        name: 'Nested Video',
        trackId: videoTrack.id,
        startTime: 0,
        duration: 4,
        inPoint: 0,
        outPoint: 4,
        transform: baseTransform,
        effects: [],
        source: { type: 'video', mediaFileId: 'media-video', naturalDuration: 4 },
      } as TimelineClip],
    } as TimelineClip];

    await buildAndApplyNestedClipSegments({
      clipId: 'comp-clip',
      timelineData: {
        clips: [video],
        tracks: [videoTrack],
        duration: 4,
      } as CompositionTimelineData,
      compDuration: 4,
      nestedClips: [],
      get: harness.get,
      set: harness.set,
    });

    expect(harness.state.clips[0].clipSegments).toEqual([
      expect.objectContaining({
        clipId: 'clip-video',
        clipName: 'clip-video.mp4',
        startNorm: 0,
        endNorm: 1,
      }),
    ]);
  });

  it('skips nested clip segment writes for stale sessions', async () => {
    const videoTrack = track('video-1', 'video');
    const video = serializedClip('clip-video', 'video', 'media-video', videoTrack.id);
    const harness = createStoreHarness();
    harness.state.clips = [{
      id: 'comp-clip',
      name: 'Comp Clip',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      transform: baseTransform,
      effects: [],
      nestedClips: [{
        id: 'nested-comp-clip-clip-video',
        name: 'Nested Video',
        trackId: videoTrack.id,
        startTime: 0,
        duration: 4,
        inPoint: 0,
        outPoint: 4,
        transform: baseTransform,
        effects: [],
        source: { type: 'video', mediaFileId: 'media-video', naturalDuration: 4 },
      } as TimelineClip],
    } as TimelineClip];

    await buildAndApplyNestedClipSegments({
      clipId: 'comp-clip',
      timelineData: {
        clips: [video],
        tracks: [videoTrack],
        duration: 4,
      } as CompositionTimelineData,
      compDuration: 4,
      nestedClips: [],
      get: harness.get,
      set: harness.set,
      isCurrentTimelineSession: () => false,
    });

    expect(harness.state.clips[0].clipSegments).toBeUndefined();
    expect(harness.setCalls).toHaveLength(0);
  });

  it('forwards nested composition boundaries when generating composition thumbnails', async () => {
    const harness = createStoreHarness();
    harness.state.thumbnailsEnabled = true;
    harness.state.clips = [{
      id: 'comp-clip',
      name: 'Comp Clip',
      trackId: 'video-1',
      startTime: 0,
      duration: 8,
      inPoint: 0,
      outPoint: 8,
      transform: baseTransform,
      effects: [],
      isComposition: true,
      compositionId: 'comp-source',
    } as TimelineClip];
    const generateCompositionThumbnails = vi
      .mocked(thumbnailRenderer.generateCompositionThumbnails)
      .mockResolvedValueOnce(['thumb-a', 'thumb-b']);

    await generateCompThumbnails({
      clipId: 'comp-clip',
      nestedClips: [],
      compDuration: 8,
      thumbnailsEnabled: true,
      boundaries: [0.25, 0.75],
      get: harness.get,
      set: harness.set,
    });

    expect(generateCompositionThumbnails).toHaveBeenCalledWith(
      'comp-source',
      8,
      { count: 10, width: 160, height: 90, boundaries: [0.25, 0.75] },
    );
    expect(harness.state.clips[0].thumbnails).toEqual(['thumb-a', 'thumb-b']);
  });

  it('calculates nested clip boundaries from visible video clips only', () => {
    const visibleVideo = track('visible-video', 'video');
    const hiddenVideo = { ...track('hidden-video', 'video'), visible: false };
    const audio = track('audio-1', 'audio');
    const boundaries = calculateNestedClipBoundaries({
      clips: [
        { ...serializedClip('visible-a', 'video', 'media-a', visibleVideo.id), startTime: 2, duration: 3 },
        { ...serializedClip('visible-b', 'video', 'media-b', visibleVideo.id), startTime: 6, duration: 2 },
        { ...serializedClip('hidden', 'video', 'media-hidden', hiddenVideo.id), startTime: 1, duration: 1 },
        { ...serializedClip('audio', 'audio', 'media-audio', audio.id), startTime: 4, duration: 1 },
      ],
      tracks: [visibleVideo, hiddenVideo, audio],
      duration: 10,
    } as CompositionTimelineData, 10);

    expect(boundaries).toEqual([0.2, 0.5, 0.6, 0.8]);
  });

  it('merges nested clip keyframes while preserving unrelated entries', () => {
    const harness = createStoreHarness();
    const unrelatedKeyframe = {
      id: 'kf-existing',
      clipId: 'existing-clip',
      property: 'opacity',
      time: 0,
      value: 1,
      interpolation: 'linear',
    } as Keyframe;
    const nestedKeyframe = {
      id: 'kf-nested',
      clipId: 'nested-comp-clip-video',
      property: 'scale.x',
      time: 1,
      value: 1.5,
      interpolation: 'linear',
    } as Keyframe;
    harness.state.clipKeyframes = new Map([
      ['existing-clip', [unrelatedKeyframe]],
    ]);

    const merged = mergeNestedClipKeyframes({
      compClipId: 'comp-clip',
      nestedKeyframes: new Map([
        ['nested-comp-clip-video', [nestedKeyframe]],
      ]),
      get: harness.get,
      set: harness.set,
    });

    expect(merged).toBe(true);
    expect(harness.state.clipKeyframes.get('existing-clip')).toEqual([unrelatedKeyframe]);
    expect(harness.state.clipKeyframes.get('nested-comp-clip-video')).toEqual([nestedKeyframe]);
  });

  it('skips nested clip keyframe merge for stale sessions', () => {
    const harness = createStoreHarness();
    const nestedKeyframe = {
      id: 'kf-nested',
      clipId: 'nested-comp-clip-video',
      property: 'opacity',
      time: 1,
      value: 0.5,
      interpolation: 'linear',
    } as Keyframe;

    const merged = mergeNestedClipKeyframes({
      compClipId: 'comp-clip',
      nestedKeyframes: new Map([
        ['nested-comp-clip-video', [nestedKeyframe]],
      ]),
      get: harness.get,
      set: harness.set,
      isCurrentTimelineSession: () => false,
    });

    expect(merged).toBe(false);
    expect(harness.state.clipKeyframes.size).toBe(0);
    expect(harness.setCalls).toHaveLength(0);
  });

  it('treats empty nested clip keyframe maps as a non-blocking no-op', () => {
    const harness = createStoreHarness();

    const merged = mergeNestedClipKeyframes({
      compClipId: 'comp-clip',
      nestedKeyframes: new Map(),
      get: harness.get,
      set: harness.set,
      isCurrentTimelineSession: () => false,
    });

    expect(merged).toBe(true);
    expect(harness.setCalls).toHaveLength(0);
  });

  it('restores direct nested video and audio as data-only sources', async () => {
    const videoTrack = track('video-1', 'video');
    const audioTrack = track('audio-1', 'audio');
    const video = serializedClip('clip-video', 'video', 'media-video', videoTrack.id);
    const audio = serializedClip('clip-audio', 'audio', 'media-audio', audioTrack.id);
    const comp = composition('comp', [video, audio], [videoTrack, audioTrack]);
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const createElement = vi.spyOn(document, 'createElement');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        mediaFile('media-video', 'video', 8),
        mediaFile('media-audio', 'audio', 9),
      ],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
    });

    expect(nestedClips).toHaveLength(2);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');

    expect(nestedClips[0].source).toEqual({
      type: 'video',
      mediaFileId: 'media-video',
      naturalDuration: 8,
      filePath: 'C:/media/media-video.mp4',
    });
    expect(nestedClips[0].isLoading).toBe(false);
    expect(nestedClips[0].source?.videoElement).toBeUndefined();

    expect(nestedClips[1].source).toEqual({
      type: 'audio',
      mediaFileId: 'media-audio',
      naturalDuration: 9,
      filePath: 'C:/media/media-audio.mp3',
    });
    expect(nestedClips[1].isLoading).toBe(false);
    expect(nestedClips[1].source?.audioElement).toBeUndefined();
  });

  it('restores sub-nested video and audio as data-only sources', async () => {
    const parentTrack = track('parent-video', 'video');
    const childVideoTrack = track('child-video', 'video');
    const childAudioTrack = track('child-audio', 'audio');
    const childVideo = serializedClip('child-video-clip', 'video', 'media-child-video', childVideoTrack.id);
    const childAudio = serializedClip('child-audio-clip', 'audio', 'media-child-audio', childAudioTrack.id);
    const childComp = composition('child-comp', [childVideo, childAudio], [childVideoTrack, childAudioTrack]);
    const parentComp = composition(
      'parent-comp',
      [{
        id: 'nested-comp-source',
        trackId: parentTrack.id,
        name: 'Nested Comp',
        sourceType: 'video',
        isComposition: true,
        compositionId: childComp.id,
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        transform: baseTransform,
        effects: [],
      } as SerializableClip],
      [parentTrack],
    );
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const createElement = vi.spyOn(document, 'createElement');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        mediaFile('media-child-video', 'video', 11),
        mediaFile('media-child-audio', 'audio', 12),
      ],
      compositions: [parentComp, childComp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: parentComp,
      get: harness.get,
      set: harness.set,
    });

    const nestedCompClip = nestedClips[0];
    expect(nestedCompClip.nestedClips).toHaveLength(2);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');

    expect(nestedCompClip.nestedClips?.[0].source).toEqual({
      type: 'video',
      mediaFileId: 'media-child-video',
      naturalDuration: 11,
      filePath: 'C:/media/media-child-video.mp4',
    });
    expect(nestedCompClip.nestedClips?.[0].isLoading).toBe(false);
    expect(nestedCompClip.nestedClips?.[1].source).toEqual({
      type: 'audio',
      mediaFileId: 'media-child-audio',
      naturalDuration: 12,
      filePath: 'C:/media/media-child-audio.mp3',
    });
    expect(nestedCompClip.nestedClips?.[1].isLoading).toBe(false);
  });

  it('collects keyframes for nested composition clips and sub-nested media clips', async () => {
    const parentTrack = track('parent-video', 'video');
    const childTrack = track('child-video', 'video');
    const childVideo = {
      ...serializedClip('child-video-clip', 'video', 'media-child-video', childTrack.id),
      keyframes: [{
        id: 'kf-child-video',
        clipId: 'child-video-clip',
        property: 'opacity',
        time: 1,
        value: 0.5,
        interpolation: 'linear',
      } as Keyframe],
    } as SerializableClip;
    const childComp = composition('child-comp', [childVideo], [childTrack]);
    const nestedCompClip = {
      ...serializedClip('nested-comp-clip', 'video', 'child-comp', parentTrack.id),
      isComposition: true,
      compositionId: childComp.id,
      keyframes: [{
        id: 'kf-nested-comp',
        clipId: 'nested-comp-clip',
        property: 'scale.x',
        time: 0.5,
        value: 1.25,
        interpolation: 'linear',
      } as Keyframe],
    } as SerializableClip;
    const parentComp = composition('parent-comp', [nestedCompClip], [parentTrack]);
    const harness = createStoreHarness();

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [mediaFile('media-child-video', 'video', 8)],
      compositions: [parentComp, childComp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: parentComp,
      get: harness.get,
      set: harness.set,
    });

    expect(nestedClips).toHaveLength(1);
    expect(harness.state.clipKeyframes.get('nested-parent-comp-clip-nested-comp-clip')).toEqual([
      expect.objectContaining({
        id: 'kf-nested-comp',
        clipId: 'nested-parent-comp-clip-nested-comp-clip',
      }),
    ]);
    expect(harness.state.clipKeyframes.get('nested-nested-parent-comp-clip-nested-comp-clip-child-video-clip')).toEqual([
      expect.objectContaining({
        id: 'kf-child-video',
        clipId: 'nested-nested-parent-comp-clip-nested-comp-clip-child-video-clip',
      }),
    ]);
  });

  it('restores direct nested primitive mesh clips without media files', async () => {
    const videoTrack = track('video-1', 'video');
    const mesh = {
      ...serializedClip('clip-mesh', 'model', 'missing-mesh-media', videoTrack.id),
      name: 'Cube Mesh',
      meshType: 'cube',
      threeDEffectorsEnabled: false,
    } as SerializableClip;
    const comp = composition('comp', [mesh], [videoTrack]);
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
    });

    expect(nestedClips).toHaveLength(1);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(nestedClips[0]).toEqual(expect.objectContaining({
      id: 'nested-parent-comp-clip-clip-mesh',
      name: 'Cube Mesh',
      is3D: true,
      isLoading: false,
      meshType: 'cube',
      wireframe: false,
    }));
    expect(nestedClips[0].source).toEqual(expect.objectContaining({
      type: 'model',
      meshType: 'cube',
      mediaFileId: 'missing-mesh-media',
      naturalDuration: Number.MAX_SAFE_INTEGER,
      threeDEffectorsEnabled: false,
    }));
  });

  it('restores sub-nested primitive mesh clips without media files', async () => {
    const parentTrack = track('parent-video', 'video');
    const childTrack = track('child-video', 'video');
    const childMesh = {
      ...serializedClip('child-mesh', 'model', 'missing-child-mesh-media', childTrack.id),
      name: 'Nested Cube',
      meshType: 'cube',
    } as SerializableClip;
    const childComp = composition('child-comp', [childMesh], [childTrack]);
    const parentComp = composition(
      'parent-comp',
      [{
        id: 'nested-comp-source',
        trackId: parentTrack.id,
        name: 'Nested Comp',
        sourceType: 'video',
        isComposition: true,
        compositionId: childComp.id,
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        transform: baseTransform,
        effects: [],
      } as SerializableClip],
      [parentTrack],
    );
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [],
      compositions: [parentComp, childComp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: parentComp,
      get: harness.get,
      set: harness.set,
    });

    const nestedMesh = nestedClips[0].nestedClips?.[0];
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(nestedMesh).toEqual(expect.objectContaining({
      id: 'nested-nested-parent-comp-clip-nested-comp-source-child-mesh',
      name: 'Nested Cube',
      is3D: true,
      isLoading: false,
      meshType: 'cube',
    }));
    expect(nestedMesh?.source).toEqual(expect.objectContaining({
      type: 'model',
      meshType: 'cube',
      mediaFileId: 'missing-child-mesh-media',
      naturalDuration: Number.MAX_SAFE_INTEGER,
      threeDEffectorsEnabled: true,
    }));
  });

  it('restores direct nested model clips from reusable sequence URLs without new blob URLs', async () => {
    const videoTrack = track('video-1', 'video');
    const modelSequence = {
      fps: 24,
      frameCount: 2,
      playbackMode: 'clamp' as const,
      sequenceName: 'hero',
      frames: [
        { name: 'Hero000.glb', modelUrl: 'https://assets.local/Hero000.glb' },
        { name: 'Hero001.glb', modelUrl: 'https://assets.local/Hero001.glb' },
      ],
    };
    const modelClip = {
      ...serializedClip('clip-model', 'model', 'media-model', videoTrack.id),
      name: 'Hero Model',
      naturalDuration: 12,
      modelSequence,
      meshType: 'text3d',
      text3DProperties,
      threeDEffectorsEnabled: false,
    } as SerializableClip;
    const comp = composition('comp', [modelClip], [videoTrack]);
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        modelMediaFile('media-model', {
          name: 'Hero.glb',
          modelSequence,
          url: 'blob:stale-model-without-file',
        }),
      ],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
    });

    expect(nestedClips).toHaveLength(1);
    expect(createObjectURL).not.toHaveBeenCalled();

    const nestedModel = nestedClips[0];
    expect(nestedModel.source).toEqual(expect.objectContaining({
      type: 'model',
      mediaFileId: 'media-model',
      modelFileName: 'Hero.glb',
      modelUrl: 'https://assets.local/Hero000.glb',
      naturalDuration: 12,
      modelSequence: expect.objectContaining({ frameCount: 2 }),
      meshType: 'text3d',
      text3DProperties,
      threeDEffectorsEnabled: false,
    }));
    expect(nestedModel.source?.text3DProperties).not.toBe(text3DProperties);
    expect(nestedModel.is3D).toBe(true);
    expect(nestedModel.meshType).toBe('text3d');
    expect(nestedModel.text3DProperties).toEqual(text3DProperties);
    expect(nestedModel.text3DProperties).not.toBe(text3DProperties);
    expect(nestedModel.isLoading).toBe(false);
  });

  it('restores sub-nested model clips from reusable sequence URLs without new blob URLs', async () => {
    const parentTrack = track('parent-video', 'video');
    const childTrack = track('child-video', 'video');
    const modelSequence = {
      fps: 30,
      frameCount: 1,
      playbackMode: 'clamp' as const,
      frames: [
        { name: 'NestedHero.glb', modelUrl: 'https://assets.local/NestedHero.glb' },
      ],
    };
    const childModel = {
      ...serializedClip('child-model-clip', 'model', 'media-child-model', childTrack.id),
      name: 'Nested Hero',
      naturalDuration: 7,
      modelSequence,
      meshType: 'text3d',
      text3DProperties,
      threeDEffectorsEnabled: true,
    } as SerializableClip;
    const childComp = composition('child-comp', [childModel], [childTrack]);
    const parentComp = composition(
      'parent-comp',
      [{
        id: 'nested-comp-source',
        trackId: parentTrack.id,
        name: 'Nested Comp',
        sourceType: 'video',
        isComposition: true,
        compositionId: childComp.id,
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        transform: baseTransform,
        effects: [],
      } as SerializableClip],
      [parentTrack],
    );
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        modelMediaFile('media-child-model', {
          name: 'NestedHero.glb',
          modelSequence,
          url: 'blob:stale-sub-nested-model',
        }),
      ],
      compositions: [parentComp, childComp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: parentComp,
      get: harness.get,
      set: harness.set,
    });

    const nestedModel = nestedClips[0].nestedClips?.[0];
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(nestedModel?.source).toEqual(expect.objectContaining({
      type: 'model',
      mediaFileId: 'media-child-model',
      modelFileName: 'NestedHero.glb',
      modelUrl: 'https://assets.local/NestedHero.glb',
      naturalDuration: 7,
      modelSequence: expect.objectContaining({ frameCount: 1 }),
      meshType: 'text3d',
      text3DProperties,
      threeDEffectorsEnabled: true,
    }));
    expect(nestedModel?.is3D).toBe(true);
    expect(nestedModel?.meshType).toBe('text3d');
    expect(nestedModel?.text3DProperties).toEqual(text3DProperties);
    expect(nestedModel?.text3DProperties).not.toBe(text3DProperties);
    expect(nestedModel?.isLoading).toBe(false);
  });

  it('restores direct nested gaussian splat clips from reusable sequence URLs without new blob URLs', async () => {
    const videoTrack = track('video-1', 'video');
    const sequence = gaussianSplatSequence();
    const splatClip = {
      ...serializedClip('clip-splat', 'gaussian-splat', 'media-splat', videoTrack.id),
      name: 'Scan',
      naturalDuration: 1,
      gaussianSplatSequence: sequence,
      threeDEffectorsEnabled: false,
    } as SerializableClip;
    const comp = composition('comp', [splatClip], [videoTrack]);
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        gaussianSplatMediaFile('media-splat', {
          name: 'scan.ply',
          gaussianSplatSequence: sequence,
          url: 'blob:stale-splat-without-file',
          duration: 1,
        }),
      ],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
    });

    expect(nestedClips).toHaveLength(1);
    expect(createObjectURL).not.toHaveBeenCalled();

    const nestedSplat = nestedClips[0];
    expect(blobUrlManager.get(nestedSplat.id, 'file')).toBeUndefined();
    expect(nestedSplat.source).toEqual(expect.objectContaining({
      type: 'gaussian-splat',
      mediaFileId: 'media-splat',
      gaussianSplatUrl: 'https://assets.local/scan000000.ply',
      gaussianSplatFileName: 'scan000000.ply',
      gaussianSplatRuntimeKey: 'Raw/scan000000.ply',
      naturalDuration: 1,
      gaussianSplatSequence: expect.objectContaining({ frameCount: 2, sequenceName: 'scan' }),
      threeDEffectorsEnabled: false,
    }));
    expect(nestedSplat.is3D).toBe(true);
    expect(nestedSplat.isLoading).toBe(false);
  });

  it('restores sub-nested gaussian splat clips from reusable sequence URLs without new blob URLs', async () => {
    const parentTrack = track('parent-video', 'video');
    const childTrack = track('child-video', 'video');
    const sequence = gaussianSplatSequence();
    const childSplat = {
      ...serializedClip('child-splat-clip', 'gaussian-splat', 'media-child-splat', childTrack.id),
      name: 'Nested Scan',
      naturalDuration: 1,
      gaussianSplatSequence: sequence,
      threeDEffectorsEnabled: true,
    } as SerializableClip;
    const childComp = composition('child-comp', [childSplat], [childTrack]);
    const parentComp = composition(
      'parent-comp',
      [{
        id: 'nested-comp-source',
        trackId: parentTrack.id,
        name: 'Nested Comp',
        sourceType: 'video',
        isComposition: true,
        compositionId: childComp.id,
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        transform: baseTransform,
        effects: [],
      } as SerializableClip],
      [parentTrack],
    );
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        gaussianSplatMediaFile('media-child-splat', {
          name: 'scan.ply',
          gaussianSplatSequence: sequence,
          url: 'blob:stale-sub-nested-splat',
          duration: 1,
        }),
      ],
      compositions: [parentComp, childComp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: parentComp,
      get: harness.get,
      set: harness.set,
    });

    const nestedSplat = nestedClips[0].nestedClips?.[0];
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(blobUrlManager.get(nestedSplat?.id ?? '', 'file')).toBeUndefined();
    expect(nestedSplat?.source).toEqual(expect.objectContaining({
      type: 'gaussian-splat',
      mediaFileId: 'media-child-splat',
      gaussianSplatUrl: 'https://assets.local/scan000000.ply',
      gaussianSplatFileName: 'scan000000.ply',
      gaussianSplatRuntimeKey: 'Raw/scan000000.ply',
      naturalDuration: 1,
      gaussianSplatSequence: expect.objectContaining({ frameCount: 2, sequenceName: 'scan' }),
      threeDEffectorsEnabled: true,
    }));
    expect(nestedSplat?.is3D).toBe(true);
    expect(nestedSplat?.isLoading).toBe(false);
  });

  it('uses managed blob fallback for direct nested model clips without reusable URLs', async () => {
    const videoTrack = track('video-1', 'video');
    const modelFile = new File(['model'], 'Fallback.glb', { type: 'model/gltf-binary' });
    const modelClip = {
      ...serializedClip('clip-model-fallback', 'model', 'media-model-fallback', videoTrack.id),
      name: 'Fallback Model',
      meshType: 'cube',
      threeDEffectorsEnabled: false,
    } as SerializableClip;
    const comp = composition('comp', [modelClip], [videoTrack]);
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:add-comp-model');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        modelMediaFile('media-model-fallback', {
          name: modelFile.name,
          file: modelFile,
          duration: 3600,
        }),
      ],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(blobUrlManager.get(nestedClips[0].id, 'model')).toBe('blob:add-comp-model');
    expect(nestedClips[0].source).toEqual(expect.objectContaining({
      type: 'model',
      mediaFileId: 'media-model-fallback',
      modelFileName: 'Fallback.glb',
      modelUrl: 'blob:add-comp-model',
      naturalDuration: 3600,
      meshType: 'cube',
      threeDEffectorsEnabled: false,
    }));
    expect(nestedClips[0].is3D).toBe(true);
    expect(nestedClips[0].meshType).toBe('cube');
    expect(nestedClips[0].isLoading).toBe(false);
  });

  it('uses managed blob fallback for direct nested gaussian splat clips without reusable URLs', async () => {
    const videoTrack = track('video-1', 'video');
    const splatFile = new File(['splat'], 'Fallback.ply', { type: 'application/octet-stream' });
    const splatClip = {
      ...serializedClip('clip-splat-fallback', 'gaussian-splat', 'media-splat-fallback', videoTrack.id),
      name: 'Fallback Splat',
      threeDEffectorsEnabled: false,
    } as SerializableClip;
    const comp = composition('comp', [splatClip], [videoTrack]);
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:add-comp-splat');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        gaussianSplatMediaFile('media-splat-fallback', {
          name: splatFile.name,
          file: splatFile,
          duration: 3600,
        }),
      ],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(splatFile);
    expect(blobUrlManager.get(nestedClips[0].id, 'file')).toBe('blob:add-comp-splat');
    expect(nestedClips[0].source).toEqual(expect.objectContaining({
      type: 'gaussian-splat',
      mediaFileId: 'media-splat-fallback',
      gaussianSplatUrl: 'blob:add-comp-splat',
      gaussianSplatFileName: 'Fallback.ply',
      gaussianSplatRuntimeKey: 'blob:add-comp-splat',
      naturalDuration: 3600,
      threeDEffectorsEnabled: false,
    }));
    expect(nestedClips[0].is3D).toBe(true);
    expect(nestedClips[0].isLoading).toBe(false);
  });

  it('uses managed blob fallback for direct nested gaussian avatar clips without reusable URLs', async () => {
    const videoTrack = track('video-1', 'video');
    const avatarFile = new File(['avatar'], 'Avatar.zip', { type: 'application/zip' });
    const avatarClip = {
      ...serializedClip('clip-avatar-fallback', 'gaussian-avatar', 'media-avatar-fallback', videoTrack.id),
      name: 'Fallback Avatar',
      naturalDuration: 3600,
      gaussianBlendshapes: {
        jawOpen: 0.4,
      },
    } as SerializableClip;
    const comp = composition('comp', [avatarClip], [videoTrack]);
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:add-comp-avatar');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        gaussianAvatarMediaFile('media-avatar-fallback', {
          name: avatarFile.name,
          file: avatarFile,
          duration: 3600,
        }),
      ],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(avatarFile);
    expect(blobUrlManager.get(nestedClips[0].id, 'model')).toBe('blob:add-comp-avatar');
    expect(nestedClips[0].source).toEqual(expect.objectContaining({
      type: 'gaussian-avatar',
      mediaFileId: 'media-avatar-fallback',
      gaussianAvatarUrl: 'blob:add-comp-avatar',
      gaussianBlendshapes: {
        jawOpen: 0.4,
      },
      naturalDuration: 3600,
    }));
    expect(nestedClips[0].is3D).toBe(true);
    expect(nestedClips[0].isLoading).toBe(false);
  });

  it('uses managed blob fallback for sub-nested gaussian avatar clips without reusable URLs', async () => {
    const parentTrack = track('parent-video', 'video');
    const childTrack = track('child-video', 'video');
    const avatarFile = new File(['avatar'], 'NestedAvatar.zip', { type: 'application/zip' });
    const childAvatar = {
      ...serializedClip('child-avatar-clip', 'gaussian-avatar', 'media-child-avatar', childTrack.id),
      name: 'Nested Avatar',
      naturalDuration: 3600,
      gaussianBlendshapes: {
        eyeBlinkLeft: 0.25,
      },
    } as SerializableClip;
    const childComp = composition('child-comp', [childAvatar], [childTrack]);
    const parentComp = composition(
      'parent-comp',
      [{
        id: 'nested-comp-source',
        trackId: parentTrack.id,
        name: 'Nested Comp',
        sourceType: 'video',
        isComposition: true,
        compositionId: childComp.id,
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        transform: baseTransform,
        effects: [],
      } as SerializableClip],
      [parentTrack],
    );
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:add-comp-sub-avatar');

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        gaussianAvatarMediaFile('media-child-avatar', {
          name: avatarFile.name,
          file: avatarFile,
          duration: 3600,
        }),
      ],
      compositions: [parentComp, childComp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: parentComp,
      get: harness.get,
      set: harness.set,
    });

    const nestedAvatar = nestedClips[0].nestedClips?.[0];
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(avatarFile);
    expect(blobUrlManager.get(nestedAvatar?.id ?? '', 'model')).toBe('blob:add-comp-sub-avatar');
    expect(nestedAvatar?.source).toEqual(expect.objectContaining({
      type: 'gaussian-avatar',
      mediaFileId: 'media-child-avatar',
      gaussianAvatarUrl: 'blob:add-comp-sub-avatar',
      gaussianBlendshapes: {
        eyeBlinkLeft: 0.25,
      },
      naturalDuration: 3600,
    }));
    expect(nestedAvatar?.is3D).toBe(true);
    expect(nestedAvatar?.isLoading).toBe(false);
  });

  it('prepares direct nested vector animation clips through the shared runtime helper', async () => {
    const videoTrack = track('video-1', 'video');
    const vectorFile = new File(['{}'], 'anim.lottie', { type: 'application/json' });
    const vectorClip = {
      ...serializedClip('clip-lottie', 'lottie', 'media-lottie', videoTrack.id),
      name: 'anim.lottie',
      naturalDuration: 4,
    } as SerializableClip;
    const comp = composition('comp', [vectorClip], [videoTrack]);
    const harness = createStoreHarness();
    const canvas = document.createElement('canvas');
    const runtimeReady = vi.fn();
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
    const prepareSpy = vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource').mockReturnValue(preparePromise);
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [{
        id: 'media-lottie',
        name: vectorFile.name,
        type: 'lottie',
        file: vectorFile,
        duration: 4,
        absolutePath: 'C:/media/anim.lottie',
      }],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
      restoreHooks: {
        runtimeReady: {
          onReady: runtimeReady,
        },
      },
    });

    harness.state.clips = [{
      id: 'parent-comp-clip',
      trackId: videoTrack.id,
      name: 'Parent Comp',
      file: new File([], 'Parent Comp'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
      transform: baseTransform,
      effects: [],
      isComposition: true,
      compositionId: comp.id,
      nestedClips,
    } as TimelineClip];

    expect(nestedClips[0].source).toBeNull();
    expect(runtimeReady).not.toHaveBeenCalled();
    resolvePrepare({
      canvas,
      metadata: {
        provider: 'lottie',
        duration: 6,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    const patchedClip = harness.state.clips[0].nestedClips?.[0];
    expect(prepareSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: nestedClips[0].id,
      source: expect.objectContaining({ type: 'lottie', mediaFileId: 'media-lottie' }),
    }), vectorFile);
    expect(renderSpy).toHaveBeenCalledWith(expect.objectContaining({ id: nestedClips[0].id }), 0);
    expect(patchedClip?.source).toEqual(expect.objectContaining({
      type: 'lottie',
      textCanvas: canvas,
      mediaFileId: 'media-lottie',
      naturalDuration: 6,
    }));
    expect(patchedClip?.isLoading).toBe(false);
    expect(runtimeReady).toHaveBeenCalledWith(expect.objectContaining({
      rootCompClipId: 'parent-comp-clip',
      parentClipId: 'parent-comp-clip',
      nestedClipId: nestedClips[0].id,
      sourceType: 'lottie',
      depth: 1,
      defaultInvalidatesCache: true,
    }));
  });

  it('applies direct nested vector completions to the returned clip before store installation', async () => {
    const videoTrack = track('video-1', 'video');
    const vectorFile = new File(['{}'], 'anim.lottie', { type: 'application/json' });
    const vectorClip = {
      ...serializedClip('clip-lottie', 'lottie', 'media-lottie', videoTrack.id),
      name: 'anim.lottie',
      naturalDuration: 4,
    } as SerializableClip;
    const comp = composition('comp', [vectorClip], [videoTrack]);
    const harness = createStoreHarness();
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
    vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [{
        id: 'media-lottie',
        name: vectorFile.name,
        type: 'lottie',
        file: vectorFile,
        duration: 4,
        absolutePath: 'C:/media/anim.lottie',
      }],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
    });

    resolvePrepare({
      canvas,
      metadata: {
        provider: 'lottie',
        duration: 6,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(nestedClips[0].source).toEqual(expect.objectContaining({
      type: 'lottie',
      textCanvas: canvas,
      mediaFileId: 'media-lottie',
      naturalDuration: 6,
    }));
    expect(nestedClips[0].isLoading).toBe(false);

    harness.state.clips = [{
      id: 'parent-comp-clip',
      trackId: videoTrack.id,
      name: 'Parent Comp',
      file: new File([], 'Parent Comp'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
      transform: baseTransform,
      effects: [],
      isComposition: true,
      compositionId: comp.id,
      nestedClips,
    } as TimelineClip];

    expect(harness.state.clips[0].nestedClips?.[0].source).toEqual(expect.objectContaining({
      type: 'lottie',
      textCanvas: canvas,
    }));
  });

  it('ignores stale direct nested vector runtime completions', async () => {
    const videoTrack = track('video-1', 'video');
    const vectorFile = new File(['{}'], 'anim.lottie', { type: 'application/json' });
    const vectorClip = {
      ...serializedClip('clip-lottie', 'lottie', 'media-lottie', videoTrack.id),
      name: 'anim.lottie',
      naturalDuration: 4,
    } as SerializableClip;
    const comp = composition('comp', [vectorClip], [videoTrack]);
    const harness = createStoreHarness();
    const canvas = document.createElement('canvas');
    const runtimeReady = vi.fn();
    let isCurrentSession = true;
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

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [{
        id: 'media-lottie',
        name: vectorFile.name,
        type: 'lottie',
        file: vectorFile,
        duration: 4,
        absolutePath: 'C:/media/anim.lottie',
      }],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
      isCurrentTimelineSession: () => isCurrentSession,
      restoreHooks: {
        runtimeReady: {
          onReady: runtimeReady,
        },
      },
    });
    harness.state.clips = [{
      id: 'parent-comp-clip',
      trackId: videoTrack.id,
      name: 'Parent Comp',
      file: new File([], 'Parent Comp'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
      transform: baseTransform,
      effects: [],
      isComposition: true,
      compositionId: comp.id,
      nestedClips,
    } as TimelineClip];

    isCurrentSession = false;
    resolvePrepare({
      canvas,
      metadata: {
        provider: 'lottie',
        duration: 6,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(destroySpy).toHaveBeenCalledWith(nestedClips[0].id, 'lottie');
    expect(harness.state.invalidateCache).not.toHaveBeenCalled();
    expect(harness.setCalls.some((patch) => 'clips' in patch)).toBe(false);
    expect(nestedClips[0].source).toBeNull();
    expect(nestedClips[0].isLoading).toBe(true);
    expect(harness.state.clips[0].nestedClips?.[0].source).toBeNull();
    expect(runtimeReady).not.toHaveBeenCalled();
  });

  it('restores direct nested motion clips without media lookup', async () => {
    const videoTrack = track('video-1', 'video');
    const motion = {
      version: 1,
      kind: 'shape',
      shape: {
        primitive: 'rectangle',
        size: { w: 320, h: 180 },
      },
    } satisfies NonNullable<SerializableClip['motion']>;
    const motionClip = {
      ...serializedClip('clip-motion', 'motion-shape', '', videoTrack.id),
      name: 'Motion Rectangle',
      motion,
    } as SerializableClip;
    const comp = composition('comp', [motionClip], [videoTrack]);
    const harness = createStoreHarness();

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
    });

    expect(nestedClips).toHaveLength(1);
    expect(nestedClips[0]).toEqual(expect.objectContaining({
      id: 'nested-parent-comp-clip-clip-motion',
      name: 'Motion Rectangle',
      isLoading: false,
      source: expect.objectContaining({
        type: 'motion-shape',
        naturalDuration: 4,
      }),
    }));
    expect(nestedClips[0].motion).toEqual(motion);
    expect(nestedClips[0].motion).not.toBe(motion);
  });

  it('skips stale nested keyframe merges', async () => {
    const videoTrack = track('video-1', 'video');
    const video = {
      ...serializedClip('clip-video', 'video', 'media-video', videoTrack.id),
      keyframes: [{
        id: 'kf-1',
        clipId: 'clip-video',
        property: 'opacity',
        time: 1,
        value: 0.5,
        interpolation: 'linear',
      } as Keyframe],
    } as SerializableClip;
    const comp = composition('comp', [video], [videoTrack]);
    const harness = createStoreHarness();

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [mediaFile('media-video', 'video', 8)],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
      isCurrentTimelineSession: () => false,
    });

    expect(nestedClips).toHaveLength(1);
    expect(harness.state.clipKeyframes.size).toBe(0);
    expect(harness.setCalls.some((patch) => 'clipKeyframes' in patch)).toBe(false);
  });

  it('keeps shared-loader image and vector clips without browser files as non-loading null-source placeholders by default', async () => {
    const videoTrack = track('video-1', 'video');
    const imageClip = {
      ...serializedClip('clip-image', 'image', 'media-image', videoTrack.id),
      name: 'Still Image',
    } as SerializableClip;
    const vectorClip = {
      ...serializedClip('clip-lottie', 'lottie', 'media-lottie', videoTrack.id),
      name: 'anim.lottie',
    } as SerializableClip;
    const comp = composition('comp', [imageClip, vectorClip], [videoTrack]);
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const prepareSpy = vi.spyOn(vectorAnimationRuntimeManager, 'prepareClipSource');
    const runtimeReady = vi.fn();

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [
        {
          id: 'media-image',
          name: 'Still.png',
          type: 'image',
          file: undefined,
          url: '',
          duration: 4,
          absolutePath: 'C:/media/Still.png',
        },
        {
          id: 'media-lottie',
          name: 'anim.lottie',
          type: 'lottie',
          file: undefined,
          url: '',
          duration: 4,
          absolutePath: 'C:/media/anim.lottie',
        },
      ],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
      restoreHooks: {
        runtimeReady: {
          onReady: runtimeReady,
        },
      },
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(runtimeReady).not.toHaveBeenCalled();
    expect(nestedClips).toHaveLength(2);
    expect(nestedClips[0]).toEqual(expect.objectContaining({
      source: null,
      isLoading: false,
      needsReload: undefined,
    }));
    expect(nestedClips[1]).toEqual(expect.objectContaining({
      source: null,
      isLoading: false,
      needsReload: undefined,
    }));
  });

  it('lets restore hooks mark missing nested runtime sources for relink without changing default callers', async () => {
    const videoTrack = track('video-1', 'video');
    const imageClip = {
      ...serializedClip('clip-image', 'image', 'media-image', videoTrack.id),
      name: 'Still Image',
      naturalDuration: 7,
    } as SerializableClip;
    const comp = composition('comp', [imageClip], [videoTrack]);
    const harness = createStoreHarness();
    const getNeedsReload = vi.fn(() => true);
    const createMissingRuntimeSource = vi.fn((event: NestedMediaRestoreEvent): TimelineClip['source'] => ({
      type: event.sourceType as NonNullable<TimelineClip['source']>['type'],
      naturalDuration: event.serializedClip.naturalDuration ?? event.serializedClip.duration,
      mediaFileId: event.serializedClip.mediaFileId,
    }));

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [{
        id: 'media-image',
        name: 'Still.png',
        type: 'image',
        file: undefined,
        url: '',
        duration: 4,
        absolutePath: 'C:/media/Still.png',
      }],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
      restoreHooks: {
        mediaRelink: {
          getNeedsReload,
          createMissingRuntimeSource,
        },
      },
    });

    expect(getNeedsReload).toHaveBeenCalledWith(expect.objectContaining({
      rootCompClipId: 'parent-comp-clip',
      parentClipId: 'parent-comp-clip',
      nestedClipId: nestedClips[0].id,
      sourceType: 'image',
      hasBrowserFile: false,
      depth: 1,
    }));
    expect(createMissingRuntimeSource).toHaveBeenCalledWith(expect.objectContaining({
      nestedClipId: nestedClips[0].id,
      sourceType: 'image',
      hasBrowserFile: false,
    }));
    expect(nestedClips[0]).toEqual(expect.objectContaining({
      needsReload: true,
      isLoading: false,
      source: {
        type: 'image',
        naturalDuration: 7,
        mediaFileId: 'media-image',
      },
    }));
  });

  it('uses managed blob ownership for direct nested data-only image loads', async () => {
    const videoTrack = track('video-1', 'video');
    const imageFile = new File(['image'], 'Still.png', { type: 'image/png' });
    const imageClip = {
      ...serializedClip('clip-image', 'image', 'media-image', videoTrack.id),
      name: 'Still Image',
    } as SerializableClip;
    const comp = composition('comp', [imageClip], [videoTrack]);
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:add-comp-image');
    const createElement = vi.spyOn(document, 'createElement');
    const runtimeReady = vi.fn();
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [{
        id: 'media-image',
        name: imageFile.name,
        type: 'image',
        file: imageFile,
        duration: 4,
        absolutePath: 'C:/media/Still.png',
      }],
      compositions: [comp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: comp,
      get: harness.get,
      set: harness.set,
      restoreHooks: {
        runtimeReady: {
          onReady: runtimeReady,
        },
      },
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(imageFile);
    expect(blobUrlManager.get(nestedClips[0].id, 'image')).toBe('blob:add-comp-image');
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');
    expect(nestedClips[0].source).toEqual(expect.objectContaining({
      type: 'image',
      mediaFileId: 'media-image',
      imageUrl: 'blob:add-comp-image',
      naturalDuration: 4,
      filePath: 'C:/media/Still.png',
    }));
    expect(nestedClips[0].source?.imageElement).toBeUndefined();
    expect(nestedClips[0].isLoading).toBe(false);

    harness.state.clips = [{
      id: 'parent-comp-clip',
      trackId: videoTrack.id,
      name: 'Parent Comp',
      file: new File([], 'Parent Comp'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
      transform: baseTransform,
      effects: [],
      isComposition: true,
      compositionId: comp.id,
      nestedClips,
    } as TimelineClip];

    const patchedClip = harness.state.clips[0].nestedClips?.[0];
    expect(patchedClip?.source).toBe(nestedClips[0].source);
    expect(patchedClip?.isLoading).toBe(false);
    expect(createdImages).toHaveLength(0);
    expect(harness.state.invalidateCache).toHaveBeenCalled();
    expect(runtimeReady).toHaveBeenCalledWith(expect.objectContaining({
      rootCompClipId: 'parent-comp-clip',
      parentClipId: 'parent-comp-clip',
      nestedClipId: nestedClips[0].id,
      sourceType: 'image',
      depth: 1,
      defaultInvalidatesCache: true,
    }));
  });

  it('uses managed blob ownership for sub-nested data-only image loads', async () => {
    const parentTrack = track('parent-video', 'video');
    const childTrack = track('child-video', 'video');
    const imageFile = new File(['image'], 'NestedStill.png', { type: 'image/png' });
    const childImage = {
      ...serializedClip('child-image-clip', 'image', 'media-child-image', childTrack.id),
      name: 'Nested Still',
    } as SerializableClip;
    const childComp = composition('child-comp', [childImage], [childTrack]);
    const parentComp = composition(
      'parent-comp',
      [{
        id: 'nested-comp-source',
        trackId: parentTrack.id,
        name: 'Nested Comp',
        sourceType: 'video',
        isComposition: true,
        compositionId: childComp.id,
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        transform: baseTransform,
        effects: [],
      } as SerializableClip],
      [parentTrack],
    );
    const harness = createStoreHarness();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:add-comp-sub-image');
    const createElement = vi.spyOn(document, 'createElement');
    const runtimeReady = vi.fn();
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [{
        id: 'media-child-image',
        name: imageFile.name,
        type: 'image',
        file: imageFile,
        duration: 4,
        absolutePath: 'C:/media/NestedStill.png',
      }],
      compositions: [parentComp, childComp],
    } as ReturnType<typeof useMediaStore.getState>);

    const nestedClips = await loadNestedClips({
      compClipId: 'parent-comp-clip',
      composition: parentComp,
      get: harness.get,
      set: harness.set,
      restoreHooks: {
        runtimeReady: {
          onReady: runtimeReady,
        },
      },
    });

    const nestedImage = nestedClips[0].nestedClips?.[0];
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(imageFile);
    expect(blobUrlManager.get(nestedImage?.id ?? '', 'image')).toBe('blob:add-comp-sub-image');
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(createElement).not.toHaveBeenCalledWith('audio');
    expect(nestedImage?.source).toEqual(expect.objectContaining({
      type: 'image',
      mediaFileId: 'media-child-image',
      imageUrl: 'blob:add-comp-sub-image',
      naturalDuration: 4,
      filePath: 'C:/media/NestedStill.png',
    }));
    expect(nestedImage?.source?.imageElement).toBeUndefined();
    expect(nestedImage?.isLoading).toBe(false);

    harness.state.clips = [{
      id: 'parent-comp-clip',
      trackId: parentTrack.id,
      name: 'Parent Comp',
      file: new File([], 'Parent Comp'),
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'video', naturalDuration: 10 },
      transform: baseTransform,
      effects: [],
      isComposition: true,
      compositionId: parentComp.id,
      nestedClips,
    } as TimelineClip];
    const storeNestedImage = harness.state.clips[0].nestedClips?.[0].nestedClips?.[0];
    expect(storeNestedImage?.source).toBe(nestedImage?.source);
    expect(storeNestedImage?.isLoading).toBe(false);
    expect(nestedImage?.isLoading).toBe(false);
    expect(createdImages).toHaveLength(0);
    expect(runtimeReady).toHaveBeenCalledWith(expect.objectContaining({
      rootCompClipId: 'parent-comp-clip',
      parentClipId: nestedClips[0].id,
      nestedClipId: nestedImage?.id,
      sourceType: 'image',
      depth: 2,
      defaultInvalidatesCache: false,
    }));
  });
});
