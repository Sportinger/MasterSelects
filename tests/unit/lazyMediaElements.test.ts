import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../../src/engine/WebGPUEngine';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import {
  getLazyTimelineMediaElementCount,
  hydrateTimelineMediaWindow,
  releaseAllLazyTimelineMediaElements,
} from '../../src/services/timeline/lazyMediaElements';
import {
  getLazyImageElementForClip,
  getLazyTimelineImageElementCount,
  releaseAllLazyTimelineImageElements,
} from '../../src/services/timeline/lazyImageElements';
import {
  getLazyMediaElementObjectUrlKey,
  mediaObjectUrlManager,
  revokeAllMediaObjectUrls,
} from '../../src/services/project/mediaObjectUrlManager';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';

const noop = () => undefined;

function makeTrack(type: TimelineTrack['type'], id = `track-${type}`): TimelineTrack {
  return {
    id,
    name: id,
    type,
    height: 64,
    muted: false,
    visible: true,
    solo: false,
  };
}

function makeClip(
  id: string,
  track: TimelineTrack,
  sourceType: 'video' | 'audio',
  mediaFileId: string,
  file = new File(['media'], `${id}.mp4`, { type: sourceType === 'video' ? 'video/mp4' : 'audio/mpeg' })
): TimelineClip {
  return {
    id,
    trackId: track.id,
    name: file.name,
    file,
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: {
      type: sourceType,
      mediaFileId,
      naturalDuration: 4,
    },
    mediaFileId,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    needsReload: true,
  };
}

function makeImageClip(
  id: string,
  track: TimelineTrack,
  mediaFileId: string,
  file = new File(['image'], `${id}.png`, { type: 'image/png' })
): TimelineClip {
  return {
    id,
    trackId: track.id,
    name: file.name,
    file,
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: {
      type: 'image',
      mediaFileId,
      naturalDuration: 4,
    },
    mediaFileId,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    needsReload: false,
  };
}

function makeContext(params: {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  mediaFiles: Array<{ id: string; name: string; type: string; url?: string; file?: File; duration?: number }>;
  isPlaying?: boolean;
  now?: number;
  playheadPosition?: number;
}): FrameContext {
  const videoTracks = params.tracks.filter((track) => track.type === 'video');
  const audioTracks = params.tracks.filter((track) => track.type === 'audio');
  return {
    clips: params.clips,
    tracks: params.tracks,
    isPlaying: params.isPlaying ?? false,
    isDraggingPlayhead: false,
    hasClipDragPreview: false,
    playheadPosition: params.playheadPosition ?? 0.25,
    playbackSpeed: 1,
    activeCompId: 'main',
    proxyEnabled: false,
    getInterpolatedTransform: (clipId: string) => params.clips.find((clip) => clip.id === clipId)?.transform ?? params.clips[0].transform,
    getInterpolatedEffects: () => [],
    getInterpolatedNodeGraphParams: () => ({}),
    getInterpolatedColorCorrection: () => undefined,
    getInterpolatedVectorAnimationSettings: () => ({}),
    getInterpolatedTextBounds: () => undefined,
    getInterpolatedSpeed: () => 1,
    getSourceTimeForClip: () => 0,
    hasKeyframes: () => false,
    now: params.now ?? 1000,
    frameNumber: 1,
    videoTracks,
    audioTracks,
    visibleVideoTrackIds: new Set(videoTracks.map((track) => track.id)),
    unmutedAudioTrackIds: new Set(audioTracks.map((track) => track.id)),
    anyVideoSolo: false,
    anyAudioSolo: false,
    clipsAtTime: params.clips,
    clipsByTrackId: new Map(params.clips.map((clip) => [clip.trackId, clip])),
    mediaFiles: params.mediaFiles,
    mediaFileById: new Map(params.mediaFiles.map((file) => [file.id, file])),
    mediaFileByName: new Map(params.mediaFiles.map((file) => [file.name, file])),
    compositionById: new Map(),
  } as unknown as FrameContext;
}

function makeNestedVideoCompositionContext() {
  const parentTrack = makeTrack('video', 'track-parent');
  const nestedTrack = makeTrack('video', 'nested-video-1');
  const nestedVideo = makeClip(
    'nested-video-clip',
    nestedTrack,
    'video',
    'media-nested-video',
    new File(['nested'], 'nested-video.mp4', { type: 'video/mp4' })
  );
  nestedVideo.startTime = 0.5;
  nestedVideo.duration = 3;
  nestedVideo.inPoint = 0;
  nestedVideo.outPoint = 3;

  const parentComp: TimelineClip = {
    id: 'comp-clip',
    trackId: parentTrack.id,
    name: 'Comp Clip',
    file: new File([], 'nested-comp'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video', naturalDuration: 5 },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    isComposition: true,
    compositionId: 'comp-1',
    nestedTracks: [nestedTrack],
    nestedClips: [nestedVideo],
  };

  const ctx = makeContext({
    clips: [parentComp],
    tracks: [parentTrack],
    mediaFiles: [
      { id: 'media-nested-video', name: nestedVideo.name, type: 'video', url: 'blob:nested-video', duration: 3 },
    ],
    now: 1000,
    playheadPosition: 0.75,
  });

  return { ctx, nestedVideo, parentComp };
}

describe('lazy timeline media elements', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(noop);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(noop);
    releaseAllLazyTimelineMediaElements();
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    releaseAllLazyTimelineMediaElements();
    releaseAllLazyTimelineImageElements();
    revokeAllMediaObjectUrls();
    timelineRuntimeCoordinator.clearResources();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers video and audio primary lazy media as interactive coordinator resources', () => {
    const videoTrack = makeTrack('video', 'track-v1');
    const audioTrack = makeTrack('audio', 'track-a1');
    const videoClip = makeClip('clip-v1', videoTrack, 'video', 'media-v1');
    const audioClip = makeClip('clip-a1', audioTrack, 'audio', 'media-a1');
    const ctx = makeContext({
      clips: [videoClip, audioClip],
      tracks: [videoTrack, audioTrack],
      mediaFiles: [
        { id: 'media-v1', name: videoClip.name, type: 'video', url: 'blob:video', duration: 4 },
        { id: 'media-a1', name: audioClip.name, type: 'audio', url: 'blob:audio', duration: 4 },
      ],
    });

    hydrateTimelineMediaWindow(ctx);

    const stats = timelineRuntimeCoordinator.getBridgeStats();
    expect(getLazyTimelineMediaElementCount()).toBe(2);
    expect(videoClip.source?.videoElement).toBeInstanceOf(HTMLVideoElement);
    expect(audioClip.source?.audioElement).toBeInstanceOf(HTMLAudioElement);
    expect(videoClip.source?.videoElement?.preload).toBe('metadata');
    expect(audioClip.source?.audioElement?.preload).toBe('metadata');
    expect(stats.totals.resources).toBe(2);
    expect(stats.totals.htmlMediaElements).toBe(2);
    expect(stats.totals.audioSources).toBe(1);
    expect(stats.policies.interactive.resources.map((resource) => resource.id).toSorted()).toEqual([
      'timeline-lazy-media:audio:clip-a1',
      'timeline-lazy-media:video:clip-v1',
    ]);
    expect(stats.policies.interactive.resources[0].tags).toContain('primary-lazy-media');
  });

  it('skips file-backed lazy video allocation when interactive html-media admission is over budget', () => {
    for (let index = 0; index < 12; index += 1) {
      timelineRuntimeCoordinator.retainResource({
        id: `interactive-html-media-${index}`,
        kind: 'html-media',
        policyId: 'interactive',
        owner: {
          ownerId: `clip-retained-${index}`,
          ownerType: 'clip',
          clipId: `clip-retained-${index}`,
          trackId: 'track-retained',
        },
        mediaElementKind: 'video',
        elementId: `retained-video-${index}`,
        srcKind: 'blob-url',
      });
    }

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:denied-video');
    const createElement = vi.spyOn(document, 'createElement');
    const videoTrack = makeTrack('video', 'track-v1');
    const videoClip = makeClip('clip-v1', videoTrack, 'video', 'media-v1');
    const ctx = makeContext({
      clips: [videoClip],
      tracks: [videoTrack],
      mediaFiles: [
        { id: 'media-v1', name: videoClip.name, type: 'video', file: videoClip.file, duration: 4 },
      ],
    });

    hydrateTimelineMediaWindow(ctx);

    expect(getLazyTimelineMediaElementCount()).toBe(0);
    expect(videoClip.source?.videoElement).toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.budgetReport.usage.htmlMediaElements).toBe(12);
  });

  it('admits lazy audio after interactive html-media budget is released', () => {
    for (let index = 0; index < 12; index += 1) {
      timelineRuntimeCoordinator.retainResource({
        id: `interactive-html-media-${index}`,
        kind: 'html-media',
        policyId: 'interactive',
        owner: {
          ownerId: `clip-retained-${index}`,
          ownerType: 'clip',
          clipId: `clip-retained-${index}`,
          trackId: 'track-retained',
        },
        mediaElementKind: 'audio',
        elementId: `retained-audio-${index}`,
        srcKind: 'blob-url',
      });
    }

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:generated-audio');
    const audioTrack = makeTrack('audio', 'track-a1');
    const audioClip = makeClip('clip-a1', audioTrack, 'audio', 'media-a1', new File(['audio'], 'clip-a1.mp3', { type: 'audio/mpeg' }));
    const ctx = makeContext({
      clips: [audioClip],
      tracks: [audioTrack],
      mediaFiles: [
        { id: 'media-a1', name: audioClip.name, type: 'audio', file: audioClip.file, duration: 4 },
      ],
    });

    hydrateTimelineMediaWindow(ctx);
    expect(getLazyTimelineMediaElementCount()).toBe(0);
    expect(createObjectURL).not.toHaveBeenCalled();

    timelineRuntimeCoordinator.clearResources();
    hydrateTimelineMediaWindow(ctx);

    expect(getLazyTimelineMediaElementCount()).toBe(1);
    expect(audioClip.source?.audioElement).toBeInstanceOf(HTMLAudioElement);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.budgetReport.usage.htmlMediaElements).toBe(1);
  });

  it('skips lazy audio allocation when interactive audio-source admission is over budget', () => {
    for (let index = 0; index < 8; index += 1) {
      timelineRuntimeCoordinator.retainResource({
        id: `interactive-audio-source-${index}`,
        kind: 'html-media',
        policyId: 'interactive',
        owner: {
          ownerId: `clip-retained-audio-${index}`,
          ownerType: 'clip',
          clipId: `clip-retained-audio-${index}`,
          trackId: 'track-retained',
        },
        mediaElementKind: 'audio',
        elementId: `retained-audio-source-${index}`,
        srcKind: 'blob-url',
      });
    }

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:denied-audio');
    const createElement = vi.spyOn(document, 'createElement');
    const audioTrack = makeTrack('audio', 'track-a1');
    const audioClip = makeClip('clip-a1', audioTrack, 'audio', 'media-a1', new File(['audio'], 'clip-a1.mp3', { type: 'audio/mpeg' }));
    const ctx = makeContext({
      clips: [audioClip],
      tracks: [audioTrack],
      mediaFiles: [
        { id: 'media-a1', name: audioClip.name, type: 'audio', file: audioClip.file, duration: 4 },
      ],
    });

    hydrateTimelineMediaWindow(ctx);

    expect(getLazyTimelineMediaElementCount()).toBe(0);
    expect(audioClip.source?.audioElement).toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalledWith('audio');
    const usage = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.budgetReport.usage;
    expect(usage.htmlMediaElements).toBe(8);
    expect(usage.audioSources).toBe(8);
  });

  it('releaseAll clears source element refs without a frame context', () => {
    const cleanupVideo = vi.spyOn(engine, 'cleanupVideo').mockImplementation(noop);
    const videoTrack = makeTrack('video', 'track-v1');
    const audioTrack = makeTrack('audio', 'track-a1');
    const videoClip = makeClip('clip-v1', videoTrack, 'video', 'media-v1');
    const audioClip = makeClip('clip-a1', audioTrack, 'audio', 'media-a1');
    const ctx = makeContext({
      clips: [videoClip, audioClip],
      tracks: [videoTrack, audioTrack],
      mediaFiles: [
        { id: 'media-v1', name: videoClip.name, type: 'video', url: 'blob:video', duration: 4 },
        { id: 'media-a1', name: audioClip.name, type: 'audio', url: 'blob:audio', duration: 4 },
      ],
    });

    hydrateTimelineMediaWindow(ctx);

    expect(getLazyTimelineMediaElementCount()).toBe(2);
    expect(videoClip.source?.videoElement).toBeInstanceOf(HTMLVideoElement);
    expect(audioClip.source?.audioElement).toBeInstanceOf(HTMLAudioElement);

    releaseAllLazyTimelineMediaElements();

    expect(getLazyTimelineMediaElementCount()).toBe(0);
    expect(videoClip.source?.videoElement).toBeUndefined();
    expect(audioClip.source?.audioElement).toBeUndefined();
    expect(cleanupVideo).toHaveBeenCalledTimes(1);
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(0);
  });

  it('releases idle file-backed lazy media through prune and revokes manager-owned element URLs', () => {
    const cleanupVideo = vi.spyOn(engine, 'cleanupVideo').mockImplementation(noop);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:generated-video');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(noop);
    const videoTrack = makeTrack('video', 'track-v1');
    const videoClip = makeClip('clip-v1', videoTrack, 'video', 'media-v1');
    const ctx = makeContext({
      clips: [videoClip],
      tracks: [videoTrack],
      mediaFiles: [
        { id: 'media-v1', name: videoClip.name, type: 'video', file: videoClip.file, duration: 4 },
      ],
      now: 1000,
      playheadPosition: 0.25,
    });

    hydrateTimelineMediaWindow(ctx);
    expect(getLazyTimelineMediaElementCount()).toBe(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const lazyUrlKey = getLazyMediaElementObjectUrlKey('video', videoClip.id);
    expect(mediaObjectUrlManager.get('media-v1', lazyUrlKey)).toBe('blob:generated-video');
    expect(videoClip.source?.videoElement?.src).toBe('blob:generated-video');

    ctx.playheadPosition = 10;
    ctx.now = 1000 + 1801;
    hydrateTimelineMediaWindow(ctx);

    expect(getLazyTimelineMediaElementCount()).toBe(0);
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(0);
    expect(cleanupVideo).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:generated-video');
    expect(mediaObjectUrlManager.get('media-v1', lazyUrlKey)).toBeUndefined();
    expect(videoClip.source?.videoElement).toBeUndefined();
  });

  it('hydrates and releases data-only video sources inside active nested compositions', () => {
    const { ctx, nestedVideo, parentComp } = makeNestedVideoCompositionContext();

    hydrateTimelineMediaWindow(ctx);

    expect(getLazyTimelineMediaElementCount()).toBe(1);
    expect(nestedVideo.source?.videoElement).toBeInstanceOf(HTMLVideoElement);
    expect(nestedVideo.source?.videoElement?.src).toBe('blob:nested-video');
    expect(parentComp.source?.videoElement).toBeUndefined();

    ctx.playheadPosition = 20;
    ctx.now = 1000 + 1801;
    hydrateTimelineMediaWindow(ctx);

    expect(getLazyTimelineMediaElementCount()).toBe(0);
    expect(nestedVideo.source?.videoElement).toBeUndefined();
  });

  it('releaseAll clears nested source refs without a frame context', () => {
    const { ctx, nestedVideo } = makeNestedVideoCompositionContext();

    hydrateTimelineMediaWindow(ctx);

    expect(getLazyTimelineMediaElementCount()).toBe(1);
    expect(nestedVideo.source?.videoElement).toBeInstanceOf(HTMLVideoElement);

    releaseAllLazyTimelineMediaElements();

    expect(getLazyTimelineMediaElementCount()).toBe(0);
    expect(nestedVideo.source?.videoElement).toBeUndefined();
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(0);
  });
});

describe('lazy timeline image elements', () => {
  beforeEach(() => {
    releaseAllLazyTimelineImageElements();
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    releaseAllLazyTimelineImageElements();
    timelineRuntimeCoordinator.clearResources();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads data-only image clips from media urls without mutating the clip source', () => {
    const imageTrack = makeTrack('video', 'track-image');
    const imageClip = makeImageClip('clip-image', imageTrack, 'media-image');
    const onImageStatusChange = vi.fn();
    const createdImages: HTMLImageElement[] = [];
    const ImageCtor = vi.fn(function ImageMock() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    });
    vi.stubGlobal('Image', ImageCtor);
    const ctx = makeContext({
      clips: [imageClip],
      tracks: [imageTrack],
      mediaFiles: [
        { id: 'media-image', name: imageClip.name, type: 'image', url: 'blob:image-source', duration: 4 },
      ],
    }) as ReturnType<typeof makeContext> & { onImageStatusChange?: (clipId: string) => void };
    ctx.onImageStatusChange = onImageStatusChange;

    const coldImage = getLazyImageElementForClip(ctx, imageClip);

    expect(coldImage).toBeNull();
    expect(getLazyTimelineImageElementCount()).toBe(1);
    expect(createdImages[0]?.src).toBe('blob:image-source');
    expect(imageClip.source?.imageElement).toBeUndefined();
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(1);

    createdImages[0].dispatchEvent(new Event('load'));

    const readyImage = getLazyImageElementForClip(ctx, imageClip);

    expect(readyImage).toBe(createdImages[0]);
    expect(onImageStatusChange).toHaveBeenCalledOnce();
    expect(onImageStatusChange).toHaveBeenCalledWith('clip-image');
    expect(imageClip.source?.imageElement).toBeUndefined();
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.imageBitmaps).toBe(1);
  });

  it('releases file-backed image object urls', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file-image');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(noop);
    const imageTrack = makeTrack('video', 'track-image');
    const imageClip = makeImageClip('clip-image', imageTrack, 'media-image');
    const ctx = makeContext({
      clips: [imageClip],
      tracks: [imageTrack],
      mediaFiles: [
        { id: 'media-image', name: imageClip.name, type: 'image', file: imageClip.file, duration: 4 },
      ],
    });

    getLazyImageElementForClip(ctx, imageClip);
    releaseAllLazyTimelineImageElements();

    expect(createObjectURL).toHaveBeenCalledWith(imageClip.file);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:file-image');
    expect(getLazyTimelineImageElementCount()).toBe(0);
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(0);
  });

  it('skips file-backed image allocation when the interactive image budget is full', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:denied-image');
    const ImageCtor = vi.fn(function ImageMock() {
      return document.createElement('img');
    });
    vi.stubGlobal('Image', ImageCtor);
    for (let index = 0; index < 64; index += 1) {
      timelineRuntimeCoordinator.retainResource({
        id: `preexisting-image-${index}`,
        kind: 'image-canvas',
        policyId: 'interactive',
        owner: {
          ownerId: `preexisting-image-${index}`,
          ownerType: 'clip',
          clipId: `preexisting-image-${index}`,
        },
        source: {
          clipId: `preexisting-image-${index}`,
        },
        imageKind: 'html-image',
        imageId: `preexisting-image-${index}`,
        label: 'Preexisting image',
      });
    }

    const imageTrack = makeTrack('video', 'track-image');
    const imageClip = makeImageClip('clip-image', imageTrack, 'media-image');
    const ctx = makeContext({
      clips: [imageClip],
      tracks: [imageTrack],
      mediaFiles: [
        { id: 'media-image', name: imageClip.name, type: 'image', file: imageClip.file, duration: 4 },
      ],
    });

    const image = getLazyImageElementForClip(ctx, imageClip);

    expect(image).toBeNull();
    expect(getLazyTimelineImageElementCount()).toBe(0);
    expect(imageClip.source?.imageElement).toBeUndefined();
    expect(ImageCtor).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(64);
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.imageBitmaps).toBe(64);
  });

  it('replaces a lazy image record when the source url changes for the same clip id', () => {
    const createdImages: HTMLImageElement[] = [];
    const ImageCtor = vi.fn(function ImageMock() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    });
    vi.stubGlobal('Image', ImageCtor);
    const imageTrack = makeTrack('video', 'track-image');
    const imageClip = makeImageClip('clip-image', imageTrack, 'media-image');
    const ctx = makeContext({
      clips: [imageClip],
      tracks: [imageTrack],
      mediaFiles: [
        { id: 'media-image', name: imageClip.name, type: 'image', url: 'blob:first-image', duration: 4 },
      ],
    });

    getLazyImageElementForClip(ctx, imageClip);
    expect(createdImages[0]?.src).toBe('blob:first-image');
    expect(getLazyTimelineImageElementCount()).toBe(1);

    ctx.mediaFileById.set('media-image', {
      id: 'media-image',
      name: imageClip.name,
      type: 'image',
      url: 'blob:second-image',
      duration: 4,
    } as never);
    ctx.mediaFileByName.set(imageClip.name, {
      id: 'media-image',
      name: imageClip.name,
      type: 'image',
      url: 'blob:second-image',
      duration: 4,
    } as never);

    getLazyImageElementForClip(ctx, imageClip);

    expect(ImageCtor).toHaveBeenCalledTimes(2);
    expect(createdImages[0]?.getAttribute('src')).toBeNull();
    expect(createdImages[1]?.src).toBe('blob:second-image');
    expect(getLazyTimelineImageElementCount()).toBe(1);
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(1);
  });
});
