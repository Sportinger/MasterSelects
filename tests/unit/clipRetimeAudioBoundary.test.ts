import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Keyframe, TimelineClip, TimelineTrack } from '../../src/types';
import type { AudioSyncState, FrameContext } from '../../src/services/layerBuilder/types';
import { ProcessedAudioPreviewBoundary } from '../../src/services/audio/preview/ProcessedAudioPreviewBoundary';
import { ownsProcessedAudioPreview, setProcessedAudioPreviewOwners } from '../../src/services/audio/preview/processedAudioPreviewOwnership';

// Importing the lightweight boundary must not evaluate the runtime or renderer.
vi.mock('../../src/services/audio/preview/ProcessedAudioPreviewRuntime', () => {
  throw new Error('Preview runtime evaluated before a render was requested');
});

function fixture(speed = -1, keys: Keyframe[] = []) {
  const element = { muted: false, pause: vi.fn(), dataset: {} } as unknown as HTMLAudioElement;
  const clip = { id: 'clip', trackId: 'audio', startTime: 0, duration: 4, inPoint: 0,
    outPoint: 4, speed, source: { type: 'audio', audioElement: element } } as TimelineClip;
  const track = { id: 'audio', type: 'audio' } as TimelineTrack;
  const ctx = { clips: [clip], tracks: [track], clipsAtTime: [clip],
    clipsByTrackId: new Map([[track.id, clip]]), audioTracks: [track],
    getClipKeyframes: () => keys } as unknown as FrameContext;
  const state = { audioPlayingCount: 0 } as AudioSyncState;
  const resolveMedia = () => ({ htmlAudioElement: element, htmlVideoElement: null });
  return { element, clip, ctx, state, resolveMedia };
}

afterEach(() => setProcessedAudioPreviewOwners([]));

describe('lazy processed preview boundary', () => {
  it('does not load during construction, stop, or ordinary forward playback', () => {
    const load = vi.fn();
    const boundary = new ProcessedAudioPreviewBoundary(load);
    boundary.stopAll();
    const f = fixture(2);
    expect(boundary.sync(f.ctx, f.state, f.resolveMedia)).toBe(f.ctx);
    expect(load).not.toHaveBeenCalled();
    expect(f.element.pause).not.toHaveBeenCalled();
  });

  it('owns and mutes backward clips until loaded, then syncs only fresh frame state', async () => {
    const runtime = { sync: vi.fn((ctx: FrameContext) => ctx), stopAll: vi.fn(), invalidateAll: vi.fn() };
    let finish!: (value: typeof runtime) => void;
    const load = vi.fn(() => new Promise<typeof runtime>(resolve => { finish = resolve; }));
    const boundary = new ProcessedAudioPreviewBoundary(load);
    const f = fixture();
    const pending = boundary.sync(f.ctx, f.state, f.resolveMedia);
    expect(pending.clipsAtTime).toEqual([]);
    expect(pending.audioTracks).toEqual([]);
    expect(pending.clipsByTrackId.size).toBe(0);
    expect(ownsProcessedAudioPreview(f.clip.id)).toBe(true);
    expect(f.element.muted).toBe(true);
    expect(f.element.dataset.audioPreviewMutedReason).toContain('preparing');
    boundary.sync(f.ctx, f.state, f.resolveMedia);
    expect(load).toHaveBeenCalledOnce();
    boundary.stopAll();
    finish(runtime);
    await Promise.resolve();
    expect(runtime.sync).not.toHaveBeenCalled();
    const fresh = { ...f.ctx, playheadPosition: 3, isPlaying: false };
    boundary.sync(fresh, f.state, f.resolveMedia);
    expect(runtime.sync).toHaveBeenCalledWith(fresh, f.state);
    boundary.invalidateAll();
    expect(runtime.invalidateAll).toHaveBeenCalledOnce();
    expect(ownsProcessedAudioPreview(f.clip.id)).toBe(false);
  });

  it('also mutes forward portions of an automated clip while the module is pending', () => {
    const boundary = new ProcessedAudioPreviewBoundary(() => new Promise(() => {}));
    const f = fixture(1, [{ id: 'k', clipId: 'clip', property: 'speed', time: 0,
      value: 1, easing: 'linear' }]);
    boundary.sync(f.ctx, f.state, f.resolveMedia);
    expect(f.element.muted).toBe(true);
    expect(ownsProcessedAudioPreview(f.clip.id)).toBe(true);
  });

  it('keeps source audio muted with a reason when the dynamic import fails', async () => {
    const boundary = new ProcessedAudioPreviewBoundary(async () => { throw new Error('chunk unavailable'); });
    const f = fixture();
    boundary.sync(f.ctx, f.state, f.resolveMedia);
    await Promise.resolve();
    boundary.sync(f.ctx, f.state, f.resolveMedia);
    expect(f.element.muted).toBe(true);
    expect(f.element.dataset.audioPreviewMutedReason).toContain('could not load');
  });
});
