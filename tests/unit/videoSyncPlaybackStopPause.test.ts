import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';

const hoisted = vi.hoisted(() => ({
  android: false,
  clips: [] as TimelineClip[],
  videoByClipId: new Map<string, HTMLVideoElement>(),
  record: vi.fn(),
}));

vi.mock('../../src/engine/texture/videoFrameCopyPolicy', () => ({
  isAndroidVideoFrameRuntime: () => hoisted.android,
}));
vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: { getState: () => ({ clips: hoisted.clips }) },
}));
vi.mock('../../src/services/vfPipelineMonitor', () => ({
  vfPipelineMonitor: { record: hoisted.record },
}));
vi.mock('../../src/services/layerBuilder/videoSyncMediaAdmission', () => ({
  canClipOwnVideoSyncMedia: () => true,
}));
vi.mock('../../src/services/layerBuilder/videoSyncMediaResolver', () => ({
  resolveVideoSyncMedia: (clip: TimelineClip) => ({ htmlVideoElement: hoisted.videoByClipId.get(clip.id) ?? null }),
}));

import { pausePlaybackVideosNow } from '../../src/services/layerBuilder/videoSyncPlaybackStopPause';
import { VideoSyncWarmupState } from '../../src/services/layerBuilder/videoSyncWarmupState';

function playingVideo(): HTMLVideoElement {
  const video = { paused: false, playbackRate: 1 } as unknown as HTMLVideoElement & { paused: boolean };
  video.pause = vi.fn(() => { (video as { paused: boolean }).paused = true; });
  return video;
}

function setup() {
  const warmups = new VideoSyncWarmupState();
  const deps = {
    warmups,
    getHandoffVideoElement: () => null,
    getHandoffTrackState: () => undefined,
    isForceDecodeInProgress: () => false,
  };
  // Clip A ran to its end; clip B starts after a gap and pre-rolls (muted, clamped rate) while the
  // playhead is still in the gap. Nothing is visible at the playhead.
  const activeVideo = playingVideo();
  const preplayVideo = playingVideo();
  preplayVideo.playbackRate = 0.0625;
  hoisted.clips = [
    { id: 'clip-a', trackId: 'v1', startTime: 0, duration: 2 } as TimelineClip,
    { id: 'clip-b', trackId: 'v1', startTime: 2.2, duration: 2 } as TimelineClip,
  ];
  hoisted.videoByClipId.set('clip-a', activeVideo);
  hoisted.videoByClipId.set('clip-b', preplayVideo);
  warmups.setUpcomingPreplay(preplayVideo, { clipId: 'clip-b', startTime: 2.2 });
  return { deps, warmups, activeVideo, preplayVideo };
}

describe('pausePlaybackVideosNow', () => {
  afterEach(() => {
    hoisted.android = false;
    hoisted.clips = [];
    hoisted.videoByClipId.clear();
    hoisted.record.mockClear();
  });

  it('pauses a pre-roll of the next clip on Android when playback stops in a gap', () => {
    // Review 2026-10-29: Android skips the synchronous stop pause (its HTML stop path grabs the
    // running frame first), and paused in a gap no sync runs, so the pre-roll kept playing.
    hoisted.android = true;
    const { deps, warmups, activeVideo, preplayVideo } = setup();

    pausePlaybackVideosNow(deps);

    expect(preplayVideo.paused).toBe(true);
    expect(preplayVideo.playbackRate).toBe(1);
    expect(warmups.hasUpcomingPreplay(preplayVideo)).toBe(false);
    expect(hoisted.record).toHaveBeenCalledWith('vf_pause', { clipId: 'clip-b', reason: 'playback-stop-preplay' });
    // A clip at the playhead stays with the Android stop path, which grabs its frame before pausing.
    expect(activeVideo.paused).toBe(false);
  });

  it('pauses the pre-roll and clears its entry elsewhere too, so the next play starts a fresh one', () => {
    const { deps, warmups, activeVideo, preplayVideo } = setup();

    pausePlaybackVideosNow(deps);

    expect(preplayVideo.paused).toBe(true);
    expect(preplayVideo.playbackRate).toBe(1);
    expect(warmups.hasUpcomingPreplay(preplayVideo)).toBe(false);
    expect(activeVideo.paused).toBe(true);
  });
});
