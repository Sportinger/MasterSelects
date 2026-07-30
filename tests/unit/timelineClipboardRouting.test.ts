import { act, cleanup, renderHook } from '@testing-library/react';
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
    const analysis = {
      frames: [{
        timestamp: 1,
        motion: 0.2,
        globalMotion: 0.1,
        localMotion: 0.3,
        focus: 0.8,
        brightness: 0.5,
        faceCount: 0,
      }],
      sampleInterval: 500,
    };
    const clip = createMockClip({
      id: 'clip-1',
      mediaFileId: 'media-1',
      source: { type: 'video', mediaFileId: 'media-1', naturalDuration: 5 },
      analysis,
      analysisStatus: 'ready',
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
    expect(useTimelineStore.getState().clipboardData?.[0].analysis).toBe(analysis);
    expect(useTimelineStore.getState().clipboardData?.[0].analysisStatus).toBe('ready');
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

  it('pastes copied clips into another timeline after the selection is cleared', async () => {
    const clip = createMockClip({
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 3,
    });
    useTimelineStore.setState({
      clips: [clip],
      selectedClipIds: new Set(['clip-1']),
    });
    useTimelineStore.getState().copyClips();

    await useTimelineStore.getState().loadState({
      tracks: [{
        id: 'video-target',
        name: 'Video Target',
        type: 'video',
        height: 60,
        muted: false,
        visible: true,
        solo: false,
      }],
      clips: [],
      playheadPosition: 12,
      duration: 60,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    });

    expect(useTimelineStore.getState().selectedClipIds).toEqual(new Set());
    expect(useTimelineStore.getState().clipboardData).toHaveLength(1);

    useTimelineStore.getState().pasteClips();

    expect(useTimelineStore.getState().clips).toHaveLength(1);
    expect(useTimelineStore.getState().clips[0]).toMatchObject({
      trackId: 'video-target',
      startTime: 12,
      name: clip.name,
    });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(
      new Set([useTimelineStore.getState().clips[0].id]),
    );
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

  it('does not let media panel capture paste when copied timeline clips remain after selection clears', () => {
    const pasteMediaItems = vi.fn(() => []);
    const clip = createMockClip({ id: 'clip-1' });
    useTimelineStore.setState({
      clips: [clip],
      selectedClipIds: new Set(['clip-1']),
    });
    useTimelineStore.getState().copyClips();
    useTimelineStore.setState({
      selectedClipIds: new Set(),
      selectedKeyframeIds: new Set(),
    });

    const { result } = renderHook(() => useMediaPanelSelectionCommands({
      addToSelection: vi.fn(),
      closeContextMenu: vi.fn(),
      contextMenu: null,
      createComposition: vi.fn(),
      copyMediaItems: vi.fn(),
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
      pasteMediaItems,
      reloadFile: vi.fn(),
      removeFromSelection: vi.fn(),
      selectedIds: [],
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
      hasMediaClipboard: () => true,
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

    const pasteEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'v',
    });
    document.dispatchEvent(pasteEvent);

    expect(pasteEvent.defaultPrevented).toBe(false);
    expect(pasteMediaItems).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().clipboardData).toHaveLength(1);
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

  it('waits for the composition switch before adding media to a new comp', async () => {
    let finishCompositionSwitch!: () => void;
    const switchPromise = new Promise<void>((resolve) => {
      finishCompositionSwitch = resolve;
    });
    const openCompositionTab = vi.fn(() => switchPromise);
    const updateComposition = vi.fn();
    const closeContextMenu = vi.fn();
    const timelineState = useTimelineStore.getState();
    const addClip = vi.spyOn(timelineState, 'addClip').mockResolvedValue('clip-1');
    const setDuration = vi.spyOn(timelineState, 'setDuration').mockImplementation(() => undefined);
    vi.spyOn(timelineState, 'getSerializableState').mockReturnValue({
      tracks: DEFAULT_TRACKS,
      clips: [],
      playheadPosition: 0,
      duration: 4321.23356,
      durationLocked: true,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    });
    const composition = {
      id: 'comp-long-video',
      name: 'Long video Comp',
      type: 'composition' as const,
      parentId: null,
      createdAt: 1,
      width: 854,
      height: 480,
      frameRate: 25,
      duration: 4321.23356,
      backgroundColor: '#000000',
      timelineData: {
        tracks: DEFAULT_TRACKS,
        clips: [],
        playheadPosition: 0,
        duration: 4321.23356,
        durationLocked: true,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
      },
    };
    const mediaFile = {
      createdAt: 1,
      duration: 4321.23356,
      file: new File(['video'], 'long-video.mp4', { type: 'video/mp4' }),
      fps: 25,
      height: 480,
      id: 'media-long-video',
      name: 'long-video.mp4',
      parentId: null,
      type: 'video' as const,
      url: 'blob:long-video',
      width: 854,
    };
    const { result } = renderHook(() => useMediaPanelSelectionCommands({
      addToSelection: vi.fn(),
      closeContextMenu,
      contextMenu: null,
      createComposition: vi.fn(() => composition),
      copyMediaItems: vi.fn(),
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
      openCompositionTab,
      pasteMediaItems: vi.fn(() => []),
      reloadFile: vi.fn(),
      removeFromSelection: vi.fn(),
      selectedIds: ['media-long-video'],
      setContextMenu: vi.fn(),
      setGenerativeTrayExpanded: vi.fn(),
      setGridFolderId: vi.fn(),
      setSelectedMediaBoardAnnotationId: vi.fn(),
      setSelection: vi.fn(),
      setSourceMonitorFile: vi.fn(),
      toggleFolderExpanded: vi.fn(),
      updateAiReferenceMediaFileIds: vi.fn(),
      updateComposition,
      viewMode: 'classic',
      hasMediaClipboard: () => false,
    }));

    let createPromise!: Promise<void>;
    await act(async () => {
      createPromise = result.current.handleCreateCompositionFromMedia(mediaFile);
      await Promise.resolve();
    });

    expect(openCompositionTab).toHaveBeenCalledWith('comp-long-video', { skipAnimation: true });
    expect(addClip).not.toHaveBeenCalled();

    await act(async () => {
      finishCompositionSwitch();
      await createPromise;
    });

    expect(addClip).toHaveBeenCalledWith(
      expect.any(String),
      mediaFile.file,
      0,
      4321.23356,
      'media-long-video',
      'video',
    );
    expect(setDuration).toHaveBeenCalledWith(4321.23356);
    expect(updateComposition).toHaveBeenCalledWith(
      'comp-long-video',
      expect.objectContaining({ duration: 4321.23356 }),
    );
    expect(closeContextMenu).toHaveBeenCalled();
  });
});
