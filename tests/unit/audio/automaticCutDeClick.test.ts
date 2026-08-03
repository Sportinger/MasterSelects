import { describe, expect, it } from 'vitest';

import {
  collectAutomaticAudioFadeTargets,
  collectLinkedDeletionIds,
  createAutomaticCutDeClickOperation,
} from '../../../src/services/audio/automaticCutDeClick';
import type { TimelineClip } from '../../../src/types';

function clip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'audio',
    trackId: 'audio-track',
    name: 'Audio.wav',
    file: { name: 'audio.wav', type: 'audio/wav' } as File,
    startTime: 0,
    duration: 3,
    inPoint: 0,
    outPoint: 3,
    source: { type: 'audio' },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    ...overrides,
  } as TimelineClip;
}

describe('automatic cut de-click planning', () => {
  it('finds both surviving audio edges around a linked deleted segment', () => {
    const clips = [
      clip({ id: 'audio-left', startTime: 0, inPoint: 0, outPoint: 3 }),
      clip({ id: 'audio-middle', startTime: 3, inPoint: 3, outPoint: 7, duration: 4, linkedClipId: 'video-middle' }),
      clip({ id: 'audio-right', startTime: 7, inPoint: 7, outPoint: 10 }),
      clip({
        id: 'video-middle',
        trackId: 'video-track',
        startTime: 3,
        duration: 4,
        inPoint: 3,
        outPoint: 7,
        linkedClipId: 'audio-middle',
        source: { type: 'video' },
        file: { name: 'video.mp4', type: 'video/mp4' } as File,
      }),
    ];
    const deletionIds = collectLinkedDeletionIds(clips, ['video-middle'], true);

    expect([...deletionIds].sort()).toEqual(['audio-middle', 'video-middle']);
    expect(collectAutomaticAudioFadeTargets(clips, deletionIds)).toEqual([
      { clipId: 'audio-left', edge: 'out' },
      { clipId: 'audio-right', edge: 'in' },
    ]);
  });

  it('builds a six-millisecond fade-out and fade-in in source time', () => {
    const outgoing = createAutomaticCutDeClickOperation(
      clip({ id: 'out', startTime: 0, inPoint: 0, outPoint: 3 }),
      'out',
      0.006,
      { createdAt: 1, id: 'fade-out' },
    );
    const incoming = createAutomaticCutDeClickOperation(
      clip({ id: 'in', startTime: 7, inPoint: 7, outPoint: 10 }),
      'in',
      0.006,
      { createdAt: 2, id: 'fade-in' },
    );

    expect(outgoing).toMatchObject({
      id: 'fade-out',
      params: { gainDb: -120, fadeInSeconds: 0.006, fadeOutSeconds: 0 },
      timeRange: { start: 2.994, end: 3 },
    });
    expect(incoming).toMatchObject({
      id: 'fade-in',
      params: { gainDb: -120, fadeInSeconds: 0, fadeOutSeconds: 0.006 },
      timeRange: { start: 7, end: 7.006 },
    });
  });

  it('reverses the source-envelope direction for reversed playback', () => {
    const reversedIn = createAutomaticCutDeClickOperation(
      clip({ id: 'reverse', inPoint: 2, outPoint: 5, reversed: true }),
      'in',
      0.006,
      { createdAt: 1, id: 'reverse-in' },
    );

    expect(reversedIn).toMatchObject({
      params: { fadeInSeconds: 0.006, fadeOutSeconds: 0 },
      timeRange: { start: 4.994, end: 5 },
    });
  });
});
