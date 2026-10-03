import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip, Keyframe } from '../../src/types';
import { syncAudioClipToPlayback } from '../../src/services/layerPlayback/mediaSync';
import { syncLayerAudioPlayback } from '../../src/components/timeline/utils/layerSyncAudioPlayback';
import type { LayerPlaybackInfo } from '../../src/services/layerPlayback/layerPlaybackState';
import { createClipSpeedSource, resolveClipSourceTime } from '../../src/services/timeline/retime/clipRetime';

const state = vi.hoisted(() => ({ clipKeyframes: new Map<string, Keyframe[]>() }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => state } }));
vi.mock('../../src/services/audioManager', () => ({
  audioManager: { resume: async () => {} }, audioStatusTracker: { updateStatus: vi.fn() },
}));

function fixture(speed: number, reversed = false) {
  const element = { currentTime: 0, playbackRate: 1, paused: true, muted: false,
    dataset: {}, play: vi.fn(async () => {}), pause: vi.fn() } as unknown as HTMLAudioElement;
  const clip = { id: 'audio', trackId: 'track', startTime: 10, inPoint: 2, outPoint: 10,
    duration: 4, speed, reversed, effects: [], source: { type: 'audio', audioElement: element },
  } as TimelineClip;
  return { clip, element };
}

beforeEach(() => state.clipKeyframes.clear());

describe('actual audio preview consumers', () => {
  it.each([0.5, 2])('background audio seeks at %sx using the shared contract', speed => {
    const { clip, element } = fixture(speed);
    syncAudioClipToPlayback(clip, { shouldRender: true, currentTime: 11,
      playbackState: 'playing' } as LayerPlaybackInfo);
    expect(element.currentTime).toBe(resolveClipSourceTime(clip, 1).sourceTime);
    expect(element.playbackRate).toBe(speed);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it.each([[1, true], [-1, false], [-1, true]] as const)('background audio guards speed=%s reverse=%s', (speed, reversed) => {
    const { clip, element } = fixture(speed, reversed);
    syncAudioClipToPlayback(clip, { shouldRender: true, currentTime: 11,
      playbackState: 'playing' } as LayerPlaybackInfo);
    const backwards = reversed !== (speed < 0);
    expect(element.muted).toBe(backwards);
    expect(element.play).toHaveBeenCalledTimes(backwards ? 0 : 1);
    expect(Boolean(element.dataset.audioPreviewMutedReason)).toBe(backwards);
  });

  it('legacy layer sync seeks automated forward clips and mutes backward clips', () => {
    const { clip, element } = fixture(1);
    const keys: Keyframe[] = [
      { id: 's0', clipId: clip.id, property: 'speed', time: 0, value: 2, hold: true, easing: 'linear' },
      { id: 's1', clipId: clip.id, property: 'speed', time: 2, value: -1, easing: 'linear' },
    ];
    const source = createClipSpeedSource(clip, keys);
    const sync = (local: number) => syncLayerAudioPlayback({
      clips: [clip], clipsAtTime: [clip], audioTracks: [{ id: 'track' }] as never,
      videoTracks: [], playheadPosition: clip.startTime + local, isPlaying: true,
      isDraggingPlayhead: false, isAudioTrackMuted: () => false, isVideoTrackVisible: () => true,
      getInterpolatedSpeed: (_id, time) => source.speedAt(time),
      getSourceTimeForClip: (_id, time) => source.integrate(time),
    });
    sync(1);
    expect(element.currentTime).toBe(resolveClipSourceTime(clip, 1, source).sourceTime);
    expect(element.playbackRate).toBe(2);
    element.play = vi.fn(async () => {});
    sync(3);
    expect(element.muted).toBe(true);
    expect(element.play).not.toHaveBeenCalled();
  });
});
