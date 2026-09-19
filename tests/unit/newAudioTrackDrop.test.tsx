import { act, renderHook } from '@testing-library/react';
import type { DragEvent as ReactDragEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useExternalDrop } from '../../src/components/timeline/hooks/useExternalDrop';
import { useMediaStore, type MediaFile } from '../../src/stores/mediaStore';

describe('audio drop into a new timeline layer', () => {
  it('creates an audio track and places the dropped audio at the pointer time', async () => {
    const file = new File(['audio'], 'music.wav', { type: 'audio/wav' });
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...useMediaStore.getState(),
      files: [{ id: 'audio-file', name: 'music.wav', type: 'audio', file, duration: 12 } as MediaFile],
    });
    const timeline = document.createElement('div');
    timeline.getBoundingClientRect = () => ({ left: 100 } as DOMRect);
    const addTrack = vi.fn(() => 'new-audio-track');
    const addClip = vi.fn();
    const { result, unmount } = renderHook(() => useExternalDrop({
      timelineRef: { current: timeline }, scrollX: 100, tracks: [], clips: [],
      isExporting: false, activeTimelineToolId: 'select', pixelToTime: pixel => pixel / 100,
      prepareTimelinePlacementRange: vi.fn(), addTrack, addClip, addCompClip: vi.fn(),
      addTextClip: vi.fn(), updateTextProperties: vi.fn(), updateClip: vi.fn(),
      addSolidClip: vi.fn(), addMeshClip: vi.fn(), addCameraClip: vi.fn(), addLightClip: vi.fn(),
      addSplatEffectorClip: vi.fn(), addMathSceneClip: vi.fn(), addMotionShapeClip: vi.fn(),
      replaceClipSource: vi.fn(), replaceClipSourceWithComposition: vi.fn(),
    }));
    const data: Record<string, string> = { 'application/x-media-file-id': 'audio-file', 'application/x-media-is-audio': 'true' };
    const event = {
      clientX: 400, clientY: 600, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      dataTransfer: { types: Object.keys(data), files: [], items: [], getData: (key: string) => data[key] ?? '', dropEffect: 'copy' },
    } as unknown as ReactDragEvent;
    await act(async () => result.current.handleNewTrackDrop(event, 'audio'));
    expect(addTrack).toHaveBeenCalledExactlyOnceWith('audio');
    expect(addClip).toHaveBeenCalledWith('new-audio-track', file, 4, 12, 'audio-file', undefined);
    unmount();
  });

  it('imports an OS audio file before placing it on a new track at the pointer time', async () => {
    const file = new File(['audio'], 'external.wav', { type: 'audio/wav' });
    const imported = { id: 'imported-audio', name: file.name, type: 'audio', file, duration: 12 } as MediaFile;
    const importFiles = vi.fn().mockResolvedValue([imported]);
    const mediaState = {
      ...useMediaStore.getState(), files: [], folders: [],
      createFolder: vi.fn(), importFiles, importFilesWithHandles: vi.fn(),
    };
    const previousSelector = vi.mocked(useMediaStore).getMockImplementation();
    vi.mocked(useMediaStore).mockImplementation(selector => selector(mediaState));
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaState);
    const timeline = document.createElement('div');
    timeline.getBoundingClientRect = () => ({ left: 100 } as DOMRect);
    const addTrack = vi.fn(() => 'new-audio-track');
    const addClip = vi.fn().mockResolvedValue('new-audio-clip');
    const { result, unmount } = renderHook(() => useExternalDrop({
      timelineRef: { current: timeline }, scrollX: 100, tracks: [], clips: [],
      isExporting: false, activeTimelineToolId: 'select', pixelToTime: pixel => pixel / 100,
      prepareTimelinePlacementRange: vi.fn(), addTrack, addClip, addCompClip: vi.fn(),
      addTextClip: vi.fn(), updateTextProperties: vi.fn(), updateClip: vi.fn(),
      addSolidClip: vi.fn(), addMeshClip: vi.fn(), addCameraClip: vi.fn(), addLightClip: vi.fn(),
      addSplatEffectorClip: vi.fn(), addMathSceneClip: vi.fn(), addMotionShapeClip: vi.fn(),
      replaceClipSource: vi.fn(), replaceClipSourceWithComposition: vi.fn(),
    }));
    const event = {
      clientX: 400, clientY: 600, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['Files'], files: [file],
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
        getData: () => '', dropEffect: 'copy',
      },
    } as unknown as ReactDragEvent;
    try {
      await act(async () => result.current.handleNewTrackDrop(event, 'audio'));
      expect(importFiles).toHaveBeenCalledExactlyOnceWith([file], null);
      expect(addTrack).toHaveBeenCalledExactlyOnceWith('audio');
      expect(addClip).toHaveBeenCalledExactlyOnceWith('new-audio-track', file, 4, 12, 'imported-audio', undefined);
    } finally {
      unmount();
      if (previousSelector) vi.mocked(useMediaStore).mockImplementation(previousSelector);
    }
  });
});
