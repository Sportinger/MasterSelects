import { describe, expect, it } from 'vitest';

import { applySelectedTrackRevealScroll } from '../../src/components/timeline/utils/timelineHostLayout';
import type { SelectedTrackRevealSnapshot } from '../../src/components/timeline/utils/timelineHostTypes';

const createSnapshot = (
  overrides: Partial<SelectedTrackRevealSnapshot> = {},
): SelectedTrackRevealSnapshot => ({
  clipId: 'clip-1',
  trackId: 'video-1',
  sectionKind: 'video',
  keyframeCount: 4,
  curveSignature: '',
  trackHeight: 120,
  contentHeight: 500,
  viewportHeight: 200,
  trackTop: 300,
  trackBottom: 420,
  ...overrides,
});

describe('selected timeline track reveal', () => {
  it('scrolls upper video layers away until the selected clip and keyframe rows fully fit', () => {
    expect(applySelectedTrackRevealScroll(100, createSnapshot())).toBe(230);
  });

  it('keeps the divider-facing bottom of an oversized video track visible', () => {
    expect(applySelectedTrackRevealScroll(0, createSnapshot({
      trackHeight: 260,
      trackTop: 200,
      trackBottom: 460,
    }))).toBe(260);
  });

  it('does not move a track that is already fully visible', () => {
    expect(applySelectedTrackRevealScroll(220, createSnapshot())).toBe(220);
  });
});
