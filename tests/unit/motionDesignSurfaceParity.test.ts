import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
import type {
  MotionLayerDefinition,
} from '../../src/types/motionDesign';
import type { Keyframe } from '../../src/types/keyframes';
import type { Layer } from '../../src/types/layers';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import {
  createDefaultMotionLayerDefinition,
  createLinearGradientAppearance,
  createStrokeAppearance,
} from '../../src/types/motionDesign';

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

function motionClip(trackId: string): {
  clip: TimelineClip;
  keyframes: Keyframe[];
} {
  const motion = createDefaultMotionLayerDefinition('shape', {
    primitive: 'star',
    size: { w: 100, h: 80 },
  });
  motion.shape!.star = {
    points: 7,
    outerRadius: 48,
    innerRadius: 22,
    cornerRadius: 3,
  };
  const gradient = createLinearGradientAppearance();
  const stroke = {
    ...createStrokeAppearance(),
    visible: true,
    width: 6,
    alignment: 'outside' as const,
    blendMode: 'screen' as const,
  };
  motion.appearance!.items.push(gradient, stroke);
  const fillId = motion.appearance?.items.find((item) => item.kind === 'color-fill')?.id;
  if (!fillId) throw new Error('Motion fixture requires a primary fill');
  const clip: TimelineClip = {
    id: 'surface-motion',
    trackId,
    name: 'Surface Motion',
    file: new File([], 'surface-motion.msmotion'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'motion-shape', naturalDuration: 5 },
    motion,
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    isLoading: false,
  };
  return {
    clip,
    keyframes: [
      {
        id: 'surface-width-start',
        clipId: clip.id,
        property: 'shape.size.w',
        time: 0,
        value: 100,
        easing: 'linear',
      },
      {
        id: 'surface-width-end',
        clipId: clip.id,
        property: 'shape.size.w',
        time: 2,
        value: 300,
        easing: 'linear',
      },
      {
        id: 'surface-fill-start',
        clipId: clip.id,
        property: `appearance.${fillId}.opacity`,
        time: 0,
        value: 0.2,
        easing: 'linear',
      },
      {
        id: 'surface-fill-end',
        clipId: clip.id,
        property: `appearance.${fillId}.opacity`,
        time: 2,
        value: 0.8,
        easing: 'linear',
      },
    ],
  };
}

function compositionClip(
  trackId: string,
  nestedTrack: TimelineTrack,
  nestedClip: TimelineClip,
): TimelineClip {
  return {
    id: 'surface-parent',
    trackId,
    name: 'Surface Parent',
    file: new File([], 'surface-parent.mscomp'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    isComposition: true,
    compositionId: 'surface-nested-comp',
    nestedTracks: [nestedTrack],
    nestedClips: [nestedClip],
    isLoading: false,
  };
}

function exportContext(
  track: TimelineTrack,
  clip: TimelineClip,
): ExportFrameContext {
  return {
    time: 1,
    fps: 30,
    frameTolerance: 50_000,
    outputWidth: 1920,
    outputHeight: 1080,
    clipsAtTime: [clip],
    renderClipsAtTime: [clip],
    trackMap: new Map([[track.id, track]]),
    clipsByTrack: new Map([[track.id, clip]]),
    mediaFiles: [],
    mediaCompositions: [{
      ...DEFAULT_COMPOSITION,
      id: 'surface-nested-comp',
      name: 'Surface Nested',
    }],
    getInterpolatedTransform: () => structuredClone(DEFAULT_TRANSFORM),
    getInterpolatedEffects: () => [],
    getInterpolatedColorCorrection: () => undefined,
    getInterpolatedVectorAnimationSettings: () => ({}),
    getInterpolatedTextBounds: () => undefined,
    getSourceTimeForClip: (_clipId, localTime) => localTime,
    getInterpolatedSpeed: () => 1,
  };
}

function motionFromLayer(layer: Layer | undefined): MotionLayerDefinition {
  const motion = layer?.source?.motion;
  expect(layer?.source?.type).toBe('motion');
  expect(motion).toBeDefined();
  return motion!;
}

function nestedMotionFromLayer(layer: Layer | undefined): MotionLayerDefinition {
  const nestedLayers = layer?.source?.nestedComposition?.layers;
  expect(layer?.source?.nestedComposition).toBeDefined();
  expect(nestedLayers).toHaveLength(1);
  return motionFromLayer(nestedLayers?.[0]);
}

describe('Motion Design evaluated surface parity', () => {
  beforeEach(() => {
    cleanupLayerBuilder();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState({
      ...initialMediaState,
      activeCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      files: [],
      compositions: [{
        ...DEFAULT_COMPOSITION,
        id: 'surface-nested-comp',
        name: 'Surface Nested',
      }],
      proxyEnabled: false,
    });
  });

  afterEach(() => {
    cleanupLayerBuilder();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  it('feeds the same interpolated MotionFrame state to preview, nested preview, and export', () => {
    const directTrack = videoTrack('surface-direct-track');
    const nestedTrack = videoTrack('surface-nested-track');
    const parentTrack = videoTrack('surface-parent-track');
    const fixture = motionClip(directTrack.id);
    useTimelineStore.setState({
      tracks: [directTrack],
      clips: [fixture.clip],
      playheadPosition: 1,
      isPlaying: false,
      isDraggingPlayhead: false,
      clipKeyframes: new Map([[fixture.clip.id, fixture.keyframes]]),
    });

    const directPreview = motionFromLayer(
      new LayerBuilderService().buildLayersFromStore()[0],
    );

    const nestedMotionClip = {
      ...fixture.clip,
      trackId: nestedTrack.id,
    };
    const parentClip = compositionClip(parentTrack.id, nestedTrack, nestedMotionClip);
    useTimelineStore.setState({
      tracks: [parentTrack],
      clips: [parentClip],
      playheadPosition: 1,
      clipKeyframes: new Map([[nestedMotionClip.id, fixture.keyframes]]),
    });
    const nestedPreview = nestedMotionFromLayer(
      new LayerBuilderService().buildLayersFromStore()[0],
    );

    initializeLayerBuilder([directTrack]);
    const directExport = motionFromLayer(
      buildLayersAtTime(
        exportContext(directTrack, fixture.clip),
        new Map(),
        null,
        false,
      )[0],
    );

    cleanupLayerBuilder();
    initializeLayerBuilder([parentTrack]);
    const nestedExport = nestedMotionFromLayer(
      buildLayersAtTime(
        exportContext(parentTrack, parentClip),
        new Map(),
        null,
        false,
      )[0],
    );

    for (const state of [
      directPreview,
      nestedPreview,
      directExport,
      nestedExport,
    ]) {
      const fill = state.appearance?.items.find((item) => item.kind === 'color-fill');
      expect(state.shape?.size.w).toBe(200);
      expect(state.shape?.primitive).toBe('star');
      expect(state.shape?.star).toEqual({
        points: 7,
        outerRadius: 48,
        innerRadius: 22,
        cornerRadius: 3,
      });
      expect(fill?.opacity).toBeCloseTo(0.5);
      expect(state.appearance?.items.map((item) => item.kind)).toEqual([
        'color-fill',
        'linear-gradient',
        'stroke',
      ]);
      expect(state.appearance?.items[2].blendMode).toBe('screen');
    }
    expect(nestedPreview).toEqual(directPreview);
    expect(directExport).toEqual(directPreview);
    expect(nestedExport).toEqual(directPreview);
  });
});
