import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nestedExportMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    registeredClipIds: Set<string>;
    initialize: ReturnType<typeof vi.fn>;
    prefetchFrameForClipSourceTime: ReturnType<typeof vi.fn>;
  }>,
  frame: { timestamp: 0 } as unknown as VideoFrame,
}));

vi.mock('../../src/engine/ParallelDecodeManager', () => {
  class ParallelDecodeManager {
    readonly registeredClipIds = new Set<string>();
    initialize = vi.fn(async (clips: Array<{ clipId: string }>) => {
      clips.forEach(({ clipId }) => this.registeredClipIds.add(clipId));
    });
    prefetchFramesForTime = vi.fn(async () => undefined);
    prefetchFrameForClipSourceTime = vi.fn(async () => undefined);
    advanceToTime = vi.fn();
    getFrameForClip = vi.fn((clipId: string) => (
      this.registeredClipIds.has(clipId) ? nestedExportMocks.frame : null
    ));
    getFrameForClipSourceTime = vi.fn((clipId: string) => (
      this.registeredClipIds.has(clipId) ? nestedExportMocks.frame : null
    ));
    prewarmClipStarts = vi.fn(async () => 0);
    hasClip = vi.fn((clipId: string) => this.registeredClipIds.has(clipId));
    cleanup = vi.fn();

    constructor() {
      nestedExportMocks.instances.push(this);
    }
  }

  return { ParallelDecodeManager };
});

import {
  buildLayersAtTime,
  cleanupLayerBuilder,
  initializeLayerBuilder,
} from '../../src/engine/export/ExportLayerBuilder';
import { cleanupExportMode, prepareClipsForExport } from '../../src/engine/export/ClipPreparation';
import { seekAllClipsToTime } from '../../src/engine/export/VideoSeeker';
import { getClipWarmupSourceTime } from '../../src/engine/export/clipPreparation/mediaElements';
import { getClipSourceWindowTime } from '../../src/engine/export/layerBuilder/timing';
import type { ExportClipState, ExportSettings, FrameContext } from '../../src/engine/export/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { MAX_NESTING_DEPTH } from '../../src/stores/timeline/constants';
import type { TimelineClip, TimelineTrack } from '../../src/stores/timeline/types';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import type { ClipMask } from '../../src/types/masks';
import type { ClipTransform, TransitionSourceMap, TransitionSourceMapV2 } from '../../src/types/timelineCore';
import { getAllTransitions } from '../../src/transitions';

const initialMediaState = useMediaStore.getState();
const initialTimelineState = useTimelineStore.getState();
const exportSettings: ExportSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  container: 'mp4',
  bitrate: 8_000_000,
  startTime: 0,
  endTime: 1,
};

const sourceMap: TransitionSourceMap = {
  version: 1,
  segments: [
    { kind: 'hold', compStart: 0, compEnd: 1, sourceTime: 4 },
    { kind: 'linear', compStart: 1, compEnd: 2, sourceStart: 4, sourceEnd: 7 },
    { kind: 'linear', compStart: 2, compEnd: 3, sourceStart: 7, sourceEnd: 4 },
  ],
};

function track(id = 'track'): TimelineTrack {
  return { id, type: 'video', visible: true, solo: false } as TimelineTrack;
}

function transform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    opacity: 1,
    blendMode: 'normal' as const,
  };
}

function readyVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'readyState', {
    configurable: true,
    value: HTMLMediaElement.HAVE_CURRENT_DATA,
  });
  return video;
}

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip',
    name: 'clip',
    trackId: 'track',
    startTime: 0,
    duration: 3,
    inPoint: 0,
    outPoint: 12,
    source: { type: 'video', videoElement: readyVideo() },
    transform: transform(),
    effects: [],
    ...overrides,
  } as TimelineClip;
}

function context(time: number, activeClip: TimelineClip, activeTrack = track()): FrameContext {
  return {
    time,
    fps: 30,
    frameTolerance: 50_000,
    clipsAtTime: [activeClip],
    renderClipsAtTime: [activeClip],
    trackMap: new Map([[activeTrack.id, activeTrack]]),
    clipsByTrack: new Map([[activeTrack.id, activeClip]]),
    mediaFiles: [],
    mediaCompositions: [],
    getInterpolatedTransform: () => transform(),
    getInterpolatedEffects: () => [],
    getInterpolatedColorCorrection: () => undefined,
    getInterpolatedVectorAnimationSettings: () => ({}),
    getInterpolatedTextBounds: () => undefined,
    getSourceTimeForClip: (_clipId, localTime) => localTime * 2,
    getInterpolatedSpeed: () => 1,
  };
}

function holdMap(sourceTime: number): TransitionSourceMap {
  return {
    version: 1,
    segments: [{ kind: 'hold', compStart: 0, compEnd: 1, sourceTime }],
  };
}

function createRecursiveVideoFixture(file?: File): {
  root: TimelineClip;
  rootTrack: TimelineTrack;
  leaf: TimelineClip;
} {
  const rootTrack = track('root-track');
  const nestedTrack = track('nested-track');
  const leafTrack = track('leaf-track');
  const leafVideo = readyVideo();
  leafVideo.src = 'blob:level-two-leaf';
  const leaf = clip({
    id: 'level-two-leaf',
    name: 'level-two-leaf',
    trackId: leafTrack.id,
    duration: 1,
    outPoint: 1,
    file,
    source: { type: 'video', videoElement: leafVideo },
    transitionSourceMap: holdMap(0.25),
  });
  const nested = clip({
    id: 'nested-wrapper',
    name: 'nested-wrapper',
    trackId: nestedTrack.id,
    duration: 1,
    outPoint: 1,
    source: null,
    isComposition: true,
    compositionId: 'nested-comp',
    nestedClips: [leaf],
    nestedTracks: [leafTrack],
    transitionSourceMap: holdMap(0),
  });
  const root = clip({
    id: 'root-wrapper',
    name: 'root-wrapper',
    trackId: rootTrack.id,
    duration: 1,
    outPoint: 1,
    source: null,
    isComposition: true,
    compositionId: 'root-comp',
    nestedClips: [nested],
    nestedTracks: [nestedTrack],
    transitionSourceMap: holdMap(0),
  });

  return { root, rootTrack, leaf };
}

function createCompositionChain(nestedDepth: number, prefix: string): {
  root: TimelineClip;
  rootTrack: TimelineTrack;
} {
  const rootTrack = track(`${prefix}-root-track`);
  const createWrapper = (depth: number, trackId: string): TimelineClip => {
    const nestedTrack = track(`${prefix}-nested-track-${depth}`);
    const nestedClip = depth === 0
      ? clip({
          id: `${prefix}-leaf`,
          trackId: nestedTrack.id,
          duration: 1,
          outPoint: 1,
        })
      : createWrapper(depth - 1, nestedTrack.id);
    return clip({
      id: `${prefix}-wrapper-${depth}`,
      trackId,
      duration: 1,
      outPoint: 1,
      source: null,
      isComposition: true,
      nestedClips: [nestedClip],
      nestedTracks: [nestedTrack],
    });
  };

  return { root: createWrapper(nestedDepth, rootTrack.id), rootTrack };
}

function containsVideoLayer(layers: ReturnType<typeof buildLayersAtTime>): boolean {
  return layers.some((layer) =>
    layer.source.type === 'video' ||
    (!!layer.source.nestedComposition && containsVideoLayer(layer.source.nestedComposition.layers)),
  );
}

describe('transition source map export parity', () => {
  beforeEach(() => {
    nestedExportMocks.instances.length = 0;
  });

  afterEach(() => {
    cleanupLayerBuilder();
    useMediaStore.setState(initialMediaState);
    useTimelineStore.setState(initialTimelineState);
    vi.restoreAllMocks();
  });

  it('uses map time before transition overrides and leaves invalid or absent maps on the exact legacy path', () => {
    const mapped = clip({ inPoint: 2, outPoint: 10, transitionSourceMap: sourceMap, transitionSourceTimeOverride: 9 });
    const legacy = clip({ inPoint: 2, outPoint: 10 });
    const invalid = clip({
      inPoint: 2,
      outPoint: 10,
      transitionSourceMap: { version: 1, segments: [] } as unknown as TransitionSourceMap,
    });
    const ctx = context(1.5, mapped);

    expect(getClipSourceWindowTime(mapped, 1.5, ctx)).toBe(5.5);
    expect(getClipSourceWindowTime(legacy, 1.5, ctx)).toBe(5);
    expect(getClipSourceWindowTime(invalid, 1.5, ctx)).toBe(5);
    expect(getClipWarmupSourceTime(mapped, 1.5)).toBe(5.5);
    expect(getClipWarmupSourceTime(legacy, 1.5)).toBe(8.5);
  });

  it('uses hold, positive, negative, and boundary map times for composition wrapper currentTime', () => {
    const child = clip({
      id: 'child',
      trackId: 'child-track',
      startTime: 4,
      duration: 4,
      inPoint: 0,
      outPoint: 12,
    });
    const wrapper = clip({
      id: 'wrapper',
      source: null,
      isComposition: true,
      compositionId: 'wrapper-comp',
      nestedClips: [child],
      nestedTracks: [track('child-track')],
      transitionSourceMap: sourceMap,
    });
    const wrapperTrack = track();
    initializeLayerBuilder([wrapperTrack]);

    const currentTimeAt = (time: number) => {
      const layer = buildLayersAtTime(context(time, wrapper, wrapperTrack), new Map(), null, false)[0];
      return layer?.source?.nestedComposition?.currentTime;
    };

    expect(currentTimeAt(0.5)).toBe(4);
    expect(currentTimeAt(1)).toBe(4);
    expect(currentTimeAt(1.5)).toBe(5.5);
    expect(currentTimeAt(2)).toBe(7);
    expect(currentTimeAt(2.5)).toBe(5.5);
    expect(currentTimeAt(3)).toBe(4);
  });

  it('maps recursive composition and child video time while invalid wrappers keep local plus inPoint', () => {
    const leaf = clip({
      id: 'leaf',
      trackId: 'leaf-track',
      startTime: 7,
      duration: 2,
      inPoint: 0,
      outPoint: 12,
      transitionSourceMap: { version: 1, segments: [{ kind: 'hold', compStart: 0, compEnd: 2, sourceTime: 9 }] },
    });
    const nested = clip({
      id: 'nested',
      trackId: 'nested-track',
      startTime: 5,
      duration: 2,
      inPoint: 0,
      outPoint: 12,
      source: null,
      isComposition: true,
      compositionId: 'nested-comp',
      nestedClips: [leaf],
      nestedTracks: [track('leaf-track')],
      transitionSourceMap: { version: 1, segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 7, sourceEnd: 9 }] },
    });
    const wrapper = clip({
      id: 'wrapper',
      source: null,
      isComposition: true,
      compositionId: 'wrapper-comp',
      nestedClips: [nested],
      nestedTracks: [track('nested-track')],
      transitionSourceMap: { version: 1, segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 5, sourceEnd: 7 }] },
    });
    const wrapperTrack = track();
    initializeLayerBuilder([wrapperTrack]);

    const layer = buildLayersAtTime(context(0.5, wrapper, wrapperTrack), new Map(), null, false)[0];
    const nestedLayer = layer?.source?.nestedComposition?.layers[0];
    const leafLayer = nestedLayer?.source?.nestedComposition?.layers[0];

    expect(layer?.source?.nestedComposition?.currentTime).toBe(5.5);
    expect(nestedLayer?.source?.nestedComposition?.currentTime).toBe(7.5);
    expect(leafLayer?.source?.mediaTime).toBe(9);

    const legacyWrapper = clip({
      id: 'legacy-wrapper',
      source: null,
      inPoint: 2,
      isComposition: true,
      nestedClips: [clip({ id: 'legacy-child', trackId: 'legacy-track', startTime: 2, duration: 2 })],
      nestedTracks: [track('legacy-track')],
      transitionSourceMap: { version: 1, segments: [] } as unknown as TransitionSourceMap,
    });
    const legacyLayer = buildLayersAtTime(context(0.5, legacyWrapper, wrapperTrack), new Map(), null, false)[0];
    expect(legacyLayer?.source?.nestedComposition?.currentTime).toBe(2.5);
  });

  it('uses v2 parent-domain transform, effects, and masks for nested export children', () => {
    const parentTransform: ClipTransform = {
      opacity: 0.5,
      blendMode: 'normal',
      position: { x: 10, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const sourceEffect: Effect = { id: 'source-effect', name: 'source-effect', type: 'brightness', enabled: true, params: { amount: 2 } };
    const generatedEffect: Effect = { id: 'generated-effect', name: 'generated-effect', type: 'brightness', enabled: true, params: { amount: 5 } };
    const mask = (id: string, feather: number): ClipMask => ({
      id,
      name: id,
      vertices: [],
      closed: true,
      opacity: 1,
      feather,
      featherQuality: 50,
      inverted: false,
      mode: 'add',
      expanded: false,
      position: { x: 0, y: 0 },
      enabled: true,
      visible: true,
    });
    const sourceMask = mask('source-mask', 2);
    const generatedMask = mask('generated-mask', 3);
    const parentKeyframes: Keyframe[] = [
      { id: 'parent-position-start', clipId: 'child', property: 'position.x', time: 0, value: 10, easing: 'linear' },
      { id: 'parent-position-end', clipId: 'child', property: 'position.x', time: 1, value: 30, easing: 'linear' },
      { id: 'parent-opacity-start', clipId: 'child', property: 'opacity', time: 0, value: 0.5, easing: 'linear' },
      { id: 'parent-opacity-end', clipId: 'child', property: 'opacity', time: 1, value: 0.75, easing: 'linear' },
      { id: 'parent-effect-start', clipId: 'child', property: 'effect.source-effect.amount', time: 0, value: 2, easing: 'linear' },
      { id: 'parent-effect-end', clipId: 'child', property: 'effect.source-effect.amount', time: 1, value: 10, easing: 'linear' },
      { id: 'parent-mask-start', clipId: 'child', property: 'mask.source-mask.feather', time: 0, value: 2, easing: 'linear' },
      { id: 'parent-mask-end', clipId: 'child', property: 'mask.source-mask.feather', time: 1, value: 6, easing: 'linear' },
    ];
    const generatedKeyframes: Keyframe[] = [
      { id: 'generated-position-start', clipId: 'child', property: 'position.x', time: 0, value: 10, easing: 'linear' },
      { id: 'generated-position-end', clipId: 'child', property: 'position.x', time: 1, value: 14, easing: 'linear' },
      { id: 'generated-opacity-start', clipId: 'child', property: 'opacity', time: 0, value: 0.5, easing: 'linear' },
      { id: 'generated-opacity-end', clipId: 'child', property: 'opacity', time: 1, value: 0.75, easing: 'linear' },
      { id: 'generated-effect-start', clipId: 'child', property: 'effect.generated-effect.amount', time: 0, value: 5, easing: 'linear' },
      { id: 'generated-effect-end', clipId: 'child', property: 'effect.generated-effect.amount', time: 1, value: 9, easing: 'linear' },
      { id: 'generated-mask-start', clipId: 'child', property: 'mask.generated-mask.feather', time: 0, value: 3, easing: 'linear' },
      { id: 'generated-mask-end', clipId: 'child', property: 'mask.generated-mask.feather', time: 1, value: 7, easing: 'linear' },
    ];
    const map: TransitionSourceMapV2 = {
      version: 2,
      mediaDuration: 10,
      parent: {
        duration: 1,
        inPoint: 0,
        outPoint: 10,
        defaultSpeed: 1,
        animation: {
          baseTransform: parentTransform,
          keyframes: parentKeyframes,
          sourceEffectIds: [sourceEffect.id],
          sourceMaskIds: [sourceMask.id],
        },
      },
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 1 }],
    };
    const child = clip({
      id: 'child',
      trackId: 'child-track',
      duration: 1,
      transform: parentTransform,
      effects: [sourceEffect, generatedEffect],
      masks: [sourceMask, generatedMask],
      transitionSourceMap: map,
    });
    const wrapperTrack = track();
    const wrapper = clip({
      id: 'wrapper',
      source: null,
      isComposition: true,
      nestedClips: [child],
      nestedTracks: [track(child.trackId)],
    });
    useTimelineStore.setState({ clipKeyframes: new Map([[child.id, generatedKeyframes]]) });
    initializeLayerBuilder([wrapperTrack]);

    const nestedLayer = buildLayersAtTime(context(0.5, wrapper, wrapperTrack), new Map(), null, false)[0]
      ?.source.nestedComposition?.layers[0];

    expect(nestedLayer?.position.x).toBe(22);
    expect(nestedLayer?.opacity).toBeCloseTo(0.78125);
    expect(nestedLayer?.effects.map(effect => effect.params.amount)).toEqual([6, 7]);
    expect(nestedLayer?.masks?.map(maskValue => maskValue.feather)).toEqual([4, 5]);
  });

  it('omits invalid v2 nested children instead of falling back to legacy animation', () => {
    const child = clip({
      id: 'invalid-v2-child',
      trackId: 'child-track',
      duration: 1,
      transform: { ...transform(), position: { x: 99, y: 0, z: 0 } },
      transitionSourceMap: { version: 2, segments: [] } as unknown as TransitionSourceMap,
    });
    const wrapperTrack = track();
    const wrapper = clip({
      id: 'invalid-v2-wrapper',
      source: null,
      isComposition: true,
      nestedClips: [child],
      nestedTracks: [track(child.trackId)],
    });
    initializeLayerBuilder([wrapperTrack]);

    expect(buildLayersAtTime(context(0.5, wrapper, wrapperTrack), new Map(), null, false)).toEqual([]);
  });

  it('maps or omits direct export clips for v2', () => {
    const parentTransform: ClipTransform = {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 10, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const sourceEffect: Effect = { id: 'export-effect', name: 'export-effect', type: 'brightness', enabled: true, params: { amount: 2 } };
    const sourceMask: ClipMask = {
      id: 'export-mask', name: 'export-mask', vertices: [], closed: true, opacity: 1,
      feather: 2, featherQuality: 50, inverted: false, mode: 'add', expanded: false,
      position: { x: 0, y: 0 }, enabled: true, visible: true,
    };
    const map: TransitionSourceMapV2 = {
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
            { id: 'parent-effect-start', clipId: 'source', property: 'effect.export-effect.amount', time: 0, value: 2, easing: 'linear' },
            { id: 'parent-effect-end', clipId: 'source', property: 'effect.export-effect.amount', time: 2, value: 6, easing: 'linear' },
            { id: 'parent-mask-start', clipId: 'source', property: 'mask.export-mask.feather', time: 0, value: 2, easing: 'linear' },
            { id: 'parent-mask-end', clipId: 'source', property: 'mask.export-mask.feather', time: 2, value: 6, easing: 'linear' },
          ],
          sourceEffectIds: [sourceEffect.id],
          sourceMaskIds: [sourceMask.id],
        },
      },
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 2 }],
    };
    const direct = clip({
      id: 'mapped-direct-export',
      source: { type: 'image', imageElement: document.createElement('img') },
      duration: 1,
      outPoint: 2,
      transform: parentTransform,
      effects: [sourceEffect],
      masks: [sourceMask],
      transitionSourceMap: map,
      transitionRecipeBlendWindows: [{ compStart: 0.25, compEnd: 0.75, blendMode: 'add' }],
    });
    const generatedKeyframes: Keyframe[] = [
      { id: 'generated-position-start', clipId: direct.id, property: 'position.x', time: 0, value: 10, easing: 'linear' },
      { id: 'generated-position-end', clipId: direct.id, property: 'position.x', time: 1, value: 14, easing: 'linear' },
    ];
    const directTrack = track();
    const directContext = (activeClip: TimelineClip) => ({
      ...context(0.5, activeClip, directTrack),
      getInterpolatedTransform: () => ({ ...parentTransform, position: { x: 99, y: 0, z: 0 } }),
      getInterpolatedEffects: () => [{ ...sourceEffect, params: { amount: 99 } }],
    });
    useTimelineStore.setState({ clipKeyframes: new Map([[direct.id, generatedKeyframes]]) });
    initializeLayerBuilder([directTrack]);

    expect(buildLayersAtTime(directContext(direct), new Map(), null, false)[0]).toMatchObject({
      position: { x: 22 },
      effects: [{ params: { amount: 4 } }],
      masks: [{ feather: 4 }],
      blendMode: 'add',
    });
    expect(buildLayersAtTime(
      directContext({ ...direct, transitionSourceMap: { version: 2, segments: [] } as TransitionSourceMap }),
      new Map(),
      null,
      false,
    )).toEqual([]);
  });

  it('keeps all scene-3d transition panels and semantic render progress in direct and nested export layers', () => {
    const scene3dTransitions = getAllTransitions().filter((transition) => transition.renderMode === 'scene-3d-panel');
    expect(scene3dTransitions).toHaveLength(6);

    for (const { id } of scene3dTransitions) {
      const generated = Object.assign(clip({
        id,
        startTime: 0,
        duration: 3,
        outPoint: 3,
        is3D: true,
        transitionRender: { kind: 'pattern-mask' as const, pattern: 'checker', progress: 0 },
        source: { type: 'image', imageElement: document.createElement('img') },
      }), {
        keyframes: [
          { id: `${id}-entry`, clipId: id, property: 'transitionRender.progress', time: 0, value: 0, easing: 'linear' },
          { id: `${id}-exit`, clipId: id, property: 'transitionRender.progress', time: 2, value: 1, easing: 'linear' },
        ] as Keyframe[],
      });
      const directTrack = track(`${id}-direct-track`);
      generated.trackId = directTrack.id;
      initializeLayerBuilder([directTrack]);
      const direct = buildLayersAtTime(context(1, generated, directTrack), new Map(), null, false)[0];

      const nestedTrack = track(`${id}-nested-track`);
      const nestedGenerated = { ...generated, trackId: nestedTrack.id };
      const wrapperTrack = track(`${id}-wrapper-track`);
      const wrapper = clip({
        id: `${id}-wrapper`,
        source: null,
        isComposition: true,
        duration: 3,
        outPoint: 3,
        nestedClips: [nestedGenerated],
        nestedTracks: [nestedTrack],
      });
      wrapper.trackId = wrapperTrack.id;
      initializeLayerBuilder([wrapperTrack]);
      const nested = buildLayersAtTime(context(1, wrapper, wrapperTrack), new Map(), null, false)[0]
        ?.source.nestedComposition?.layers[0];

      expect(direct).toMatchObject({ is3D: true, transitionRender: { progress: 0.5 } });
      expect(nested).toMatchObject({ is3D: true, transitionRender: { progress: 0.5 } });
    }
  });

  it('seeks repeated holds, falling map times, and recursively mapped nested video frames', async () => {
    const seekDuringExport = vi.fn(async () => undefined);
    const mappedClip = clip({ transitionSourceMap: sourceMap });
    const clipStates = new Map<string, ExportClipState>([[mappedClip.id, {
      clipId: mappedClip.id,
      webCodecsPlayer: { seekDuringExport } as NonNullable<ExportClipState['webCodecsPlayer']>,
      lastSampleIndex: 0,
      isSequential: true,
    }]]);

    for (const time of [0.2, 0.8, 2.1, 2.5]) {
      await seekAllClipsToTime(context(time, mappedClip), clipStates, null, false);
    }
    expect(seekDuringExport.mock.calls.map(([time]) => time)).toEqual([
      4,
      4,
      expect.closeTo(6.7, 10),
      5.5,
    ]);

    const nestedSeek = vi.fn(async () => undefined);
    const nestedLeaf = clip({
      id: 'nested-leaf',
      trackId: 'nested-leaf-track',
      startTime: 7,
      duration: 1,
      transitionSourceMap: { version: 1, segments: [{ kind: 'linear', compStart: 0, compEnd: 1, sourceStart: 9, sourceEnd: 10 }] },
    });
    const nestedWrapper = clip({
      id: 'nested-wrapper',
      source: null,
      isComposition: true,
      nestedClips: [nestedLeaf],
      nestedTracks: [track('nested-leaf-track')],
      startTime: 5,
      duration: 1,
      transitionSourceMap: { version: 1, segments: [{ kind: 'linear', compStart: 0, compEnd: 1, sourceStart: 7, sourceEnd: 8 }] },
    });
    const wrapper = clip({
      id: 'root-wrapper',
      source: null,
      isComposition: true,
      nestedClips: [nestedWrapper],
      nestedTracks: [track('nested-wrapper-track')],
      transitionSourceMap: { version: 1, segments: [{ kind: 'linear', compStart: 0, compEnd: 1, sourceStart: 5, sourceEnd: 6 }] },
    });
    nestedWrapper.trackId = 'nested-wrapper-track';
    const nestedStates = new Map<string, ExportClipState>([[nestedLeaf.id, {
      clipId: nestedLeaf.id,
      webCodecsPlayer: { seekDuringExport: nestedSeek } as NonNullable<ExportClipState['webCodecsPlayer']>,
      lastSampleIndex: 0,
      isSequential: true,
    }]]);

    await seekAllClipsToTime(context(0.5, wrapper), nestedStates, null, false);
    expect(nestedSeek).toHaveBeenCalledWith(9.5);
  });

  it('prefetches mapped parallel decoder frames after its legacy timeline cleanup', async () => {
    const mappedClip = clip({ transitionSourceMap: sourceMap });
    const parallelDecoder = {
      prefetchFramesForTime: vi.fn(async () => undefined),
      prefetchFrameForClipSourceTime: vi.fn(async () => undefined),
      advanceToTime: vi.fn(),
    };

    await seekAllClipsToTime(
      context(0.8, mappedClip),
      new Map(),
      parallelDecoder as never,
      true,
    );

    expect(parallelDecoder.prefetchFrameForClipSourceTime).toHaveBeenCalledWith(mappedClip.id, 4);
    expect(parallelDecoder.advanceToTime).toHaveBeenCalledBefore(
      parallelDecoder.prefetchFrameForClipSourceTime,
    );
  });

  it('prepares a level-two mapped video leaf for fast parallel export before seeking and building it', async () => {
    const file = new File(['video'], 'level-two.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(16)),
    });
    const { root, rootTrack, leaf } = createRecursiveVideoFixture(file);
    useTimelineStore.setState({ tracks: [rootTrack], clips: [root] });

    const result = await prepareClipsForExport(exportSettings, 'fast');
    const parallelDecoder = nestedExportMocks.instances[0];

    expect(result.useParallelDecode).toBe(true);
    expect(result.clipStates.has(leaf.id)).toBe(true);
    expect(parallelDecoder?.initialize).toHaveBeenCalledWith([
      expect.objectContaining({ clipId: leaf.id }),
    ], 30);
    expect(parallelDecoder?.registeredClipIds).toEqual(new Set([leaf.id]));

    const ctx = context(0.5, root, rootTrack);
    await seekAllClipsToTime(ctx, result.clipStates, result.parallelDecoder, result.useParallelDecode);
    initializeLayerBuilder([rootTrack]);

    expect(buildLayersAtTime(ctx, result.clipStates, result.parallelDecoder, result.useParallelDecode)).toHaveLength(1);
    expect(parallelDecoder?.prefetchFrameForClipSourceTime).toHaveBeenCalledWith(leaf.id, 0.25);

    cleanupExportMode(result.clipStates, result.parallelDecoder);
  });

  it('prepares, seeks, and builds a deep video leaf at its exact source time without usable maps', async () => {
    const file = new File(['video'], 'unmapped-level-two.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(16)),
    });
    const { root, rootTrack, leaf } = createRecursiveVideoFixture(file);
    const nested = root.nestedClips![0];
    root.inPoint = 2;
    root.outPoint = 3;
    root.transitionSourceMap = { version: 1, segments: [] } as unknown as TransitionSourceMap;
    nested.startTime = 2;
    nested.inPoint = 4;
    nested.outPoint = 5;
    nested.transitionSourceMap = undefined;
    leaf.startTime = 4;
    leaf.inPoint = 6;
    leaf.outPoint = 8;
    leaf.speed = 2;
    leaf.transitionSourceMap = undefined;
    useTimelineStore.setState({ tracks: [rootTrack], clips: [root] });

    const result = await prepareClipsForExport(exportSettings, 'fast');
    const parallelDecoder = nestedExportMocks.instances[0];
    const ctx = context(0.5, root, rootTrack);
    await seekAllClipsToTime(ctx, result.clipStates, result.parallelDecoder, result.useParallelDecode);
    initializeLayerBuilder([rootTrack]);

    const layer = buildLayersAtTime(ctx, result.clipStates, result.parallelDecoder, result.useParallelDecode)[0];
    const leafLayer = layer?.source.nestedComposition?.layers[0]?.source.nestedComposition?.layers[0];
    expect(parallelDecoder?.prefetchFrameForClipSourceTime).toHaveBeenCalledWith(leaf.id, 6.5);
    expect(parallelDecoder?.getFrameForClipSourceTime).toHaveBeenCalledWith(leaf.id, 6.5, expect.anything());
    expect(leafLayer?.source.videoFrame).toBe(nestedExportMocks.frame);

    cleanupExportMode(result.clipStates, result.parallelDecoder);
  });

  it('prepares, seeks, and builds the same level-two mapped leaf in precise mode', async () => {
    const { root, rootTrack, leaf } = createRecursiveVideoFixture();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'video') {
        Object.defineProperties(element, {
          readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
          duration: { configurable: true, value: 1 },
          seeking: { configurable: true, value: false },
          currentTime: { configurable: true, writable: true, value: 0 },
          load: { configurable: true, value: vi.fn() },
          pause: { configurable: true, value: vi.fn() },
        });
      }
      return element;
    }) as typeof document.createElement);
    useTimelineStore.setState({ tracks: [rootTrack], clips: [root] });

    const result = await prepareClipsForExport(exportSettings, 'precise');
    const preparedVideo = result.clipStates.get(leaf.id)?.preciseVideoElement;
    const ctx = context(0.5, root, rootTrack);

    expect(preparedVideo).not.toBe(leaf.source?.videoElement);
    expect([...result.clipStates.keys()]).toEqual([leaf.id]);
    expect(result.clipStates.get(leaf.id)?.hasDedicatedPreciseVideoElement).toBe(true);
    await seekAllClipsToTime(ctx, result.clipStates, null, false);
    initializeLayerBuilder([rootTrack]);
    expect(buildLayersAtTime(ctx, result.clipStates, null, false)).toHaveLength(1);

    cleanupExportMode(result.clipStates, result.parallelDecoder);
  });

  it('renders five nested composition levels and keeps the central depth limit', () => {
    const fiveLevels = createCompositionChain(5, 'five');
    initializeLayerBuilder([fiveLevels.rootTrack]);
    expect(containsVideoLayer(buildLayersAtTime(
      context(0.5, fiveLevels.root, fiveLevels.rootTrack),
      new Map(),
      null,
      false,
    ))).toBe(true);

    const atLimit = createCompositionChain(MAX_NESTING_DEPTH, 'at-limit');
    initializeLayerBuilder([atLimit.rootTrack]);
    expect(buildLayersAtTime(
      context(0.5, atLimit.root, atLimit.rootTrack),
      new Map(),
      null,
      false,
    )).toEqual([]);
  });

  it('does not prefetch a video leaf beyond MAX_NESTING_DEPTH', async () => {
    const atLimit = createCompositionChain(MAX_NESTING_DEPTH, 'seek-limit');
    const parallelDecoder = {
      prefetchFramesForTime: vi.fn(async () => undefined),
      prefetchFrameForClipSourceTime: vi.fn(async () => undefined),
      advanceToTime: vi.fn(),
    };

    await seekAllClipsToTime(
      context(0.5, atLimit.root, atLimit.rootTrack),
      new Map(),
      parallelDecoder as never,
      true,
    );

    expect(parallelDecoder.prefetchFrameForClipSourceTime).not.toHaveBeenCalled();
  });
});
