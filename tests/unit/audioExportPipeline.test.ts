import { describe, expect, it } from 'vitest';
import { AudioExportPipeline } from '../../src/engine/audio/AudioExportPipeline';
import type { TimelineClip, TimelineTrack } from '../../src/types';

const videoTrack: TimelineTrack = {
  id: 'v1',
  name: 'Video 1',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

const audioTrack: TimelineTrack = {
  id: 'a1',
  name: 'Audio 1',
  type: 'audio',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

function createClip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    name: 'clip',
    trackId: videoTrack.id,
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    ...overrides,
  } as TimelineClip;
}

describe('AudioExportPipeline audio preflight', () => {
  it('returns false for video-only export ranges', () => {
    const clips = [createClip({ source: { type: 'video' } })];

    expect(AudioExportPipeline.hasAudioInRange(clips, [videoTrack, audioTrack], 0, 5)).toBe(false);
  });

  it('detects unmuted audio clips in range', () => {
    const clips = [
      createClip({
        id: 'audio-clip',
        trackId: audioTrack.id,
        source: { type: 'audio', audioElement: {} as HTMLAudioElement },
      }),
    ];

    expect(AudioExportPipeline.hasAudioInRange(clips, [videoTrack, audioTrack], 0, 5)).toBe(true);
  });

  it('ignores muted or non-solo audio tracks', () => {
    const clips = [
      createClip({
        id: 'muted-audio',
        trackId: audioTrack.id,
        source: { type: 'audio', audioElement: {} as HTMLAudioElement },
      }),
    ];

    expect(
      AudioExportPipeline.hasAudioInRange(clips, [videoTrack, { ...audioTrack, muted: true }], 0, 5)
    ).toBe(false);
    expect(
      AudioExportPipeline.hasAudioInRange(
        clips,
        [videoTrack, { ...audioTrack, solo: false }, { ...audioTrack, id: 'a2', solo: true }],
        0,
        5
      )
    ).toBe(false);
  });

  it('detects visible nested composition mixdowns', () => {
    const clips = [
      createClip({
        id: 'comp',
        isComposition: true,
        mixdownBuffer: {} as AudioBuffer,
        hasMixdownAudio: true,
      }),
    ];

    expect(AudioExportPipeline.hasAudioInRange(clips, [videoTrack, audioTrack], 0, 5)).toBe(true);
    expect(
      AudioExportPipeline.hasAudioInRange(clips, [{ ...videoTrack, visible: false }, audioTrack], 0, 5)
    ).toBe(false);
  });
});
