import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRACKS, useTimelineStore } from '../../src/stores/timeline';
import {
  getMediaCompositionSettings,
  useMediaPanelSelectionCommands,
} from '../../src/components/panels/media/panel/useMediaPanelSelectionCommands';
import type { MediaFile } from '../../src/stores/mediaStore';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';

describe('timeline clipboard routing', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS,
      clips: [],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(),
      selectedKeyframeIds: new Set(),
      primarySelectedClipId: null,
      clipboardData: null,
      clipboardKeyframes: null,
      playheadPosition: 0,
      duration: 60,
      targetTrackIdByType: {},
    });
  });

  it('clears stale keyframes when copying clips', () => {
    const clip = createMockClip({
      id: 'clip-1',
      mediaFileId: 'media-1',
      source: { type: 'video', mediaFileId: 'media-1', naturalDuration: 5 },
    });

    useTimelineStore.setState({
      clips: [clip],
      selectedClipIds: new Set(['clip-1']),
      clipboardKeyframes: [{
        clipId: 'old-clip',
        easing: 'linear',
        property: 'opacity',
        time: 0,
        value: 1,
      }],
    });

    useTimelineStore.getState().copyClips();

    expect(useTimelineStore.getState().clipboardData).toHaveLength(1);
    expect(useTimelineStore.getState().clipboardKeyframes).toBeNull();
  });

  it('clears stale clips when copying keyframes', () => {
    const keyframe = createMockKeyframe({ id: 'kf-1', clipId: 'clip-1' });

    useTimelineStore.setState({
      clipKeyframes: new Map([['clip-1', [keyframe]]]),
      selectedKeyframeIds: new Set(['kf-1']),
      clipboardData: [{
        id: 'old-clip',
        trackId: 'video-1',
        trackType: 'video',
        name: 'Old Clip',
        startTime: 0,
        duration: 5,
        inPoint: 0,
        outPoint: 5,
        sourceType: 'video',
        transform: createMockClip().transform,
        effects: [],
      }],
    });

    useTimelineStore.getState().copyKeyframes();

    expect(useTimelineStore.getState().clipboardKeyframes).toHaveLength(1);
    expect(useTimelineStore.getState().clipboardData).toBeNull();
  });

  it('does not let media panel capture copy while a timeline clip is selected', () => {
    const copyMediaItems = vi.fn();
    const clip = createMockClip({ id: 'clip-1' });
    useTimelineStore.setState({
      clips: [clip],
      selectedClipIds: new Set(['clip-1']),
    });

    const { result } = renderHook(() => useMediaPanelSelectionCommands({
      addToSelection: vi.fn(),
      closeContextMenu: vi.fn(),
      contextMenu: null,
      createComposition: vi.fn(),
      copyMediaItems,
      createFolder: vi.fn(),
      duplicateMediaItems: vi.fn(),
      ensureFileThumbnail: vi.fn(),
      folders: [],
      generateAudioProxy: vi.fn(),
      generateMediaSpectrogram: vi.fn(),
      generateMediaWaveform: vi.fn(),
      getActiveParentId: () => null,
      getAiReferenceMediaFileIds: () => [],
      handleDelete: vi.fn(),
      importFiles: vi.fn(),
      importFilesWithHandles: vi.fn(),
      openCompositionTab: vi.fn(),
      pasteMediaItems: vi.fn(),
      reloadFile: vi.fn(),
      removeFromSelection: vi.fn(),
      selectedIds: ['media-1'],
      setContextMenu: vi.fn(),
      setGenerativeTrayExpanded: vi.fn(),
      setGridFolderId: vi.fn(),
      setSelectedMediaBoardAnnotationId: vi.fn(),
      setSelection: vi.fn(),
      setSourceMonitorFile: vi.fn(),
      toggleFolderExpanded: vi.fn(),
      updateAiReferenceMediaFileIds: vi.fn(),
      updateComposition: vi.fn(),
      viewMode: 'classic',
      hasMediaClipboard: () => false,
    }));

    const root = document.createElement('div');
    root.getBoundingClientRect = () => ({
      bottom: 10000,
      height: 10000,
      left: 0,
      right: 10000,
      toJSON: () => ({}),
      top: 0,
      width: 10000,
      x: 0,
      y: 0,
    });
    result.current.mediaPanelRootRef.current = root;

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'c',
    }));

    expect(copyMediaItems).not.toHaveBeenCalled();
  });

  it('derives create-comp settings from media dimensions and duration', () => {
    expect(getMediaCompositionSettings({
      createdAt: 1,
      duration: 12.5,
      fps: 23.976,
      height: 2160,
      id: 'media-1',
      name: 'shot.mp4',
      parentId: null,
      type: 'video',
      url: 'blob:shot',
      width: 3840,
    } as MediaFile)).toEqual({
      duration: 12.5,
      frameRate: 24,
      height: 2160,
      width: 3840,
    });
  });
});
