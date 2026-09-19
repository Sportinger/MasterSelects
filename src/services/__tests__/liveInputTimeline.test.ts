import { describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../stores/mediaStore';
import type { ClipboardClipData } from '../../stores/timeline/types';
import type { SerializableClip } from '../../types/timeline';
import {
  canPasteLiveInputInComposition,
  clipRequiresAsyncMediaLoad,
  createPastedClipSource,
} from '../../stores/timeline/clipboard/clipboardPastedClipSource';
import {
  createHistoryTimelineEditState,
  toHistoryTimelineClipEditState,
} from '../../stores/timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../../stores/timeline/historyTimelineRestoreState';
import { createDataOnlyRestoredVideoSource } from '../../stores/timeline/restoredMediaSource';
import { createLoadStateLiveInputClip } from '../../stores/timeline/serialization/loadStateCommonClipRestore';
import {
  clipTreeContainsLiveInput,
  clipTreeNeedsLiveVideoElement,
} from '../timeline/liveInputClipTree';
import {
  canPlaceLiveInputInActiveComposition,
  collectUsedLiveInputIds,
  createLiveInputTimelineClip,
  isLiveInputUsedOutsideComposition,
} from '../liveInputTimeline';
import {
  createLiveInputRenderGate,
  createLiveInputVideoElement,
  keepLiveInputVideoActive,
  requestRenderForVideoFrames,
  resetLiveInputPresentationCanvas,
  resolveLiveInputVideoPresentation,
  selectLiveInputPresentationVideo,
} from '../mediaRuntime/liveInputRuntime';
import { hasActiveContinuousRenderClip } from '../../hooks/engine/engineTimelineDerivations';

function liveItem(liveInput: NonNullable<MediaFile['liveInput']>): MediaFile {
  return {
    id: 'live-1',
    name: 'Live Camera',
    type: 'video',
    parentId: null,
    createdAt: 1,
    url: '',
    duration: 30,
    hasAudio: false,
    liveInput,
  };
}

describe('live input timeline clips', () => {
  it('keeps live presentation metadata rotation-free across iPad orientation changes', () => {
    const presentation = resolveLiveInputVideoPresentation(
      { kind: 'video-device' },
      1920,
      1080,
    );

    expect(presentation).toEqual({ width: 1920, height: 1080, rotation: 0 });
    expect(resolveLiveInputVideoPresentation(
      { kind: 'video-device' },
      1080,
      1920,
    )).toEqual({ width: 1080, height: 1920, rotation: 0 });
    expect(resolveLiveInputVideoPresentation(
      { kind: 'display' },
      1920,
      1080,
    )).toEqual({ width: 1920, height: 1080, rotation: 0 });
  });

  it('resets orientation frames without replacing the renderer canvas handle', () => {
    const presentationCanvas = document.createElement('canvas');
    presentationCanvas.width = 1920;
    presentationCanvas.height = 1080;
    const retainedHandle = presentationCanvas;

    const context = resetLiveInputPresentationCanvas(presentationCanvas);

    expect(presentationCanvas).toBe(retainedHandle);
    expect(presentationCanvas.width).toBe(1920);
    expect(presentationCanvas.height).toBe(1080);
    expect(context).not.toBeNull();
  });

  it('keeps the hidden stream video mounted and resumes it after Safari pauses it', () => {
    const track = Object.assign(new EventTarget(), {
      muted: false,
      readyState: 'live',
    }) as unknown as MediaStreamTrack;
    const stream = {
      active: true,
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const video = createLiveInputVideoElement(stream);
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    const stopRecovery = keepLiveInputVideoActive(video, stream);

    expect(video.isConnected).toBe(true);
    video.dispatchEvent(new Event('pause'));
    window.dispatchEvent(new Event('pageshow'));
    expect(play).toHaveBeenCalledTimes(2);

    stopRecovery();
    video.dispatchEvent(new Event('pause'));
    expect(play).toHaveBeenCalledTimes(2);
    video.remove();
  });

  it('prefers the visible Media Panel video as the Safari presentation surface', () => {
    const stream = {} as MediaStream;
    const fallback = document.createElement('video');
    const visiblePreview = document.createElement('video');
    visiblePreview.srcObject = stream;
    visiblePreview.dataset.liveInputPresentationRole = 'media-panel';
    Object.defineProperties(visiblePreview, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    document.body.appendChild(visiblePreview);

    expect(selectLiveInputPresentationVideo(
      fallback,
      stream,
      [visiblePreview],
    )).toBe(visiblePreview);

    visiblePreview.remove();
    expect(selectLiveInputPresentationVideo(
      fallback,
      stream,
      [visiblePreview],
    )).toBe(fallback);
  });

  it('keeps Media Panel video frames authoritative over a newer composition preview', () => {
    const stream = {} as MediaStream;
    const mediaPanelVideo = document.createElement('video');
    const compositionPreviewVideo = document.createElement('video');
    for (const [video, role] of [
      [mediaPanelVideo, 'media-panel'],
      [compositionPreviewVideo, 'composition-preview'],
    ] as const) {
      video.srcObject = stream;
      video.dataset.liveInputPresentationRole = role;
      Object.defineProperties(video, {
        readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
        videoWidth: { configurable: true, value: 1920 },
        videoHeight: { configurable: true, value: 1080 },
      });
      document.body.appendChild(video);
    }

    expect(selectLiveInputPresentationVideo(
      document.createElement('video'),
      stream,
      [mediaPanelVideo, compositionPreviewVideo],
    )).toBe(mediaPanelVideo);

    mediaPanelVideo.remove();
    compositionPreviewVideo.remove();
  });

  it('periodically wakes an idle renderer while keeping active live frames continuous', () => {
    let now = 3_000;
    let lastRenderedAt = 0;
    const shouldRender = createLiveInputRenderGate(
      () => lastRenderedAt,
      () => now,
    );

    expect(shouldRender()).toBe(true);
    now = 3_200;
    expect(shouldRender()).toBe(false);
    now = 3_500;
    expect(shouldRender()).toBe(true);

    lastRenderedAt = now;
    now = 3_510;
    expect(shouldRender()).toBe(true);
  });

  it('requests editor frames only while a live source is actively rendered', () => {
    const video = document.createElement('video');
    const requestRender = vi.fn();
    let active = false;
    const stop = requestRenderForVideoFrames(video, () => active, requestRender);

    video.dispatchEvent(new Event('timeupdate'));
    active = true;
    video.dispatchEvent(new Event('timeupdate'));
    stop();
    video.dispatchEvent(new Event('timeupdate'));

    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('keeps continuous rendering active while a connected live clip is visible', () => {
    const clip = createLiveInputTimelineClip({
      item: liveItem({ kind: 'video-device', deviceId: 'camera-2' }),
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      id: 'clip-live-active',
    })!;
    const track = {
      id: 'video-1',
      name: 'Video 1',
      type: 'video' as const,
      height: 72,
      muted: false,
      visible: true,
      solo: false,
    };

    expect(hasActiveContinuousRenderClip([clip], [track], 5, id => id === 'live-1')).toBe(true);
    expect(hasActiveContinuousRenderClip([clip], [track], 5, () => false)).toBe(false);
    expect(hasActiveContinuousRenderClip([clip], [{ ...track, visible: false }], 5, () => true)).toBe(false);
    expect(hasActiveContinuousRenderClip([clip], [track], 12, () => true)).toBe(false);
  });

  it('keeps runtime handles out of the clip and restricts feedback to its own composition', () => {
    const camera = liveItem({ kind: 'video-device', deviceId: 'camera-2' });
    const clip = createLiveInputTimelineClip({ item: camera, trackId: 'video-1', startTime: 4, id: 'clip-live-1' });

    expect(clip?.source).toMatchObject({ type: 'video', liveInputId: 'live-1', mediaFileId: 'live-1' });
    expect(clip?.source).not.toHaveProperty('videoElement');

    const feedback = liveItem({ kind: 'composition-feedback', compositionId: 'comp-a' });
    expect(canPlaceLiveInputInActiveComposition(feedback, 'comp-a')).toBe(true);
    expect(canPlaceLiveInputInActiveComposition(feedback, 'comp-b')).toBe(false);
  });

  it('restores the saved 2D/3D mode of a live-input clip', () => {
    const sourceClip = createLiveInputTimelineClip({
      item: liveItem({ kind: 'video-device', deviceId: 'camera-2' }),
      trackId: 'video-1',
      startTime: 0,
      id: 'clip-live-3d',
    })!;
    const serializedClip = {
      id: sourceClip.id,
      trackId: sourceClip.trackId,
      name: sourceClip.name,
      mediaFileId: sourceClip.mediaFileId,
      liveInputId: sourceClip.source?.liveInputId,
      sourceType: 'video',
      startTime: sourceClip.startTime,
      duration: sourceClip.duration,
      inPoint: sourceClip.inPoint,
      outPoint: sourceClip.outPoint,
      transform: sourceClip.transform,
      effects: [],
      is3D: true,
    } as SerializableClip;

    expect(createLoadStateLiveInputClip(serializedClip)).toMatchObject({
      id: sourceClip.id,
      is3D: true,
      source: { liveInputId: 'live-1' },
    });
    expect(createLoadStateLiveInputClip({
      ...serializedClip,
      is3D: false,
    })).toMatchObject({ is3D: false });
  });

  it('preserves the runtime ID through clipboard, history, and nested restore data', () => {
    const item = liveItem({ kind: 'video-device', deviceId: 'camera-2' });
    const clip = createLiveInputTimelineClip({ item, trackId: 'video-1', startTime: 0, id: 'clip-live-1' })!;
    const clipboardData: ClipboardClipData = {
      id: clip.id,
      trackId: clip.trackId,
      trackType: 'video',
      name: clip.name,
      mediaFileId: item.id,
      liveInputId: item.id,
      startTime: 0,
      duration: clip.duration,
      inPoint: 0,
      outPoint: clip.duration,
      sourceType: 'video',
      transform: clip.transform,
      effects: [],
    };

    expect(clipRequiresAsyncMediaLoad(clipboardData)).toBe(false);
    expect(canPasteLiveInputInComposition(
      clipboardData,
      { kind: 'composition-feedback', compositionId: 'comp-a' },
      'comp-b',
    )).toBe(false);
    expect(createPastedClipSource(clipboardData, undefined)).toMatchObject({ liveInputId: item.id });
    expect(toHistoryTimelineClipEditState(clip)).toMatchObject({
      liveInputId: item.id,
      runtimeRef: { liveInputId: item.id },
    });
    expect(createDataOnlyRestoredVideoSource({
      mediaFileId: item.id,
      liveInputId: item.id,
      naturalDuration: clip.duration,
    }, clip.duration)).toMatchObject({ liveInputId: item.id });

    const history = createHistoryTimelineEditState({
      id: 'history-1',
      label: 'live input edit',
      timestamp: 1,
      tracks: [],
      clips: [clip],
      selectedClipIds: [clip.id],
      zoom: 1,
      scrollX: 0,
    });
    const restored = createHistoryTimelineRestoreState(history);
    expect(restored.state.clips[0]).toMatchObject({
      needsReload: undefined,
      source: { liveInputId: item.id },
    });
    expect(restored.diagnostics.deferredRuntimeClipIds).not.toContain(clip.id);
    expect(clipTreeContainsLiveInput({
      ...clip,
      id: 'nested-parent',
      source: null,
      nestedClips: [clip],
    })).toBe(true);
    expect(clipTreeNeedsLiveVideoElement({
      ...clip,
      source: null,
      nestedClips: [{ ...clip, freeRun: true, source: { type: 'video' } }],
    })).toBe(true);
  });

  it('collects only live inputs that are used across active and stored timelines', () => {
    const activeClip = createLiveInputTimelineClip({
      item: liveItem({ kind: 'display' }),
      trackId: 'video-1',
      startTime: 0,
      id: 'clip-live-active',
    })!;
    const ids = collectUsedLiveInputIds(
      [activeClip],
      [{
        timelineData: {
          tracks: [],
          clips: [{
            id: 'clip-live-stored',
            trackId: 'video-1',
            name: 'Stored live input',
            mediaFileId: 'live-2',
            liveInputId: 'live-2',
            startTime: 0,
            duration: 5,
            inPoint: 0,
            outPoint: 5,
            sourceType: 'video',
            transform: activeClip.transform,
            effects: [],
          }],
          playheadPosition: 0,
          duration: 5,
          zoom: 1,
          scrollX: 0,
          inPoint: null,
          outPoint: null,
          loopPlayback: false,
        },
      }],
    );

    expect(ids.toSorted()).toEqual(['live-1', 'live-2']);
  });

  it('detects when a shared item cannot be rebound to composition feedback', () => {
    const clip = createLiveInputTimelineClip({
      item: liveItem({ kind: 'display' }),
      trackId: 'video-1',
      startTime: 0,
      id: 'clip-live-shared',
    })!;
    const storedClip = {
      id: 'clip-live-other',
      trackId: 'video-1',
      name: 'Shared input',
      mediaFileId: 'live-1',
      liveInputId: 'live-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      sourceType: 'video' as const,
      transform: clip.transform,
      effects: [],
    };

    expect(isLiveInputUsedOutsideComposition('live-1', 'comp-a', 'comp-a', [clip], [{
      id: 'comp-b',
      timelineData: {
        tracks: [], clips: [storedClip], playheadPosition: 0, duration: 5, zoom: 1, scrollX: 0,
        inPoint: null, outPoint: null, loopPlayback: false,
      },
    }])).toBe(true);
    expect(isLiveInputUsedOutsideComposition('live-1', 'comp-a', 'comp-a', [clip], [])).toBe(false);
  });
});
