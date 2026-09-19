import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  asset: {
    id: 'asset', sourceMediaId: 'media', sourceVideoClipId: 'video',
    track: { id: 'track', referenceTime: 4 },
  },
  timeline: {
    clips: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    isExporting: false,
    updateClip: vi.fn(),
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: { getState: () => runtime.timeline },
}));

vi.mock('../../src/services/planarTracking/trackingAssets', () => ({
  getTrackingAsset: (id: string) => id === runtime.asset.id ? runtime.asset : undefined,
}));

import {
  bindClipToTrackingAsset,
  isTrackingBindingEligibleClip,
} from '../../src/services/planarTracking/trackingBinding';

describe('tracking binding authoring', () => {
  beforeEach(() => {
    runtime.asset.track = { id: 'track', referenceTime: 4 } as never;
    runtime.timeline.clips = [];
    runtime.timeline.tracks = [];
    runtime.timeline.isExporting = false;
    runtime.timeline.updateClip.mockReset();
  });

  it('preserves the edited binding when switching between follow and surface', () => {
    const existing = {
      version: 1 as const, assetId: 'asset', targetVideoClipId: 'custom-video', mode: 'follow' as const,
      point: { x: 0.2, y: 0.7 }, offset: { x: -0.1, y: 0.04 }, sourceStart: 8,
      placement: { x: 0.3, y: 0.4, width: 0.2, height: 0.15, rotation: 12 },
    };
    runtime.timeline.clips = [{ id: 'graphic', trackId: 'graphics', source: { type: 'image' }, trackingBinding: existing }];
    runtime.timeline.tracks = [{ id: 'graphics', locked: false }];

    const result = bindClipToTrackingAsset('graphic', 'asset', 'surface');
    expect(result).toEqual({ ...existing, mode: 'surface' });
    expect(result).not.toBe(existing);
    expect(runtime.timeline.updateClip).toHaveBeenCalledWith('graphic', { trackingBinding: result });
  });

  it.each([
    ['locked', { locked: true }, false, 'image'],
    ['exporting', { locked: false }, true, 'image'],
    ['audio', { locked: false }, false, 'audio'],
    ['3D model', { locked: false }, false, 'model'],
  ])('rejects %s clips before changing durable state', (_label, track, isExporting, sourceType) => {
    runtime.timeline.clips = [{ id: 'graphic', trackId: 'graphics', source: { type: sourceType } }];
    runtime.timeline.tracks = [{ id: 'graphics', ...track }];
    runtime.timeline.isExporting = isExporting;

    expect(() => bindClipToTrackingAsset('graphic', 'asset', 'follow')).toThrow();
    expect(runtime.timeline.updateClip).not.toHaveBeenCalled();
  });

  it('shares ordinary 2D clip eligibility with tracking pickers', () => {
    expect(isTrackingBindingEligibleClip({ source: { type: 'text' } } as never)).toBe(true);
    expect(isTrackingBindingEligibleClip({ source: { type: 'model' }, is3D: true } as never)).toBe(false);
    expect(isTrackingBindingEligibleClip({ source: { type: 'audio' } } as never)).toBe(false);
  });

  it('starts a terrain binding on an observed triangle instead of a possible bounds-center hole', () => {
    runtime.asset.track = {
      id: 'track', referenceTime: 4,
      terrain: {
        denseMesh: {
          positions: [10, 0, 0, 12, 0, 0, 10, 2, 0], indices: [0, 1, 2],
          origin: [0, 0, 0], axisX: [1, 0, 0], axisY: [0, 1, 0], normal: [0, 0, 1], size: [20, 10],
        },
      },
    } as never;
    runtime.timeline.clips = [{ id: 'graphic', trackId: 'graphics', source: { type: 'text' } }];
    runtime.timeline.tracks = [{ id: 'graphics', locked: false }];

    const result = bindClipToTrackingAsset('graphic', 'asset', 'surface');
    expect(result.placement).toMatchObject({ x: 32 / 3, y: 2 / 3, width: 4, height: 2 });
  });
});
