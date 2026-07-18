import { describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../stores/mediaStore';
import type { ClipboardClipData } from '../../stores/timeline/types';
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
import { requestRenderForVideoFrames } from '../mediaRuntime/liveInputRuntime';

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

  it('keeps runtime handles out of the clip and restricts feedback to its own composition', () => {
    const camera = liveItem({ kind: 'video-device', deviceId: 'camera-2' });
    const clip = createLiveInputTimelineClip({ item: camera, trackId: 'video-1', startTime: 4, id: 'clip-live-1' });

    expect(clip?.source).toMatchObject({ type: 'video', liveInputId: 'live-1', mediaFileId: 'live-1' });
    expect(clip?.source).not.toHaveProperty('videoElement');

    const feedback = liveItem({ kind: 'composition-feedback', compositionId: 'comp-a' });
    expect(canPlaceLiveInputInActiveComposition(feedback, 'comp-a')).toBe(true);
    expect(canPlaceLiveInputInActiveComposition(feedback, 'comp-b')).toBe(false);
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
