import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLayersAtTime,
  cleanupLayerBuilder,
  initializeLayerBuilder,
} from '../../src/engine/export/ExportLayerBuilder';
import type { ExportClipState, FrameContext } from '../../src/engine/export/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { vectorAnimationRuntimeManager } from '../../src/services/vectorAnimation/VectorAnimationRuntimeManager';
import type { TimelineClip, TimelineTrack } from '../../src/stores/timeline/types';
import type { ParallelDecodeManager } from '../../src/engine/ParallelDecodeManager';
import { planTransition } from '../../src/stores/timeline/editOperations/transitionPlanner';
import type { TransitionParamValue, TransitionType } from '../../src/transitions';

const initialMediaState = useMediaStore.getState();

function createVideoTrack(): TimelineTrack {
  return {
    id: 'track-1',
    type: 'video',
    visible: true,
    solo: false,
  } as unknown as TimelineTrack;
}

function createTransitionClip(
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
  sourceType: 'image' | 'video' = 'image',
): TimelineClip {
  const source = sourceType === 'video'
    ? { type: 'video' as const, videoElement: document.createElement('video') }
    : { type: 'image' as const, imageElement: document.createElement('img') };

  return {
    id,
    name: id,
    trackId,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source,
    transform: {},
    effects: [],
  } as unknown as TimelineClip;
}

function createDefaultTransform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    opacity: 1,
    blendMode: 'normal' as const,
  };
}

function markVideoReady(video: HTMLVideoElement): HTMLVideoElement {
  Object.defineProperty(video, 'readyState', {
    configurable: true,
    value: HTMLMediaElement.HAVE_CURRENT_DATA,
  });
  return video;
}

interface BuildTransitionExportLayersOptions {
  transitionType: TransitionType;
  requestedDuration?: number;
  time?: number;
  sourceType?: 'image' | 'video';
  outgoingClip?: Partial<TimelineClip>;
  incomingClip?: Partial<TimelineClip>;
  clipEffects?: ReturnType<FrameContext['getInterpolatedEffects']>;
  clipStates?: Map<string, ExportClipState>;
  outputWidth?: number;
  outputHeight?: number;
  transitionParams?: Record<string, TransitionParamValue>;
}

function buildTransitionExportLayers({
  transitionType,
  requestedDuration = 2,
  time = 10,
  sourceType = 'image',
  outgoingClip: outgoingOverrides,
  incomingClip: incomingOverrides,
  clipEffects = [],
  clipStates = new Map(),
  outputWidth = 1280,
  outputHeight = 720,
  transitionParams,
}: BuildTransitionExportLayersOptions) {
  const track = createVideoTrack();
  const outgoingClip = {
    ...createTransitionClip('outgoing', track.id, 0, 10, sourceType),
    transitionOut: {
      id: `transition-${transitionType}`,
      type: transitionType,
      duration: requestedDuration,
      linkedClipId: 'incoming',
      compositionId: `transition-comp-${transitionType}`,
      ...(transitionParams ? { params: transitionParams } : {}),
    },
    ...outgoingOverrides,
  } as TimelineClip;
  const incomingClip = {
    ...createTransitionClip('incoming', track.id, 10, 5, sourceType),
    transitionIn: {
      id: `transition-${transitionType}`,
      type: transitionType,
      duration: requestedDuration,
      linkedClipId: 'outgoing',
      compositionId: `transition-comp-${transitionType}`,
      ...(transitionParams ? { params: transitionParams } : {}),
    },
    ...incomingOverrides,
  } as TimelineClip;
  const plan = planTransition({
    outgoingClip,
    incomingClip,
    transitionType,
    requestedDuration,
    placement: 'center',
    edgePolicy: 'hold',
    junctionTime: outgoingClip.startTime + outgoingClip.duration,
    params: transitionParams,
  });
  expect(plan).not.toBeNull();
  const transitionComposition = createTransitionComposition({
    id: `transition-comp-${transitionType}`,
    transitionId: `transition-${transitionType}`,
    transitionType,
    duration: plan!.resolvedDuration,
  });

  const ctx: FrameContext = {
    time,
    fps: 30,
    frameTolerance: 50_000,
    outputWidth,
    outputHeight,
    clipsAtTime: [outgoingClip],
    renderClipsAtTime: [outgoingClip, incomingClip],
    trackMap: new Map([[track.id, track]]),
    clipsByTrack: new Map([[track.id, outgoingClip]]),
    transitionParticipantsByTrack: new Map([[track.id, {
      plan: plan!,
      outgoingClip,
      incomingClip,
    }]]),
    getInterpolatedTransform: createDefaultTransform,
    getInterpolatedEffects: () => clipEffects,
    getInterpolatedColorCorrection: () => undefined,
    getInterpolatedVectorAnimationSettings: () => ({}),
    getInterpolatedTextBounds: () => undefined,
    getSourceTimeForClip: (_clipId, localTime) => localTime,
    getInterpolatedSpeed: () => 1,
  };

  initializeLayerBuilder([track]);

  return {
    layers: withMediaStoreState(
      { compositions: [transitionComposition] },
      () => buildLayersAtTime(ctx, clipStates, null, false),
    ),
    plan: plan!,
    outgoingClip,
    incomingClip,
  };
}

function createTransitionComposition(input: {
  id: string;
  transitionId: string;
  transitionType: string;
  duration: number;
}): ReturnType<typeof useMediaStore.getState>['compositions'][number] {
  const outgoingClipId = `transition-comp:${input.transitionId}:outgoing`;
  const incomingClipId = `transition-comp:${input.transitionId}:incoming`;
  return {
    id: input.id,
    name: `Transition - ${input.transitionType}`,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: input.duration,
    backgroundColor: '#000000',
    timelineData: {
      tracks: [
        { id: 'transition-track-incoming', name: 'Incoming', type: 'video', visible: true, muted: false, solo: false },
        { id: 'transition-track-outgoing', name: 'Outgoing', type: 'video', visible: true, muted: false, solo: false },
      ],
      clips: [
        {
          id: outgoingClipId,
          trackId: 'transition-track-outgoing',
          name: 'Outgoing linked',
          mediaFileId: '',
          startTime: 0,
          duration: input.duration,
          inPoint: 0,
          outPoint: input.duration,
          sourceType: 'image',
          transform: createDefaultTransform(),
          effects: [],
        },
        {
          id: incomingClipId,
          trackId: 'transition-track-incoming',
          name: 'Incoming linked',
          mediaFileId: '',
          startTime: 0,
          duration: input.duration,
          inPoint: 0,
          outPoint: input.duration,
          sourceType: 'image',
          transform: createDefaultTransform(),
          effects: [],
        },
      ],
      playheadPosition: 0,
      duration: input.duration,
      zoom: 160,
      scrollX: 0,
      inPoint: 0,
      outPoint: input.duration,
      loopPlayback: true,
    },
    transitionComp: {
      kind: 'transition-comp',
      parentCompositionId: 'parent',
      parentTransitionId: input.transitionId,
      parentOutgoingClipId: 'outgoing',
      parentIncomingClipId: 'incoming',
      linkedOutgoingClipId: outgoingClipId,
      linkedIncomingClipId: incomingClipId,
      innerTransitionId: '',
      templateType: input.transitionType,
      templateVersion: 1,
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart: 0,
      bodyEnd: input.duration,
      materialized: true,
    },
  };
}

function withMediaStoreState<T>(
  overrides: Partial<ReturnType<typeof useMediaStore.getState>>,
  run: () => T,
): T {
  const getStateMock = vi.mocked(useMediaStore.getState);
  const previousImplementation = getStateMock.getMockImplementation();
  getStateMock.mockReturnValue({
    ...initialMediaState,
    ...overrides,
  });

  try {
    return run();
  } finally {
    if (previousImplementation) {
      getStateMock.mockImplementation(previousImplementation);
    }
  }
}

describe('ExportLayerBuilder', () => {
  beforeEach(() => {
    useMediaStore.setState({
      compositions: [],
    });
    useTimelineStore.setState({
      clipKeyframes: new Map(),
    });
  });

  afterEach(() => {
    cleanupLayerBuilder();
  });

  it('builds a nested composition layer for an active transition', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const outgoingImage = document.createElement('img');
    const incomingImage = document.createElement('img');
    const outgoingClip = {
      id: 'outgoing',
      name: 'Outgoing',
      trackId: track.id,
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      transitionOut: {
        id: 'transition-crossfade',
        type: 'crossfade',
        duration: 2,
        linkedClipId: 'incoming',
        compositionId: 'transition-comp-crossfade',
      },
      source: { type: 'image', imageElement: outgoingImage },
      transform: {},
    } as unknown as TimelineClip;
    const incomingClip = {
      id: 'incoming',
      name: 'Incoming',
      trackId: track.id,
      startTime: 10,
      duration: 5,
      inPoint: 0.5,
      outPoint: 5.5,
      transitionIn: {
        id: 'transition-crossfade',
        type: 'crossfade',
        duration: 2,
        linkedClipId: 'outgoing',
        compositionId: 'transition-comp-crossfade',
      },
      source: { type: 'image', imageElement: incomingImage },
      transform: {},
    } as unknown as TimelineClip;

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'crossfade',
      requestedDuration: 2,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 10,
    });
    expect(plan).not.toBeNull();
    const transitionComposition = createTransitionComposition({
      id: 'transition-comp-crossfade',
      transitionId: 'transition-crossfade',
      transitionType: 'crossfade',
      duration: plan!.resolvedDuration,
    });

    const ctx: FrameContext = {
      time: 10,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [outgoingClip],
      renderClipsAtTime: [outgoingClip, incomingClip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, outgoingClip]]),
      transitionParticipantsByTrack: new Map([[track.id, {
        plan: plan!,
        outgoingClip,
        incomingClip,
      }]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getInterpolatedColorCorrection: () => undefined,
      getInterpolatedVectorAnimationSettings: () => ({}),
      getInterpolatedTextBounds: () => undefined,
      getSourceTimeForClip: (_clipId, localTime) => localTime,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = withMediaStoreState(
      { compositions: [transitionComposition] },
      () => buildLayersAtTime(ctx, new Map(), null, false),
    );

    expect(layers).toHaveLength(1);
    expect(layers[0]?.sourceClipId).toBe('transition-crossfade');
    expect(layers[0]?.source?.nestedComposition?.compositionId).toBe('transition-comp-crossfade');
    expect(layers[0]?.source?.nestedComposition?.currentTime).toBeCloseTo(1);
  });

  it('does not render an arbitrary normal composition as a transition layer', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const outgoingImage = document.createElement('img');
    const incomingImage = document.createElement('img');
    const outgoingClip = {
      id: 'outgoing',
      name: 'Outgoing',
      trackId: track.id,
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      transitionOut: {
        id: 'transition-push',
        type: 'push-left',
        duration: 2,
        linkedClipId: 'incoming',
        compositionId: 'normal-comp',
      },
      source: { type: 'image', imageElement: outgoingImage },
      transform: {},
    } as unknown as TimelineClip;
    const incomingClip = {
      id: 'incoming',
      name: 'Incoming',
      trackId: track.id,
      startTime: 10,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      transitionIn: {
        id: 'transition-push',
        type: 'push-left',
        duration: 2,
        linkedClipId: 'outgoing',
        compositionId: 'normal-comp',
      },
      source: { type: 'image', imageElement: incomingImage },
      transform: {},
    } as unknown as TimelineClip;

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'push-left',
      requestedDuration: 2,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 10,
    });
    expect(plan).not.toBeNull();
    const normalComposition = {
      id: 'normal-comp',
      name: 'Normal Comp',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1280,
      height: 720,
      frameRate: 30,
      duration: 2,
      backgroundColor: '#000000',
      timelineData: {
        tracks: [],
        clips: [],
        playheadPosition: 0,
        duration: 2,
        zoom: 160,
        scrollX: 0,
        inPoint: 0,
        outPoint: 2,
        loopPlayback: true,
      },
    };

    const ctx: FrameContext = {
      time: 10,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [outgoingClip],
      renderClipsAtTime: [outgoingClip, incomingClip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, outgoingClip]]),
      transitionParticipantsByTrack: new Map([[track.id, {
        plan: plan!,
        outgoingClip,
        incomingClip,
      }]]),
      getInterpolatedTransform: (clipId) => ({
        position: clipId === 'outgoing'
          ? { x: 0.2, y: 0.1, z: 0.3 }
          : { x: -0.1, y: -0.2, z: 0.4 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getInterpolatedColorCorrection: () => undefined,
      getInterpolatedVectorAnimationSettings: () => ({}),
      getInterpolatedTextBounds: () => undefined,
      getSourceTimeForClip: (_clipId, localTime) => localTime,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = withMediaStoreState(
      { compositions: [normalComposition] },
      () => buildLayersAtTime(ctx, new Map(), null, false),
    );

    expect(layers).toEqual([]);
  });

  it('exports active transition families as hidden nested composition layers', () => {
    for (const transitionType of ['light-sweep', 'rgb-split-glitch', 'additive-dissolve', 'checker-wipe', 'roll-3d'] as const) {
      const { layers } = buildTransitionExportLayers({ transitionType });

      expect(layers).toHaveLength(1);
      expect(layers[0]?.sourceClipId).toBe(`transition-${transitionType}`);
      expect(layers[0]?.source?.nestedComposition?.compositionId).toBe(`transition-comp-${transitionType}`);
      expect(layers[0]?.source?.nestedComposition?.layers).toHaveLength(2);
    }
  });

  it('hydrates transition composition export layers from prepared parent video states', () => {
    const outgoingVideo = markVideoReady(document.createElement('video'));
    const incomingVideo = markVideoReady(document.createElement('video'));
    const clipStates = new Map<string, ExportClipState>([
      ['outgoing', {
        clipId: 'outgoing',
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
        preciseVideoElement: outgoingVideo,
      }],
      ['incoming', {
        clipId: 'incoming',
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
        preciseVideoElement: incomingVideo,
      }],
    ]);

    const { layers } = buildTransitionExportLayers({
      transitionType: 'light-leak',
      sourceType: 'video',
      clipStates,
    });
    const nestedLayers = layers[0]?.source?.nestedComposition?.layers ?? [];
    const outgoingLayer = nestedLayers.find(layer =>
      layer.sourceClipId === 'transition-comp:transition-light-leak:outgoing'
    );
    const incomingLayer = nestedLayers.find(layer =>
      layer.sourceClipId === 'transition-comp:transition-light-leak:incoming'
    );

    expect(layers).toHaveLength(1);
    expect(outgoingLayer?.source?.videoElement).toBe(outgoingVideo);
    expect(incomingLayer?.source?.videoElement).toBe(incomingVideo);
    expect(outgoingLayer?.source?.mediaTime).toBeCloseTo(1);
    expect(incomingLayer?.source?.mediaTime).toBeCloseTo(1);
  });

  it('uses the current WebCodecs VideoFrame for sequential export layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const videoElement = document.createElement('video');
    const currentFrame = {
      displayWidth: 1920,
      displayHeight: 1080,
    } as VideoFrame;

    const clip = {
      id: 'clip-1',
      name: 'Clip 1',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: {
        type: 'video',
        videoElement,
      },
      transform: {},
    } as unknown as TimelineClip;

    const clipStates = new Map<string, ExportClipState>([
      ['clip-1', {
        clipId: 'clip-1',
        webCodecsPlayer: {
          getCurrentFrame: () => currentFrame,
        } as unknown as TimelineClip,
        lastSampleIndex: 0,
        isSequential: true,
        preciseVideoElement: videoElement,
      }],
    ]);

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, clipStates, null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.videoFrame).toBe(currentFrame);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(clipStates.get('clip-1')?.webCodecsPlayer);
  });

  it('uses export lookup tolerance for parallel decoded frames', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const videoElement = document.createElement('video');
    const parallelFrame = {
      displayWidth: 1920,
      displayHeight: 1080,
    } as VideoFrame;

    const clip = {
      id: 'clip-1',
      name: 'Clip 1',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: {
        type: 'video',
        videoElement,
      },
      transform: {},
    } as unknown as TimelineClip;

    const clipStates = new Map<string, ExportClipState>([
      ['clip-1', {
        clipId: 'clip-1',
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
        preciseVideoElement: videoElement,
      }],
    ]);

    const parallelDecoder = {
      hasClip: vi.fn(() => true),
      getFrameForClip: vi.fn(() => parallelFrame),
      getFrameForClipSourceTime: vi.fn(() => parallelFrame),
    } as unknown as ParallelDecodeManager;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, clipStates, parallelDecoder, true);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.videoFrame).toBe(parallelFrame);
    expect(parallelDecoder.getFrameForClipSourceTime).toHaveBeenCalledWith(
      'clip-1',
      0.5,
      { toleranceMultiplier: 3 },
    );
  });

  it('uses prepared export image elements for data-only image clips', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;
    const imageElement = document.createElement('img');
    const clip = {
      id: 'clip-image',
      name: 'Still',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: {
        type: 'image',
        imageUrl: 'blob:data-only-image',
      },
      transform: {},
      effects: [],
    } as unknown as TimelineClip;
    const clipStates = new Map<string, ExportClipState>([[
      clip.id,
      {
        clipId: clip.id,
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
        exportImageElement: imageElement,
      },
    ]]);
    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, clipStates, null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source).toEqual({
      type: 'image',
      imageElement,
    });
    expect(clip.source?.imageElement).toBeUndefined();
  });

  it('forces gaussian splats onto the native scene path while keeping full-quality export settings', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const clip = {
      id: 'clip-splat',
      name: 'Splat Clip',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      source: {
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:splat',
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: false,
            maxSplats: 2048,
            splatScale: 1.5,
            nearPlane: 0.5,
            farPlane: 500,
            backgroundColor: 'transparent',
            sortFrequency: 8,
          },
          temporal: {
            enabled: false,
            playbackMode: 'loop',
            sequenceFps: 30,
            frameBlend: 0,
          },
          particle: {
            enabled: false,
            effectType: 'none',
            intensity: 0.5,
            speed: 1,
            seed: 42,
          },
        },
      },
      file: { name: 'hero.splat' },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getInterpolatedVectorAnimationSettings: () => ({
        loop: false,
        endBehavior: 'hold',
        playbackMode: 'forward',
        fit: 'contain',
      }),
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);
    const settings = layers[0]?.source?.gaussianSplatSettings;

    expect(layers).toHaveLength(1);
    expect(settings?.render.useNativeRenderer).toBe(true);
    expect(settings?.render.maxSplats).toBe(0);
    expect(settings?.render.sortFrequency).toBe(1);
    expect(settings?.render.splatScale).toBe(1.5);
  });

  it('converts gaussian splat export rotations to radians for the native shared scene', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const clip = {
      id: 'clip-splat-rotation',
      name: 'Splat Rotation',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      source: {
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:splat',
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: false,
          },
        },
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 90, y: 45, z: 180 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.rotation).toMatchObject({
      x: Math.PI / 2,
      y: Math.PI / 4,
      z: Math.PI,
    });
  });

  it('preserves mesh metadata for 3D text export layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const clip = {
      id: 'clip-text3d',
      name: '3D Text',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      source: {
        type: 'model',
      },
      meshType: 'text3d',
      text3DProperties: {
        text: 'Hello',
        fontFamily: 'helvetiker',
        fontWeight: 'bold',
        size: 1,
        depth: 0.2,
        color: '#ffffff',
        letterSpacing: 0.1,
        lineHeight: 1.1,
        textAlign: 'center',
        curveSegments: 8,
        bevelEnabled: false,
        bevelThickness: 0,
        bevelSize: 0,
        bevelSegments: 0,
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.meshType).toBe('text3d');
    expect(layers[0]?.source?.text3DProperties?.text).toBe('Hello');
  });

  it('resolves the correct model sequence frame for export time', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    useMediaStore.setState({
      files: [{
        id: 'media-model-seq-1',
        name: 'hero (3f)',
        type: 'model',
        createdAt: 1,
        modelSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'hero',
          frames: [
            { name: 'hero000000.glb', modelUrl: 'blob:hero-0' },
            { name: 'hero000001.glb', modelUrl: 'blob:hero-1' },
            { name: 'hero000002.glb', modelUrl: 'blob:hero-2' },
          ],
        },
      }],
      compositions: [],
    });

    const clip = {
      id: 'clip-model-seq-1',
      name: 'Hero Sequence',
      trackId: 'track-1',
      mediaFileId: 'media-model-seq-1',
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: {
        type: 'model',
        mediaFileId: 'media-model-seq-1',
        modelSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'hero',
          frames: [
            { name: 'hero000000.glb', modelUrl: 'blob:hero-0' },
            { name: 'hero000001.glb', modelUrl: 'blob:hero-1' },
            { name: 'hero000002.glb', modelUrl: 'blob:hero-2' },
          ],
        },
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('model');
    expect(layers[0]?.source?.modelUrl).toBe('blob:hero-1');
    expect(layers[0]?.source?.modelSequence?.frameCount).toBe(3);
  });

  it('falls back to media-library model sequence and URL for export layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;
    const modelFile = new File(['model'], 'fallback.glb', { type: 'model/gltf-binary' });

    const mediaState = {
      files: [{
        id: 'media-model-fallback',
        name: 'fallback.glb',
        type: 'model',
        createdAt: 1,
        file: modelFile,
        url: 'blob:media-model-fallback',
        modelSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'fallback',
          frames: [
            { name: 'fallback000000.glb', modelUrl: 'https://assets.local/fallback-0.glb' },
            { name: 'fallback000001.glb', modelUrl: 'https://assets.local/fallback-1.glb' },
            { name: 'fallback000002.glb', modelUrl: 'https://assets.local/fallback-2.glb' },
          ],
        },
      }],
      compositions: [],
    } satisfies Partial<ReturnType<typeof useMediaStore.getState>>;
    useMediaStore.setState(mediaState);

    const clip = {
      id: 'clip-model-fallback',
      name: 'Fallback Model',
      trackId: 'track-1',
      mediaFileId: 'media-model-fallback',
      file: modelFile,
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: {
        type: 'model',
        mediaFileId: 'media-model-fallback',
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = withMediaStoreState(mediaState, () => buildLayersAtTime(ctx, new Map(), null, false));

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('model');
    expect(layers[0]?.source?.modelUrl).toBe('https://assets.local/fallback-1.glb');
    expect(layers[0]?.source?.modelSequence?.frameCount).toBe(3);
  });

  it('falls back to media-library model URL for export layers without sequence data', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const mediaState = {
      files: [{
        id: 'media-model-url',
        name: 'url-model.glb',
        type: 'model',
        createdAt: 1,
        url: 'https://assets.local/url-model.glb',
      }],
      compositions: [],
    } satisfies Partial<ReturnType<typeof useMediaStore.getState>>;
    useMediaStore.setState(mediaState);

    const clip = {
      id: 'clip-model-url',
      name: 'URL Model',
      trackId: 'track-1',
      mediaFileId: 'media-model-url',
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: {
        type: 'model',
        mediaFileId: 'media-model-url',
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = withMediaStoreState(mediaState, () => buildLayersAtTime(ctx, new Map(), null, false));

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('model');
    expect(layers[0]?.source?.modelUrl).toBe('https://assets.local/url-model.glb');
    expect(layers[0]?.source?.modelSequence).toBeUndefined();
  });

  it('resolves the correct gaussian splat sequence frame for export and keeps native renderer selection', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;
    const frameFiles = [
      new File(['0'], 'scan000000.ply', { type: 'application/octet-stream' }),
      new File(['1'], 'scan000001.ply', { type: 'application/octet-stream' }),
      new File(['2'], 'scan000002.ply', { type: 'application/octet-stream' }),
    ];

    useMediaStore.setState({
      files: [{
        id: 'media-splat-seq-1',
        name: 'scan (3f)',
        type: 'gaussian-splat',
        createdAt: 1,
        gaussianSplatSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'scan',
          frames: [
            { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply', file: frameFiles[0], splatUrl: 'blob:scan-0' },
            { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply', file: frameFiles[1], splatUrl: 'blob:scan-1' },
            { name: 'scan000002.ply', projectPath: 'Raw/scan000002.ply', file: frameFiles[2], splatUrl: 'blob:scan-2' },
          ],
        },
      }],
      compositions: [],
    });

    const clip = {
      id: 'clip-splat-seq-1',
      name: 'Scan Sequence',
      trackId: 'track-1',
      mediaFileId: 'media-splat-seq-1',
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: {
        type: 'gaussian-splat',
        mediaFileId: 'media-splat-seq-1',
        gaussianSplatSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'scan',
          frames: [
            { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply', file: frameFiles[0], splatUrl: 'blob:scan-0' },
            { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply', file: frameFiles[1], splatUrl: 'blob:scan-1' },
            { name: 'scan000002.ply', projectPath: 'Raw/scan000002.ply', file: frameFiles[2], splatUrl: 'blob:scan-2' },
          ],
        },
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: true,
            maxSplats: 4096,
            splatScale: 1.25,
            nearPlane: 0.5,
            farPlane: 500,
            backgroundColor: 'transparent',
            sortFrequency: 6,
          },
          temporal: {
            enabled: false,
            playbackMode: 'loop',
            sequenceFps: 30,
            frameBlend: 0,
          },
          particle: {
            enabled: false,
            effectType: 'none',
            intensity: 0,
            speed: 1,
            seed: 1,
          },
        },
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('gaussian-splat');
    expect(layers[0]?.source?.gaussianSplatUrl).toBe('blob:scan-1');
    expect(layers[0]?.source?.gaussianSplatFileName).toBe('scan000001.ply');
    expect(layers[0]?.source?.gaussianSplatFileHash).toBeUndefined();
    expect(layers[0]?.source?.gaussianSplatRuntimeKey).toBe('Raw/scan000001.ply');
    expect(layers[0]?.source?.file).toBe(frameFiles[1]);
    expect(layers[0]?.source?.gaussianSplatSettings?.render.useNativeRenderer).toBe(true);
    expect(layers[0]?.source?.gaussianSplatSettings?.render.maxSplats).toBe(0);
    expect(layers[0]?.source?.gaussianSplatSettings?.render.sortFrequency).toBe(1);
  });

  it('builds nested 3D text and gaussian splat export layers for compositions', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    useMediaStore.setState({
      compositions: [
        {
          id: 'comp-1',
          width: 1280,
          height: 720,
        },
      ],
    });

    const compositionClip = {
      id: 'comp-clip',
      name: 'Nested Comp',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      isComposition: true,
      compositionId: 'comp-1',
      nestedTracks: [
        {
          id: 'nested-track-1',
          type: 'video',
          visible: true,
          solo: false,
        },
        {
          id: 'nested-track-2',
          type: 'video',
          visible: true,
          solo: false,
        },
      ],
      nestedClips: [
        {
          id: 'nested-text3d',
          name: 'Nested 3D Text',
          trackId: 'nested-track-1',
          startTime: 0,
          duration: 5,
          inPoint: 0,
          outPoint: 5,
          source: { type: 'model' },
          meshType: 'text3d',
          text3DProperties: {
            text: 'Nested Hello',
            fontFamily: 'helvetiker',
            fontWeight: 'bold',
            size: 1,
            depth: 0.2,
            color: '#ffffff',
            letterSpacing: 0,
            lineHeight: 1.1,
            textAlign: 'center',
            curveSegments: 8,
            bevelEnabled: false,
            bevelThickness: 0,
            bevelSize: 0,
            bevelSegments: 0,
          },
          transform: {},
          is3D: true,
          effects: [],
        },
        {
          id: 'nested-splat',
          name: 'Nested Splat',
          trackId: 'nested-track-2',
          startTime: 0,
          duration: 5,
          inPoint: 0,
          outPoint: 5,
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:nested-splat',
            gaussianSplatFileName: 'nested.splat',
            gaussianSplatFileHash: 'nested-hash',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: false,
                maxSplats: 1024,
                sortFrequency: 5,
              },
              temporal: {
                enabled: false,
                playbackMode: 'loop',
                sequenceFps: 30,
                frameBlend: 0,
              },
              particle: {
                enabled: false,
                effectType: 'none',
                intensity: 0,
                speed: 1,
                seed: 1,
              },
            },
          },
          transform: {},
          is3D: true,
          effects: [],
        },
      ],
      source: {
        type: 'image',
        imageElement: document.createElement('img'),
      },
      transform: {},
      effects: [],
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [compositionClip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, compositionClip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);
    const nestedLayers = layers[0]?.source?.nestedComposition?.layers ?? [];

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.nestedComposition?.sceneClips).toBe(compositionClip.nestedClips);
    expect(layers[0]?.source?.nestedComposition?.sceneTracks).toBe(compositionClip.nestedTracks);
    expect(nestedLayers).toHaveLength(2);
    expect(nestedLayers[0]?.source?.meshType).toBe('text3d');
    expect(nestedLayers[0]?.source?.text3DProperties?.text).toBe('Nested Hello');
    expect(nestedLayers[1]?.source?.gaussianSplatFileHash).toBe('nested-hash');
    expect(nestedLayers[1]?.source?.gaussianSplatSettings?.render.useNativeRenderer).toBe(true);
    expect(nestedLayers[1]?.source?.gaussianSplatSettings?.render.maxSplats).toBe(0);
    expect(nestedLayers[1]?.source?.gaussianSplatSettings?.render.sortFrequency).toBe(1);
  });

  it('keeps sequence gaussian splat export rotations in radians for the native shared scene', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const clip = {
      id: 'clip-native-sequence-rotation',
      name: 'Native Sequence Rotation',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      source: {
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:splat',
        gaussianSplatRuntimeKey: 'Raw/frame_0002.ply',
        gaussianSplatSequence: {
          frameCount: 2,
          fps: 24,
          frames: [],
        },
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: true,
          },
        },
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 90, y: 45, z: 180 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.rotation).toMatchObject({
      x: Math.PI / 2,
      y: Math.PI / 4,
      z: Math.PI,
    });
  });

  it('exports lottie clips via the shared text canvas path', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;
    const canvas = document.createElement('canvas');
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);

    const clip = {
      id: 'clip-lottie',
      name: 'Lottie Clip',
      trackId: 'track-1',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: {
        type: 'lottie',
        textCanvas: canvas,
        naturalDuration: 4,
      },
      transform: {},
      effects: [],
      file: new File(['lottie'], 'anim.lottie', { type: 'application/zip' }),
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(renderSpy).toHaveBeenCalledWith(
      clip,
      1,
      expect.objectContaining({ playbackMode: 'forward' }),
    );
    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('text');
    expect(layers[0]?.source?.textCanvas).toBe(canvas);

    renderSpy.mockRestore();
  });
});
