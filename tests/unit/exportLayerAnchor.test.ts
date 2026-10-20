import { describe, expect, it } from 'vitest';
import { buildBaseLayerProps } from '../../src/engine/export/layerBuilder/baseLayers';
import type { FrameContext as ExportFrameContext } from '../../src/engine/export/types';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';

describe('export layer transforms', () => {
  it('keeps the clip anchor so anchored 3D clips render where the preview shows them', () => {
    const clip = { id: 'splat', name: 'splat', trackId: 'v1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
      effects: [], transform: structuredClone(DEFAULT_TRANSFORM) } as unknown as TimelineClip;
    const anchor = { x: -0.5, y: 21, z: 0 };
    const state = useTimelineStore.getState();
    const ctx = {
      time: 1, fps: 30, frameTolerance: 50_000, outputWidth: 1080, outputHeight: 1920,
      clipsAtTime: [clip], renderClipsAtTime: [clip], compositionClips: [clip], trackMap: new Map(), clipsByTrack: new Map(),
      mediaFiles: [], mediaCompositions: [],
      getInterpolatedTransform: () => ({ ...structuredClone(DEFAULT_TRANSFORM), anchor }),
      getInterpolatedEffects: () => [],
      getInterpolatedColorCorrection: state.getInterpolatedColorCorrection,
      getInterpolatedVectorAnimationSettings: state.getInterpolatedVectorAnimationSettings,
      getInterpolatedTextBounds: state.getInterpolatedTextBounds,
    } as unknown as ExportFrameContext;
    expect(buildBaseLayerProps(clip, 1, 0, ctx)?.anchor).toEqual(anchor);
  });
});
