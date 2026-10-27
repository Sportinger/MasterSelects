import { describe, expect, it } from 'vitest';

import {
  findVoiceoverTrackId,
  formatPhoneAudioTime,
  resolvePhoneExtractTarget,
} from '../../src/components/mobileSkin/audio/phoneAudioTimeline';

const tracks = [
  { id: 'v2', type: 'video' as const, locked: false, visible: true },
  { id: 'v1', type: 'video' as const, locked: false, visible: true },
  { id: 'a1', type: 'audio' as const, locked: false, visible: true },
  { id: 'a2', type: 'audio' as const, locked: false, visible: true },
];

describe('voiceover track', () => {
  it('takes the first audio track that is empty from the playhead to the end', () => {
    const clips = [
      { id: 'm', name: 'Music', trackId: 'a1', startTime: 0, duration: 10 },
      { id: 'n', name: 'Old', trackId: 'a2', startTime: 0, duration: 2 },
    ];
    expect(findVoiceoverTrackId(tracks, clips, 3)).toBe('a2');
    expect(findVoiceoverTrackId(tracks, clips, 1)).toBeNull();
  });

  it('skips locked audio tracks', () => {
    expect(findVoiceoverTrackId([{ id: 'a1', type: 'audio', locked: true, visible: true }], [], 0)).toBeNull();
  });
});

describe('extract target', () => {
  const clips = [
    { id: 'top', name: 'Top', trackId: 'v2', startTime: 0, duration: 2 },
    { id: 'main', name: 'Main', trackId: 'v1', startTime: 0, duration: 4, linkedClipId: 'main-a' },
    { id: 'main-a', name: 'Main audio', trackId: 'a1', startTime: 0, duration: 4, linkedClipId: 'main' },
  ];

  it('uses the video clip with linked sound under the playhead', () => {
    expect(resolvePhoneExtractTarget(tracks, clips, [], 1)).toEqual({
      kind: 'ready', target: { videoClipId: 'main', audioClipId: 'main-a', name: 'Main' },
    });
  });

  it('prefers a selected video clip', () => {
    expect(resolvePhoneExtractTarget(tracks, clips, ['main'], 9)).toMatchObject({ kind: 'ready', target: { videoClipId: 'main' } });
  });

  it('explains why nothing can be extracted', () => {
    expect(resolvePhoneExtractTarget(tracks, clips, [], 6)).toMatchObject({ kind: 'none', reason: expect.stringMatching(/playhead onto a video clip/) });
    const unlinked = clips.map((clip) => ({ ...clip, linkedClipId: undefined }));
    expect(resolvePhoneExtractTarget(tracks, unlinked, [], 1)).toMatchObject({ kind: 'none', reason: expect.stringMatching(/no linked sound/) });
  });
});

describe('time label', () => {
  it('formats m:ss.cc', () => {
    expect(formatPhoneAudioTime(0)).toBe('0:00.00');
    expect(formatPhoneAudioTime(61.5)).toBe('1:01.50');
  });
});
