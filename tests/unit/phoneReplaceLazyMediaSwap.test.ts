import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FrameContext } from '../../src/services/layerBuilder/types';
import { getLazyTimelineVideoElementForClip, hydrateTimelineMediaWindow, releaseAllLazyTimelineMediaElements } from '../../src/services/timeline/lazyMediaElements';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import { createPrimaryMediaObjectUrl, revokeAllMediaObjectUrls } from '../../src/services/project/mediaObjectUrlManager';
import { releaseLegacyTimelineClipSourceRuntime } from '../../src/services/timeline/timelineClipSourceRuntimeCleanup';

// Editor root fix behind the phone Replace sheet: a clip whose source is swapped in place
// (replaceClipSource, its undo or a cancelled replace) must not keep the lazy <video> of the old media.

const track: TimelineTrack = { id: 'track-v1', name: 'V1', type: 'video', height: 60, muted: false, visible: true, solo: false };

function clipWith(mediaFileId: string): TimelineClip {
  return {
    id: 'swap-clip', trackId: track.id, name: `${mediaFileId}.mp4`, file: new File(['m'], `${mediaFileId}.mp4`, { type: 'video/mp4' }),
    startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
    source: { type: 'video', mediaFileId, naturalDuration: 4 }, mediaFileId,
    transform: { opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 } },
    effects: [],
  } as TimelineClip;
}

function context(clip: TimelineClip, now: number): FrameContext {
  const mediaFiles = [
    { id: 'media-a', name: 'a.mp4', type: 'video', url: 'blob:media-a', duration: 4 },
    { id: 'media-b', name: 'b.mp4', type: 'video', url: 'blob:media-b', duration: 3 },
  ];
  return {
    clips: [clip], tracks: [track], isPlaying: false, isDraggingPlayhead: false, hasClipDragPreview: false, playheadPosition: 0.25,
    playbackSpeed: 1, activeCompId: 'main', proxyEnabled: false, now, frameNumber: 1,
    videoTracks: [track], audioTracks: [], visibleVideoTrackIds: new Set([track.id]), unmutedAudioTrackIds: new Set(),
    anyVideoSolo: false, anyAudioSolo: false, clipsAtTime: [clip], clipsByTrackId: new Map([[track.id, clip]]),
    mediaFiles, mediaFileById: new Map(mediaFiles.map((file) => [file.id, file])), mediaFileByName: new Map(), compositionById: new Map(),
    getSourceTimeForClip: () => 0, getInterpolatedSpeed: () => 1, hasKeyframes: () => false,
  } as unknown as FrameContext;
}

describe('lazy video after an in-place source swap', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    releaseAllLazyTimelineMediaElements();
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    releaseAllLazyTimelineMediaElements();
    timelineRuntimeCoordinator.clearResources();
    vi.restoreAllMocks();
  });

  it('rebuilds the element for the new media, and again when the swap is undone', () => {
    const original = clipWith('media-a');
    hydrateTimelineMediaWindow(context(original, 1000));
    const first = getLazyTimelineVideoElementForClip(original);
    expect(first?.getAttribute('src')).toBe('blob:media-a');

    // replaceClipSource keeps the clip id and drops the attached element.
    const replaced = clipWith('media-b');
    hydrateTimelineMediaWindow(context(replaced, 1016));
    const second = replaced.source?.videoElement;
    expect(second).toBeInstanceOf(HTMLVideoElement);
    expect(second).not.toBe(first);
    expect(second?.getAttribute('src')).toBe('blob:media-b');

    // Undo / cancel brings the old source back under the same clip id.
    const restored = clipWith('media-a');
    hydrateTimelineMediaWindow(context(restored, 1032));
    expect(restored.source?.videoElement?.getAttribute('src')).toBe('blob:media-a');
    expect(restored.source?.videoElement).not.toBe(second);
  });

  it('rebuilds an element that a clip cleanup emptied (undo of a nest restores a clip with the same id)', () => {
    const clip = clipWith('media-a');
    hydrateTimelineMediaWindow(context(clip, 1000));
    const first = clip.source!.videoElement!;
    // deleted-clip cleanup of the composition clip that held a copy with this id
    first.removeAttribute('src');
    const restored = clipWith('media-a');
    hydrateTimelineMediaWindow(context(restored, 1016));
    expect(restored.source?.videoElement).not.toBe(first);
    expect(restored.source?.videoElement?.getAttribute('src')).toBe('blob:media-a');
  });

  it('keeps reusing the element while the media stays the same', () => {
    const clip = clipWith('media-a');
    hydrateTimelineMediaWindow(context(clip, 1000));
    const first = clip.source?.videoElement;
    const regenerated = clipWith('media-a');
    hydrateTimelineMediaWindow(context(regenerated, 1016));
    expect(regenerated.source?.videoElement).toBe(first);
  });
});

describe('releasing a replaced clip keeps shared media URLs alive', () => {
  afterEach(() => {
    revokeAllMediaObjectUrls();
    vi.restoreAllMocks();
  });

  it('does not revoke the media file primary URL, but still revokes a clip-private URL', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:primary-a');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const primary = createPrimaryMediaObjectUrl('media-a', new File(['a'], 'a.mp4', { type: 'video/mp4' }));

    const shared = document.createElement('video');
    shared.src = primary;
    releaseLegacyTimelineClipSourceRuntime({ ...clipWith('media-a'), source: { type: 'video', mediaFileId: 'media-a', naturalDuration: 4, videoElement: shared } } as TimelineClip, { revokeObjectUrls: true });
    expect(revoke).not.toHaveBeenCalledWith(primary);

    const own = document.createElement('video');
    own.src = 'blob:clip-private';
    releaseLegacyTimelineClipSourceRuntime({ ...clipWith('media-a'), source: { type: 'video', mediaFileId: 'media-a', naturalDuration: 4, videoElement: own } } as TimelineClip, { revokeObjectUrls: true });
    expect(revoke).toHaveBeenCalledWith('blob:clip-private');
  });
});
