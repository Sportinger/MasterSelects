import { describe, expect, it } from 'vitest';
import {
  captureVariantRangeSnapshot,
  createVariantFingerprintInputs,
  normalizeTimelineVariantScope,
  type VariantTimelineSourceSnapshot,
} from '../../src/services/storyboard/variants';

function source(includeLinked: boolean): VariantTimelineSourceSnapshot {
  return {
    schemaVersion: 1,
    compositionId: 'composition-1',
    scope: {
      startTime: 10,
      endTime: 20,
      trackIds: ['video-2', 'video-1', 'video-1'],
      includeLinked,
    },
    boundaryPaddingSeconds: 2,
    tracks: [
      { id: 'audio-1', kind: 'audio', payload: { muted: false } },
      { id: 'video-2', kind: 'video', payload: { locked: false } },
      { id: 'video-1', kind: 'video', payload: { locked: false } },
    ],
    clips: [
      {
        id: 'cross-start',
        trackId: 'video-1',
        startTime: 5,
        endTime: 15,
        sourceStartSeconds: 100,
        linkedClipIds: ['linked-audio'],
        payload: { label: 'start' },
      },
      {
        id: 'cross-end',
        trackId: 'video-1',
        startTime: 18,
        endTime: 25,
        linkedClipIds: [],
        payload: { label: 'end' },
      },
      {
        id: 'covers',
        trackId: 'video-2',
        startTime: 4,
        endTime: 26,
        linkedClipIds: [],
        payload: { label: 'cover' },
      },
      {
        id: 'linked-audio',
        trackId: 'audio-1',
        startTime: 5,
        endTime: 15,
        linkedClipIds: [],
        payload: { gain: 1 },
      },
      {
        id: 'unlinked-audio',
        trackId: 'audio-1',
        startTime: 10,
        endTime: 20,
        linkedClipIds: [],
        payload: { gain: 1 },
      },
    ],
    transitions: [],
    globalState: { frameRate: 30 },
  };
}

describe('storyboard variant scope capture', () => {
  it('normalizes the exact time, track, and includeLinked selection', () => {
    expect(normalizeTimelineVariantScope({
      startTime: -0,
      endTime: 12.5,
      trackIds: [' track-b ', 'track-a', 'track-b'],
      includeLinked: false,
    })).toEqual({
      startTime: 0,
      endTime: 12.5,
      trackIds: ['track-a', 'track-b'],
      includeLinked: false,
    });
    expect(() => normalizeTimelineVariantScope({
      startTime: 5,
      endTime: 5,
      trackIds: ['track-a'],
      includeLinked: false,
    })).toThrow(/endTime/);
  });

  it('represents clips crossing either or both boundaries without losing outside pieces', () => {
    const snapshot = captureVariantRangeSnapshot(source(false));
    const byId = new Map(snapshot.capturedClips.map((clip) => [clip.clipId, clip]));

    expect(snapshot.scope).toEqual({
      startTime: 10,
      endTime: 20,
      trackIds: ['video-1', 'video-2'],
      includeLinked: false,
    });
    expect(byId.get('cross-start')).toMatchObject({
      relation: 'crosses-start',
      beforeRange: { startTime: 5, endTime: 10, sourceStartSeconds: 100 },
      inside: { startTime: 10, endTime: 15, sourceStartSeconds: 105 },
    });
    expect(byId.get('cross-end')).toMatchObject({
      relation: 'crosses-end',
      inside: { startTime: 18, endTime: 20 },
      afterRange: { startTime: 20, endTime: 25 },
    });
    expect(byId.get('covers')).toMatchObject({
      relation: 'covers-range',
      beforeRange: { startTime: 4, endTime: 10 },
      inside: { startTime: 10, endTime: 20 },
      afterRange: { startTime: 20, endTime: 26 },
    });
  });

  it('expands only the linked clip graph while preserving requested trackIds', () => {
    const withoutLinked = captureVariantRangeSnapshot(source(false));
    const withLinked = captureVariantRangeSnapshot(source(true));

    expect(withoutLinked.capturedClips.map((clip) => clip.clipId))
      .not.toContain('linked-audio');
    expect(withLinked.scope.trackIds).toEqual(['video-1', 'video-2']);
    expect(withLinked.linkedExpansionPolicy).toBe('linked-clips');
    expect(withLinked.linkedExpansionClipIds).toEqual(['linked-audio']);
    expect(withLinked.linkedExpansionTrackIds).toEqual(['audio-1']);
    expect(withLinked.capturedClips.map((clip) => clip.clipId))
      .not.toContain('unlinked-audio');

    const inputs = createVariantFingerprintInputs(withLinked);
    expect(inputs.outside.clipSegments.some((clip) => (
      clip.sourceClipId === 'unlinked-audio'
    ))).toBe(true);
  });
});
