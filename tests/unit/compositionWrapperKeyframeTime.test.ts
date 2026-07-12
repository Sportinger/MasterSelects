import { describe, expect, it } from 'vitest';
import { buildLayersAtTime, cleanupLayerBuilder, initializeLayerBuilder } from '../../src/engine/export/ExportLayerBuilder';
import type { FrameContext as ExportFrameContext } from '../../src/engine/export/types';
import { evaluateNestedComposition } from '../../src/services/compositionRender/layerEvaluation';
import { buildLayerBuilderNestedCompLayer } from '../../src/services/layerBuilder/layerBuilderNestedLayerBuilder';
import { LayerBuilderProxyFrames } from '../../src/services/layerBuilder/layerBuilderProxyFrames';
import type { FrameContext as LayerBuilderFrameContext } from '../../src/services/layerBuilder/types';
import { TransformCache } from '../../src/services/layerBuilder/TransformCache';
import { useTimelineStore } from '../../src/stores/timeline';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const LOCAL_TIME = 2;
const IN_POINT = 5;
const PLAYHEAD = 12;

function createFixture() {
  const track = { id: 'wrapper-track', type: 'video', visible: true, solo: false } as TimelineTrack;
  const effect: Effect = {
    id: 'wrapper-brightness',
    name: 'Brightness',
    type: 'brightness',
    enabled: true,
    params: { amount: 0 },
  };
  const keyframes: Keyframe[] = [
    { id: 'wrapper-start', clipId: 'wrapper', property: 'effect.wrapper-brightness.amount', time: 0, value: 0, easing: 'linear' },
    { id: 'wrapper-end', clipId: 'wrapper', property: 'effect.wrapper-brightness.amount', time: 10, value: 100, easing: 'linear' },
  ];
  const nestedTrack = { id: 'nested-track', type: 'video', visible: true, solo: false } as TimelineTrack;
  const nestedClip = {
    id: 'nested-image',
    trackId: nestedTrack.id,
    name: 'Nested image',
    startTime: 6,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    effects: [],
    transform: DEFAULT_TRANSFORM,
    source: { type: 'image', imageElement: document.createElement('img') },
    isLoading: false,
  } as TimelineClip;
  const clip = {
    id: 'wrapper',
    trackId: track.id,
    name: 'Composition wrapper',
    startTime: PLAYHEAD - LOCAL_TIME,
    duration: 10,
    inPoint: IN_POINT,
    outPoint: 15,
    effects: [effect],
    transform: DEFAULT_TRANSFORM,
    source: null,
    isComposition: true,
    compositionId: 'nested-comp',
    nestedTracks: [nestedTrack],
    nestedClips: [nestedClip],
    isLoading: false,
  } as TimelineClip;

  return { clip, effect, keyframes, nestedClip, track };
}

function effectsAt(effect: Effect, time: number): Effect[] {
  return [{ ...effect, params: { ...effect.params, amount: time * 10 } }];
}

describe('composition wrapper keyframe time', () => {
  it('keeps nested sampling at inPoint while preview, layer builder, and export evaluate wrapper effects locally', () => {
    const { clip, effect, keyframes, nestedClip, track } = createFixture();
    const previousKeyframes = useTimelineStore.getState().clipKeyframes;
    useTimelineStore.setState({ clipKeyframes: new Map([[clip.id, keyframes]]) });

    try {
      const previewLayer = evaluateNestedComposition({
        clip,
        parentTime: PLAYHEAD,
        parentCompId: 'main',
        sources: {
          compositionId: 'nested-comp',
          clipSources: new Map(),
          pendingSourceDisposers: new Map(),
          isReady: true,
          disposed: false,
          lastAccessTime: 0,
        },
        compositions: [{ id: 'nested-comp', width: 320, height: 180 }],
        mediaFiles: [],
        proxyEnabled: false,
        getVectorAnimationSettings: () => undefined,
        getClipKeyframes: (clipId) => clipId === clip.id ? keyframes : undefined,
        getComposition: () => null,
        isCompositionReady: () => true,
        prepareComposition: () => {},
        evaluateCompositionAtTime: () => [],
      });

      expect(previewLayer?.effects[0]?.params.amount).toBe(LOCAL_TIME * 10);
      expect(previewLayer?.source?.nestedComposition?.layers[0]?.id).toBe(`main-nested-${nestedClip.id}`);

      const layerBuilderEffectTimes: number[] = [];
      const layerBuilderCtx = {
        clips: [clip],
        tracks: [track],
        isPlaying: false,
        isDraggingPlayhead: false,
        hasClipDragPreview: false,
        playheadPosition: PLAYHEAD,
        playbackSpeed: 1,
        activeCompId: 'main',
        proxyEnabled: false,
        getInterpolatedTransform: () => DEFAULT_TRANSFORM,
        getInterpolatedEffects: (_clipId: string, time: number) => {
          layerBuilderEffectTimes.push(time);
          return effectsAt(effect, time);
        },
        getInterpolatedColorCorrection: () => undefined,
        getInterpolatedNodeGraphParams: () => ({}),
        getInterpolatedVectorAnimationSettings: () => ({}),
        getInterpolatedTextBounds: () => undefined,
        getInterpolatedSpeed: () => 1,
        getSourceTimeForClip: (_clipId: string, time: number) => time,
        hasKeyframes: () => false,
        now: 0,
        frameNumber: 0,
        videoTracks: [track],
        audioTracks: [],
        visibleVideoTrackIds: new Set([track.id]),
        unmutedAudioTrackIds: new Set<string>(),
        anyVideoSolo: false,
        anyAudioSolo: false,
        clipsAtTime: [clip],
        clipsByTrackId: new Map([[track.id, clip]]),
        mediaFiles: [],
        mediaFileById: new Map(),
        mediaFileByName: new Map(),
        compositionById: new Map([['nested-comp', { id: 'nested-comp', width: 320, height: 180 }]]),
      } as unknown as LayerBuilderFrameContext;
      const layerBuilderLayer = buildLayerBuilderNestedCompLayer({
        clip,
        layerIndex: 0,
        ctx: layerBuilderCtx,
        transformCache: new TransformCache(),
        proxyFrames: new LayerBuilderProxyFrames(),
      });

      expect(layerBuilderEffectTimes).toEqual([LOCAL_TIME]);
      expect(layerBuilderLayer?.effects[0]?.params.amount).toBe(LOCAL_TIME * 10);
      expect(layerBuilderLayer?.source?.nestedComposition?.currentTime).toBe(LOCAL_TIME + IN_POINT);
      expect(layerBuilderLayer?.source?.nestedComposition?.layers[0]?.sourceClipId).toBe(nestedClip.id);

      const exportEffectTimes: number[] = [];
      const exportCtx = {
        time: PLAYHEAD,
        fps: 30,
        frameTolerance: 50_000,
        clipsAtTime: [clip],
        trackMap: new Map([[track.id, track]]),
        clipsByTrack: new Map([[track.id, clip]]),
        mediaFiles: [],
        mediaCompositions: [{ id: 'nested-comp', width: 320, height: 180 }],
        getInterpolatedTransform: () => DEFAULT_TRANSFORM,
        getInterpolatedEffects: (_clipId: string, time: number) => {
          exportEffectTimes.push(time);
          return effectsAt(effect, time);
        },
        getInterpolatedColorCorrection: () => undefined,
        getInterpolatedVectorAnimationSettings: () => ({}),
        getInterpolatedTextBounds: () => undefined,
        getSourceTimeForClip: (_clipId: string, time: number) => time,
        getInterpolatedSpeed: () => 1,
      } as ExportFrameContext;

      initializeLayerBuilder([track]);
      try {
        const exportLayer = buildLayersAtTime(exportCtx, new Map(), null, false)[0];

        expect(exportEffectTimes).toEqual([LOCAL_TIME]);
        expect(exportLayer?.effects[0]?.params.amount).toBe(LOCAL_TIME * 10);
        expect(exportLayer?.source?.nestedComposition?.currentTime).toBe(LOCAL_TIME + IN_POINT);
        expect(exportLayer?.source?.nestedComposition?.layers[0]?.sourceClipId).toBe(nestedClip.id);
      } finally {
        cleanupLayerBuilder();
      }
    } finally {
      useTimelineStore.setState({ clipKeyframes: previousKeyframes });
    }
  });
});
