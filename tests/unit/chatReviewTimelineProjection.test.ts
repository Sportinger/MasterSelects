import { describe, expect, it } from 'vitest';

import { projectChatReviewLanes } from '../../src/marketing/chatReviewTimelineProjection';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

function track(
  id: string,
  type: 'audio' | 'video',
  options: Partial<TimelineTrack> = {},
): TimelineTrack {
  return {
    height: 48,
    id,
    locked: false,
    muted: false,
    name: id,
    solo: false,
    type,
    visible: true,
    ...options,
  };
}

function clip(
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
  options: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    duration,
    id,
    name: id,
    startTime,
    trackId,
    ...options,
  } as TimelineClip;
}

describe('chat review timeline projection', () => {
  it('projects a layered edit into one narrative video lane and one audio lane', () => {
    const tracks = [
      track('video-graphics', 'video'),
      track('video-captions', 'video'),
      track('video-main', 'video'),
      track('audio-dialogue', 'audio'),
      track('audio-music', 'audio'),
    ];
    const clips = [
      clip('image-overlay', 'video-graphics', 3, 2, { source: { type: 'image' } as TimelineClip['source'] }),
      clip('captions', 'video-captions', 0, 10, {
        captionProperties: {} as TimelineClip['captionProperties'],
        source: { type: 'caption' } as TimelineClip['source'],
      }),
      clip('video-a', 'video-main', 0, 4, {
        linkedClipId: 'audio-a',
        source: { type: 'video' } as TimelineClip['source'],
      }),
      clip('video-b', 'video-main', 4, 3, {
        linkedClipId: 'audio-b',
        source: { type: 'video' } as TimelineClip['source'],
      }),
      clip('audio-a', 'audio-dialogue', 0, 4, { waveform: [0.2, 0.8] }),
      clip('audio-b', 'audio-dialogue', 4, 3, { waveform: [0.4, 0.6] }),
      clip('music', 'audio-music', 0, 7, { waveform: [0.1, 0.3] }),
    ];

    const projection = projectChatReviewLanes(clips, tracks);

    expect(projection.video.map((item) => item.id)).toEqual(['video-a', 'video-b']);
    expect(projection.audio.map((item) => item.id)).toEqual(['audio-a', 'music', 'audio-b']);
  });

  it('respects effective video visibility and audio mute/solo state', () => {
    const tracks = [
      track('video-hidden', 'video', { visible: false }),
      track('video-main', 'video'),
      track('audio-muted', 'audio', { muted: true }),
      track('audio-solo', 'audio', { solo: true }),
    ];
    const clips = [
      clip('hidden-video', 'video-hidden', 0, 3, { source: { type: 'video' } as TimelineClip['source'] }),
      clip('main-video', 'video-main', 0, 3, { source: { type: 'video' } as TimelineClip['source'] }),
      clip('muted-audio', 'audio-muted', 0, 3),
      clip('solo-audio', 'audio-solo', 0, 3),
    ];

    const projection = projectChatReviewLanes(clips, tracks);

    expect(projection.video.map((item) => item.id)).toEqual(['main-video']);
    expect(projection.audio.map((item) => item.id)).toEqual(['solo-audio']);
  });

  it('uses the bottom visual track for an image-only edit', () => {
    const tracks = [
      track('video-overlay', 'video'),
      track('video-story', 'video'),
      track('audio', 'audio'),
    ];
    const clips = [
      clip('overlay', 'video-overlay', 0, 3, { source: { type: 'image' } as TimelineClip['source'] }),
      clip('story-a', 'video-story', 0, 2, { source: { type: 'image' } as TimelineClip['source'] }),
      clip('story-b', 'video-story', 2, 2, { source: { type: 'image' } as TimelineClip['source'] }),
    ];

    const projection = projectChatReviewLanes(clips, tracks);

    expect(projection.video.map((item) => item.id)).toEqual(['story-a', 'story-b']);
  });
});
