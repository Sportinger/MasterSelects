import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleAddKeyframe,
  handleGetKeyframes,
} from '../../src/services/aiTools/handlers/keyframes';
import {
  handleCreateMotionShapeClip,
  handleGetMotionDesign,
  handleUpdateMotionProperties,
} from '../../src/services/aiTools/handlers/motionDesign';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();
const CLIP_ID = 'sequence-clip';

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: CLIP_ID,
    trackId: 'video-1',
    name: 'Sequence clip',
    file: new File([], 'sequence.mp4'),
    startTime: 1,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}

function initializeHistory(): void {
  setHistoryCallbacks({
    flushPendingCapture: () => undefined,
    suppressCaptures: () => undefined,
  });
  initHistoryStoreRefs({
    timeline: {
      getState: useTimelineStore.getState,
      setState: useTimelineStore.setState,
    },
    media: {
      getState: useMediaStore.getState,
      setState: useMediaStore.setState,
    },
    dock: {
      getState: () => ({ layout: null }),
      setState: () => undefined,
    },
  });
}

function seedTimeline(clips: TimelineClip[] = [createClip()]): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips,
    tracks: [{
      id: 'video-1',
      name: 'Video 1',
      type: 'video',
      height: 70,
      muted: false,
      visible: true,
      solo: false,
    }],
    playheadPosition: 2,
    clipKeyframes: new Map(),
  });
}

describe('AI atomic motion sequence authoring', () => {
  beforeEach(() => {
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      activeCompositionId: 'comp-1',
      compositions: [{
        id: 'comp-1',
        width: 1920,
        height: 1080,
      } as never],
    } as never);
    seedTimeline();
    setHistoryDisabledForDebug(false);
    initializeHistory();
    getHistoryStateView().clearHistory();
  });

  afterEach(() => {
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  it('commits mixed X/Y/opacity keys atomically with canonical units and one undo', async () => {
    const result = await handleAddKeyframe({
      sequence: [
        { clipId: CLIP_ID, property: 'position.x', value: 480, time: 0 },
        { clipId: CLIP_ID, property: 'position.y', value: -270, time: 0 },
        { clipId: CLIP_ID, property: 'opacity', value: 0.4, time: 0.5, easing: 'easeOut' },
      ],
    }, useTimelineStore.getState());

    expect(result.success).toBe(true);
    const stored = useTimelineStore.getState().getClipKeyframes(CLIP_ID);
    expect(stored.find((keyframe) => keyframe.property === 'position.x')?.value)
      .toBeCloseTo(0.5);
    expect(stored.find((keyframe) => keyframe.property === 'position.y')?.value)
      .toBeCloseTo(-0.5);
    expect(stored.find((keyframe) => keyframe.property === 'opacity')?.value)
      .toBe(0.4);
    expect(getHistoryStateView().undoStack).toHaveLength(1);

    const data = result.data as {
      keyframes: Array<{
        keyframeId: string;
        requestedValue: number;
        canonicalValue: number;
        storedValue: number;
        resolvedTime: number;
        status: string;
      }>;
      createdCount: number;
      updatedCount: number;
    };
    expect(data.createdCount).toBe(3);
    expect(data.updatedCount).toBe(0);
    expect(data.keyframes.map((keyframe) => keyframe.keyframeId).sort())
      .toEqual(stored.map((keyframe) => keyframe.id).sort());
    expect(data.keyframes[0]).toMatchObject({
      requestedValue: 480,
      canonicalValue: 480,
      storedValue: 0.5,
      resolvedTime: 0,
      status: 'created',
    });

    const read = await handleGetKeyframes(
      { clipId: CLIP_ID },
      useTimelineStore.getState(),
    );
    const readKeys = (read.data as { keyframes: Array<{ property: string; value: number }> })
      .keyframes;
    expect(readKeys.find((keyframe) => keyframe.property === 'position.x')?.value)
      .toBeCloseTo(480);
    expect(readKeys.find((keyframe) => keyframe.property === 'position.y')?.value)
      .toBeCloseTo(-270);
  });

  it('updates an existing keyframe without changing its stable id', async () => {
    const first = await handleAddKeyframe({
      clipId: CLIP_ID,
      property: 'opacity',
      value: 0.2,
      time: 1,
    }, useTimelineStore.getState());
    const stableId = (first.data as { keyframeId: string }).keyframeId;

    const update = await handleAddKeyframe({
      sequence: [{
        clipId: CLIP_ID,
        property: 'opacity',
        value: 0.8,
        time: 1,
        easing: 'ease-in',
      }],
    }, useTimelineStore.getState());

    expect(update.success).toBe(true);
    const updated = (update.data as {
      keyframes: Array<{ keyframeId: string; status: string; updated: boolean }>;
    }).keyframes[0];
    expect(updated).toMatchObject({
      keyframeId: stableId,
      status: 'updated',
      updated: true,
    });
    expect(useTimelineStore.getState().getClipKeyframes(CLIP_ID)[0])
      .toMatchObject({ id: stableId, value: 0.8, easing: 'ease-in' });
  });

  it('commits an atomic sequence larger than the former 100-keyframe cap', async () => {
    const sequence = Array.from({ length: 124 }, (_, index) => ({
      clipId: CLIP_ID,
      property: 'opacity',
      value: index / 123,
      time: (index / 123) * 5,
      easing: 'linear',
    }));

    const result = await handleAddKeyframe({ sequence }, useTimelineStore.getState());

    expect(result.success).toBe(true);
    expect((result.data as { createdCount: number }).createdCount).toBe(124);
    expect(useTimelineStore.getState().getClipKeyframes(CLIP_ID)).toHaveLength(124);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
  });

  it('rejects duplicate or invalid sequence items before any write', async () => {
    const duplicate = await handleAddKeyframe({
      sequence: [
        { clipId: CLIP_ID, property: 'opacity', value: 0.2, time: -1 },
        { clipId: CLIP_ID, property: 'opacity', value: 0.8, time: 0 },
      ],
    }, useTimelineStore.getState());
    expect(duplicate.success).toBe(false);
    expect(duplicate.error).toContain('Duplicate keyframe target');

    const invalid = await handleAddKeyframe({
      sequence: [
        { clipId: CLIP_ID, property: 'position.x', value: 200, time: 0 },
        { clipId: CLIP_ID, property: 'opacity', value: 2, time: 1 },
      ],
    }, useTimelineStore.getState());
    expect(invalid.success).toBe(false);
    expect(useTimelineStore.getState().getClipKeyframes(CLIP_ID)).toHaveLength(0);
    expect(getHistoryStateView().undoStack).toHaveLength(0);
  });

  it('exposes Transform descriptors and applies mixed static updates without partial writes', async () => {
    seedTimeline([]);
    const created = await handleCreateMotionShapeClip({
      trackId: 'video-1',
      primitive: 'rectangle',
      width: 640,
      height: 240,
      duration: 5,
      x: 480,
      y: -270,
    }, useTimelineStore.getState());
    expect(created.success).toBe(true);
    const clipId = (created.data as { clipId: string }).clipId;
    const positioned = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!;
    expect(positioned.transform.position.x).toBeCloseTo(0.5);
    expect(positioned.transform.position.y).toBeCloseTo(-0.5);

    const described = await handleGetMotionDesign(
      { clipId },
      useTimelineStore.getState(),
    );
    const paths = (described.data as { properties: Array<{ path: string }> })
      .properties.map((property) => property.path);
    expect(paths).toEqual(expect.arrayContaining([
      'position.x',
      'opacity',
      'shape.size.w',
    ]));
    expect((described.data as { properties: Array<{ path: string; value?: number }> })
      .properties.find((property) => property.path === 'position.x')?.value).toBe(480);
    expect((described.data as { properties: Array<{ path: string; value?: number }> })
      .properties.find((property) => property.path === 'position.y')?.value).toBe(-270);

    const applied = await handleUpdateMotionProperties({
      clipId,
      updates: [
        { path: 'shape.size.w', value: 720 },
        { path: 'position.x', value: 480 },
        { path: 'opacity', value: 0.4 },
      ],
    }, useTimelineStore.getState());
    expect(applied.success).toBe(true);
    const afterApplied = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!;
    expect(afterApplied.motion?.shape?.size.w).toBe(720);
    expect(afterApplied.transform.position.x).toBeCloseTo(0.5);
    expect(afterApplied.transform.opacity).toBe(0.4);

    const supported = await handleUpdateMotionProperties({
      clipId,
      updates: [
        { path: 'position.x', value: 960 },
        { path: 'replicator.offset.rotation', value: 45 },
      ],
    }, useTimelineStore.getState());
    expect(supported.success).toBe(true);
    const afterSupported = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!;
    expect(afterSupported.transform.position.x).toBeCloseTo(1);
    expect(afterSupported.motion?.replicator?.terminalTransform.rotationDegrees).toBe(45);

    const beforeRejected = {
      motion: structuredClone(afterSupported.motion),
      transform: structuredClone(afterSupported.transform),
    };
    const rejected = await handleUpdateMotionProperties({
      clipId,
      updates: [
        { path: 'position.x', value: 480 },
        { path: 'replicator.offset.rotation.invalid', value: 90 },
      ],
    }, useTimelineStore.getState());
    expect(rejected.success).toBe(false);
    const afterRejected = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!;
    expect({
      motion: afterRejected.motion,
      transform: afterRejected.transform,
    }).toEqual(beforeRejected);
  });
});
