import { describe, expect, it } from 'vitest';
import {
  getCompositionVideoTracks,
  normalizeVisiblePreviewPanelSource,
  resolvePreviewSourceCompositionId,
} from '../../src/utils/previewPanelSource';
import type { Composition } from '../../src/stores/mediaStore/types';

const visibleComposition = {
  id: 'visible-comp',
  name: 'Visible Comp',
  timelineData: {
    tracks: [{ id: 'video-1', type: 'video', name: 'Video 1' }],
  },
} as Composition;

const hiddenTransitionComposition = {
  id: 'hidden-transition-comp',
  name: 'Hidden Transition',
  timelineData: {
    tracks: [{ id: 'video-hidden', type: 'video', name: 'Hidden Video' }],
  },
  transitionComp: { kind: 'transition-comp' },
} as Composition;

describe('previewPanelSource hidden compositions', () => {
  const compositions = [visibleComposition, hiddenTransitionComposition];

  it('normalizes stale explicit hidden composition sources to active comp', () => {
    expect(normalizeVisiblePreviewPanelSource(
      { type: 'composition', compositionId: hiddenTransitionComposition.id },
      compositions,
      visibleComposition.id,
    )).toEqual({ type: 'activeComp' });
    expect(resolvePreviewSourceCompositionId(
      { type: 'composition', compositionId: hiddenTransitionComposition.id },
      visibleComposition.id,
      compositions,
    )).toBe(visibleComposition.id);
  });

  it('keeps the active composition renderable even when it is hidden', () => {
    expect(normalizeVisiblePreviewPanelSource(
      { type: 'composition', compositionId: hiddenTransitionComposition.id },
      compositions,
      hiddenTransitionComposition.id,
    )).toEqual({ type: 'composition', compositionId: hiddenTransitionComposition.id });
  });

  it('does not expose hidden composition layers as explicit source options', () => {
    expect(getCompositionVideoTracks(
      hiddenTransitionComposition.id,
      compositions,
      visibleComposition.id,
      [],
    )).toEqual([]);
  });
});
