import { afterEach, describe, expect, it } from 'vitest';
import {
  markPlayheadFrameHistoryDiscontinuity,
  playheadFrameHistoryMetadata,
  playheadState,
  updateInternalPosition,
} from '../../src/services/layerBuilder/PlayheadState';
import type { RenderSurfaceFrameContext } from '../../src/services/render/renderHostTypes';

const original = {
  position: playheadState.position,
  eventRevision: playheadState.frameHistoryEventRevision,
  discontinuity: playheadState.frameHistoryDiscontinuity,
};

afterEach(() => {
  playheadState.position = original.position;
  playheadState.frameHistoryEventRevision = original.eventRevision;
  if (original.discontinuity) playheadState.frameHistoryDiscontinuity = original.discontinuity;
  else delete playheadState.frameHistoryDiscontinuity;
});

describe('frame-history event producer', () => {
  it('keeps events monotonic and non-consuming for multiple render surfaces', () => {
    const start = playheadState.frameHistoryEventRevision;
    markPlayheadFrameHistoryDiscontinuity('seek');
    const first = playheadFrameHistoryMetadata(7);
    const second = playheadFrameHistoryMetadata(7);
    expect(first).toEqual({ eventRevision: start + 1, discontinuity: 'seek', ownerRevision: 7 });
    expect(second).toEqual(first);

    markPlayheadFrameHistoryDiscontinuity('loop');
    expect(playheadFrameHistoryMetadata(8)).toEqual({ eventRevision: start + 2, discontinuity: 'loop', ownerRevision: 8 });
  });

  it('does not mark ordinary continuous playback position advances', () => {
    const before = playheadFrameHistoryMetadata(3);
    updateInternalPosition(playheadState.position + 1 / 30);
    expect(playheadFrameHistoryMetadata(3)).toEqual(before);
  });

  it('keeps frame-history context optional for existing render callers', () => {
    const legacy: RenderSurfaceFrameContext = { compositionId: 'comp', timelineTimeSeconds: 1 };
    const enriched: RenderSurfaceFrameContext = { ...legacy, frameHistory: playheadFrameHistoryMetadata(4) };
    expect(legacy.frameHistory).toBeUndefined();
    expect(enriched.frameHistory?.ownerRevision).toBe(4);
  });
});
