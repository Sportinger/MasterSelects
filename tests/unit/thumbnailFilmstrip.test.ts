import { describe, expect, it } from 'vitest';
import type { ClipSegment } from '../../src/types';
import {
  resolveLegacyThumbnailRenderPlans,
  resolveSegmentThumbnailRenderPlans,
  resolveThumbnailCacheEligibility,
  resolveThumbnailDisplayPlan,
  resolveVisibleThumbCount,
} from '../../src/components/timeline/utils/thumbnailFilmstrip';

const segments: ClipSegment[] = [
  {
    clipId: 'seg-a',
    startNorm: 0,
    endNorm: 0.5,
    thumbnails: ['a0', 'a1', 'a2', 'a3'],
  },
  {
    clipId: 'seg-b',
    startNorm: 0.5,
    endNorm: 1,
    thumbnails: ['b0', 'b1'],
  },
];

describe('thumbnail filmstrip plan', () => {
  it('counts visible thumbnails from the render window only', () => {
    expect(resolveVisibleThumbCount({ startPx: 0, width: 0 }, 80)).toBe(0);
    expect(resolveVisibleThumbCount({ startPx: 100, width: 240 }, 80)).toBe(4);
  });

  it('enables source cache only for passive video clips without composition segments', () => {
    expect(resolveThumbnailCacheEligibility({
      passiveMediaEnabled: true,
      sourceType: 'video',
      sourceMediaFileId: 'media-1',
      isComposition: false,
      clipSegments: [],
    })).toEqual({
      sourceMediaFileId: 'media-1',
      isCompositionWithSegments: false,
      useSourceCache: true,
    });

    expect(resolveThumbnailCacheEligibility({
      passiveMediaEnabled: true,
      sourceType: 'video',
      sourceMediaFileId: 'media-1',
      isComposition: true,
      clipSegments: segments,
    })).toMatchObject({
      isCompositionWithSegments: true,
      useSourceCache: false,
    });
  });

  it('separates segment and regular thumbnail display decisions', () => {
    expect(resolveThumbnailDisplayPlan({
      passiveMediaEnabled: true,
      thumbnailsEnabled: true,
      isAudioClip: false,
      showsStaticClipArtwork: false,
      isComposition: true,
      compositionSegmentCount: 2,
      isCompositionWithSegments: true,
      useSourceCache: false,
      hasCachedSourceThumbnails: false,
      legacyThumbnailCount: 0,
    })).toEqual({
      showSegmentThumbnails: true,
      showRegularThumbnails: false,
    });

    expect(resolveThumbnailDisplayPlan({
      passiveMediaEnabled: true,
      thumbnailsEnabled: true,
      isAudioClip: false,
      showsStaticClipArtwork: false,
      isComposition: false,
      compositionSegmentCount: 0,
      isCompositionWithSegments: false,
      useSourceCache: true,
      hasCachedSourceThumbnails: true,
      legacyThumbnailCount: 0,
    })).toEqual({
      showSegmentThumbnails: false,
      showRegularThumbnails: true,
    });
  });

  it('clips composition segments into the visible thumbnail window', () => {
    const plans = resolveSegmentThumbnailRenderPlans({
      segments,
      renderWindow: { startPx: 250, width: 500 },
      clipWidth: 1000,
      visibleThumbs: 8,
      thumbWidth: 100,
    });

    expect(plans.map(plan => ({
      segmentIndex: plan.segmentIndex,
      leftPercent: plan.leftPercent,
      widthPercent: plan.widthPercent,
      thumbnailIndexes: plan.thumbnailIndexes,
    }))).toEqual([
      {
        segmentIndex: 0,
        leftPercent: 0,
        widthPercent: 50,
        thumbnailIndexes: [0, 1, 2, 3],
      },
      {
        segmentIndex: 1,
        leftPercent: 50,
        widthPercent: 50,
        thumbnailIndexes: [0, 0, 1, 1],
      },
    ]);
  });

  it('maps legacy thumbnails from visible slots back to source thumbnail indexes', () => {
    expect(resolveLegacyThumbnailRenderPlans({
      thumbnails: ['t0', 't1', 't2', 't3', 't4'],
      visibleThumbs: 4,
      renderWindow: { startPx: 200, width: 320 },
      clipWidth: 1000,
      displayInPoint: 2,
      displayOutPoint: 8,
      naturalDuration: 10,
      thumbWidth: 100,
    })).toEqual([
      { slotIndex: 0, thumbnailIndex: 1, thumbnail: 't1' },
      { slotIndex: 1, thumbnailIndex: 1, thumbnail: 't1' },
      { slotIndex: 2, thumbnailIndex: 2, thumbnail: 't2' },
      { slotIndex: 3, thumbnailIndex: 2, thumbnail: 't2' },
    ]);
  });
});
