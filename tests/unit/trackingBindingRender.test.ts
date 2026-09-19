import { describe, expect, it } from 'vitest';
import {
  resolvePlanarTrackingProjection,
  resolvePlanarTrackingScreenAnchor,
} from '../../src/services/planarTracking/trackingBindingRender';
import {
  IDENTITY_TRACKING_SOURCE_TRANSFORM,
  trackingSourceTransform,
  transformTrackingPoint,
} from '../../src/services/planarTracking/trackingSourceTransform';
import type { Layer } from '../../src/types/layers';
import type { PlanarTrack, SurfaceQuad } from '../../src/types/planarTracking';
import type { TrackingBinding } from '../../src/types/trackingBinding';

const unitQuad: SurfaceQuad = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
];

function track(quad: SurfaceQuad = unitQuad): PlanarTrack {
  return {
    id: 'track', name: 'Track', sourceId: 'media', fps: 10, referenceTime: 2,
    referenceQuad: unitQuad, samples: [{ time: 2, duration: 0.1, quad, confidence: 1 }],
    occlusions: [], enabled: true, color: '#fff', opacity: 1, fill: 0,
    lineWidth: 1, inset: 0, shape: 'outline', visibleFrom: 2, visibleTo: 2.1, fade: 0,
  };
}

function binding(mode: TrackingBinding['mode']): TrackingBinding {
  return {
    version: 1, assetId: 'asset', targetVideoClipId: 'video', mode,
    point: { x: 0.5, y: 0.5 }, offset: { x: 0.1, y: -0.05 },
    placement: { x: 0.5, y: 0.5, width: 1, height: 1, rotation: 0 },
  };
}

function sourceLayer(): Layer {
  return {
    id: 'video-layer', sourceClipId: 'video', name: 'Video', visible: true,
    opacity: 1, blendMode: 'normal', effects: [], source: { type: 'video' },
    position: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 },
  };
}

describe('generic tracking render binding', () => {
  it('maps source tracking coordinates through native pixel scale and the target clip transform', () => {
    const transform = trackingSourceTransform(
      { ...sourceLayer(), position: { x: 0.2, y: -0.1, z: 0 } },
      { width: 960, height: 540 },
      { width: 1920, height: 1080 },
    )!;
    const topLeft = transformTrackingPoint(transform, { x: 0, y: 0 })!;
    const bottomRight = transformTrackingPoint(transform, { x: 1, y: 1 })!;
    expect(topLeft.x).toBeCloseTo(0.35, 10);
    expect(topLeft.y).toBeCloseTo(0.2, 10);
    expect(bottomRight.x).toBeCloseTo(0.85, 10);
    expect(bottomRight.y).toBeCloseTo(0.7, 10);
  });

  it('resolves an exact planar projective quad and never crosses an uncovered PTS gap', () => {
    const quad: SurfaceQuad = [
      { x: 0.1, y: 0.2 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.8 },
    ];
    const descriptor = { binding: binding('surface'), track: track(quad) };
    const transforms = new Map([['video', IDENTITY_TRACKING_SOURCE_TRANSFORM]]);
    const resolved = resolvePlanarTrackingProjection(descriptor, new Map([['video', 2]]), transforms);
    resolved?.quad?.forEach((point, index) => {
      expect(point.x).toBeCloseTo(quad[index]!.x, 9);
      expect(point.y).toBeCloseTo(quad[index]!.y, 9);
    });
    expect(resolvePlanarTrackingProjection(descriptor, new Map([['video', 2.2]]), transforms)).toBeNull();
  });

  it('projects a follow point before applying the screen-space offset', () => {
    const descriptor = { binding: binding('follow'), track: track() };
    const transforms = new Map([['video', IDENTITY_TRACKING_SOURCE_TRANSFORM]]);
    expect(resolvePlanarTrackingScreenAnchor(descriptor, new Map([['video', 2.05]]), transforms)).toEqual({
      contact: { x: 0.5, y: 0.5 },
      content: { x: 0.6, y: 0.45 },
    });
  });

  it('uses explicit source PTS when the original video clip is outside the composition', () => {
    const crossComposition = { ...binding('surface'), targetVideoClipId: undefined, sourceStart: 2 };
    expect(resolvePlanarTrackingProjection(
      { binding: crossComposition, track: track(), sourcePresentedTime: 2 },
      new Map(),
      new Map(),
    )?.quad).toEqual(unitQuad);
  });
});
