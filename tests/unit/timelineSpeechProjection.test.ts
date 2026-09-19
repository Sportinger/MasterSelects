import { describe, expect, it } from 'vitest';

import {
  buildTimelineSpeechProjection,
  buildTimelineSpeechSegments,
  joinTimelineSpeechWords,
} from '../../src/services/transcription/timelineSpeechProjection';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

function track(id: string, type: TimelineTrack['type'], overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    height: 64,
    id,
    muted: false,
    name: id,
    solo: false,
    type,
    visible: true,
    ...overrides,
  };
}

function clip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    duration: 5,
    id: 'video-clip',
    inPoint: 10,
    linkedClipId: 'audio-clip',
    name: 'Interview',
    outPoint: 20,
    startTime: 5,
    trackId: 'video-track',
    transcript: [
      { end: 13, id: 'word-1', speaker: 'A', start: 12, text: 'Hallo' },
      { end: 14, id: 'word-2', speaker: 'A', start: 13, text: 'Welt.' },
    ],
    ...overrides,
  } as TimelineClip;
}

describe('timeline speech projection', () => {
  it('deduplicates linked A/V and maps source words into timeline time', () => {
    const transcript = clip({}).transcript;
    const projection = buildTimelineSpeechProjection({
      clips: [
        clip({}),
        clip({
          id: 'audio-clip',
          linkedClipId: 'video-clip',
          trackId: 'audio-track',
          transcript,
        }),
      ],
      maximumWords: 100_000,
      tracks: [track('video-track', 'video'), track('audio-track', 'audio')],
    });

    expect(projection.words).toEqual([
      expect.objectContaining({
        audioClipId: 'audio-clip',
        clipId: 'video-clip',
        text: 'Hallo',
        timelineEnd: 6.5,
        timelineStart: 6,
        trackId: 'audio-track',
      }),
      expect.objectContaining({
        audioClipId: 'audio-clip',
        clipId: 'video-clip',
        text: 'Welt.',
        timelineEnd: 7,
        timelineStart: 6.5,
        trackId: 'audio-track',
      }),
    ]);
    expect(projection.text).toBe('Hallo Welt.');
    expect(projection.segments).toEqual([
      expect.objectContaining({
        clipId: 'video-clip',
        text: 'Hallo Welt.',
        wordCount: 2,
      }),
    ]);
    expect(projection.excluded.linkedDuplicateClipCount).toBe(1);
  });

  it('uses effective clip/track mute and audio solo state', () => {
    const firstVideo = clip({
      id: 'video-a',
      linkedClipId: 'audio-a',
      transcript: [{ end: 1, id: 'a', start: 0, text: 'hidden' }],
      inPoint: 0,
      outPoint: 2,
      startTime: 0,
      trackId: 'video-a-track',
    });
    const secondVideo = clip({
      id: 'video-b',
      linkedClipId: 'audio-b',
      transcript: [{ end: 1, id: 'b', start: 0, text: 'audible' }],
      inPoint: 0,
      outPoint: 2,
      startTime: 0,
      trackId: 'video-b-track',
    });
    const projection = buildTimelineSpeechProjection({
      clips: [
        firstVideo,
        clip({ ...firstVideo, id: 'audio-a', linkedClipId: 'video-a', trackId: 'audio-a-track' }),
        secondVideo,
        clip({ ...secondVideo, id: 'audio-b', linkedClipId: 'video-b', trackId: 'audio-b-track' }),
      ],
      maximumWords: 100_000,
      tracks: [
        track('video-a-track', 'video'),
        track('audio-a-track', 'audio'),
        track('video-b-track', 'video'),
        track('audio-b-track', 'audio', {
          audioState: {
            meterMode: 'peak',
            muted: false,
            pan: 0,
            recordArm: false,
            inputMonitor: false,
            solo: true,
            volumeDb: 0,
          },
        }),
      ],
    });

    expect(projection.words.map((word) => word.text)).toEqual(['audible']);
    expect(projection.excluded.mutedOrUnsoloedClipCount).toBe(1);
  });

  it('maps reverse playback and exposes stable text/segment helpers', () => {
    const projection = buildTimelineSpeechProjection({
      clips: [clip({
        duration: 10,
        inPoint: 0,
        linkedClipId: undefined,
        outPoint: 10,
        reversed: true,
        startTime: 20,
        trackId: 'audio-track',
        transcript: [
          { end: 2, id: 'one', start: 1, text: 'Alpha' },
          { end: 3, id: 'two', start: 2, text: 'Beta' },
          { end: 4, id: 'three', start: 3, text: 'Gamma' },
        ],
      })],
      maximumWords: 100_000,
      tracks: [track('audio-track', 'audio')],
    });

    expect(projection.words.map((word) => word.timelineStart)).toEqual([26, 27, 28]);
    expect(joinTimelineSpeechWords(projection.words)).toBe('Gamma Beta Alpha');
    expect(buildTimelineSpeechSegments(projection.words).map((segment) => segment.text))
      .toEqual(['Gamma Beta Alpha']);
  });
});
