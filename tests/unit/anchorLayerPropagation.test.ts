import { describe, expect, it } from 'vitest';

import { buildLayerBuilderImageLayer } from '../../src/services/layerBuilder/layerBuilder2dSources';
import { buildLayerBuilderGaussianSplatLayer } from '../../src/services/layerBuilder/layerBuilder3dLayers';
import { TransformCache } from '../../src/services/layerBuilder/TransformCache';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { TimelineClip } from '../../src/types/timeline';
import type { ClipTransform } from '../../src/types/timelineCore';

const anchor = { x: 0.25, y: -0.5, z: 0.75 };
const transform: ClipTransform = {
  opacity: 1,
  blendMode: 'normal',
  position: { x: 0, y: 0, z: 0 },
  anchor,
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
};

function makeClip(sourceType: 'image' | 'gaussian-splat'): TimelineClip {
  return {
    id: `${sourceType}-clip`,
    trackId: 'video-1',
    name: sourceType,
    file: new File([], sourceType === 'image' ? 'image.png' : 'cloud.ply'),
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    source: { type: sourceType },
    transform,
    effects: [],
    isLoading: false,
    is3D: sourceType === 'gaussian-splat',
  };
}

function makeContext(clip: TimelineClip): FrameContext {
  return {
    activeCompId: 'comp-1',
    playheadPosition: 0,
    visualPlayheadPosition: 0,
    getInterpolatedTransform: () => transform,
    getInterpolatedEffects: () => [],
    getInterpolatedColorCorrection: () => undefined,
    getInterpolatedSpeed: () => 1,
    getSourceTimeForClip: () => 0,
    mediaFileById: new Map(),
    mediaFileByName: new Map(),
    clips: [clip],
  } as FrameContext;
}

describe('anchor layer propagation', () => {
  it('passes the anchor into 2D compositor layers', () => {
    const clip = makeClip('image');
    const layer = buildLayerBuilderImageLayer({
      clip,
      layerIndex: 0,
      ctx: makeContext(clip),
      transformCache: new TransformCache(),
      imageElement: {} as HTMLImageElement,
    });

    expect(layer.anchor).toEqual(anchor);
  });

  it('passes the anchor into native Gaussian Splat layers', () => {
    const clip = makeClip('gaussian-splat');
    const layer = buildLayerBuilderGaussianSplatLayer({
      clip,
      layerIndex: 0,
      ctx: makeContext(clip),
      transformCache: new TransformCache(),
    });

    expect(layer.anchor).toEqual(anchor);
  });
});
