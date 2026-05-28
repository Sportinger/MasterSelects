import { describe, expect, it } from 'vitest';
import {
  CLIP_DRAG_NEW_AUDIO_TRACK_ID,
  CLIP_DRAG_NEW_VIDEO_TRACK_ID,
  findNearestCompatibleClipDragTrackId,
  getClipDragNewTrackId,
  getClipDragNewTrackType,
  getClipDragTrackRequirement,
  resolveCompatibleClipDragTrackId,
} from '../../../src/components/timeline/utils/clipDragTrackTargeting';
import { createMockClip, createMockTrack } from '../../helpers/mockData';

const tracks = [
  createMockTrack({ id: 'video-1', type: 'video', height: 50 }),
  createMockTrack({ id: 'video-2', type: 'video', height: 50 }),
  createMockTrack({ id: 'audio-1', type: 'audio', height: 50 }),
  createMockTrack({ id: 'audio-2', type: 'audio', height: 50 }),
];

describe('clipDragTrackTargeting', () => {
  it('keeps a video clip on a compatible video track when dropped over audio tracks', () => {
    const videoClip = createMockClip({
      id: 'video-with-audio',
      trackId: 'video-2',
      source: { type: 'video', naturalDuration: 5 },
      linkedClipId: 'linked-audio',
    });

    expect(resolveCompatibleClipDragTrackId('audio-1', 'video-2', videoClip, tracks)).toBe('video-2');
  });

  it('chooses the nearest compatible video track when the pointer is in audio lanes', () => {
    const videoClip = createMockClip({
      id: 'video-with-audio',
      trackId: 'video-1',
      source: { type: 'video', naturalDuration: 5 },
    });
    const requirement = getClipDragTrackRequirement(videoClip, tracks);

    expect(findNearestCompatibleClipDragTrackId(tracks, 150, track => track.height, requirement)).toBe('video-2');
  });

  it('chooses the nearest compatible audio track when an audio clip is over video lanes', () => {
    const audioClip = createMockClip({
      id: 'audio',
      trackId: 'audio-1',
      source: { type: 'audio', naturalDuration: 5 },
    });
    const requirement = getClipDragTrackRequirement(audioClip, tracks);

    expect(findNearestCompatibleClipDragTrackId(tracks, 40, track => track.height, requirement)).toBe('audio-1');
  });

  it('offers a new video track above the video stack and a new audio track below the audio stack', () => {
    expect(getClipDragNewTrackType(tracks, 20, track => track.height, 'video')).toBe('video');
    expect(getClipDragNewTrackType(tracks, 225, track => track.height, 'audio')).toBe('audio');
    expect(getClipDragNewTrackId('video')).toBe(CLIP_DRAG_NEW_VIDEO_TRACK_ID);
    expect(getClipDragNewTrackId('audio')).toBe(CLIP_DRAG_NEW_AUDIO_TRACK_ID);
  });

  it('keeps an active video new-track ghost reachable while it pushes tracks down', () => {
    expect(getClipDragNewTrackType(tracks, 70, track => track.height, 'video')).toBeNull();
    expect(getClipDragNewTrackType(tracks, 70, track => track.height, 'video', 24, 'video')).toBe('video');
  });
});
