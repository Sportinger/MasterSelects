import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveCurrentTimelinePlacementSource,
  resolveTimelinePlacementCommandPreview,
  runTimelinePlacementCommand,
  showTimelinePlacementCommandPreview,
} from '../../src/services/timelinePlacementCommands';
import { NativeHelperClient } from '../../src/services/nativeHelper/NativeHelperClient';
import {
  getPrimaryMediaObjectUrlKey,
  mediaObjectUrlManager,
  revokeAllMediaObjectUrls,
} from '../../src/services/project/mediaObjectUrlManager';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const mockedGetMediaState = useMediaStore.getState as unknown as ReturnType<typeof vi.fn>;
const mockedSetMediaState = useMediaStore.setState as unknown as ReturnType<typeof vi.fn>;

function setMediaState(overrides: Record<string, unknown> = {}): void {
  mockedGetMediaState.mockReturnValue({
    files: [],
    compositions: [],
    textItems: [],
    solidItems: [],
    meshItems: [],
    cameraItems: [],
    splatEffectorItems: [],
    mathSceneItems: [],
    motionShapeItems: [],
    signalAssets: [],
    sourceMonitorFileId: null,
    sourceMonitorInPoint: null,
    sourceMonitorOutPoint: null,
    selectedIds: [],
    getActiveComposition: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
    getOrCreateTextFolder: vi.fn().mockReturnValue('text-folder-1'),
    createTextItem: vi.fn(),
    getOrCreateSolidFolder: vi.fn().mockReturnValue('solid-folder-1'),
    createSolidItem: vi.fn(),
    ...overrides,
  });
}

function selectSolidSource(duration = 3): void {
  setMediaState({
    solidItems: [{
      id: 'solid-source',
      name: 'Red Solid',
      type: 'solid',
      parentId: null,
      createdAt: 1,
      color: '#ff0000',
      width: 1920,
      height: 1080,
      duration,
    }],
    selectedIds: ['solid-source'],
  });
}

describe('timeline placement commands', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        createMockTrack({ id: 'video-1', type: 'video' }),
        createMockTrack({ id: 'audio-1', type: 'audio' }),
      ],
      clips: [],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      timelineRangeSelection: null,
      playheadPosition: 0,
      isExporting: false,
      duration: 60,
    });
    setMediaState();
    mockedSetMediaState.mockClear();
    revokeAllMediaObjectUrls();
    vi.restoreAllMocks();
  });

  it('inserts the selected media-panel source at the playhead and ripples existing clips', async () => {
    selectSolidSource(3);
    useTimelineStore.setState({
      playheadPosition: 5,
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 12, duration: 2, inPoint: 0, outPoint: 2 }),
      ],
    });

    const result = await runTimelinePlacementCommand('insert');
    const created = useTimelineStore.getState().clips.find((clip) => clip.id === result.createdClipId);
    const clips = useTimelineStore.getState().clips
      .filter((clip) => clip.trackId === 'video-1')
      .toSorted((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));

    expect(result.success).toBe(true);
    expect(created?.source?.type).toBe('solid');
    expect(created?.startTime).toBe(5);
    expect(created?.duration).toBe(3);
    expect(clips.map((clip) => [clip.startTime, clip.duration])).toEqual([
      [0, 5],
      [5, 3],
      [8, 5],
      [15, 2],
    ]);
  });

  it('fits the selected source into the selected target clip duration', async () => {
    selectSolidSource(3);
    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'target', trackId: 'video-1', startTime: 4, duration: 6, inPoint: 0, outPoint: 6 }),
      ],
      selectedClipIds: new Set(['target']),
      primarySelectedClipId: 'target',
    });

    const result = await runTimelinePlacementCommand('fit-to-fill');
    const created = useTimelineStore.getState().clips.find((clip) => clip.id === result.createdClipId);

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === 'target')).toBe(false);
    expect(created?.startTime).toBe(4);
    expect(created?.duration).toBe(6);
    expect(created?.outPoint).toBe(3);
    expect(created?.speed).toBeCloseTo(0.5);
  });

  it('uses Source Monitor In/Out as the placement source duration', () => {
    setMediaState({
      files: [{
        id: 'video-source',
        name: 'Source.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        file: new File(['video'], 'Source.mp4', { type: 'video/mp4' }),
        url: 'blob:source',
        duration: 12,
        hasAudio: false,
      }],
      sourceMonitorFileId: 'video-source',
      sourceMonitorInPoint: 2,
      sourceMonitorOutPoint: 7,
    });

    const source = resolveCurrentTimelinePlacementSource() as { duration?: number; sourceInPoint?: number; naturalDuration?: number } | null;

    expect(source?.duration).toBe(5);
    expect(source?.sourceInPoint).toBe(2);
    expect(source?.naturalDuration).toBe(12);
  });

  it('stores NativeHelper-resolved placement files under the managed primary media URL key', async () => {
    const resolvedFile = new File(['image'], 'Resolved.png', { type: 'image/png' });
    const nativeClient = NativeHelperClient as unknown as {
      parseFileReferenceUrl: ReturnType<typeof vi.fn>;
      getReferencedFile: ReturnType<typeof vi.fn>;
    };
    nativeClient.parseFileReferenceUrl = vi.fn().mockReturnValue('C:/Images/Resolved.png');
    nativeClient.getReferencedFile = vi.fn().mockResolvedValue(resolvedFile);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:managed-placement-source');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    setMediaState({
      files: [{
        id: 'native-video-source',
        name: 'Resolved.png',
        type: 'image',
        parentId: null,
        createdAt: 1,
        url: 'native-helper-file://C:/Images/Resolved.png',
        duration: 12,
        hasAudio: false,
      }],
      selectedIds: ['native-video-source'],
    });
    const addClip = vi.fn(async (
      trackId: string,
      file: File,
      startTime: number,
      duration: number,
      mediaFileId?: string,
      _mediaTypeOverride?: string,
      options?: { source?: { naturalDuration?: number } },
    ) => {
      const clipId = 'placed-native-source';
      useTimelineStore.setState((state) => ({
        clips: [
          ...state.clips,
          createMockClip({
            id: clipId,
            trackId,
            file,
            mediaFileId,
            startTime,
            duration,
            inPoint: 0,
            outPoint: duration,
            source: options?.source ?? null,
          }),
        ],
      }));
      return clipId;
    });
    type AddClip = ReturnType<typeof useTimelineStore.getState>['addClip'];
    useTimelineStore.setState({ addClip: addClip as unknown as AddClip });

    const result = await runTimelinePlacementCommand('overwrite');
    const created = useTimelineStore.getState().clips.find((clip) => clip.id === result.createdClipId);
    const mediaPatch = mockedSetMediaState.mock.calls.at(-1)?.[0] as ((state: { files: unknown[] }) => { files: unknown[] }) | undefined;
    const nextMediaState = mediaPatch?.({
      files: useMediaStore.getState().files,
    }) as { files: Array<{ id: string; file?: File; url?: string; hasFileHandle?: boolean; absolutePath?: string }> } | undefined;

    expect(result.success).toBe(true);
    expect(nativeClient.getReferencedFile).toHaveBeenCalledWith('native-helper-file://C:/Images/Resolved.png', 'Resolved.png');
    expect(created?.mediaFileId).toBe('native-video-source');
    expect(created?.file).toBe(resolvedFile);
    expect(mediaObjectUrlManager.get('native-video-source', getPrimaryMediaObjectUrlKey())).toBe('blob:managed-placement-source');
    expect(nextMediaState?.files[0]).toMatchObject({
      id: 'native-video-source',
      file: resolvedFile,
      url: 'blob:managed-placement-source',
      hasFileHandle: true,
      absolutePath: 'C:/Images/Resolved.png',
    });
  });

  it('builds a non-mutating placement ghost preview from the current source', () => {
    selectSolidSource(3);
    useTimelineStore.setState({
      playheadPosition: 5,
    });

    const preview = resolveTimelinePlacementCommandPreview('overwrite');

    expect(preview).toMatchObject({
      toolId: 'overwrite',
      plane: 'section-scrolled',
      trackId: 'video-1',
      trackIds: ['video-1'],
      startTime: 5,
      endTime: 8,
      sourceInPoint: 0,
      sourceOutPoint: 3,
      label: 'Red Solid',
    });
    expect(useTimelineStore.getState().clips).toEqual([]);
  });

  it('can publish placement preview state without committing a placement command', () => {
    selectSolidSource(4);
    useTimelineStore.setState({
      playheadPosition: 2,
    });

    const preview = showTimelinePlacementCommandPreview('insert');

    expect(preview?.startTime).toBe(2);
    expect(useTimelineStore.getState().timelineToolPreview).toMatchObject({
      toolId: 'insert',
      startTime: 2,
      endTime: 6,
      label: 'Red Solid',
    });
    expect(useTimelineStore.getState().clips).toEqual([]);
  });
});
