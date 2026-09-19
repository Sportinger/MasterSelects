import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCameraTrackFromSolve,
  stabilizeSourceClipFromSolve,
} from '../../src/services/photogrammetry/cameraSolveTimelineOutputs';
import type { CameraSolveDataset } from '../../src/services/photogrammetry/cameraSolvingContract';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();
const SOURCE_CLIP_ID = 'camera-solve-source';

function quaternionY(degrees: number): [number, number, number, number] {
  const half = degrees * Math.PI / 360;
  return [Math.cos(half), 0, Math.sin(half), 0];
}

function solvedDataset(): CameraSolveDataset {
  const angles = [0, 5, -5, 0];
  const imageLines = angles.flatMap((angle, index) => {
    const [w, x, y, z] = quaternionY(angle);
    return [
      `${index + 1} ${w} ${x} ${y} ${z} ${-index} 0 0 1 frame-${index + 1}.jpg`,
      '',
    ];
  });
  return {
    id: 'solve-output-test',
    createdAt: 1,
    files: [],
    model: {
      datasetName: 'test-solve',
      registeredSourceIndices: [0, 1, 2, 3],
      camerasText: '1 SIMPLE_PINHOLE 1920 1080 1000 960 540\n',
      imagesText: imageLines.join('\n'),
      pointsText: '',
    },
    source: {
      sourceClipId: SOURCE_CLIP_ID,
      sourceClipName: 'Orbit source',
      clipStartTime: 5,
      clipDuration: 3,
      sampleTimes: [0, 1, 2, 3],
    },
  };
}

function sourceClip(): TimelineClip {
  return {
    id: SOURCE_CLIP_ID,
    trackId: 'video-1',
    name: 'Orbit source',
    file: new File([], 'orbit.mp4', { type: 'video/mp4' }),
    startTime: 5,
    duration: 3,
    inPoint: 0,
    outPoint: 3,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
  };
}

function initializeHistory(): void {
  setHistoryCallbacks({
    flushPendingCapture: () => undefined,
    suppressCaptures: () => undefined,
  });
  initHistoryStoreRefs({
    timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: useMediaStore.setState },
    dock: { getState: () => ({ layout: null }), setState: () => undefined },
  });
}

describe('camera solve timeline outputs', () => {
  beforeEach(() => {
    setHistoryDisabledForDebug(false);
    initializeHistory();
    getHistoryStateView().clearHistory();
    useTimelineStore.setState({
      ...initialTimelineState,
      tracks: [{
        id: 'video-1',
        name: 'Video 1',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      }],
      clips: [sourceClip()],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
    });
    useMediaStore.setState({
      ...initialMediaState,
      activeCompositionId: 'comp-1',
      compositions: [{ id: 'comp-1', width: 1920, height: 1080 } as never],
    });
  });

  afterEach(() => {
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  it('creates an undoable 3D camera clip with six keys per pose', () => {
    const created = createCameraTrackFromSolve(solvedDataset());
    const state = useTimelineStore.getState();
    const camera = state.clips.find((clip) => clip.id === created.clipId);

    expect(created).toMatchObject({ poseCount: 4, keyframeCount: 24 });
    expect(camera?.source?.type).toBe('camera');
    expect(camera?.startTime).toBe(5);
    expect(camera?.source?.cameraSettings?.resolutionWidth).toBe(1920);
    expect(state.getClipKeyframes(created.clipId)).toHaveLength(24);
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    useHistoryStore.getState().undo();
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === created.clipId)).toBe(false);
  });

  it('adds bounded, undoable stabilization transform keys to the source clip', () => {
    const created = stabilizeSourceClipFromSolve(solvedDataset(), 75);
    const keyframes = useTimelineStore.getState().getClipKeyframes(SOURCE_CLIP_ID);
    const positionValues = keyframes
      .filter((keyframe) => keyframe.property === 'position.x' || keyframe.property === 'position.y')
      .map((keyframe) => Math.abs(keyframe.value as number));

    expect(created).toMatchObject({ poseCount: 4, keyframeCount: 16 });
    expect(keyframes).toHaveLength(16);
    expect(Math.max(...positionValues)).toBeLessThan(1);
    expect(keyframes.filter((keyframe) => keyframe.property === 'scale.all').every((keyframe) => keyframe.value >= 1.02)).toBe(true);
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    useHistoryStore.getState().undo();
    expect(useTimelineStore.getState().getClipKeyframes(SOURCE_CLIP_ID)).toHaveLength(0);
  });
});
