import { describe, expect, it } from 'vitest';
import { slitScanSourceTransform, slitScanStabilization } from '../../src/effects/time/slit-scan/stabilization';
import { slitScanProtectionMask, slitScanTrackingQuad } from '../../src/services/planarTracking/slitScanProtectionMask';
import { projectPoint } from '../../src/services/planarTracking/surfaceGeometry';
import type { TrackingAsset } from '../../src/types/trackingAsset';
import type { ClipMask } from '../../src/types/masks';
import type { SurfaceQuad } from '../../src/types/planarTracking';

const quad: SurfaceQuad = [{ x: .2, y: .3 }, { x: .4, y: .3 }, { x: .4, y: .5 }, { x: .2, y: .5 }];
const asset: TrackingAsset = { id: 'asset', type: 'tracking', name: 'Object', createdAt: 0, parentId: null,
  sourceMediaId: 'media', revision: 1, track: { id: 'track', name: 'Object', sourceId: 'media', fps: 30,
    referenceTime: 0, referenceQuad: quad, samples: [{ time: 0, duration: 1 / 30, confidence: 1, quad },
      { time: 1, duration: 1 / 30, confidence: 1, quad: quad.map(p => ({ x: p.x + .1, y: p.y + .2 })) as SurfaceQuad }],
    enabled: false, occlusions: [], color: '#fff', opacity: 1, fill: 0, lineWidth: 1, inset: 0,
    shape: 'outline', visibleFrom: 0, visibleTo: 2, fade: 0 } };
const params = { stabilizationAssetId: 'asset', stabilizationReference: 0 };

describe('Slit Scan source stabilization binding', () => {
  it('uses tracking independently of the marker toggle and aligns source PTS to reference', () => {
    const s = slitScanStabilization(params, [asset], 'media', 1920, 1080)!;
    const source = projectPoint(slitScanSourceTransform(s, 1), quad[0]);
    expect(source.x).toBeCloseTo(.3); expect(source.y).toBeCloseTo(.5);
    expect(asset.track.enabled).toBe(false);
    expect(() => slitScanSourceTransform(s, .5)).toThrow(/sample-gap/);
  });
  it('rejects missing or foreign tracks and changes pixel identity on reference/settings/revision edits', () => {
    expect(slitScanStabilization({}, [], 'media', 2, 1)).toBeUndefined();
    expect(() => slitScanStabilization(params, [], 'media', 2, 1)).toThrow(/missing/);
    expect(() => slitScanStabilization(params, [asset], 'foreign', 2, 1)).toThrow(/different source/);
    const base = slitScanStabilization(params, [asset], 'media', 2, 1)!.identity;
    for (const patch of [{ stabilizationReference: 1 }, { stabilizationStrength: .5 }, { stabilizationRotation: 'off' }, { stabilizationScale: 'off' }]) {
      expect(slitScanStabilization({ ...params, ...patch }, [asset], 'media', 2, 1)!.identity).not.toBe(base);
    }
    expect(slitScanStabilization(params, [{ ...asset, revision: 2 }], 'media', 2, 1)!.identity).not.toBe(base);
  });
});

describe('Slit Scan object selection and protection', () => {
  it('creates editable effect-only reference masks with feather and independent vertex IDs', () => {
    const a = slitScanProtectionMask(quad, 30), b = slitScanProtectionMask(quad, 30);
    expect(a).toMatchObject({ enabled: true, compositeEnabled: false, feather: 30, closed: true, inverted: false });
    expect(a.vertices?.map(({ x, y }) => ({ x, y }))).toEqual(quad);
    expect(a.vertices?.[0].id).not.toBe(b.vertices?.[0].id);
    expect(a.vertices?.[0]).not.toBe(quad[0]);
  });
  it('tracks the translated/rotated selection in source pixels without mutating its authoring shape', () => {
    const mask = { ...slitScanProtectionMask(quad, 30), position: { x: .1, y: .2 }, rotation: 90 } as ClipMask;
    const before = structuredClone(mask);
    const result = slitScanTrackingQuad(mask, 200, 100);
    expect(result[0].x).toBeCloseTo(.45); expect(result[0].y).toBeCloseTo(.4);
    expect(result[2].x).toBeCloseTo(.35); expect(result[2].y).toBeCloseTo(.8);
    expect(mask).toEqual(before);
    expect(() => slitScanTrackingQuad({ ...mask, inverted: true }, 200, 100)).toThrow(/non-inverted/);
  });
});
