import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeAITool } from '../../src/services/aiTools';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function resetTimeline(): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [],
    tracks: [
      {
        id: 'video-2',
        name: 'Video 2',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      },
      {
        id: 'video-1',
        name: 'Video 1',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      },
      {
        id: 'video-locked',
        name: 'Locked Video',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
        locked: true,
      },
      {
        id: 'audio-1',
        name: 'Audio',
        type: 'audio',
        height: 48,
        muted: false,
        visible: true,
        solo: false,
      },
    ],
    playheadPosition: 2,
    clipKeyframes: new Map(),
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
  });
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

async function createAdjustment(
  overrides: Record<string, unknown> = {},
): Promise<{ clipId: string; data: Record<string, unknown> }> {
  const result = await executeAITool('editMotionAdjustment', {
    operation: 'create',
    trackId: 'video-1',
    startTime: 1,
    duration: 5,
    ...overrides,
  }, 'internal');
  expect(result.success).toBe(true);
  const data = result.data as Record<string, unknown>;
  return { clipId: data.clipId as string, data };
}

describe('MD7 AI Motion Adjustment authoring', () => {
  beforeEach(() => {
    useMediaStore.setState(initialMediaState);
    resetTimeline();
    setHistoryDisabledForDebug(false);
    initializeHistory();
    getHistoryStateView().clearHistory();
  });

  afterEach(() => {
    if (getHistoryStateView().batchId !== null) {
      getHistoryStateView().cancelBatch();
    }
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  it('creates a frozen effect/mix layer with receipts and one real undo/redo step', async () => {
    const { clipId, data } = await createAdjustment({
      name: 'Global Grade',
      opacity: 0.75,
      blendMode: 'screen',
      effects: [
        { type: 'brightness', parameters: { amount: 0.2 } },
        { type: 'invert' },
      ],
    });

    expect(data).toMatchObject({
      operation: 'create',
      clipId,
      affectedClipIds: [clipId],
      plannerKinds: ['create'],
      diagnostics: [],
      history: { mode: 'single-entry', atomic: true, label: 'Create Adjustment Layer' },
    });
    expect((data.createdEffectIds as string[])).toHaveLength(2);
    expect((data.stateRevisionAfter as number)).toBeGreaterThan(data.stateRevisionBefore as number);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toMatchObject({
      name: 'Global Grade',
      trackId: 'video-1',
      startTime: 1,
      duration: 5,
      source: { type: 'motion-adjustment' },
      motion: { kind: 'adjustment' },
      transform: { opacity: 0.75, blendMode: 'screen' },
      effects: [
        { type: 'brightness', params: { amount: 0.2 } },
        { type: 'invert', params: {} },
      ],
    });
    expect(getHistoryStateView().undoStack).toHaveLength(1);

    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === clipId)).toBe(false);
    expect(getHistoryStateView().undo()).toBeNull();

    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects)
      .toHaveLength(2);
  });

  it('configures, moves, trims, and removes through single-entry reversible edits', async () => {
    const { clipId } = await createAdjustment({
      effects: [{ id: 'effect:original', type: 'contrast', parameters: { amount: 1.2 } }],
    });
    getHistoryStateView().clearHistory();

    const configured = await executeAITool('editMotionAdjustment', {
      operation: 'configure',
      clipId,
      opacity: 0.4,
      blendMode: 'overlay',
      effects: [{ type: 'gaussian-blur', parameters: { radius: 12, samples: 7 } }],
    }, 'internal');
    expect(configured.success).toBe(true);
    expect(configured.data).toMatchObject({
      operation: 'configure',
      plannerKinds: ['configure'],
      removedEffectIds: ['effect:original'],
      history: { mode: 'single-entry', atomic: true },
    });
    const configuredEffectId = (configured.data as { createdEffectIds: string[] })
      .createdEffectIds[0]!;
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toMatchObject({
      transform: { opacity: 0.4, blendMode: 'overlay' },
      effects: [{
        id: configuredEffectId,
        type: 'gaussian-blur',
        params: { radius: 12, samples: 7 },
      }],
    });
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects[0]?.id)
      .toBe('effect:original');
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects[0]?.id)
      .toBe(configuredEffectId);

    getHistoryStateView().clearHistory();
    const moved = await executeAITool('editMotionAdjustment', {
      operation: 'move',
      clipId,
      trackId: 'video-2',
      startTime: 4,
    }, 'internal');
    expect(moved.success).toBe(true);
    expect(moved.data).toMatchObject({ operation: 'move', history: { mode: 'single-entry' } });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toMatchObject({
      trackId: 'video-2',
      startTime: 4,
    });
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toMatchObject({
      trackId: 'video-1',
      startTime: 1,
    });
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });

    getHistoryStateView().clearHistory();
    const trimmed = await executeAITool('editMotionAdjustment', {
      operation: 'trim',
      clipId,
      startTime: 5,
      duration: 2.5,
    }, 'internal');
    expect(trimmed.success).toBe(true);
    expect(trimmed.data).toMatchObject({ operation: 'trim', plannerKinds: ['trim'] });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toMatchObject({
      startTime: 5,
      duration: 2.5,
      inPoint: 0,
      outPoint: 2.5,
      source: { naturalDuration: 2.5 },
    });
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toMatchObject({
      startTime: 4,
      duration: 5,
    });
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });

    getHistoryStateView().clearHistory();
    const removed = await executeAITool('editMotionAdjustment', {
      operation: 'remove',
      clipId,
    }, 'internal');
    expect(removed.success).toBe(true);
    expect(removed.data).toMatchObject({
      operation: 'remove',
      clipId,
      plannerKinds: ['remove'],
      removedEffectIds: [configuredEffectId],
    });
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === clipId)).toBe(false);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects[0]?.id)
      .toBe(configuredEffectId);
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === clipId)).toBe(false);
  });

  it('fails unsupported effects, bad blends, stale writes, and locked tracks before history', async () => {
    const unsupported = await executeAITool('editMotionAdjustment', {
      operation: 'create',
      trackId: 'video-1',
      effects: [{ type: 'glow', parameters: { amount: 1 } }],
    }, 'internal');
    expect(unsupported).toMatchObject({
      success: false,
      data: { code: 'MD7_ADJUSTMENT_UNSUPPORTED_EFFECT' },
    });

    const badBlend = await executeAITool('editMotionAdjustment', {
      operation: 'create',
      trackId: 'video-1',
      blendMode: 'difference',
    }, 'internal');
    expect(badBlend).toMatchObject({
      success: false,
      data: { code: 'MD7_ADJUSTMENT_UNSUPPORTED_BLEND_MODE' },
    });

    const locked = await executeAITool('editMotionAdjustment', {
      operation: 'create',
      trackId: 'video-locked',
    }, 'internal');
    expect(locked).toMatchObject({
      success: false,
      data: { code: 'MD7_ADJUSTMENT_TRACK_LOCKED' },
    });

    const stale = await executeAITool('editMotionAdjustment', {
      operation: 'create',
      trackId: 'video-1',
      expectedRevision: useTimelineStore.getState().timelineRevision + 1,
    }, 'internal');
    expect(stale).toMatchObject({
      success: false,
      data: { code: 'MD7_ADJUSTMENT_STALE_REVISION' },
    });
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(getHistoryStateView().undo()).toBeNull();
  });

  it('blocks generic AI effect paths from injecting unsupported adjustment data', async () => {
    const { clipId } = await createAdjustment();
    getHistoryStateView().clearHistory();

    const unsupported = await executeAITool('addEffect', {
      clipId,
      effectType: 'glow',
      params: { intensity: 2 },
    }, 'internal');
    expect(unsupported).toMatchObject({
      success: false,
      data: { code: 'MD7_ADJUSTMENT_UNSUPPORTED_EFFECT' },
    });

    const invalidParameters = await executeAITool('addEffect', {
      clipId,
      effectType: 'brightness',
      params: { amount: 9 },
    }, 'internal');
    expect(invalidParameters).toMatchObject({
      success: false,
      data: { code: 'MD7_ADJUSTMENT_INVALID_EFFECT' },
    });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects)
      .toEqual([]);
    expect(getHistoryStateView().undo()).toBeNull();

    const supported = await executeAITool('addEffect', {
      clipId,
      effectType: 'brightness',
      params: { amount: 0.25 },
    }, 'internal');
    expect(supported.success).toBe(true);
    const effectId = (supported.data as { effectId: string }).effectId;
    getHistoryStateView().clearHistory();
    const invalidUpdate = await executeAITool('updateEffect', {
      clipId,
      effectId,
      params: { amount: 4 },
    }, 'internal');
    expect(invalidUpdate).toMatchObject({
      success: false,
      data: { code: 'MD7_ADJUSTMENT_INVALID_EFFECT' },
    });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects[0])
      .toMatchObject({ id: effectId, params: { amount: 0.25 } });
    expect(getHistoryStateView().undo()).toBeNull();
  });

  it('keeps the direct Add-menu store action locked-safe and one-step undoable', () => {
    expect(useTimelineStore.getState().addMotionAdjustmentClip(
      'video-locked',
      1,
      5,
    )).toBeNull();
    expect(useTimelineStore.getState().addMotionAdjustmentClip(
      'video-1',
      Number.NaN,
      5,
    )).toBeNull();
    expect(getHistoryStateView().undo()).toBeNull();

    const clipId = useTimelineStore.getState().addMotionAdjustmentClip('video-1', 3, 4);
    expect(clipId).not.toBeNull();
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toMatchObject({
      startTime: 3,
      duration: 4,
      source: { type: 'motion-adjustment' },
      motion: { kind: 'adjustment' },
      effects: [],
    });
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === clipId)).toBe(false);
    expect(getHistoryStateView().undo()).toBeNull();
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.source?.type)
      .toBe('motion-adjustment');
  });
});
