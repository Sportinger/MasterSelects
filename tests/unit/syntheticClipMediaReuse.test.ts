import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTimelineExternalDropCommand } from '../../src/services/timeline/timelineExternalDropCommandExecutor';
import { runTimelinePlacementCommand } from '../../src/services/timelinePlacementCommands';
import { DEFAULT_TRACKS, useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { CameraItem, MeshItem, TextItem } from '../../src/stores/mediaStore/types';
import { playheadState } from '../../src/services/layerBuilder/PlayheadState';
import * as canvasRuntime from '../../src/services/timeline/timelineGeneratedCanvasRuntime';

const text: TextItem = {
  id: 'saved-text', name: 'Opening title', type: 'text', parentId: null, createdAt: 1,
  text: 'A saved title\nSecond line', fontFamily: 'Roboto', fontSize: 94, color: '#12ab34', duration: 7,
};
const mesh: MeshItem = {
  id: 'saved-mesh', name: 'Blue sphere', type: 'model', parentId: null, createdAt: 1,
  meshType: 'sphere', color: '#1299ff', duration: 8,
};
const camera: CameraItem = {
  id: 'saved-camera', name: 'Portrait camera', type: 'camera', parentId: null, createdAt: 1, duration: 9,
  cameraSettings: { fov: 35, near: 0.5, far: 600, resolutionWidth: 1080, resolutionHeight: 1920 },
};

describe('synthetic clips reused from existing media items', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.restoreAllMocks();
    playheadState.isUsingInternalPosition = false;
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS, clips: [], selectedClipIds: new Set(), primarySelectedClipId: null,
      clipKeyframes: new Map(), clipboardData: null, timelineRangeSelection: null,
      playheadPosition: 4, duration: 60, isExporting: false, targetTrackIdByType: { video: 'video-1' },
    });
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [], compositions: [], activeCompositionId: null, folders: [], selectedIds: [],
      textItems: [text], meshItems: [mesh], cameraItems: [camera], solidItems: [], lightItems: [],
      splatEffectorItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [],
      sourceMonitorFileId: null, sourceMonitorInPoint: null, sourceMonitorOutPoint: null,
    } as unknown as ReturnType<typeof useMediaStore.getState>);
  });

  for (const route of ['drop', 'placement'] as const) {
    it.each([
      { kind: 'text' as const, item: text },
      { kind: 'mesh' as const, item: mesh },
      { kind: 'camera' as const, item: camera },
    ])(`preserves saved $kind content, settings and source identity through ${route}`, async ({ kind, item }) => {
      const savedItem = structuredClone(item);
      if (route === 'drop') {
        const result = await executeTimelineExternalDropCommand({
          actions: useTimelineStore.getState(), command: { kind, itemId: item.id },
          isAudioOnlyMediaFile: () => false, isVideoTrack: true, mediaFilePolicy: 'strict-track-type',
          resolveStartTime: () => 4, trackId: 'video-1',
        });
        expect(result).toEqual({ handled: true });
      } else {
        vi.mocked(useMediaStore.getState).mockReturnValue({ ...useMediaStore.getState(), selectedIds: [item.id] });
        expect((await runTimelinePlacementCommand('insert')).success).toBe(true);
      }
      const clips = useTimelineStore.getState().clips;
      expect(clips).toHaveLength(1);
      const clip = clips[0];
      expect(clip).toMatchObject({ name: item.name, mediaFileId: item.id, duration: item.duration, startTime: 4 });
      expect(clip.source?.mediaFileId).toBe(item.id);
      if (kind === 'text') {
        expect(clip.textProperties).toMatchObject({ text: text.text, fontFamily: text.fontFamily, fontSize: text.fontSize, color: text.color });
        expect(clip.source?.textCanvas).toBeInstanceOf(HTMLCanvasElement);
      } else if (kind === 'mesh') {
        expect(clip.source).toMatchObject({ meshType: mesh.meshType, modelMaterialSettings: { overrideBaseColor: true, baseColor: mesh.color } });
      } else {
        expect(clip.source?.cameraSettings).toEqual(camera.cameraSettings);
        expect(clip.source?.cameraSettings).not.toBe(camera.cameraSettings);
      }
      expect(item).toEqual(savedItem);
    });
  }

  it('retains both saved text items when canvas initialization completes out of order', async () => {
    const other = { ...text, id: 'second-text', text: 'Second saved title' };
    let finishFirst!: (runtime: canvasRuntime.TimelineTextCanvasRuntime) => void;
    let finishSecond!: (runtime: canvasRuntime.TimelineTextCanvasRuntime) => void;
    const firstRuntime = new Promise<canvasRuntime.TimelineTextCanvasRuntime>(resolve => { finishFirst = resolve; });
    const secondRuntime = new Promise<canvasRuntime.TimelineTextCanvasRuntime>(resolve => { finishSecond = resolve; });
    // The route tests above cover real canvas creation. Control this boundary
    // explicitly to test a slower first font load without depending on the
    // test runner's concurrent dynamic-module initialization order.
    const createRuntime = vi.spyOn(canvasRuntime, 'createTimelineTextCanvasRuntime')
      .mockImplementationOnce(() => firstRuntime)
      .mockImplementationOnce(() => secondRuntime);
    const state = useTimelineStore.getState();
    const firstAdd = state.addTextClip('video-1', 0, 3, true, text);
    const secondAdd = state.addTextClip('video-1', 5, 3, true, other);
    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(useTimelineStore.getState().clips).toHaveLength(0);

    finishSecond({ canvas: document.createElement('canvas'), textProperties: structuredClone(createRuntime.mock.calls[1][0].textProperties) });
    await secondAdd;
    expect(useTimelineStore.getState().clips.map(clip => clip.mediaFileId)).toEqual([other.id]);

    finishFirst({ canvas: document.createElement('canvas'), textProperties: structuredClone(createRuntime.mock.calls[0][0].textProperties) });
    await firstAdd;
    expect(useTimelineStore.getState().clips.map(clip => [clip.mediaFileId, clip.textProperties?.text])).toEqual([
      [other.id, other.text], [text.id, text.text],
    ]);
  });
});
