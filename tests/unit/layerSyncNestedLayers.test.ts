import { describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import type { ClipMask } from '../../src/types/masks';
import type { ClipTransform, TransitionSourceMapV2 } from '../../src/types/timelineCore';
import { buildLayerSyncNestedLayers } from '../../src/components/timeline/utils/layerSyncNestedLayers';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { getAllTransitions } from '../../src/transitions';
import { createMockClip, createMockTrack } from '../helpers/mockData';

describe('buildLayerSyncNestedLayers', () => {
  it('uses the shared effect evaluator, including easing', () => {
    const effects: Effect[] = [{
      id: 'brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 2 },
    }];
    const nestedClip = createMockClip({
      id: 'nested-clip',
      trackId: 'nested-track',
      duration: 10,
      outPoint: 10,
      effects,
      source: {
        type: 'video',
        videoElement: document.createElement('video'),
        naturalDuration: 10,
      },
    });
    const keyframes: Keyframe[] = [
      { id: 'start', clipId: nestedClip.id, property: 'effect.brightness.amount', time: 0, value: 0, easing: 'ease-in' },
      { id: 'end', clipId: nestedClip.id, property: 'effect.brightness.amount', time: 10, value: 10, easing: 'linear' },
    ];
    const layers = buildLayerSyncNestedLayers({
      clip: createMockClip({
        isComposition: true,
        nestedClips: [nestedClip],
        nestedTracks: [createMockTrack({ id: 'nested-track' })],
      }),
      clipKeyframes: new Map([[nestedClip.id, keyframes]]),
      clipTime: 5,
      getInterpolatedVectorAnimationSettings: () => ({}),
      imageLookupContext: {
        now: 0,
        mediaFileById: new Map(),
        mediaFileByName: new Map(),
      },
    });

    expect(layers[0].effects).toEqual(evaluateCompositionClipEffects(effects, keyframes, 5));
    expect(layers[0].effects[0].params.amount).toBeCloseTo(2.5);
  });

  it('uses parent-domain v2 animation for nested layers and masks', () => {
    const transform: ClipTransform = {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 10, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const effects: Effect[] = [{
      id: 'source-effect', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 1 },
    }];
    const masks: ClipMask[] = [{
      id: 'source-mask', name: 'Source mask', closed: true, opacity: 1, feather: 2, featherQuality: 50,
      inverted: false, mode: 'add', expanded: false, position: { x: 0, y: 0 }, enabled: true, visible: true,
      vertices: [{
        id: 'vertex', x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'mirrored',
      }],
    }];
    const parentKeyframes: Keyframe[] = [
      { id: 'x-start', clipId: 'source', property: 'position.x', time: 0, value: 10, easing: 'linear' },
      { id: 'x-end', clipId: 'source', property: 'position.x', time: 4, value: 30, easing: 'linear' },
      { id: 'effect-start', clipId: 'source', property: 'effect.source-effect.amount', time: 0, value: 1, easing: 'linear' },
      { id: 'effect-end', clipId: 'source', property: 'effect.source-effect.amount', time: 4, value: 9, easing: 'linear' },
      { id: 'mask-start', clipId: 'source', property: 'mask.source-mask.feather', time: 0, value: 2, easing: 'linear' },
      { id: 'mask-end', clipId: 'source', property: 'mask.source-mask.feather', time: 4, value: 10, easing: 'linear' },
    ];
    const transitionSourceMap: TransitionSourceMapV2 = {
      version: 2,
      mediaDuration: 10,
      parent: {
        duration: 4,
        inPoint: 0,
        outPoint: 4,
        defaultSpeed: 1,
        animation: { baseTransform: transform, keyframes: parentKeyframes, sourceEffectIds: ['source-effect'], sourceMaskIds: ['source-mask'] },
      },
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 2, parentStart: 0, parentEnd: 4 }],
    };
    const nestedClip = createMockClip({
      id: 'nested-v2', trackId: 'nested-track', duration: 2, outPoint: 2, transform, effects, masks,
      transitionSourceMap,
      source: { type: 'video', videoElement: document.createElement('video'), naturalDuration: 2 },
    });
    const layers = buildLayerSyncNestedLayers({
      clip: createMockClip({
        isComposition: true,
        nestedClips: [nestedClip],
        nestedTracks: [createMockTrack({ id: 'nested-track' })],
      }),
      clipKeyframes: new Map(),
      clipTime: 1,
      getInterpolatedVectorAnimationSettings: () => ({}),
      imageLookupContext: { now: 0, mediaFileById: new Map(), mediaFileByName: new Map() },
    });

    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      position: { x: 20 },
      effects: [{ id: 'source-effect', params: { amount: 5 } }],
      maskClipId: nestedClip.id,
      maskInvert: false,
      masks: [{ id: 'source-mask', feather: 6 }],
    });
  });

  it('omits a nested child with an invalid v2 source map', () => {
    const nestedClip = createMockClip({
      id: 'invalid-v2', trackId: 'nested-track', transitionSourceMap: { version: 2, segments: [] } as never,
      source: { type: 'video', videoElement: document.createElement('video'), naturalDuration: 5 },
    });

    expect(buildLayerSyncNestedLayers({
      clip: createMockClip({
        isComposition: true,
        nestedClips: [nestedClip],
        nestedTracks: [createMockTrack({ id: 'nested-track' })],
      }),
      clipKeyframes: new Map(),
      clipTime: 1,
      getInterpolatedVectorAnimationSettings: () => ({}),
      imageLookupContext: { now: 0, mediaFileById: new Map(), mediaFileByName: new Map() },
    })).toEqual([]);
  });

  it('keeps all scene-3d transition panels and their semantic render state while paused', () => {
    const scene3dTransitions = getAllTransitions().filter((transition) => transition.renderMode === 'scene-3d-panel');
    expect(scene3dTransitions).toHaveLength(6);

    for (const { id } of scene3dTransitions) {
      const nestedClip = createMockClip({
        id,
        trackId: 'nested-track',
        duration: 3,
        outPoint: 3,
        is3D: true,
        transitionRender: { kind: 'procedural-mask', procedural: 'blocks', progress: 0, seed: 7 },
        source: { type: 'video', videoElement: document.createElement('video'), naturalDuration: 3 },
      });
      const layers = buildLayerSyncNestedLayers({
        clip: createMockClip({
          isComposition: true,
          nestedClips: [nestedClip],
          nestedTracks: [createMockTrack({ id: 'nested-track' })],
        }),
        clipKeyframes: new Map([[nestedClip.id, [
          { id: `${id}-entry`, clipId: id, property: 'transitionRender.progress', time: 0, value: 0, easing: 'linear' },
          { id: `${id}-exit`, clipId: id, property: 'transitionRender.progress', time: 2, value: 1, easing: 'linear' },
        ] as Keyframe[]]]),
        clipTime: 1,
        getInterpolatedVectorAnimationSettings: () => ({}),
        imageLookupContext: { now: 0, mediaFileById: new Map(), mediaFileByName: new Map() },
      });

      expect(layers[0]).toMatchObject({ is3D: true, transitionRender: { progress: 0.5 } });
    }
  });
});
