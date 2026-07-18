import { describe, expect, it, vi } from 'vitest';

import { buildEvaluatedClipLayer, evaluateNestedComposition } from '../../src/services/compositionRender/layerEvaluation';
import { getClipTimeInfo } from '../../src/services/layerBuilder/FrameContext';
import { buildLayerBuilderNestedCompLayer } from '../../src/services/layerBuilder/layerBuilderNestedLayerBuilder';
import { buildNestedLayerBase, getNestedClipSourceTime } from '../../src/services/layerBuilder/layerBuilderNestedLayers';
import { LayerBuilderProxyFrames } from '../../src/services/layerBuilder/layerBuilderProxyFrames';
import {
  createTransientTransitionComposition,
  hydrateTransitionCompositionTimeline,
} from '../../src/services/layerBuilder/layerBuilderTransitionComposition';
import { TransformCache } from '../../src/services/layerBuilder/TransformCache';
import { planTransition } from '../../src/stores/timeline/editOperations/transitionPlanner';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { TransitionSourceMap } from '../../src/types/timelineCore';
import type { SerializableClip, TimelineClip, TimelineTrack } from '../../src/types/timeline';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import type { ClipMask } from '../../src/types/masks';
import { getAllTransitions } from '../../src/transitions';

const sourceMap: TransitionSourceMap = {
  version: 1,
  segments: [
    { kind: 'hold', compStart: 0, compEnd: 1, sourceTime: 4 },
    { kind: 'linear', compStart: 1, compEnd: 3, sourceStart: 4, sourceEnd: 10 },
    { kind: 'hold', compStart: 3, compEnd: 4, sourceTime: 10 },
  ],
};

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'transition-clip',
    trackId: 'track-1',
    name: 'Transition Clip',
    startTime: 1,
    duration: 4,
    inPoint: 2,
    outPoint: 12,
    source: { type: 'video', naturalDuration: 20 },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    isLoading: false,
    ...overrides,
  } as TimelineClip;
}

function createContext(playheadPosition: number, visualPlayheadPosition = playheadPosition): FrameContext {
  return {
    playheadPosition,
    visualPlayheadPosition,
    getInterpolatedSpeed: () => 1,
    getSourceTimeForClip: (_clipId, localTime) => localTime * 2,
  } as FrameContext;
}

describe('transition source map preview runtime', () => {
  it('builds the mapped-v3 preview scene before a transition composition exists', () => {
    const outgoing = createClip({
      id: 'outgoing',
      startTime: 0,
      duration: 10,
      inPoint: 50,
      outPoint: 60,
      mediaFileId: 'outgoing-media',
      source: { type: 'video', mediaFileId: 'outgoing-media', naturalDuration: 120 },
      transitionOut: {
        id: 'transition-blur',
        type: 'blur-dissolve',
        duration: 2,
        linkedClipId: 'incoming',
      },
    });
    const incoming = createClip({
      id: 'incoming',
      startTime: 10,
      duration: 8,
      inPoint: 20,
      outPoint: 28,
      mediaFileId: 'incoming-media',
      source: { type: 'video', mediaFileId: 'incoming-media', naturalDuration: 120 },
      transitionIn: {
        id: 'transition-blur',
        type: 'blur-dissolve',
        duration: 2,
        linkedClipId: 'outgoing',
      },
    });
    const plan = planTransition({
      outgoingClip: outgoing,
      incomingClip: incoming,
      transitionType: 'blur-dissolve',
      requestedDuration: 2,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 10,
      getMediaDuration: () => 120,
    });

    expect(plan).not.toBeNull();
    const composition = createTransientTransitionComposition({
      activeTransition: { plan: plan!, outgoingClip: outgoing, incomingClip: incoming },
      parentCompositionId: 'parent',
      width: 1920,
      height: 1080,
      frameRate: 30,
      getMediaDuration: () => 120,
    });

    expect(composition?.id).toBe('transition-preview:parent:transition-blur');
    expect(composition?.timelineData?.clips.filter(clip =>
      clip.transitionSourceMap?.version === 2
    )).toHaveLength(2);
  });

  it('uses mapped linear and hold times for source and visual frame time', () => {
    const clip = createClip({ transitionSourceMap: sourceMap });
    const originalMap = structuredClone(sourceMap);

    expect(getClipTimeInfo(createContext(3, 3.5), clip)).toMatchObject({
      clipLocalTime: 2,
      sourceTime: 5,
      clipTime: 7,
      visualClipLocalTime: 2.5,
      visualSourceTime: 6.5,
      visualClipTime: 8.5,
      isHold: false,
      sourceRate: 3,
      speed: 3,
      absSpeed: 3,
    });
    expect(getClipTimeInfo(createContext(1.5, 2.5), clip)).toMatchObject({
      clipTime: 4,
      visualClipTime: 5.5,
      sourceTime: 2,
      visualSourceTime: 3.5,
      isHold: true,
      sourceRate: 0,
      speed: 0,
      absSpeed: 0,
    });
    expect(sourceMap).toEqual(originalMap);
  });

  it('falls back to legacy timing for invalid maps and ordinary clips', () => {
    const invalidMap = {
      version: 1,
      segments: [{ kind: 'hold', compStart: 0, compEnd: 0, sourceTime: 4 }],
    } as unknown as TransitionSourceMap;
    const context = createContext(3);

    expect(getClipTimeInfo(context, createClip({ transitionSourceMap: invalidMap }))).toMatchObject({
      clipTime: 6,
      sourceTime: 4,
      isHold: false,
      speed: 1,
    });
    expect(getClipTimeInfo(createContext(3), createClip())).toMatchObject({
      clipTime: 6,
      sourceTime: 4,
      isHold: false,
      speed: 1,
    });
  });

  it('uses a valid map directly for nested source time and leaves legacy clips unchanged', () => {
    const mappedClip = createClip({ transitionSourceMap: sourceMap });

    expect(getNestedClipSourceTime(mappedClip, 2)).toBe(7);
    expect(getNestedClipSourceTime(mappedClip, 0.5)).toBe(4);
    expect(getNestedClipSourceTime(createClip(), 2)).toBe(4);
  });

  it('keeps reverse source-map speed signed while leaving legacy reverse unchanged', () => {
    const reverseMap: TransitionSourceMap = {
      version: 1,
      segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 10, sourceEnd: 4 }],
    };

    expect(getClipTimeInfo(createContext(2), createClip({ startTime: 1, transitionSourceMap: reverseMap }))).toMatchObject({
      clipTime: 7,
      sourceRate: -3,
      speed: -3,
      absSpeed: 3,
      isHold: false,
    });
    expect(getClipTimeInfo(createContext(2), createClip({ reversed: true }))).toMatchObject({
      speed: 1,
      absSpeed: 1,
      isHold: false,
    });
  });

  it('uses mapped background media time and only plays through linear map segments', () => {
    const pause = vi.fn();
    const play = vi.fn(() => Promise.resolve());
    const video = {
      currentTime: 0,
      duration: 20,
      muted: true,
      paused: false,
      playbackRate: 1,
      play,
      pause,
      seeking: false,
    } as unknown as HTMLVideoElement;
    const clip = createClip({ transitionSourceMap: sourceMap, startTime: 0 });
    const source = {
      clipId: clip.id,
      type: 'video' as const,
      videoElement: video,
      naturalDuration: 20,
    };
    const baseParams = {
      compositionId: 'comp-1',
      clipAtTime: clip,
      source,
      isActiveComposition: false,
      getVectorAnimationSettings: () => undefined,
      playbackOptions: { isPlaying: true },
    };

    const holdLayer = buildEvaluatedClipLayer({ ...baseParams, time: 0.5 });
    expect(holdLayer.source?.mediaTime).toBe(4);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();

    video.paused = true;
    const linearLayer = buildEvaluatedClipLayer({ ...baseParams, time: 2 });
    expect(linearLayer.source?.mediaTime).toBe(7);
    expect(video.playbackRate).toBe(3);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not continuously play a negative-rate mapped background source', () => {
    const pause = vi.fn();
    const play = vi.fn(() => Promise.resolve());
    const video = {
      currentTime: 0,
      duration: 20,
      muted: true,
      paused: false,
      playbackRate: 1,
      play,
      pause,
      seeking: false,
    } as unknown as HTMLVideoElement;
    const clip = createClip({
      startTime: 0,
      transitionSourceMap: {
        version: 1,
        segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 10, sourceEnd: 4 }],
      },
    });

    const layer = buildEvaluatedClipLayer({
      compositionId: 'comp-1',
      clipAtTime: clip,
      source: { clipId: clip.id, type: 'video', videoElement: video, naturalDuration: 20 },
      isActiveComposition: false,
      getVectorAnimationSettings: () => undefined,
      playbackOptions: { isPlaying: true },
      time: 1,
    });

    expect(layer.source?.mediaTime).toBe(7);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
  });

  it('passes mapped composition time through recursive nested layers and their cache data', () => {
    const rootTrack = { id: 'root-track', type: 'video', visible: true } as TimelineTrack;
    const nestedTrack = { id: 'nested-track', type: 'video', visible: true } as TimelineTrack;
    const leafTrack = { id: 'leaf-track', type: 'video', visible: true } as TimelineTrack;
    const transform = createClip().transform;
    const leaf = createClip({
      id: 'leaf',
      trackId: leafTrack.id,
      startTime: 11,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      source: { type: 'image', imageElement: document.createElement('img') },
      transform,
    });
    const nested = createClip({
      id: 'nested',
      trackId: nestedTrack.id,
      startTime: 5,
      duration: 2,
      inPoint: 0,
      outPoint: 12,
      isComposition: true,
      compositionId: 'nested-comp',
      nestedTracks: [leafTrack],
      nestedClips: [leaf],
      transitionSourceMap: {
        version: 1,
        segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 10, sourceEnd: 12 }],
      },
      transform,
    });
    const root = createClip({
      id: 'root',
      trackId: rootTrack.id,
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 7,
      isComposition: true,
      compositionId: 'root-comp',
      nestedTracks: [nestedTrack],
      nestedClips: [nested],
      transitionSourceMap: {
        version: 1,
        segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 5, sourceEnd: 7 }],
      },
      transform,
    });
    const ctx = {
      ...createContext(1),
      clips: [root],
      tracks: [rootTrack],
      isPlaying: false,
      isDraggingPlayhead: false,
      hasClipDragPreview: false,
      playbackSpeed: 1,
      activeCompId: 'main',
      proxyEnabled: false,
      getInterpolatedTransform: () => transform,
      getInterpolatedEffects: () => [],
      getInterpolatedColorCorrection: () => undefined,
      getInterpolatedNodeGraphParams: () => ({}),
      getInterpolatedVectorAnimationSettings: () => ({}),
      getInterpolatedTextBounds: () => undefined,
      hasKeyframes: () => false,
      now: 0,
      frameNumber: 0,
      videoTracks: [rootTrack],
      audioTracks: [],
      visibleVideoTrackIds: new Set([rootTrack.id]),
      unmutedAudioTrackIds: new Set<string>(),
      anyVideoSolo: false,
      anyAudioSolo: false,
      clipsAtTime: [root],
      clipsByTrackId: new Map([[rootTrack.id, root]]),
      mediaFiles: [],
      mediaFileById: new Map(),
      mediaFileByName: new Map(),
      compositionById: new Map([
        ['root-comp', { id: 'root-comp', width: 320, height: 180 }],
        ['nested-comp', { id: 'nested-comp', width: 320, height: 180 }],
      ]),
    } as unknown as FrameContext;

    const layer = buildLayerBuilderNestedCompLayer({
      clip: root,
      layerIndex: 0,
      ctx,
      transformCache: new TransformCache(),
      proxyFrames: new LayerBuilderProxyFrames(),
    });
    const nestedLayer = layer?.source?.nestedComposition?.layers[0];

    expect(layer?.source?.mediaTime).toBe(6);
    expect(layer?.source?.nestedComposition?.currentTime).toBe(6);
    expect(nestedLayer?.source?.mediaTime).toBe(11);
    expect(nestedLayer?.source?.nestedComposition?.currentTime).toBe(11);
  });

  it('clones the serializable map into transition-composition runtime clips', () => {
    const serializableClip = {
      id: 'serializable-transition-clip',
      trackId: 'track-1',
      name: 'Serializable Transition Clip',
      mediaFileId: '',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      sourceType: 'video',
      naturalDuration: 20,
      transitionSourceMap: sourceMap,
      transform: createClip().transform,
      effects: [],
    } as SerializableClip;
    const composition = {
      id: 'transition-composition',
      width: 1920,
      height: 1080,
      timelineData: { clips: [serializableClip], tracks: [] },
    };

    const [{ transitionSourceMap }] = hydrateTransitionCompositionTimeline({
      composition: composition as never,
      activeTransition: {} as never,
    }).clips;

    expect(transitionSourceMap).toEqual(sourceMap);
    expect(transitionSourceMap).not.toBe(sourceMap);
    expect(transitionSourceMap?.segments).not.toBe(sourceMap.segments);
  });

  it('uses parent-domain v2 animation across runtime and composition layers, omitting invalid v2 layers', () => {
    const sourceEffect = { id: 'source-effect', name: 'Source', type: 'brightness', enabled: true, params: { amount: 2 } } as Effect;
    const sourceMask = {
      id: 'source-mask', name: 'Source mask', vertices: [], closed: true, opacity: 1,
      feather: 2, featherQuality: 50, inverted: false, mode: 'add', expanded: false,
      position: { x: 0, y: 0 }, enabled: true, visible: true,
    } as ClipMask;
    const parentTransform = {
      ...createClip().transform,
      position: { x: 10, y: 0, z: 0 },
    };
    const parentKeyframes = [
      { id: 'parent-position-start', clipId: 'source', property: 'position.x', time: 0, value: 10, easing: 'linear' },
      { id: 'parent-position-end', clipId: 'source', property: 'position.x', time: 2, value: 30, easing: 'linear' },
      { id: 'parent-effect-start', clipId: 'source', property: 'effect.source-effect.amount', time: 0, value: 2, easing: 'linear' },
      { id: 'parent-effect-end', clipId: 'source', property: 'effect.source-effect.amount', time: 2, value: 6, easing: 'linear' },
      { id: 'parent-mask-start', clipId: 'source', property: 'mask.source-mask.feather', time: 0, value: 2, easing: 'linear' },
      { id: 'parent-mask-end', clipId: 'source', property: 'mask.source-mask.feather', time: 2, value: 6, easing: 'linear' },
    ] as Keyframe[];
    const transitionSourceMap = {
      version: 2,
      mediaDuration: 20,
      parent: {
        duration: 2,
        inPoint: 0,
        outPoint: 2,
        defaultSpeed: 1,
        animation: {
          baseTransform: parentTransform,
          keyframes: parentKeyframes,
          sourceEffectIds: [sourceEffect.id],
          sourceMaskIds: [sourceMask.id],
        },
      },
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 2, parentStart: 0, parentEnd: 2 }],
    } as TransitionSourceMap;
    const clip = createClip({
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'image', imageElement: document.createElement('img') },
      transform: parentTransform,
      effects: [sourceEffect],
      masks: [sourceMask],
      transitionSourceMap,
    });

    const directLayer = buildEvaluatedClipLayer({
      compositionId: 'comp', time: 1, clipAtTime: clip,
      source: { clipId: clip.id, type: 'image', imageElement: document.createElement('img'), naturalDuration: 20 },
      isActiveComposition: false, getVectorAnimationSettings: () => undefined,
    });
    const runtimeLayer = buildNestedLayerBase(clip, 1)?.baseLayer;
    expect(directLayer).toMatchObject({ position: { x: 20 }, effects: [{ params: { amount: 4 } }], masks: [{ feather: 4 }] });
    expect(runtimeLayer).toMatchObject({ position: { x: 20 }, effects: [{ params: { amount: 4 } }], masks: [{ feather: 4 }] });

    const nestedTrack = { id: 'nested-track', type: 'video', visible: true } as TimelineTrack;
    const wrapper = createClip({
      id: 'wrapper', startTime: 0, duration: 2, inPoint: 0, outPoint: 2,
      isComposition: true, compositionId: 'nested-comp', nestedTracks: [nestedTrack], nestedClips: [{ ...clip, id: 'nested', trackId: nestedTrack.id }],
      transform: parentTransform, effects: [sourceEffect], masks: [sourceMask], transitionSourceMap,
    });
    const compositionLayer = evaluateNestedComposition({
      clip: wrapper, parentTime: 1, parentCompId: 'parent',
      sources: { compositionId: 'nested-comp', clipSources: new Map(), pendingSourceDisposers: new Map(), isReady: true, disposed: false, lastAccessTime: 0 },
      compositions: [{ id: 'nested-comp', width: 320, height: 180 }], mediaFiles: [], proxyEnabled: false,
      getVectorAnimationSettings: () => undefined, getComposition: () => null, isCompositionReady: () => true,
      prepareComposition: () => {}, evaluateCompositionAtTime: () => [],
    });
    expect(compositionLayer).toMatchObject({ position: { x: 20 }, effects: [{ params: { amount: 4 } }], masks: [{ feather: 4 }] });
    expect(compositionLayer?.source?.nestedComposition?.layers[0]).toMatchObject({ position: { x: 20 }, effects: [{ params: { amount: 4 } }], masks: [{ feather: 4 }] });

    const invalidV2 = createClip({ transitionSourceMap: { version: 2, segments: [] } as unknown as TransitionSourceMap });
    expect(buildEvaluatedClipLayer({
      compositionId: 'comp', time: 1, clipAtTime: invalidV2,
      source: { clipId: invalidV2.id, type: 'image', imageElement: document.createElement('img'), naturalDuration: 20 },
      isActiveComposition: false, getVectorAnimationSettings: () => undefined,
    })).toBeNull();
    expect(buildNestedLayerBase(invalidV2, 1)).toBeNull();
  });

  it('maps or omits top-level runtime composition wrappers for v2', () => {
    const parentTransform = {
      ...createClip().transform,
      position: { x: 10, y: 0, z: 0 },
    };
    const sourceEffect = { id: 'wrapper-effect', name: 'Wrapper', type: 'brightness', enabled: true, params: { amount: 2 } } as Effect;
    const sourceMask = {
      id: 'wrapper-mask', name: 'Wrapper mask', vertices: [], closed: true, opacity: 1,
      feather: 2, featherQuality: 50, inverted: false, mode: 'add', expanded: false,
      position: { x: 0, y: 0 }, enabled: true, visible: true,
    } as ClipMask;
    const map: TransitionSourceMap = {
      version: 2,
      mediaDuration: 2,
      parent: {
        duration: 2,
        inPoint: 0,
        outPoint: 2,
        defaultSpeed: 1,
        animation: {
          baseTransform: parentTransform,
          keyframes: [
            { id: 'parent-position-start', clipId: 'source', property: 'position.x', time: 0, value: 10, easing: 'linear' },
            { id: 'parent-position-end', clipId: 'source', property: 'position.x', time: 2, value: 30, easing: 'linear' },
            { id: 'parent-effect-start', clipId: 'source', property: 'effect.wrapper-effect.amount', time: 0, value: 2, easing: 'linear' },
            { id: 'parent-effect-end', clipId: 'source', property: 'effect.wrapper-effect.amount', time: 2, value: 6, easing: 'linear' },
            { id: 'parent-mask-start', clipId: 'source', property: 'mask.wrapper-mask.feather', time: 0, value: 2, easing: 'linear' },
            { id: 'parent-mask-end', clipId: 'source', property: 'mask.wrapper-mask.feather', time: 2, value: 6, easing: 'linear' },
          ],
          sourceEffectIds: [sourceEffect.id],
          sourceMaskIds: [sourceMask.id],
        },
      },
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 2 }],
    };
    const childTrack = { id: 'wrapper-child-track', type: 'video', visible: true } as TimelineTrack;
    const child = createClip({
      id: 'wrapper-child',
      trackId: childTrack.id,
      startTime: 1.5,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      source: { type: 'image', imageElement: document.createElement('img') },
    });
    const wrapper = createClip({
      id: 'mapped-wrapper',
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 2,
      source: null,
      isComposition: true,
      compositionId: 'wrapper-comp',
      nestedTracks: [childTrack],
      nestedClips: [child],
      transform: parentTransform,
      effects: [sourceEffect],
      masks: [sourceMask],
      transitionSourceMap: map,
      transitionRecipeBlendWindows: [{ compStart: 0.25, compEnd: 0.75, blendMode: 'add' }],
    });
    const generatedKeyframes: Keyframe[] = [
      { id: 'generated-position-start', clipId: wrapper.id, property: 'position.x', time: 0, value: 10, easing: 'linear' },
      { id: 'generated-position-end', clipId: wrapper.id, property: 'position.x', time: 1, value: 14, easing: 'linear' },
    ];
    const ctx = {
      playheadPosition: 0.75,
      visualPlayheadPosition: 0.5,
      activeCompId: 'main',
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: (_clipId: string, localTime: number) => localTime,
      getClipKeyframes: (clipId: string) => clipId === wrapper.id ? generatedKeyframes : [],
      getInterpolatedTransform: () => ({ ...parentTransform, position: { x: 99, y: 0, z: 0 } }),
      getInterpolatedEffects: () => [{ ...sourceEffect, params: { amount: 99 } }],
      getInterpolatedColorCorrection: () => undefined,
      mediaFileById: new Map(),
      mediaFileByName: new Map(),
      compositionById: new Map([['wrapper-comp', { id: 'wrapper-comp', width: 320, height: 180 }]]),
    } as FrameContext;

    const build = (clip: TimelineClip) => buildLayerBuilderNestedCompLayer({
      clip,
      layerIndex: 0,
      ctx,
      transformCache: new TransformCache(),
      proxyFrames: new LayerBuilderProxyFrames(),
    });

    expect(build(wrapper)).toMatchObject({
      position: { x: 22 },
      effects: [{ params: { amount: 4 } }],
      masks: [{ feather: 4 }],
      blendMode: 'add',
    });
    expect(build({ ...wrapper, transitionSourceMap: { version: 2, segments: [] } as TransitionSourceMap })).toBeNull();
  });

  it('uses composition-local render progress and keeps all scene-3d panels through runtime composition layers', () => {
    const scene3dTransitions = getAllTransitions().filter((transition) => transition.renderMode === 'scene-3d-panel');
    expect(scene3dTransitions).toHaveLength(6);
    const keyframes = [
      { id: 'render-entry', clipId: 'generated', property: 'transitionRender.progress', time: 0, value: 0, easing: 'linear' },
      { id: 'render-exit', clipId: 'generated', property: 'transitionRender.progress', time: 2, value: 1, easing: 'linear' },
    ] as Keyframe[];
    const transitionSourceMap = {
      version: 2,
      mediaDuration: 20,
      parent: {
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        defaultSpeed: 1,
        animation: { baseTransform: createClip().transform, keyframes: [], sourceEffectIds: [], sourceMaskIds: [] },
      },
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 2, parentStart: 5, parentEnd: 7 }],
    } as TransitionSourceMap;

    for (const { id } of scene3dTransitions) {
      const child = Object.assign(createClip({
        id,
        trackId: 'child-track',
        startTime: 0,
        inPoint: 0,
        duration: 3,
        outPoint: 3,
        source: { type: 'image', imageElement: document.createElement('img') },
        is3D: true,
        transitionRender: { kind: 'clock-mask' as const, progress: 0, clockwise: true, angleOffset: 0 },
        transitionSourceMap,
      }), { keyframes });
      const childTrack = { id: child.trackId, type: 'video', visible: true } as TimelineTrack;
      const wrapper = Object.assign(createClip({
        id: `${id}-wrapper`,
        startTime: 0,
        inPoint: 0,
        duration: 3,
        outPoint: 3,
        source: null,
        isComposition: true,
        is3D: true,
        nestedTracks: [childTrack],
        nestedClips: [child],
        transitionRender: { kind: 'clock-mask' as const, progress: 0, clockwise: true, angleOffset: 0 },
      }), { keyframes });

      for (const [time, progress] of [[0, 0], [1, 0.5], [2, 1]] as const) {
        const direct = buildEvaluatedClipLayer({
          compositionId: 'comp', time, clipAtTime: child,
          source: { clipId: child.id, type: 'image', imageElement: document.createElement('img'), naturalDuration: 20 },
          isActiveComposition: false, getVectorAnimationSettings: () => undefined,
        });
        const runtime = buildNestedLayerBase(child, time)?.baseLayer;
        const composition = evaluateNestedComposition({
          clip: wrapper, parentTime: time, parentCompId: 'parent',
          sources: { compositionId: 'nested', clipSources: new Map(), pendingSourceDisposers: new Map(), isReady: true, disposed: false, lastAccessTime: 0 },
          compositions: [], mediaFiles: [], proxyEnabled: false,
          getVectorAnimationSettings: () => undefined, getComposition: () => null, isCompositionReady: () => true,
          prepareComposition: () => {}, evaluateCompositionAtTime: () => [],
        });

        expect(direct).toMatchObject({ is3D: true, transitionRender: { progress } });
        expect(runtime).toMatchObject({ is3D: true, transitionRender: { progress } });
        expect(composition).toMatchObject({ is3D: true, transitionRender: { progress } });
        expect(composition?.source.nestedComposition?.layers[0]).toMatchObject({
          is3D: true,
          transitionRender: { progress },
        });
      }
    }
  });
});
