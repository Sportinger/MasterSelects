import { describe, expect, it } from 'vitest';

import { buildLayerSyncNestedLayers } from '../../src/components/timeline/utils/layerSyncNestedLayers';
import { buildBaseLayerProps, buildNestedBaseLayer } from '../../src/engine/export/layerBuilder/baseLayers';
import { buildEvaluatedClipLayer, evaluateNestedComposition } from '../../src/services/compositionRender/layerEvaluation';
import { buildNestedLayerBase } from '../../src/services/layerBuilder/layerBuilderNestedLayers';
import { hydrateTransitionCompositionTimeline } from '../../src/services/layerBuilder/layerBuilderTransitionComposition';
import { resolveTransitionRecipeBlendMode } from '../../src/services/timeline/transitionRecipeBlendWindows';
import type { Keyframe, SerializableClip, TimelineClip } from '../../src/types/timeline';
import type { TransitionRecipeBlendWindow } from '../../src/types/timelineCore';
import { createMockClip, createMockTrack, createMockTransform } from '../helpers/mockData';

function recipeClip(windows: TransitionRecipeBlendWindow[]): TimelineClip {
  return createMockClip({
    id: 'recipe-blend-clip',
    trackId: 'recipe-blend-track',
    startTime: 10,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    source: { type: 'video', videoElement: document.createElement('video') },
    transform: createMockTransform({ blendMode: 'screen' }),
    transitionRecipeBlendWindows: windows,
  });
}

function builtBlendModes(clip: TimelineClip, time: number) {
  const localTime = time - clip.startTime;
  const nestedTrack = createMockTrack({ id: clip.trackId });
  const wrapper = createMockClip({
    id: 'recipe-blend-wrapper',
    source: null,
    isComposition: true,
    nestedClips: [clip],
    nestedTracks: [nestedTrack],
  });
  const syncLayer = buildLayerSyncNestedLayers({
    clip: wrapper,
    clipKeyframes: new Map(),
    clipTime: time,
    getInterpolatedVectorAnimationSettings: () => ({}),
    imageLookupContext: { now: 0, mediaFileById: new Map(), mediaFileByName: new Map() },
  })[0];
  const compositionLayer = buildEvaluatedClipLayer({
    compositionId: 'recipe-comp',
    time,
    clipAtTime: clip,
    source: {
      clipId: clip.id,
      type: 'image',
      imageElement: document.createElement('img'),
      naturalDuration: 2,
    },
    isActiveComposition: false,
    getVectorAnimationSettings: () => undefined,
  });
  const exportContext = {
    time,
    getInterpolatedTransform: () => clip.transform,
    getInterpolatedEffects: () => [],
    getInterpolatedColorCorrection: () => undefined,
  } as Parameters<typeof buildBaseLayerProps>[3];

  return [
    buildNestedLayerBase(clip, localTime).baseLayer.blendMode,
    syncLayer?.blendMode,
    compositionLayer.blendMode,
    buildBaseLayerProps(clip, localTime, 0, exportContext).blendMode,
    buildNestedBaseLayer(clip, localTime).blendMode,
  ];
}

function builtTransitionRenderProgresses(clip: TimelineClip, time: number) {
  const localTime = time - clip.startTime;
  const keyframes = (clip as TimelineClip & { keyframes: Keyframe[] }).keyframes;
  const nestedTrack = createMockTrack({ id: clip.trackId });
  const wrapper = createMockClip({
    id: 'recipe-render-wrapper',
    source: null,
    isComposition: true,
    nestedClips: [clip],
    nestedTracks: [nestedTrack],
  });
  const syncLayer = buildLayerSyncNestedLayers({
    clip: wrapper,
    clipKeyframes: new Map([[clip.id, keyframes]]),
    clipTime: time,
    getInterpolatedVectorAnimationSettings: () => ({}),
    imageLookupContext: { now: 0, mediaFileById: new Map(), mediaFileByName: new Map() },
  })[0];
  const compositionLayer = buildEvaluatedClipLayer({
    compositionId: 'recipe-comp',
    time,
    clipAtTime: clip,
    source: { clipId: clip.id, type: 'image', imageElement: document.createElement('img'), naturalDuration: 2 },
    isActiveComposition: false,
    getVectorAnimationSettings: () => undefined,
  });
  const exportContext = {
    time,
    getInterpolatedTransform: () => clip.transform,
    getInterpolatedEffects: () => [],
    getInterpolatedColorCorrection: () => undefined,
  } as Parameters<typeof buildBaseLayerProps>[3];

  return [
    buildNestedLayerBase(clip, localTime)?.baseLayer.transitionRender?.progress,
    syncLayer?.transitionRender?.progress,
    compositionLayer?.transitionRender?.progress,
    buildBaseLayerProps(clip, localTime, 0, exportContext)?.transitionRender?.progress,
    buildNestedBaseLayer(clip, localTime)?.transitionRender?.progress,
  ];
}

describe('transition recipe blend windows', () => {
  it('uses valid half-open windows without mutation, with the last overlap winning', () => {
    const windows: TransitionRecipeBlendWindow[] = [
      { compStart: 0.25, compEnd: 1, blendMode: 'add' },
      { compStart: 0.5, compEnd: 1, blendMode: 'multiply' },
    ];
    const original = structuredClone(windows);

    expect(resolveTransitionRecipeBlendMode(windows, 0, 'screen')).toBe('screen');
    expect(resolveTransitionRecipeBlendMode(windows, 0.25, 'screen')).toBe('add');
    expect(resolveTransitionRecipeBlendMode(windows, 0.5, 'screen')).toBe('multiply');
    expect(resolveTransitionRecipeBlendMode(windows, 1, 'screen')).toBe('screen');
    expect(windows).toEqual(original);
  });

  it('ignores malformed windows and non-finite composition time', () => {
    const windows = [
      { compStart: Number.NaN, compEnd: 1, blendMode: 'add' },
      { compStart: 0, compEnd: 0, blendMode: 'multiply' },
      { compStart: 0, compEnd: 1, blendMode: 'not-a-mode' },
      { compStart: 0, compEnd: 1, blendMode: 'overlay' },
    ] as unknown as TransitionRecipeBlendWindow[];
    const original = structuredClone(windows);

    expect(resolveTransitionRecipeBlendMode(windows, 0.5, 'screen')).toBe('overlay');
    expect(resolveTransitionRecipeBlendMode(windows, Number.NaN, 'screen')).toBe('screen');
    expect(windows).toEqual(original);
  });

  it('keeps preview, layer-sync, composition rendering, and export in parity', () => {
    const windows = [
      { compStart: 10.25, compEnd: 10.75, blendMode: 'add' },
      { compStart: 10.5, compEnd: 11, blendMode: 'not-a-mode' },
      { compStart: 10.5, compEnd: 10.75, blendMode: 'multiply' },
    ] as unknown as TransitionRecipeBlendWindow[];
    const clip = recipeClip(windows);

    for (const [time, expected] of [
      [10, 'screen'],
      [10.25, 'add'],
      [10.5, 'multiply'],
      [10.75, 'screen'],
    ] as const) {
      expect(builtBlendModes(clip, time)).toEqual([expected, expected, expected, expected, expected]);
    }
  });

  it('keeps generated transition render progress in parity at entry, midpoint, and exit', () => {
    const clip = Object.assign(recipeClip([]), {
      duration: 3,
      transitionRender: { kind: 'clock-mask' as const, progress: 0, clockwise: true, angleOffset: 0 },
      keyframes: [
        { id: 'render-entry', clipId: 'recipe-blend-clip', property: 'transitionRender.progress', time: 0, value: 0, easing: 'linear' },
        { id: 'render-exit', clipId: 'recipe-blend-clip', property: 'transitionRender.progress', time: 2, value: 1, easing: 'linear' },
      ] as Keyframe[],
    });

    for (const [time, expected] of [[10, 0], [11, 0.5], [12, 1]] as const) {
      expect(builtTransitionRenderProgresses(clip, time)).toEqual([expected, expected, expected, expected, expected]);
    }
  });

  it('resolves the composition-render nested clip and wrapper against their parent times', () => {
    const nestedTrack = createMockTrack({ id: 'nested-track' });
    const child = createMockClip({
      id: 'nested-child',
      trackId: nestedTrack.id,
      startTime: 0,
      duration: 1,
      outPoint: 1,
      source: { type: 'image', imageElement: document.createElement('img') },
      transitionRecipeBlendWindows: [{ compStart: 0.25, compEnd: 0.75, blendMode: 'add' }],
    });
    const wrapper = createMockClip({
      id: 'nested-wrapper',
      startTime: 10,
      duration: 1,
      outPoint: 1,
      source: null,
      isComposition: true,
      nestedTracks: [nestedTrack],
      nestedClips: [child],
      transitionRecipeBlendWindows: [{ compStart: 10.25, compEnd: 10.75, blendMode: 'multiply' }],
    });
    const layer = evaluateNestedComposition({
      clip: wrapper,
      parentTime: 10.5,
      parentCompId: 'parent-comp',
      sources: { clipSources: new Map(), } as never,
      compositions: [],
      mediaFiles: [],
      proxyEnabled: false,
      getVectorAnimationSettings: () => undefined,
      getComposition: () => undefined,
      isCompositionReady: () => true,
      prepareComposition: () => {},
      evaluateCompositionAtTime: () => [],
    });

    expect(layer?.blendMode).toBe('multiply');
    expect(layer?.source.nestedComposition?.layers[0]?.blendMode).toBe('add');
  });

  it('clones blend windows while hydrating transition-composition clips', () => {
    const windows: TransitionRecipeBlendWindow[] = [{ compStart: 0.25, compEnd: 0.75, blendMode: 'add' }];
    const serializableClip = {
      id: 'serializable-recipe-clip',
      trackId: 'track',
      name: 'Recipe clip',
      mediaFileId: '',
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      sourceType: 'image',
      transform: createMockTransform(),
      effects: [],
      transitionRecipeBlendWindows: windows,
    } as SerializableClip;

    const [{ transitionRecipeBlendWindows }] = hydrateTransitionCompositionTimeline({
      composition: { id: 'recipe-transition-comp', timelineData: { clips: [serializableClip], tracks: [] } } as never,
      activeTransition: {} as never,
    }).clips;

    expect(transitionRecipeBlendWindows).toEqual(windows);
    expect(transitionRecipeBlendWindows).not.toBe(windows);
    expect(transitionRecipeBlendWindows?.[0]).not.toBe(windows[0]);
  });
});
