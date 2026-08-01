import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildLayersAtTime,
  cleanupLayerBuilder,
  initializeLayerBuilder,
} from '../../src/engine/export/ExportLayerBuilder';
import { buildBaseLayerProps, buildNestedBaseLayer } from '../../src/engine/export/layerBuilder/baseLayers';
import { buildTransitionCompositionLayerForExport } from '../../src/engine/export/layerBuilder/nestedLayers';
import type { FrameContext as ExportFrameContext } from '../../src/engine/export/types';
import { LayerBuilderService } from '../../src/services/layerBuilder/LayerBuilderService';
import { buildNestedLayerBase } from '../../src/services/layerBuilder/layerBuilderNestedLayers';
import { buildLayerBuilderNestedTransitionLayer } from '../../src/services/layerBuilder/layerBuilderNestedTransitionLayer';
import { LayerBuilderProxyFrames } from '../../src/services/layerBuilder/layerBuilderProxyFrames';
import { buildLayerBuilderTransitionCompositionLayer } from '../../src/services/layerBuilder/layerBuilderTransitionComposition';
import { evaluateParentedClipTransform } from '../../src/services/layerBuilder/parentTransformEvaluation';
import { compositionRenderer } from '../../src/services/compositionRenderer';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_COMPOSITION } from '../../src/stores/mediaStore/constants';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import { planTransition } from '../../src/stores/timeline/editOperations/transitionPlanner';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import type { TransitionSourceMapV2 } from '../../src/types/timelineCore';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function track(id: string): TimelineTrack {
  return {
    id,
    name: id,
    type: 'video',
    height: 70,
    muted: false,
    visible: true,
    solo: false,
  };
}

function clip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    trackId: 'track',
    name: 'Clip',
    file: new File([], 'clip.png'),
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: { type: 'image', imageElement: document.createElement('img') },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    isLoading: false,
    ...overrides,
  };
}

function xTransform(x: number) {
  return {
    ...structuredClone(DEFAULT_TRANSFORM),
    position: { x, y: 0, z: 0 },
  };
}

function xKeyframes(clipId: string, endTime = 4, endX = 100): Keyframe[] {
  return [
    { id: `${clipId}-x-0`, clipId, property: 'position.x', time: 0, value: 0, easing: 'linear' },
    { id: `${clipId}-x-1`, clipId, property: 'position.x', time: endTime, value: endX, easing: 'linear' },
  ];
}

function identityMappedSourceMap(baseTransform = xTransform(5)): TransitionSourceMapV2 {
  return {
    version: 2,
    mediaDuration: 10,
    parent: {
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      defaultSpeed: 1,
      animation: {
        baseTransform,
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
}

function exportContext(input: {
  time: number;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  clipsByTrack: Map<string, TimelineClip>;
  mediaCompositions?: ExportFrameContext['mediaCompositions'];
}): ExportFrameContext {
  const state = useTimelineStore.getState();
  return {
    time: input.time,
    fps: 30,
    frameTolerance: 50_000,
    outputWidth: 1920,
    outputHeight: 1080,
    clipsAtTime: input.clips,
    renderClipsAtTime: input.clips,
    compositionClips: input.clips,
    trackMap: new Map(input.tracks.map(value => [value.id, value])),
    clipsByTrack: input.clipsByTrack,
    mediaFiles: [],
    mediaCompositions: input.mediaCompositions ?? [],
    getInterpolatedTransform: state.getInterpolatedTransform,
    getInterpolatedEffects: state.getInterpolatedEffects,
    getInterpolatedColorCorrection: state.getInterpolatedColorCorrection,
    getInterpolatedVectorAnimationSettings: state.getInterpolatedVectorAnimationSettings,
    getInterpolatedTextBounds: state.getInterpolatedTextBounds,
    getSourceTimeForClip: state.getSourceTimeForClip,
    getInterpolatedSpeed: state.getInterpolatedSpeed,
  };
}

describe('MD6 parent transform builder parity', () => {
  beforeEach(() => {
    cleanupLayerBuilder();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState({
      ...initialMediaState,
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [],
      compositions: [],
      proxyEnabled: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupLayerBuilder();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  it('evaluates chains at one explicit surface frame and fails closed for missing or cyclic parents', () => {
    const grandparent = clip({ id: 'grandparent', source: { type: 'motion-null' }, transform: xTransform(20) });
    const parent = clip({
      id: 'parent',
      source: { type: 'motion-null' },
      parentClipId: grandparent.id,
      transform: xTransform(0),
    });
    const child = clip({ id: 'child', parentClipId: parent.id, transform: xTransform(5) });
    const keyframes = new Map([[parent.id, xKeyframes(parent.id)]]);

    const evaluated = evaluateParentedClipTransform({
      clip: child,
      clips: [grandparent, parent, child],
      clipLocalTime: 2,
      parentTimelineTime: 4,
      getKeyframes: candidate => keyframes.get(candidate.id),
    });
    expect(evaluated).toMatchObject({ ok: true, transform: { position: { x: 125 } } });

    expect(evaluateParentedClipTransform({
      clip: child,
      clips: [child],
      clipLocalTime: 2,
      parentTimelineTime: 4,
      getKeyframes: () => [],
    })).toMatchObject({ ok: false, reason: 'missing-parent', parentClipId: parent.id });

    const cyclicParent = { ...parent, parentClipId: child.id };
    expect(evaluateParentedClipTransform({
      clip: child,
      clips: [cyclicParent, child],
      clipLocalTime: 2,
      parentTimelineTime: 4,
      getKeyframes: () => [],
    })).toMatchObject({ ok: false, reason: 'cycle' });
  });

  it('propagates a transient Null drag preview through its children before commit', () => {
    const parent = clip({
      id: 'preview-parent-null',
      source: { type: 'motion-null' },
      transform: xTransform(0.2),
    });
    const child = clip({
      id: 'preview-child',
      parentClipId: parent.id,
      transform: xTransform(0.1),
    });
    useTimelineStore.setState({
      clips: [parent, child],
      tracks: [track('track')],
      clipKeyframes: new Map(),
      playheadPosition: 1,
      layerTransformPreview: {
        ownerId: 'motion-null-test',
        clipId: parent.id,
        transform: { position: { x: 0.5, y: 0, z: 0 } },
      },
    });

    const context = new LayerBuilderService().captureFrameContext(1);
    expect(context.getInterpolatedTransform(parent.id, 1).position.x).toBeCloseTo(0.5);
    expect(context.getInterpolatedTransform(child.id, 1).position.x).toBeCloseTo(0.6);
  });

  it('keeps mapped animation local and composes its animated parent in preview and export bases', () => {
    const parent = clip({
      id: 'mapped-parent',
      source: { type: 'motion-null' },
      startTime: 10,
      transform: xTransform(0),
    });
    const child = clip({
      id: 'mapped-child',
      startTime: 12,
      duration: 6,
      parentClipId: parent.id,
      transform: xTransform(5),
      transitionSourceMap: identityMappedSourceMap(),
    });
    useTimelineStore.setState({
      clips: [parent, child],
      clipKeyframes: new Map([[parent.id, xKeyframes(parent.id)]]),
      playheadPosition: 10,
    });

    const preview = buildNestedLayerBase(child, 2, {
      clips: [parent, child],
      timelineTime: 14,
    });
    const nestedExport = buildNestedBaseLayer(child, 2, {
      clips: [parent, child],
      timelineTime: 14,
    });
    const rootExport = buildBaseLayerProps(child, 2, 0, {
      ...exportContext({
        time: 14,
        clips: [parent, child],
        tracks: [track('mapped-parent-track'), track('mapped-child-track')],
        clipsByTrack: new Map(),
      }),
      getInterpolatedTransform: () => xTransform(999),
    });

    expect(preview?.baseLayer.position.x).toBe(105);
    expect(nestedExport?.position.x).toBe(105);
    expect(rootExport?.position.x).toBe(105);
  });

  it('matches exact-frame target preview, nested preview, root export, and nested export while UI time differs', () => {
    const parentTrack = track('root-parent-track');
    const childTrack = track('root-child-track');
    const parent = clip({
      id: 'root-parent',
      trackId: parentTrack.id,
      source: { type: 'motion-null' },
      startTime: 10,
      transform: xTransform(0),
    });
    const child = clip({
      id: 'root-child',
      trackId: childTrack.id,
      startTime: 12,
      duration: 6,
      parentClipId: parent.id,
      transform: xTransform(5),
    });
    const rootKeyframes = xKeyframes(parent.id);

    useTimelineStore.setState({
      tracks: [childTrack, parentTrack],
      clips: [parent, child],
      clipKeyframes: new Map([[parent.id, rootKeyframes]]),
      playheadPosition: 10,
      isPlaying: false,
      isDraggingPlayhead: false,
    });
    const targetService = new LayerBuilderService();
    const targetPreview = targetService.buildLayersFromStore(
      targetService.captureFrameContext(14),
    )[0];

    initializeLayerBuilder([childTrack, parentTrack]);
    const rootExport = buildLayersAtTime(exportContext({
      time: 14,
      clips: [parent, child],
      tracks: [childTrack, parentTrack],
      clipsByTrack: new Map([
        [childTrack.id, child],
        [parentTrack.id, parent],
      ]),
    }), new Map(), null, false)[0];

    cleanupLayerBuilder();
    const nestedParentTrack = track('nested-parent-track');
    const nestedChildTrack = track('nested-child-track');
    const wrapperTrack = track('wrapper-track');
    const nestedParent = clip({
      id: 'nested-parent',
      trackId: nestedParentTrack.id,
      source: { type: 'motion-null' },
      transform: xTransform(0),
    });
    const nestedChild = clip({
      id: 'nested-child',
      trackId: nestedChildTrack.id,
      startTime: 2,
      duration: 6,
      parentClipId: nestedParent.id,
      transform: xTransform(5),
    });
    const wrapper = clip({
      id: 'wrapper',
      trackId: wrapperTrack.id,
      source: null,
      startTime: 10,
      duration: 10,
      isComposition: true,
      compositionId: 'parent-parity-comp',
      nestedClips: [nestedParent, nestedChild],
      nestedTracks: [nestedChildTrack, nestedParentTrack],
    });
    const nestedKeyframes = xKeyframes(nestedParent.id);
    useTimelineStore.setState({
      tracks: [wrapperTrack],
      clips: [wrapper],
      clipKeyframes: new Map([[nestedParent.id, nestedKeyframes]]),
      playheadPosition: 10,
    });
    useMediaStore.setState({
      compositions: [{
        ...DEFAULT_COMPOSITION,
        id: 'parent-parity-comp',
        name: 'Parent parity',
      }],
    });

    const nestedService = new LayerBuilderService();
    const nestedPreview = nestedService.buildLayersFromStore(
      nestedService.captureFrameContext(14),
    )[0]?.source?.nestedComposition?.layers[0];

    initializeLayerBuilder([wrapperTrack]);
    const nestedExport = buildLayersAtTime(exportContext({
      time: 14,
      clips: [wrapper],
      tracks: [wrapperTrack],
      clipsByTrack: new Map([[wrapperTrack.id, wrapper]]),
      mediaCompositions: [{
        ...DEFAULT_COMPOSITION,
        id: 'parent-parity-comp',
        name: 'Parent parity',
      }],
    }), new Map(), null, false)[0]?.source?.nestedComposition?.layers[0];

    expect(useTimelineStore.getState().playheadPosition).toBe(10);
    for (const layer of [targetPreview, rootExport, nestedPreview, nestedExport]) {
      expect(layer?.position.x).toBe(105);
    }
  });

  it('preserves an external animated parent through preview and export transition hydration', () => {
    const transitionTrack = track('transition-track');
    const parentTrack = track('transition-parent-track');
    const parent = clip({
      id: 'transition-parent',
      trackId: parentTrack.id,
      source: { type: 'motion-null' },
      duration: 20,
      outPoint: 20,
      transform: xTransform(0),
    });
    const outgoing = clip({
      id: 'transition-outgoing',
      trackId: transitionTrack.id,
      startTime: 0,
      duration: 10,
      inPoint: 50,
      outPoint: 60,
      parentClipId: parent.id,
      transform: xTransform(5),
      source: {
        type: 'image',
        imageElement: document.createElement('img'),
        naturalDuration: 120,
      },
      transitionOut: {
        id: 'parented-transition',
        type: 'blur-dissolve',
        duration: 2,
        linkedClipId: 'transition-incoming',
      },
    });
    const incoming = clip({
      id: 'transition-incoming',
      trackId: transitionTrack.id,
      startTime: 10,
      duration: 8,
      inPoint: 20,
      outPoint: 28,
      source: {
        type: 'image',
        imageElement: document.createElement('img'),
        naturalDuration: 120,
      },
      transitionIn: {
        id: 'parented-transition',
        type: 'blur-dissolve',
        duration: 2,
        linkedClipId: outgoing.id,
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
    const activeTransition = { plan: plan!, outgoingClip: outgoing, incomingClip: incoming };

    useTimelineStore.setState({
      tracks: [transitionTrack, parentTrack],
      clips: [parent, outgoing, incoming],
      clipKeyframes: new Map([[parent.id, xKeyframes(parent.id, 10, 100)]]),
      playheadPosition: 0,
    });
    useMediaStore.setState({
      activeCompositionId: 'transition-parent-comp',
      compositions: [{
        ...DEFAULT_COMPOSITION,
        id: 'transition-parent-comp',
        name: 'Transition parent',
      }],
    });

    const service = new LayerBuilderService();
    const previewContext = service.captureFrameContext(9.5);
    const previewTransition = buildLayerBuilderTransitionCompositionLayer(
      activeTransition,
      0,
      previewContext,
      new LayerBuilderProxyFrames(),
    );
    const exportTransition = buildTransitionCompositionLayerForExport({
      activeTransition,
      layerIndex: 0,
      parentCompositionId: 'export',
      parentTime: 9.5,
      layerIdPrefix: 'export',
      clipStates: new Map(),
      parallelDecoder: null,
      useParallelDecode: false,
      mediaFiles: [],
      mediaCompositions: [],
      outputWidth: 1920,
      outputHeight: 1080,
      frameRate: 30,
      parentTransformClips: [parent, outgoing, incoming],
      parentTransformTimelineTime: 9.5,
    });

    const previewPositions = previewTransition?.source?.nestedComposition?.layers
      .map(layer => layer.position.x) ?? [];
    const exportPositions = exportTransition?.source?.nestedComposition?.layers
      .map(layer => layer.position.x) ?? [];
    expect(previewPositions).toContain(100);
    expect(exportPositions).toContain(100);
  });

  it('reapplies the external parent to a persisted transition inside nested preview', () => {
    const nestedTrack = track('persisted-transition-track');
    const parentTrack = track('persisted-transition-parent-track');
    const parent = clip({
      id: 'persisted-transition-parent',
      trackId: parentTrack.id,
      source: { type: 'motion-null' },
      transform: xTransform(0),
    });
    const outgoing = clip({
      id: 'persisted-outgoing',
      trackId: nestedTrack.id,
      mediaFileId: 'persisted-outgoing-media',
      duration: 4,
      outPoint: 4,
      parentClipId: parent.id,
      transform: xTransform(5),
      source: {
        type: 'image',
        mediaFileId: 'persisted-outgoing-media',
        imageElement: document.createElement('img'),
        naturalDuration: 10,
      },
      transitionOut: {
        id: 'persisted-transition',
        type: 'blur-dissolve',
        duration: 2,
        linkedClipId: 'persisted-incoming',
        compositionId: 'persisted-transition-comp',
      },
    });
    const incoming = clip({
      id: 'persisted-incoming',
      trackId: nestedTrack.id,
      mediaFileId: 'persisted-incoming-media',
      startTime: 4,
      duration: 4,
      outPoint: 4,
      source: {
        type: 'image',
        mediaFileId: 'persisted-incoming-media',
        imageElement: document.createElement('img'),
        naturalDuration: 10,
      },
      transitionIn: {
        id: 'persisted-transition',
        type: 'blur-dissolve',
        duration: 2,
        linkedClipId: outgoing.id,
      },
    });
    const transitionClipId = 'persisted-transition:outgoing';
    const persistedPlan = planTransition({
      outgoingClip: outgoing,
      incomingClip: incoming,
      transitionType: 'blur-dissolve',
      requestedDuration: 2,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 4,
      getMediaDuration: () => 10,
    });
    expect(persistedPlan).not.toBeNull();
    const nestedTransitionTime = persistedPlan!.bodyStart + 0.5;
    const wrapper = clip({
      id: 'persisted-wrapper',
      source: null,
      isComposition: true,
      compositionId: 'persisted-parent-comp',
      nestedClips: [parent, outgoing, incoming],
      nestedTracks: [nestedTrack, parentTrack],
    });
    const transitionComposition = {
      ...DEFAULT_COMPOSITION,
      id: 'persisted-transition-comp',
      name: 'Persisted transition',
      duration: 2,
      transitionComp: {
        kind: 'transition-comp' as const,
        parentCompositionId: 'persisted-parent-comp',
        parentTransitionId: 'persisted-transition',
        parentOutgoingClipId: outgoing.id,
        parentIncomingClipId: incoming.id,
        linkedOutgoingClipId: transitionClipId,
        linkedIncomingClipId: 'persisted-transition:incoming',
        innerTransitionId: '',
        paddingBefore: 0,
        paddingAfter: 0,
        bodyStart: 0,
        bodyEnd: 2,
        materialized: true,
      },
      timelineData: {
        tracks: [track('persisted-transition-render-track')],
        clips: [{
          id: transitionClipId,
          trackId: 'persisted-transition-render-track',
          name: 'Persisted outgoing',
          mediaFileId: '',
          startTime: 0,
          duration: 2,
          inPoint: 0,
          outPoint: 2,
          sourceType: 'image' as const,
          naturalDuration: 10,
          parentClipId: parent.id,
          transform: xTransform(5),
          effects: [],
          transitionSourceMap: identityMappedSourceMap(),
        }],
        playheadPosition: 0,
        duration: 2,
        durationLocked: true,
        zoom: 160,
        scrollX: 0,
        inPoint: 0,
        outPoint: 2,
        loopPlayback: true,
      },
    };
    useTimelineStore.setState({
      tracks: [track('wrapper-track')],
      clips: [wrapper],
      clipKeyframes: new Map([[parent.id, xKeyframes(parent.id)]]),
      playheadPosition: 0,
    });
    useMediaStore.setState({
      compositions: [transitionComposition],
      files: [
        { id: 'persisted-outgoing-media', duration: 10 },
        { id: 'persisted-incoming-media', duration: 10 },
      ] as never,
    });
    vi.spyOn(compositionRenderer, 'isReady').mockReturnValue(true);
    vi.spyOn(compositionRenderer, 'evaluateAtTime').mockReturnValue([{
      id: 'persisted-evaluated-layer',
      clipId: transitionClipId,
      sourceClipId: transitionClipId,
      name: 'Persisted outgoing',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'image', imageElement: document.createElement('img') },
      effects: [],
      position: { x: 5, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as never]);
    const service = new LayerBuilderService();
    const ctx = service.captureFrameContext(nestedTransitionTime);
    const nestedTransitionContext = {
      ...ctx,
      compositionById: new Map([[transitionComposition.id, transitionComposition]]),
    } as typeof ctx;

    const transitionLayer = buildLayerBuilderNestedTransitionLayer({
      parentClip: wrapper,
      nestedTrack,
      layerIndex: 0,
      clipTime: nestedTransitionTime,
      ctx: nestedTransitionContext,
    });

    expect(transitionLayer).not.toBeNull();
    expect(compositionRenderer.evaluateAtTime).toHaveBeenCalled();
    expect(transitionLayer?.source?.nestedComposition?.layers[0]?.position.x)
      .toBe(nestedTransitionTime / 4 * 100 + 5);
  });
});
