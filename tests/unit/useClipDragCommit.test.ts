import { describe, expect, it, vi } from 'vitest';

import { createClipDragTypedMoveCommitOperation } from '../../src/components/timeline/hooks/useClipDrag';
import {
  createResolvedClipMoveOperationPlan,
  resolveClipMoveRequest,
} from '../../src/stores/timeline/editOperations';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const tracks = [
  createMockTrack({ id: 'video-1', type: 'video' }),
  createMockTrack({ id: 'video-2', type: 'video' }),
  createMockTrack({ id: 'audio-1', type: 'audio' }),
];

describe('clip drag typed commit decision', () => {
  it('uses direct move-clips for plain resolved moves', () => {
    const clip = createMockClip({
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 1,
      duration: 4,
      source: { type: 'video' },
    });
    const resolution = resolveClipMoveRequest({
      id: 'plain-move',
      clips: [clip],
      tracks,
      clipId: 'clip-1',
      requestedStartTime: 5,
    });
    const operationPlan = createResolvedClipMoveOperationPlan(
      resolution.id,
      resolution.resolvedMoves,
      resolution.warnings,
    );

    expect(createClipDragTypedMoveCommitOperation(
      resolution.id,
      resolution.resolvedMoves,
      operationPlan,
    )).toEqual(resolution.operation);
  });

  it('uses move-clips-resolved for fallback-track and overlap hard cases', () => {
    const clip = createMockClip({
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 1,
      duration: 4,
      source: { type: 'video' },
    });
    const fallbackResolution = resolveClipMoveRequest({
      id: 'fallback-move',
      clips: [clip],
      tracks,
      clipId: 'clip-1',
      requestedStartTime: 5,
      requestedNewTrackType: 'video',
    });
    const fallbackPlan = createResolvedClipMoveOperationPlan(
      fallbackResolution.id,
      fallbackResolution.resolvedMoves,
      fallbackResolution.warnings,
    );
    expect(createClipDragTypedMoveCommitOperation(
      fallbackResolution.id,
      fallbackResolution.resolvedMoves,
      fallbackPlan,
    )).toMatchObject({
      type: 'move-clips-resolved',
      resolvedMoves: fallbackResolution.resolvedMoves,
    });

    const overlapped = createMockClip({
      id: 'overlapped',
      trackId: 'video-1',
      startTime: 4,
      duration: 4,
      source: { type: 'video' },
    });
    const overlapResolution = resolveClipMoveRequest({
      id: 'overlap-move',
      clips: [clip, overlapped],
      tracks,
      clipId: 'clip-1',
      requestedStartTime: 3,
      getPositionWithResistance: vi.fn(() => ({
        startTime: 3,
        forcingOverlap: true,
      })),
    });
    const overlapPlan = createResolvedClipMoveOperationPlan(
      overlapResolution.id,
      overlapResolution.resolvedMoves,
      overlapResolution.warnings,
    );
    expect(createClipDragTypedMoveCommitOperation(
      overlapResolution.id,
      overlapResolution.resolvedMoves,
      overlapPlan,
    )).toMatchObject({
      type: 'move-clips-resolved',
      resolvedMoves: overlapResolution.resolvedMoves,
    });
  });

  it('does not provide a legacy fallback operation for resolver warnings', () => {
    const clip = createMockClip({
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 1,
      duration: 4,
      source: { type: 'video' },
    });
    const resolution = resolveClipMoveRequest({
      id: 'warning-move',
      clips: [clip],
      tracks,
      clipId: 'clip-1',
      requestedStartTime: 5,
      requestedTrackId: 'audio-1',
    });
    const operationPlan = createResolvedClipMoveOperationPlan(
      resolution.id,
      resolution.resolvedMoves,
      resolution.warnings,
    );

    expect(operationPlan.blockedReasons).toEqual(['empty', 'warnings']);
    expect(createClipDragTypedMoveCommitOperation(
      resolution.id,
      resolution.resolvedMoves,
      operationPlan,
    )).toBeNull();
  });
});
