import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildLayersAtTime,
  cleanupLayerBuilder,
  initializeLayerBuilder,
} from '../../src/engine/export/ExportLayerBuilder';
import type { FrameContext as ExportFrameContext } from '../../src/engine/export/types';
import { LayerBuilderService } from '../../src/services/layerBuilder/LayerBuilderService';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_COMPOSITION } from '../../src/stores/mediaStore/constants';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { Effect, Layer, TimelineClip, TimelineTrack } from '../../src/types';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function videoTrack(id: string): TimelineTrack {
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

function adjustmentClip(
  id: string,
  trackId: string,
  options: {
    effects?: Effect[];
    transform?: TimelineClip['transform'];
  } = {},
): TimelineClip {
  return {
    id,
    trackId,
    name: id,
    file: new File([], `${id}.msmotion`),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'motion-adjustment', naturalDuration: 5 },
    motion: createDefaultMotionLayerDefinition('adjustment'),
    transform: options.transform ?? structuredClone(DEFAULT_TRANSFORM),
    effects: options.effects ?? [],
    isLoading: false,
  };
}

function motionShapeClip(id: string, trackId: string): TimelineClip {
  return {
    id,
    trackId,
    name: id,
    file: new File([], `${id}.msmotion`),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'motion-shape', naturalDuration: 5 },
    motion: createDefaultMotionLayerDefinition('shape'),
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    isLoading: false,
  };
}

function motionNullClip(id: string, trackId: string): TimelineClip {
  return {
    ...adjustmentClip(id, trackId),
    source: { type: 'motion-null', naturalDuration: 5 },
    motion: createDefaultMotionLayerDefinition('null'),
  };
}

function compositionClip(
  trackId: string,
  compositionId: string,
  nestedTracks: TimelineTrack[],
  nestedClips: TimelineClip[],
): TimelineClip {
  return {
    id: `wrapper:${compositionId}`,
    trackId,
    name: compositionId,
    file: new File([], `${compositionId}.mscomp`),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: null,
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    isComposition: true,
    compositionId,
    nestedTracks,
    nestedClips,
    isLoading: false,
  };
}

function exportContext(
  track: TimelineTrack,
  clip: TimelineClip,
  outputWidth = 2048,
  outputHeight = 1152,
): ExportFrameContext {
  return {
    time: 1,
    fps: 30,
    frameTolerance: 50_000,
    outputWidth,
    outputHeight,
    clipsAtTime: [clip],
    renderClipsAtTime: [clip],
    trackMap: new Map([[track.id, track]]),
    clipsByTrack: new Map([[track.id, clip]]),
    mediaFiles: [],
    mediaCompositions: useMediaStore.getState().compositions,
    getInterpolatedTransform: () => structuredClone(clip.transform),
    getInterpolatedEffects: () => structuredClone(clip.effects),
    getInterpolatedColorCorrection: () => undefined,
    getInterpolatedVectorAnimationSettings: () => ({}),
    getInterpolatedTextBounds: () => undefined,
    getSourceTimeForClip: (_clipId, localTime) => localTime,
    getInterpolatedSpeed: () => 1,
  };
}

function nestedAdjustmentLayer(wrapperLayer: Layer | undefined): Layer | undefined {
  return wrapperLayer?.source?.nestedComposition?.layers[0];
}

describe('MD7 Motion Adjustment LayerBuilder integration', () => {
  beforeEach(() => {
    cleanupLayerBuilder();
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      activeCompositionId: 'composition:main-adjustment',
      activeLayerSlots: {},
      layerOpacities: {},
      files: [],
      compositions: [{
        ...DEFAULT_COMPOSITION,
        id: 'composition:main-adjustment',
        name: 'Main Adjustment',
        width: 1440,
        height: 900,
      }, {
        ...DEFAULT_COMPOSITION,
        id: 'composition:nested-adjustment',
        name: 'Nested Adjustment',
        width: 1280,
        height: 720,
      }],
      proxyEnabled: false,
    } as ReturnType<typeof useMediaStore.getState>);
  });

  afterEach(() => {
    cleanupLayerBuilder();
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
  });

  it('normalizes supported effects identically for main preview and export', () => {
    const track = videoTrack('track:adjustment');
    const clip = adjustmentClip('clip:adjustment', track.id, {
      effects: [{
        id: 'effect:brightness',
        name: 'Brightness',
        type: 'brightness',
        enabled: true,
        params: {},
      }, {
        id: 'effect:blur',
        name: 'Legacy Blur',
        type: 'blur',
        enabled: true,
        params: { amount: 12, samples: 7 },
      }],
      transform: {
        ...structuredClone(DEFAULT_TRANSFORM),
        opacity: 0.6,
        blendMode: 'overlay',
      },
    });
    useTimelineStore.setState({
      tracks: [track],
      clips: [clip],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      clipKeyframes: new Map(),
    });

    const preview = new LayerBuilderService().buildLayersFromStore()[0];
    initializeLayerBuilder([track]);
    const exported = buildLayersAtTime(
      exportContext(track, clip),
      new Map(),
      null,
      false,
    )[0];

    expect(preview).toMatchObject({
      sourceClipId: clip.id,
      opacity: 0.6,
      blendMode: 'overlay',
      source: {
        type: 'motion-adjustment',
        intrinsicWidth: 1440,
        intrinsicHeight: 900,
        motion: { version: 1, kind: 'adjustment' },
      },
      effects: [{
        id: 'effect:brightness',
        type: 'brightness',
        params: { amount: 0 },
      }, {
        id: 'effect:blur',
        type: 'gaussian-blur',
        params: { radius: 12, samples: 7 },
      }],
    });
    expect(exported).toMatchObject({
      sourceClipId: clip.id,
      source: {
        type: 'motion-adjustment',
        intrinsicWidth: 2048,
        intrinsicHeight: 1152,
      },
      effects: preview?.effects,
    });
  });

  it('builds the same admitted adjustment operation inside nested preview and export', () => {
    const rootTrack = videoTrack('track:root');
    const nestedTrack = videoTrack('track:nested-adjustment');
    const nestedClip = adjustmentClip('clip:nested-adjustment', nestedTrack.id, {
      effects: [{
        id: 'effect:contrast',
        name: 'Contrast',
        type: 'contrast',
        enabled: true,
        params: {},
      }],
    });
    const wrapper = compositionClip(
      rootTrack.id,
      'composition:nested-adjustment',
      [nestedTrack],
      [nestedClip],
    );
    useTimelineStore.setState({
      tracks: [rootTrack],
      clips: [wrapper],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      clipKeyframes: new Map(),
    });

    const nestedPreview = nestedAdjustmentLayer(
      new LayerBuilderService().buildLayersFromStore()[0],
    );
    initializeLayerBuilder([rootTrack]);
    const nestedExport = nestedAdjustmentLayer(buildLayersAtTime(
      exportContext(rootTrack, wrapper),
      new Map(),
      null,
      false,
    )[0]);

    for (const layer of [nestedPreview, nestedExport]) {
      expect(layer).toMatchObject({
        sourceClipId: nestedClip.id,
        source: {
          type: 'motion-adjustment',
          intrinsicWidth: 1280,
          intrinsicHeight: 720,
        },
        effects: [{
          id: 'effect:contrast',
          type: 'contrast',
          params: { amount: 1 },
        }],
      });
    }
    expect(nestedExport?.effects).toEqual(nestedPreview?.effects);
  });

  it('keeps adjustment ordering in the layer stack while Motion Null remains non-rendering', () => {
    const topTrack = videoTrack('track:top');
    const adjustmentTrack = videoTrack('track:middle-adjustment');
    const nullTrack = videoTrack('track:middle-null');
    const bottomTrack = videoTrack('track:bottom');
    const top = motionShapeClip('clip:top', topTrack.id);
    const adjustment = adjustmentClip('clip:middle-adjustment', adjustmentTrack.id);
    const motionNull = motionNullClip('clip:middle-null', nullTrack.id);
    const bottom = motionShapeClip('clip:bottom', bottomTrack.id);
    useTimelineStore.setState({
      tracks: [topTrack, adjustmentTrack, nullTrack, bottomTrack],
      clips: [top, adjustment, motionNull, bottom],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      clipKeyframes: new Map(),
    });

    const layers = new LayerBuilderService().buildLayersFromStore();

    expect(layers.map((layer) => layer.sourceClipId)).toEqual([
      top.id,
      adjustment.id,
      bottom.id,
    ]);
    expect(layers.map((layer) => layer.source?.type)).toEqual([
      'motion',
      'motion-adjustment',
      'motion',
    ]);

    initializeLayerBuilder([nullTrack]);
    expect(buildLayersAtTime(
      exportContext(nullTrack, motionNull),
      new Map(),
      null,
      false,
    )).toEqual([]);
  });

  it('fails closed for unsupported effects and non-identity adjustment transforms', () => {
    const track = videoTrack('track:rejected-adjustment');
    const unsupported = adjustmentClip('clip:unsupported-adjustment', track.id, {
      effects: [{
        id: 'effect:exposure',
        name: 'Exposure',
        type: 'exposure',
        enabled: true,
        params: { amount: 1 },
      }],
    });
    useTimelineStore.setState({
      tracks: [track],
      clips: [unsupported],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      clipKeyframes: new Map(),
    });
    expect(new LayerBuilderService().buildLayersFromStore()).toEqual([]);

    const disabledUnsupported = adjustmentClip('clip:disabled-unsupported-adjustment', track.id, {
      effects: [{
        id: 'effect:disabled-exposure',
        name: 'Disabled Exposure',
        type: 'exposure',
        enabled: false,
        params: { amount: 1 },
      }],
    });
    initializeLayerBuilder([track]);
    expect(() => buildLayersAtTime(
      exportContext(track, disabledUnsupported),
      new Map(),
      null,
      false,
    )).toThrowError('uses unsupported effect exposure');

    const transformed = adjustmentClip('clip:transformed-adjustment', track.id, {
      transform: {
        ...structuredClone(DEFAULT_TRANSFORM),
        position: { x: 0.25, y: 0, z: 0 },
      },
    });
    expect(() => buildLayersAtTime(
      exportContext(track, transformed),
      new Map(),
      null,
      false,
    )).toThrowError('Motion adjustment transforms must remain identity in v1');

    const unsupportedMix = adjustmentClip('clip:unsupported-mix-adjustment', track.id, {
      transform: {
        ...structuredClone(DEFAULT_TRANSFORM),
        blendMode: 'difference',
      },
    });
    expect(() => buildLayersAtTime(
      exportContext(track, unsupportedMix),
      new Map(),
      null,
      false,
    )).toThrowError('Motion adjustment mix is outside the supported v1 contract');
  });
});
