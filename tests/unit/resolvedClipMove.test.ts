import { describe, expect, it, vi } from 'vitest';
import { applyMoveClipsOperation } from '../../src/stores/timeline/editOperations/moveOperations';
import {
  createResolvedClipMoveOperationPlan,
  materializeResolvedClipMoveFallbackTracks,
  resolveClipMoveRequest,
  resolvedClipMovesToMoveClipsOperation,
} from '../../src/stores/timeline/editOperations/moveResolution';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const tracks = [
  createMockTrack({ id: 'video-1', type: 'video' }),
  createMockTrack({ id: 'video-2', type: 'video' }),
  createMockTrack({ id: 'audio-1', type: 'audio' }),
];

describe('resolved clip move', () => {
  it('resolves a single lead clip move as plain data and operation payload', () => {
    const clip = createMockClip({
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 1,
      duration: 5,
      source: { type: 'video' },
    });

    const result = resolveClipMoveRequest({
      id: 'move-1',
      clips: [clip],
      tracks,
      clipId: 'clip-1',
      requestedStartTime: 4.2,
      requestedTrackId: 'video-2',
      getSnappedPosition: vi.fn(() => ({
        startTime: 4,
        snapped: true,
        snapEdgeTime: 4,
        source: 'grid',
        thresholdPx: 12,
      })),
      getPositionWithResistance: vi.fn(() => ({
        startTime: 4,
        forcingOverlap: false,
      })),
    });

    expect(result.warnings).toEqual([]);
    expect(result.resolvedMoves).toHaveLength(1);
    expect(result.resolvedMoves[0]).toMatchObject({
      clipId: 'clip-1',
      originalStartTime: 1,
      originalTrackId: 'video-1',
      requestedStartTime: 4.2,
      requestedTrackId: 'video-2',
      resolvedStartTime: 4,
      resolvedTrackId: 'video-2',
      timelineDelta: 3,
      isLeadClip: true,
      snapping: {
        enabled: true,
        snapped: true,
        requestedStartTime: 4.2,
        resolvedStartTime: 4,
        source: 'grid',
        snapIndicatorTime: 4,
        thresholdPx: 12,
      },
      resistance: {
        mode: 'none',
        applied: false,
        forcingOverlap: false,
      },
      fallbackTrack: {
        createFallbackTrack: false,
      },
      overlap: {
        mode: 'none',
        overlappedClipIds: [],
        trimClipIds: [],
        deleteClipIds: [],
      },
    });
    expect(result.operation).toEqual({
      id: 'move-1',
      type: 'move-clips',
      includeLinked: false,
      moves: [{ clipId: 'clip-1', startTime: 4, trackId: 'video-2' }],
    });
    expect(structuredClone(result.resolvedMoves[0])).toEqual(result.resolvedMoves[0]);
    expect(JSON.parse(JSON.stringify(result.resolvedMoves[0]))).toEqual(result.resolvedMoves[0]);
  });

  it('materializes linked clips unless includeLinked is false', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 2,
      duration: 4,
      linkedClipId: 'audio-1',
      source: { type: 'video' },
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 2,
      duration: 4,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });

    const linked = resolveClipMoveRequest({
      id: 'move-linked',
      clips: [video, audio],
      tracks,
      clipId: 'video-1',
      requestedStartTime: 7,
    });
    expect(linked.operation.moves).toEqual([
      { clipId: 'video-1', startTime: 7, trackId: 'video-1' },
      { clipId: 'audio-1', startTime: 7, trackId: 'audio-1' },
    ]);
    expect(linked.resolvedMoves.find(move => move.clipId === 'video-1')?.linked).toEqual({
      includeLinked: true,
      linkedClipIds: ['audio-1'],
      skippedLinkedClipIds: [],
    });

    const unlinked = resolveClipMoveRequest({
      id: 'move-unlinked',
      clips: [video, audio],
      tracks,
      clipId: 'video-1',
      requestedStartTime: 7,
      includeLinked: false,
    });
    expect(unlinked.operation.moves).toEqual([
      { clipId: 'video-1', startTime: 7, trackId: 'video-1' },
    ]);
    expect(unlinked.resolvedMoves[0]?.linked).toEqual({
      includeLinked: false,
      linkedClipIds: [],
      skippedLinkedClipIds: ['audio-1'],
      reason: 'alt-unlink',
    });
  });

  it('dedupes selected linked pairs while preserving selected offsets', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 3,
      duration: 4,
      linkedClipId: 'audio-1',
      source: { type: 'video' },
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 3.5,
      duration: 4,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });

    const result = resolveClipMoveRequest({
      id: 'move-selected-pair',
      clips: [video, audio],
      tracks,
      clipId: 'video-1',
      requestedStartTime: 8,
      selectedClipIds: ['video-1', 'audio-1'],
    });

    expect(result.operation.moves).toEqual([
      { clipId: 'video-1', startTime: 8, trackId: 'video-1' },
      { clipId: 'audio-1', startTime: 8.5, trackId: 'audio-1' },
    ]);
    expect(result.resolvedMoves.find(move => move.clipId === 'video-1')?.linked).toEqual({
      includeLinked: true,
      linkedClipIds: [],
      skippedLinkedClipIds: ['audio-1'],
      reason: 'already-selected',
    });
    expect(result.resolvedMoves.map(move => move.selectedLinkedPair)).toEqual([
      {
        selectedPairClipIds: ['video-1', 'audio-1'],
        dedupedClipIds: ['video-1'],
        preservedOffsets: true,
      },
      {
        selectedPairClipIds: ['video-1', 'audio-1'],
        dedupedClipIds: ['audio-1'],
        preservedOffsets: true,
      },
    ]);
    expect(createResolvedClipMoveOperationPlan(result.id, result.resolvedMoves, result.warnings)).toMatchObject({
      canApplyWithMoveClipsOperation: false,
      blockedReasons: ['selected-linked-pair'],
    });
  });

  it('includes linked group clips with preserved offsets', () => {
    const clips = [
      createMockClip({ id: 'lead', trackId: 'video-1', startTime: 1, duration: 2, linkedGroupId: 'group-1', source: { type: 'video' } }),
      createMockClip({ id: 'group-video', trackId: 'video-1', startTime: 4, duration: 2, linkedGroupId: 'group-1', source: { type: 'video' } }),
      createMockClip({ id: 'group-audio', trackId: 'audio-1', startTime: 5, duration: 2, linkedGroupId: 'group-1', source: { type: 'audio' } }),
    ];

    const result = resolveClipMoveRequest({
      id: 'move-group',
      clips,
      tracks,
      clipId: 'lead',
      requestedStartTime: 6,
    });

    expect(result.operation.moves).toEqual([
      { clipId: 'lead', startTime: 6, trackId: 'video-1' },
      { clipId: 'group-video', startTime: 9, trackId: 'video-1' },
      { clipId: 'group-audio', startTime: 10, trackId: 'audio-1' },
    ]);
    expect(result.resolvedMoves[0]?.linkedGroup).toEqual({
      includeGroups: true,
      linkedGroupIds: ['group-1'],
      groupClipIds: ['lead', 'group-video', 'group-audio'],
      skippedGroupClipIds: [],
    });
  });

  it('records skipped linked group clips when group following is disabled', () => {
    const clips = [
      createMockClip({ id: 'lead', trackId: 'video-1', startTime: 1, duration: 2, linkedGroupId: 'group-1', source: { type: 'video' } }),
      createMockClip({ id: 'group-video', trackId: 'video-1', startTime: 4, duration: 2, linkedGroupId: 'group-1', source: { type: 'video' } }),
      createMockClip({ id: 'group-audio', trackId: 'audio-1', startTime: 5, duration: 2, linkedGroupId: 'group-1', source: { type: 'audio' } }),
    ];

    const result = resolveClipMoveRequest({
      id: 'move-group-disabled',
      clips,
      tracks,
      clipId: 'lead',
      requestedStartTime: 6,
      includeGroups: false,
    });

    expect(result.operation.moves).toEqual([
      { clipId: 'lead', startTime: 6, trackId: 'video-1' },
    ]);
    expect(result.resolvedMoves[0]?.linkedGroup).toEqual({
      includeGroups: false,
      linkedGroupIds: ['group-1'],
      groupClipIds: [],
      skippedGroupClipIds: ['group-video', 'group-audio'],
    });
  });

  it('returns warnings without moves for incompatible or locked targets', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      source: { type: 'video' },
    });

    const incompatible = resolveClipMoveRequest({
      id: 'move-incompatible',
      clips: [video],
      tracks,
      clipId: 'video-1',
      requestedStartTime: 2,
      requestedTrackId: 'audio-1',
    });
    expect(incompatible.resolvedMoves).toEqual([]);
    expect(incompatible.warnings[0]).toMatchObject({
      code: 'unsupported',
      clipId: 'video-1',
      trackId: 'audio-1',
    });

    const locked = resolveClipMoveRequest({
      id: 'move-locked',
      clips: [video],
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video', locked: true }),
        createMockTrack({ id: 'video-2', type: 'video' }),
      ],
      clipId: 'video-1',
      requestedStartTime: 2,
      requestedTrackId: 'video-2',
    });
    expect(locked.resolvedMoves).toEqual([]);
    expect(locked.warnings[0]).toMatchObject({
      code: 'track-locked',
      clipId: 'video-1',
      trackId: 'video-2',
    });
  });

  it('reports fallback track intent when no compatible target track has space', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      source: { type: 'video' },
    });

    const result = resolveClipMoveRequest({
      id: 'move-fallback',
      clips: [video],
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'video-2', type: 'video' }),
      ],
      clipId: 'video-1',
      requestedStartTime: 5,
      requestedTrackId: 'video-2',
      getPositionWithResistance: vi.fn(() => ({
        startTime: 5,
        forcingOverlap: false,
        noFreeSpace: true,
      })),
    });

    expect(result.resolvedMoves[0]?.fallbackTrack).toEqual({
      createFallbackTrack: true,
      requestedNewTrackType: 'video',
      fallbackTrackType: 'video',
      provisionalTrackId: '__resolved_move_new_video_track__',
      reason: 'missing-compatible-track',
    });
    expect(result.operation.moves).toEqual([
      { clipId: 'video-1', startTime: 5, trackId: '__resolved_move_new_video_track__' },
    ]);
    expect(createResolvedClipMoveOperationPlan(result.id, result.resolvedMoves, result.warnings)).toMatchObject({
      canApplyWithMoveClipsOperation: false,
      blockedReasons: ['fallback-track'],
    });
  });

  it('reports explicit new-track-zone intent without a concrete target track', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      source: { type: 'video' },
    });

    const result = resolveClipMoveRequest({
      id: 'move-explicit-new-track',
      clips: [video],
      tracks,
      clipId: 'video-1',
      requestedStartTime: 5,
      requestedNewTrackType: 'video',
    });

    expect(result.resolvedMoves[0]?.fallbackTrack).toEqual({
      createFallbackTrack: true,
      requestedNewTrackType: 'video',
      fallbackTrackType: 'video',
      provisionalTrackId: '__resolved_move_new_video_track__',
      reason: 'explicit-new-track-zone',
    });
    expect(result.operation.moves).toEqual([
      { clipId: 'video-1', startTime: 5, trackId: '__resolved_move_new_video_track__' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('materializes fallback track provisional ids before applying resolved moves', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      source: { type: 'video' },
    });
    const result = resolveClipMoveRequest({
      id: 'move-fallback-materialized',
      clips: [video],
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'video-2', type: 'video' }),
      ],
      clipId: 'video-1',
      requestedStartTime: 5,
      requestedTrackId: 'video-2',
      getPositionWithResistance: vi.fn(() => ({
        startTime: 5,
        forcingOverlap: false,
        noFreeSpace: true,
      })),
    });
    const createTrack = vi.fn(() => 'video-real-fallback');

    const materialized = materializeResolvedClipMoveFallbackTracks(
      result.id,
      result.resolvedMoves,
      createTrack,
    );

    expect(createTrack).toHaveBeenCalledOnce();
    expect(createTrack).toHaveBeenCalledWith('video');
    expect(materialized.warnings).toEqual([]);
    expect(materialized.materializedFallbackTracks).toEqual([
      {
        provisionalTrackId: '__resolved_move_new_video_track__',
        trackId: 'video-real-fallback',
        type: 'video',
      },
    ]);
    expect(materialized.operation.moves).toEqual([
      { clipId: 'video-1', startTime: 5, trackId: 'video-real-fallback' },
    ]);

    const applied = applyMoveClipsOperation(materialized.operation, [video], [
      createMockTrack({ id: 'video-1', type: 'video' }),
      createMockTrack({ id: 'video-real-fallback', type: 'video' }),
    ]);
    expect(applied.warnings).toEqual([]);
    expect(applied.clips[0]).toMatchObject({
      id: 'video-1',
      startTime: 5,
      trackId: 'video-real-fallback',
    });
  });

  it('clamps negative requested starts while preserving the raw request in the resolution', () => {
    const clip = createMockClip({
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 2,
      duration: 4,
      source: { type: 'video' },
    });

    const result = resolveClipMoveRequest({
      id: 'move-negative',
      clips: [clip],
      tracks,
      clipId: 'clip-1',
      requestedStartTime: -3,
    });

    expect(result.warnings).toEqual([]);
    expect(result.resolvedMoves[0]).toMatchObject({
      requestedStartTime: -3,
      resolvedStartTime: 0,
      timelineDelta: -2,
      snapping: {
        enabled: false,
        requestedStartTime: -3,
        resolvedStartTime: 0,
      },
    });
    expect(result.operation.moves).toEqual([
      { clipId: 'clip-1', startTime: 0, trackId: 'video-1' },
    ]);
  });

  it('records follower resistance for linked clips without mutating input clips', () => {
    const video = createMockClip({
      id: 'video-1',
      trackId: 'video-1',
      startTime: 2,
      duration: 4,
      linkedClipId: 'audio-1',
      source: { type: 'video' },
    });
    const audio = createMockClip({
      id: 'audio-1',
      trackId: 'audio-1',
      startTime: 2,
      duration: 4,
      linkedClipId: 'video-1',
      source: { type: 'audio' },
    });
    const getPositionWithResistance = vi.fn((clipId: string, startTime: number) => ({
      startTime: clipId === 'audio-1' ? 6 : startTime,
      forcingOverlap: false,
    }));

    const result = resolveClipMoveRequest({
      id: 'move-linked-resistance',
      clips: [video, audio],
      tracks,
      clipId: 'video-1',
      requestedStartTime: 7,
      getPositionWithResistance,
    });

    expect(result.operation.moves).toEqual([
      { clipId: 'video-1', startTime: 7, trackId: 'video-1' },
      { clipId: 'audio-1', startTime: 6, trackId: 'audio-1' },
    ]);
    expect(result.resolvedMoves.find(move => move.clipId === 'audio-1')).toMatchObject({
      originalStartTime: 2,
      requestedStartTime: 7,
      resolvedStartTime: 6,
      timelineDelta: 4,
      resistance: {
        mode: 'edge-clamp',
        applied: true,
        forcingOverlap: false,
      },
    });
    expect(audio.startTime).toBe(2);
  });

  it('blocks direct move-clips apply when resolved moves require overlap trimming', () => {
    const clip = createMockClip({
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 2,
      duration: 4,
      source: { type: 'video' },
    });
    const overlapped = createMockClip({
      id: 'clip-overlapped',
      trackId: 'video-1',
      startTime: 3.5,
      duration: 2,
      source: { type: 'video' },
    });
    const result = resolveClipMoveRequest({
      id: 'move-overlap',
      clips: [clip, overlapped],
      tracks,
      clipId: 'clip-1',
      requestedStartTime: 3,
      getPositionWithResistance: vi.fn(() => ({
        startTime: 3,
        forcingOverlap: true,
      })),
    });

    const plan = createResolvedClipMoveOperationPlan(result.id, result.resolvedMoves, result.warnings);

    expect(result.resolvedMoves[0]?.overlap.mode).toBe('delete-covered');
    expect(result.resolvedMoves[0]?.overlap.overlappedClipIds).toEqual(['clip-overlapped']);
    expect(result.resolvedMoves[0]?.overlap.trimClipIds).toEqual([]);
    expect(result.resolvedMoves[0]?.overlap.deleteClipIds).toEqual(['clip-overlapped']);
    expect(plan.operation).toEqual(result.operation);
    expect(plan.canApplyWithMoveClipsOperation).toBe(false);
    expect(plan.blockedReasons).toEqual(['overlap-trim']);
  });

  it('records linked overlap trim propagation unless the linked partner is excluded', () => {
    const moving = createMockClip({
      id: 'moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
      source: { type: 'video' },
    });
    const overlappedVideo = createMockClip({
      id: 'overlapped-video',
      trackId: 'video-1',
      startTime: 4,
      duration: 4,
      linkedClipId: 'overlapped-audio',
      source: { type: 'video' },
    });
    const overlappedAudio = createMockClip({
      id: 'overlapped-audio',
      trackId: 'audio-1',
      startTime: 4,
      duration: 4,
      linkedClipId: 'overlapped-video',
      source: { type: 'audio' },
    });

    const included = resolveClipMoveRequest({
      id: 'move-overlap-linked',
      clips: [moving, overlappedVideo, overlappedAudio],
      tracks,
      clipId: 'moving',
      requestedStartTime: 5,
      getPositionWithResistance: vi.fn(() => ({
        startTime: 5,
        forcingOverlap: true,
      })),
    });

    expect(included.resolvedMoves[0]?.overlap).toMatchObject({
      mode: 'trim-overlapped',
      overlappedClipIds: ['overlapped-video'],
      trimClipIds: ['overlapped-video', 'overlapped-audio'],
      deleteClipIds: [],
    });

    const excluded = resolveClipMoveRequest({
      id: 'move-overlap-linked-excluded',
      clips: [moving, overlappedVideo, overlappedAudio],
      tracks,
      clipId: 'moving',
      requestedStartTime: 5,
      excludeClipIds: ['overlapped-audio'],
      getPositionWithResistance: vi.fn(() => ({
        startTime: 5,
        forcingOverlap: true,
      })),
    });

    expect(excluded.resolvedMoves[0]?.overlap).toMatchObject({
      overlappedClipIds: ['overlapped-video'],
      trimClipIds: ['overlapped-video'],
      deleteClipIds: [],
    });
  });

  it('allows direct move-clips apply for plain resolved moves', () => {
    const clip = createMockClip({
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 2,
      duration: 4,
      source: { type: 'video' },
    });
    const result = resolveClipMoveRequest({
      id: 'move-plain-plan',
      clips: [clip],
      tracks,
      clipId: 'clip-1',
      requestedStartTime: 5,
    });

    expect(createResolvedClipMoveOperationPlan(result.id, result.resolvedMoves, result.warnings)).toEqual({
      operation: result.operation,
      canApplyWithMoveClipsOperation: true,
      blockedReasons: [],
    });
  });

  it('converts resolved moves into an explicit move operation compatible with the apply kernel', () => {
    const clips = [
      createMockClip({ id: 'video-1', trackId: 'video-1', startTime: 1, duration: 4, linkedClipId: 'audio-1', source: { type: 'video' } }),
      createMockClip({ id: 'audio-1', trackId: 'audio-1', startTime: 1, duration: 4, linkedClipId: 'video-1', source: { type: 'audio' } }),
    ];
    const resolution = resolveClipMoveRequest({
      id: 'move-for-apply',
      clips,
      tracks,
      clipId: 'video-1',
      requestedStartTime: 6,
    });
    const operation = resolvedClipMovesToMoveClipsOperation('move-for-apply', resolution.resolvedMoves);
    const applied = applyMoveClipsOperation(operation, clips, tracks);

    expect(applied.warnings).toEqual([]);
    expect(applied.clips.map(clip => [clip.id, clip.startTime, clip.trackId])).toEqual([
      ['video-1', 6, 'video-1'],
      ['audio-1', 6, 'audio-1'],
    ]);
  });
});
