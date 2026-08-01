import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockClip } from '../helpers/mockData';
import { useTimelineStore } from '../../src/stores/timeline';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { TransformCache } from '../../src/services/layerBuilder/TransformCache';
import type { LayerBuilderProxyFrames } from '../../src/services/layerBuilder/layerBuilderProxyFrames';
import type { TransitionSourceMapV2 } from '../../src/types/timelineCore';

const hoisted = vi.hoisted(() => ({
  resolveLayerBuilderVideoSource: vi.fn((input: { targetTime: number }) => ({
    source: {
      type: 'video' as const,
      mediaTime: input.targetTime,
    },
    intrinsicSize: {
      width: 1920,
      height: 1080,
    },
  })),
}));

vi.mock('../../src/services/layerBuilder/layerBuilderVideoSources', () => ({
  resolveLayerBuilderVideoSource: hoisted.resolveLayerBuilderVideoSource,
}));

vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  canUseSharedPreviewRuntimeSession: vi.fn(() => false),
}));

import { buildLayerBuilderVideoLayer } from '../../src/services/layerBuilder/layerBuilderVideoLayers';

function createFrameContext(): FrameContext {
  const clip = createMockClip({
    id: 'clip-a',
    trackId: 'video-1',
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
  });
  return {
    clips: [clip],
    tracks: [],
    isPlaying: true,
    isDraggingPlayhead: false,
    hasClipDragPreview: false,
    playheadPosition: 1 + 1 / 60,
    playbackSpeed: 1,
    activeCompId: 'comp-30',
    proxyEnabled: false,
    getInterpolatedTransform: vi.fn(() => ({
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      blendMode: 'normal',
    })),
    getInterpolatedEffects: vi.fn(() => []),
    getInterpolatedNodeGraphParams: vi.fn(() => ({})),
    getInterpolatedColorCorrection: vi.fn(() => undefined),
    getInterpolatedVectorAnimationSettings: vi.fn(() => ({ enabled: false })),
    getInterpolatedTextBounds: vi.fn(() => undefined),
    getInterpolatedSpeed: vi.fn(() => 1),
    getSourceTimeForClip: vi.fn((_clipId: string, localTime: number) => localTime),
    hasKeyframes: vi.fn(() => false),
    getClipKeyframes: (clipId: string) => useTimelineStore.getState().clipKeyframes.get(clipId) ?? [],
    now: 0,
    frameNumber: 30,
    frameRate: 30,
    visualPlayheadPosition: 1,
    videoTracks: [],
    audioTracks: [],
    visibleVideoTrackIds: new Set(),
    unmutedAudioTrackIds: new Set(),
    anyVideoSolo: false,
    anyAudioSolo: false,
    clipsAtTime: [clip],
    clipsByTrackId: new Map([[clip.trackId, clip]]),
    mediaFiles: [],
    mediaFileById: new Map(),
    mediaFileByName: new Map(),
    compositionById: new Map(),
  } as unknown as FrameContext;
}

describe('buildLayerBuilderVideoLayer', () => {
  afterEach(() => {
    useTimelineStore.setState({ clipKeyframes: new Map() });
  });

  it('uses the comp-frame visual time as the video layer target time', () => {
    hoisted.resolveLayerBuilderVideoSource.mockClear();
    const ctx = createFrameContext();
    const clip = ctx.clips[0];
    const transformCache = {
      getTransform: vi.fn((_key, transform) => transform),
    } as unknown as TransformCache;
    const proxyFrames = {
      selectProxyFrame: vi.fn(),
    } as unknown as LayerBuilderProxyFrames;

    const layer = buildLayerBuilderVideoLayer({
      clip,
      layerIndex: 0,
      ctx,
      transformCache,
      proxyFrames,
    });

    expect(hoisted.resolveLayerBuilderVideoSource).toHaveBeenCalledWith(expect.objectContaining({
      clip,
      ctx,
      targetTime: 1,
    }));
    expect(ctx.getInterpolatedTransform).toHaveBeenCalledWith('clip-a', 1);
    expect(layer?.source?.mediaTime).toBe(1);
  });

  it('does not forward legacy transition render state to preview layers', () => {
    const ctx = createFrameContext();
    const clip = {
      ...ctx.clips[0],
      transitionRender: {
        kind: 'distortion' as const,
        distortion: 'swirl' as const,
        progress: 0,
      },
    };
    useTimelineStore.setState({
      clipKeyframes: new Map([[
        clip.id,
        [
          { id: 'kf-a', clipId: clip.id, property: 'transitionRender.progress', time: 0, value: 0, easing: 'linear' },
          { id: 'kf-b', clipId: clip.id, property: 'transitionRender.progress', time: 2, value: 1, easing: 'linear' },
        ],
      ]]),
    });

    const layer = buildLayerBuilderVideoLayer({
      clip,
      layerIndex: 0,
      ctx: { ...ctx, clips: [clip], clipsAtTime: [clip] },
      transformCache: { getTransform: vi.fn((_key, transform) => transform) } as unknown as TransformCache,
      proxyFrames: { selectProxyFrame: vi.fn() } as unknown as LayerBuilderProxyFrames,
    });

    expect(layer?.transitionRender).toBeUndefined();
  });

  it('composes mapped animation with the exact-frame parent transform', () => {
    const ctx = createFrameContext();
    const parent = createMockClip({
      id: 'mapped-video-parent',
      startTime: 0,
      duration: 10,
      source: { type: 'motion-null' },
    });
    const childTransform = {
      ...createMockClip().transform,
      position: { x: 5, y: 0, z: 0 },
    };
    const transitionSourceMap: TransitionSourceMapV2 = {
      version: 2,
      mediaDuration: 10,
      parent: {
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        defaultSpeed: 1,
        animation: {
          baseTransform: childTransform,
          keyframes: [],
          sourceEffectIds: [],
          sourceMaskIds: [],
        },
      },
      segments: [{
        kind: 'parent-linear',
        compStart: 0,
        compEnd: 10,
        parentStart: 0,
        parentEnd: 10,
      }],
    };
    const child = createMockClip({
      ...ctx.clips[0],
      id: 'mapped-video-child',
      parentClipId: parent.id,
      transform: childTransform,
      transitionSourceMap,
    });
    useTimelineStore.setState({
      clipKeyframes: new Map([[
        parent.id,
        [
          { id: 'parent-x-a', clipId: parent.id, property: 'position.x', time: 0, value: 0, easing: 'linear' },
          { id: 'parent-x-b', clipId: parent.id, property: 'position.x', time: 1, value: 100, easing: 'linear' },
        ],
      ]]),
    });
    const mappedContext = {
      ...ctx,
      clips: [parent, child],
      clipsAtTime: [parent, child],
      getInterpolatedTransform: vi.fn(() => ({
        ...childTransform,
        position: { x: 999, y: 0, z: 0 },
      })),
    };

    const layer = buildLayerBuilderVideoLayer({
      clip: child,
      layerIndex: 0,
      ctx: mappedContext,
      transformCache: { getTransform: vi.fn((_key, transform) => transform) } as unknown as TransformCache,
      proxyFrames: { selectProxyFrame: vi.fn() } as unknown as LayerBuilderProxyFrames,
    });

    expect(layer?.position.x).toBe(105);
    expect(mappedContext.getInterpolatedTransform).not.toHaveBeenCalled();
  });
});
