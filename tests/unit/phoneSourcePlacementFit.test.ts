// Root change for the phone source monitor: runTimelinePlacementCommand passes an optional visual
// scale mode to addClip (the phone places with 'fit', like its media import); without it the desktop
// default (natural size) is unchanged.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runTimelinePlacementCommand } from '../../src/services/timelinePlacementCommands';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const mockedGetMediaState = useMediaStore.getState as unknown as ReturnType<typeof vi.fn>;

const videoFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

function setVideoSource(): void {
  mockedGetMediaState.mockReturnValue({
    files: [{ id: 'video-source', name: 'clip.mp4', type: 'video', parentId: null, createdAt: 1, url: 'blob:x', file: videoFile, duration: 4, hasAudio: false }],
    compositions: [], textItems: [], solidItems: [], meshItems: [], cameraItems: [], lightItems: [], splatEffectorItems: [],
    mathSceneItems: [], motionShapeItems: [], signalAssets: [],
    sourceMonitorFileId: 'video-source', sourceMonitorInPoint: null, sourceMonitorOutPoint: null, selectedIds: [],
  });
}

function captureAddClip() {
  const addClip = vi.fn(async (trackId: string, file: File, startTime: number, duration: number, mediaFileId?: string) => {
    useTimelineStore.setState((state) => ({
      clips: [...state.clips, createMockClip({ id: 'placed', trackId, file, mediaFileId, startTime, duration, inPoint: 0, outPoint: duration })],
    }));
    return 'placed';
  });
  type AddClip = ReturnType<typeof useTimelineStore.getState>['addClip'];
  useTimelineStore.setState({ addClip: addClip as unknown as AddClip });
  return addClip;
}

describe('placement command visual scale option', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' })],
      clips: [], selectedClipIds: new Set(), primarySelectedClipId: null, timelineRangeSelection: null,
      playheadPosition: 0, isExporting: false, duration: 60,
    });
    setVideoSource();
  });

  it('passes visualScaleMode fit to addClip when the caller asks for it', async () => {
    const addClip = captureAddClip();
    const result = await runTimelinePlacementCommand('append-at-end', { visualScaleMode: 'fit' });
    expect(result.success).toBe(true);
    expect(addClip.mock.calls[0][6]).toEqual({ source: { naturalDuration: 4 }, visualScaleMode: 'fit' });
  });

  it('keeps the desktop default (no scale mode) when no option is given', async () => {
    const addClip = captureAddClip();
    await runTimelinePlacementCommand('append-at-end');
    expect(addClip.mock.calls[0][6]).toEqual({ source: { naturalDuration: 4 } });
  });
});
