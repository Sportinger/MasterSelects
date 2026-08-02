import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeAITool } from '../../src/services/aiTools';
import { motionDesignToolDefinitions } from '../../src/services/aiTools/definitions/motionDesign';
import { getRegisteredToolHandlerNames } from '../../src/services/aiTools/handlers';
import { handleExecuteBatch } from '../../src/services/aiTools/handlers/batch';
import { handleAddKeyframe } from '../../src/services/aiTools/handlers/keyframes';
import {
  handleConfigureMotionReplicator,
  handleCreateMotionNull,
  handleCreateMotionNullAndParent,
  handleCreateMotionShapeClip,
  handleGetMotionCapabilities,
  handleGetMotionDesign,
  handleSetMotionParent,
  handleUpdateMotionAppearances,
  handleUpdateMotionProperties,
} from '../../src/services/aiTools/handlers/motionDesign';
import {
  getRegisteredToolPolicyNames,
  getToolPolicy,
} from '../../src/services/aiTools/policy/registry';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import { executeFlashBoardToolCalls } from '../../src/services/flashboard/FlashBoardChatTools';
import type { MotionDesignClipView } from '../../src/services/motionDesign/mvpCapabilities';
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
const MOTION_TOOL_NAMES = [
  'getMotionCapabilities',
  'getMotionDesign',
  'createMotionShapeClip',
  'updateMotionProperties',
  'updateMotionAppearances',
  'saveMotionAppearancePreset',
  'listMotionAppearancePresets',
  'applyMotionAppearancePreset',
  'saveMotionTemplate',
  'listMotionTemplates',
  'applyMotionTemplate',
  'setMotionParent',
  'createMotionNull',
  'createMotionNullAndParent',
  'editMotionAdjustment',
  'editMotionModifier',
  'setMotionExpression',
  'configureMotionReplicator',
] as const;

const READ_ONLY_MOTION_TOOLS = new Set<string>([
  'getMotionCapabilities',
  'getMotionDesign',
  'listMotionAppearancePresets',
  'listMotionTemplates',
]);

function resetTimeline(): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [],
    tracks: [
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

async function createShape(
  args: Record<string, unknown> = {},
): Promise<MotionDesignClipView> {
  const result = await handleCreateMotionShapeClip({
    primitive: 'rectangle',
    duration: 6,
    width: 640,
    height: 240,
    ...args,
  }, useTimelineStore.getState());
  expect(result.success).toBe(true);
  return result.data as MotionDesignClipView;
}

describe('AI Motion Design tools', () => {
  beforeEach(() => {
    useMediaStore.setState(initialMediaState);
    resetTimeline();
    setHistoryDisabledForDebug(false);
    initializeHistory();
    getHistoryStateView().clearHistory();
  });

  afterEach(() => {
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  it('keeps definitions, handlers, policies, and mutation classification in parity', () => {
    expect(motionDesignToolDefinitions.map((tool) => tool.function.name))
      .toEqual(MOTION_TOOL_NAMES);

    const handlers = new Set(getRegisteredToolHandlerNames());
    const policies = new Set(getRegisteredToolPolicyNames());
    for (const name of MOTION_TOOL_NAMES) {
      expect(handlers.has(name), `${name} handler`).toBe(true);
      expect(policies.has(name), `${name} policy`).toBe(true);
    }

    for (const name of MOTION_TOOL_NAMES) {
      if (READ_ONLY_MOTION_TOOLS.has(name)) {
        expect(getToolPolicy(name)?.readOnly, `${name} policy`).toBe(true);
      } else {
        expect(getToolPolicy(name)?.readOnly, `${name} policy`).toBe(false);
        expect(MODIFYING_TOOLS.has(name), `${name} history classification`).toBe(true);
      }
    }
  });

  it('reports renderer-supported shape and appearance capabilities and limits', async () => {
    const result = await handleGetMotionCapabilities({}, useTimelineStore.getState());
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      capabilityVersion: 2,
      layerKinds: ['shape'],
      primitives: ['rectangle', 'ellipse', 'polygon', 'star', 'path'],
      appearances: ['color-fill', 'stroke', 'linear-gradient', 'radial-gradient'],
      appearanceLimits: {
        maxItems: 8,
        maxGradientStops: 8,
        blendModes: ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference'],
      },
      replicator: {
        layouts: ['grid', 'linear', 'radial'],
        maxCountPerAxis: 10_000,
        maxInstances: 100_000,
      },
    });
    expect((result.data as { unsupportedUntilLaterPhases: string[] })
      .unsupportedUntilLaterPhases.join(' ')).not.toContain('texture');
    expect((result.data as { unsupportedUntilLaterPhases: string[] })
      .unsupportedUntilLaterPhases.join(' ')).toContain('motion group');
  });

  it('sets and clears Motion parents through the production graph transaction', async () => {
    const parent = await createShape({ name: 'AI Parent' });
    const child = await createShape({ name: 'AI Child' });
    useTimelineStore.getState().updateClipTransform(parent.clipId, {
      position: { x: 0.2, y: -0.1, z: 0 },
      rotation: { x: 0, y: 0, z: 25 },
    });
    useTimelineStore.getState().updateClipTransform(child.clipId, {
      position: { x: -0.3, y: 0.25, z: 0 },
    });
    const worldBefore = structuredClone(
      useTimelineStore.getState().clips.find((clip) => clip.id === child.clipId)?.transform,
    );

    const setResult = await handleSetMotionParent({
      operation: 'set',
      childClipId: child.clipId,
      parentClipId: parent.clipId,
    }, useTimelineStore.getState());
    expect(setResult.success).toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.clipId)?.parentClipId)
      .toBe(parent.clipId);
    expect(setResult.data).toMatchObject({
      operation: 'set',
      childClipId: child.clipId,
      parentClipId: parent.clipId,
      entities: { updated: [{ kind: 'clip', id: child.clipId }] },
    });

    const clearResult = await handleSetMotionParent({
      operation: 'clear',
      childClipId: child.clipId,
    }, useTimelineStore.getState());
    expect(clearResult.success).toBe(true);
    const childAfter = useTimelineStore.getState().clips.find((clip) => clip.id === child.clipId);
    expect(childAfter?.parentClipId).toBeUndefined();
    expect(childAfter?.transform.position.x).toBeCloseTo(worldBefore?.position.x ?? 0, 10);
    expect(childAfter?.transform.position.y).toBeCloseTo(worldBefore?.position.y ?? 0, 10);
    expect(childAfter?.transform.rotation).toEqual(worldBefore?.rotation);
    expect(childAfter?.transform.opacity).toBe(worldBefore?.opacity);
  });

  it('cancels failed/no-op AI parenting history batches instead of adding empty undo steps', async () => {
    const parent = await createShape({ name: 'History Parent' });
    const child = await createShape({ name: 'History Child' });
    const applied = await executeAITool('setMotionParent', {
      operation: 'set',
      childClipId: child.clipId,
      parentClipId: parent.clipId,
    }, 'internal');
    expect(applied.success).toBe(true);
    expect(getHistoryStateView().undoStack).toHaveLength(1);

    const noOp = await executeAITool('setMotionParent', {
      operation: 'set',
      childClipId: child.clipId,
      parentClipId: parent.clipId,
    }, 'internal');
    expect(noOp.success).toBe(false);
    expect(noOp.error).toContain('already has');
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === child.clipId)?.parentClipId)
      .toBe(parent.clipId);

    const rejected = await executeAITool('setMotionParent', {
      operation: 'set',
      childClipId: child.clipId,
      parentClipId: 'missing-parent',
    }, 'internal');
    expect(rejected.success).toBe(false);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
  });

  it('reports transform keyframes changed by an animated parenting transaction', async () => {
    const parent = await createShape({ name: 'Animated Parent' });
    const child = await createShape({ name: 'Animated Child' });
    useTimelineStore.getState().updateClipTransform(parent.clipId, {
      position: { x: 0.25, y: 0, z: 0 },
    });
    const keyframeResult = await handleAddKeyframe({
      clipId: child.clipId,
      property: 'opacity',
      value: 0.8,
      time: 2,
      easing: 'linear',
    }, useTimelineStore.getState());
    expect(keyframeResult.success).toBe(true);
    expect(useTimelineStore.getState().getClipKeyframes(child.clipId)).toHaveLength(1);

    const result = await handleSetMotionParent({
      operation: 'set',
      childClipId: child.clipId,
      parentClipId: parent.clipId,
    }, useTimelineStore.getState());

    expect(result.success).toBe(true);
    const entities = (result.data as {
      entities: {
        created: Array<{ kind: string }>;
        updated: Array<{ kind: string }>;
      };
    }).entities;
    expect([...entities.created, ...entities.updated])
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'keyframe' })]));
  });

  it('creates a standalone Motion Null with safe defaults and one real undo/redo step', async () => {
    const result = await executeAITool('createMotionNull', {
      name: 'Lower Third Controller',
    }, 'internal');

    expect(result.success).toBe(true);
    const data = result.data as {
      clipId: string;
      affectedClipIds: string[];
      graphRevisionBefore: string;
      graphRevisionAfter: string;
      stateRevisionBefore: number;
      stateRevisionAfter: number;
      diagnostics: unknown[];
      entities: { created: Array<{ kind: string; id: string }> };
    };
    expect(data.affectedClipIds).toEqual([data.clipId]);
    expect(data.graphRevisionAfter).not.toBe(data.graphRevisionBefore);
    expect(data.stateRevisionAfter).toBeGreaterThan(data.stateRevisionBefore);
    expect(data.diagnostics).toEqual([]);
    expect(data.entities.created).toContainEqual({ kind: 'clip', id: data.clipId });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === data.clipId)).toMatchObject({
      trackId: 'video-1',
      name: 'Lower Third Controller',
      startTime: 2,
      duration: 5,
      source: { type: 'motion-null' },
    });

    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === data.clipId)).toBe(false);
    expect(getHistoryStateView().undo()).toBeNull();

    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === data.clipId)).toMatchObject({
      trackId: 'video-1',
      name: 'Lower Third Controller',
      startTime: 2,
      duration: 5,
      source: { type: 'motion-null' },
    });
  });

  it('keeps direct standalone Null domain creation undoable without the AI wrapper', () => {
    const clipId = useTimelineStore.getState().addMotionNullClip(
      'video-1',
      3,
      7,
      'Direct Controller',
    );
    expect(clipId).not.toBeNull();
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toMatchObject({
      name: 'Direct Controller',
      startTime: 3,
      duration: 7,
      source: { type: 'motion-null' },
    });

    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === clipId)).toBe(false);
    expect(getHistoryStateView().undo()).toBeNull();
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)).toMatchObject({
      name: 'Direct Controller',
      startTime: 3,
      duration: 7,
      source: { type: 'motion-null' },
    });
  });

  it('returns structured standalone Null failures without creating history', async () => {
    const result = await handleCreateMotionNull({
      trackId: 'video-locked',
      startTime: 1,
      duration: 3,
    }, useTimelineStore.getState());

    expect(result.success).toBe(false);
    expect(result.error).toContain('locked');
    expect(result.data).toMatchObject({
      operation: 'create-motion-null',
      affectedClipIds: [],
      diagnostics: [{ code: 'MD6_STRUCTURE_CREATE_NULL_TRACK_INVALID' }],
    });
    const failureData = result.data as {
      graphRevisionBefore: string;
      graphRevisionAfter: string;
      stateRevisionBefore: number;
      stateRevisionAfter: number;
    };
    expect(failureData.graphRevisionAfter).toBe(failureData.graphRevisionBefore);
    expect(failureData.stateRevisionAfter).toBe(failureData.stateRevisionBefore);
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(getHistoryStateView().undo()).toBeNull();
  });

  it('rolls standalone Motion Null creation back when a later batch action fails', async () => {
    const result = await executeAITool('executeBatch', {
      staggerDelayMs: 0,
      actions: [
        {
          tool: 'createMotionNull',
          args: { trackId: 'video-1', startTime: 1, duration: 4, name: 'Rolled Back Null' },
        },
        {
          tool: 'createMotionNull',
          args: { trackId: 'video-locked', startTime: 2, duration: 2 },
        },
      ],
    }, 'internal');

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({ totalActions: 2, succeeded: 1, failed: 1 });
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(getHistoryStateView().undo()).toBeNull();
  });

  it('creates one Motion Null and parents explicit AI clip ids atomically', async () => {
    const first = await createShape({ name: 'AI Child A', startTime: 1, duration: 2 });
    const second = await createShape({ name: 'AI Child B', startTime: 4, duration: 3 });

    const result = await handleCreateMotionNullAndParent({
      trackId: 'video-1',
      clipIds: [first.clipId, second.clipId],
      timelineTime: 2,
      duration: 2,
    }, useTimelineStore.getState());

    expect(result.success).toBe(true);
    const data = result.data as {
      clipId: string;
      parentedClipIds: string[];
      entities: { created: Array<{ kind: string; id: string }> };
    };
    const state = useTimelineStore.getState();
    const nullClip = state.clips.find((clip) => clip.id === data.clipId);
    expect(nullClip).toMatchObject({
      trackId: 'video-1',
      startTime: 1,
      duration: 6,
      source: { type: 'motion-null' },
    });
    expect(data.parentedClipIds).toEqual([first.clipId, second.clipId]);
    expect(data.entities.created).toContainEqual({ kind: 'clip', id: data.clipId });
    expect(state.clips.find((clip) => clip.id === first.clipId)?.parentClipId).toBe(data.clipId);
    expect(state.clips.find((clip) => clip.id === second.clipId)?.parentClipId).toBe(data.clipId);
  });

  it('undoes and redoes create-null-and-parent as one exact graph transaction', async () => {
    const first = await createShape({ name: 'Undo Child A', startTime: 1, duration: 2 });
    const second = await createShape({ name: 'Undo Child B', startTime: 4, duration: 3 });
    const readRelevantGraphState = () => useTimelineStore.getState().clips.map((clip) => ({
      id: clip.id,
      name: clip.name,
      trackId: clip.trackId,
      startTime: clip.startTime,
      duration: clip.duration,
      parentClipId: clip.parentClipId,
      transform: structuredClone(clip.transform),
    }));
    const before = readRelevantGraphState();
    getHistoryStateView().clearHistory();

    const result = await executeAITool('createMotionNullAndParent', {
      trackId: 'video-1',
      clipIds: [first.clipId, second.clipId],
      timelineTime: 2,
      duration: 2,
    }, 'internal');
    expect(result.success).toBe(true);
    const data = result.data as { clipId: string; affectedClipIds: string[] };
    expect(data.affectedClipIds).toEqual([data.clipId, first.clipId, second.clipId]);

    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(readRelevantGraphState()).toEqual(before);
    expect(getHistoryStateView().undo()).toBeNull();

    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    const redone = useTimelineStore.getState().clips;
    expect(redone.find((clip) => clip.id === data.clipId)?.source?.type).toBe('motion-null');
    expect(redone.find((clip) => clip.id === first.clipId)?.parentClipId).toBe(data.clipId);
    expect(redone.find((clip) => clip.id === second.clipId)?.parentClipId).toBe(data.clipId);
  });

  it('creates a styled native motion shape at the playhead with mutation metadata', async () => {
    const result = await handleCreateMotionShapeClip({
      name: 'Lower Third Plate',
      primitive: 'rectangle',
      duration: 6,
      width: 900,
      height: 180,
      cornerRadius: 36,
      fill: {
        color: '#2233cc',
        opacity: 0.9,
      },
      stroke: {
        enabled: true,
        color: '#ffffff',
        opacity: 0.75,
        width: 8,
        alignment: 'inside',
      },
    }, useTimelineStore.getState());

    expect(result.success).toBe(true);
    const data = result.data as MotionDesignClipView & {
      entities: { created: Array<{ kind: string; id: string }> };
      stateRevisionBefore: number;
      stateRevisionAfter: number;
    };
    const clip = useTimelineStore.getState().clips.find(
      (candidate) => candidate.id === data.clipId,
    )!;
    const fill = clip.motion?.appearance?.items.find((item) => item.kind === 'color-fill');
    const stroke = clip.motion?.appearance?.items.find((item) => item.kind === 'stroke');

    expect(data.startTime).toBe(2);
    expect(data.name).toBe('Lower Third Plate');
    expect(data.entities.created).toContainEqual({ kind: 'clip', id: data.clipId });
    expect(data.stateRevisionAfter).toBeGreaterThanOrEqual(data.stateRevisionBefore);
    expect(clip.source?.type).toBe('motion-shape');
    expect(clip.motion?.shape).toMatchObject({
      primitive: 'rectangle',
      size: { w: 900, h: 180 },
      cornerRadius: 36,
    });
    expect(fill).toMatchObject({
      visible: true,
      opacity: 0.9,
      color: { r: 34 / 255, g: 51 / 255, b: 204 / 255, a: 1 },
    });
    expect(stroke).toMatchObject({
      visible: true,
      opacity: 0.75,
      width: 8,
      alignment: 'inside',
    });
  });

  it('sends compact Motion mutation receipts to the model while preserving the full raw result', async () => {
    const [executed] = await executeFlashBoardToolCalls([{
      id: 'create-shape-compact',
      name: 'createMotionShapeClip',
      arguments: JSON.stringify({
        trackId: 'video-1',
        primitive: 'rectangle',
        width: 640,
        height: 180,
        duration: 5,
      }),
    }], Number.POSITIVE_INFINITY);

    expect(executed?.result.success).toBe(true);
    expect((executed?.result.data as { properties?: unknown[] }).properties?.length)
      .toBeGreaterThan(10);
    const modelReceipt = JSON.parse(executed!.modelContent) as {
      data: {
        commonEditablePaths?: Record<string, string>;
        detail?: string;
        position?: unknown[];
        properties?: unknown[];
      };
    };
    expect(modelReceipt.data.properties).toBeUndefined();
    expect(modelReceipt.data.position).toHaveLength(2);
    expect(modelReceipt.data.commonEditablePaths).toEqual({
      x: 'position.x',
      y: 'position.y',
      width: 'shape.size.w',
      height: 'shape.size.h',
      cornerRadius: 'shape.cornerRadius',
    });
    expect(modelReceipt.data.detail).toContain('Compact mutation receipt');
    expect(executed!.modelContent.length).toBeLessThan(3_000);
  });

  it('returns clip-specific stable appearance ids and property descriptors', async () => {
    const created = await createShape({
      stroke: { enabled: true, width: 4 },
    });
    const first = await handleGetMotionDesign(
      { clipId: created.clipId },
      useTimelineStore.getState(),
    );
    const second = await handleGetMotionDesign(
      { clipId: created.clipId },
      useTimelineStore.getState(),
    );
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const firstData = first.data as MotionDesignClipView;
    const secondData = second.data as MotionDesignClipView;
    expect(firstData.primaryAppearanceIds).toEqual(secondData.primaryAppearanceIds);
    expect(firstData.primaryAppearanceIds.fill).toBeTruthy();
    expect(firstData.primaryAppearanceIds.stroke).toBeTruthy();
    expect(firstData.properties.map((property) => property.path)).toEqual(
      expect.arrayContaining([
        'shape.size.w',
        `appearance.${firstData.primaryAppearanceIds.fill}.opacity`,
        `appearance.${firstData.primaryAppearanceIds.stroke}.stroke.width`,
        'replicator.count.x',
      ]),
    );
  });

  it('applies property updates atomically and rejects unsupported renderer paths', async () => {
    const created = await createShape();
    const fillId = created.primaryAppearanceIds.fill!;
    const valid = await handleUpdateMotionProperties({
      clipId: created.clipId,
      updates: [
        { path: 'shape.size.w', value: 720 },
        { path: 'shape.cornerRadius', value: 48 },
        { path: `appearance.${fillId}.opacity`, value: 0.6 },
      ],
    }, useTimelineStore.getState());

    expect(valid.success).toBe(true);
    expect((valid.data as { entities: { updated: unknown[] } }).entities.updated)
      .toContainEqual({ kind: 'clip', id: created.clipId });
    const afterValid = useTimelineStore.getState().clips.find(
      (clip) => clip.id === created.clipId,
    )!;
    expect(afterValid.motion?.shape?.size.w).toBe(720);
    expect(afterValid.motion?.shape?.cornerRadius).toBe(48);

    const beforeRejected = structuredClone(afterValid.motion);
    const rejected = await handleUpdateMotionProperties({
      clipId: created.clipId,
      updates: [
        { path: 'shape.size.h', value: 300 },
        { path: 'replicator.unsupported', value: 45 },
      ],
    }, useTimelineStore.getState());
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('Property not found for clip');
    expect(useTimelineStore.getState().clips.find(
      (clip) => clip.id === created.clipId,
    )?.motion).toEqual(beforeRejected);
  });

  it('creates and updates the primary stroke without changing its stable id', async () => {
    const created = await createShape();
    expect(created.primaryAppearanceIds.stroke).toBeNull();
    const added = await handleUpdateMotionAppearances({
      clipId: created.clipId,
      stroke: {
        enabled: true,
        color: '#ff8800',
        width: 12,
        alignment: 'outside',
      },
    }, useTimelineStore.getState());
    expect(added.success).toBe(true);
    const strokeId = (added.data as MotionDesignClipView).primaryAppearanceIds.stroke;
    expect(strokeId).toBeTruthy();

    const updated = await handleUpdateMotionAppearances({
      clipId: created.clipId,
      stroke: { opacity: 0.4, width: 18 },
    }, useTimelineStore.getState());
    expect(updated.success).toBe(true);
    const updatedData = updated.data as MotionDesignClipView;
    expect(updatedData.primaryAppearanceIds.stroke).toBe(strokeId);
    expect(updatedData.appearances.find((item) => item.id === strokeId)).toMatchObject({
      visible: true,
      opacity: 0.4,
      width: 18,
      alignment: 'outside',
    });
  });

  it('creates polygon/star parameters and edits an ordered gradient appearance stack', async () => {
    const created = await createShape({
      primitive: 'star',
      points: 7,
      outerRadius: 118,
      innerRadius: 42,
      cornerRadius: 5,
    });
    expect(created.motion.shape).toMatchObject({
      primitive: 'star',
      star: {
        points: 7,
        outerRadius: 118,
        innerRadius: 42,
        cornerRadius: 5,
      },
    });

    const added = await handleUpdateMotionAppearances({
      clipId: created.clipId,
      operations: [
        {
          operation: 'add',
          kind: 'linear-gradient',
          name: 'Brand Gradient',
          blendMode: 'screen',
          start: { x: 0, y: 0 },
          end: { x: 1, y: 1 },
          stops: [
            { offset: 0, color: '#1122cc' },
            { offset: 0.55, color: '#ff33aa' },
            { offset: 1, color: '#ffee88' },
          ],
        },
        {
          operation: 'add',
          kind: 'stroke',
          name: 'Outer Stroke',
          color: '#ffffff',
          width: 9,
          alignment: 'outside',
        },
      ],
    }, useTimelineStore.getState());
    expect(added.success).toBe(true);
    const addedData = added.data as MotionDesignClipView & {
      createdAppearanceIds: string[];
      createdGradientStopIds: string[];
    };
    expect(addedData.createdAppearanceIds).toHaveLength(2);
    expect(addedData.createdGradientStopIds).toHaveLength(3);
    expect(addedData.appearances.map((item) => item.kind)).toEqual([
      'color-fill',
      'linear-gradient',
      'stroke',
    ]);

    const gradientId = addedData.createdAppearanceIds[0];
    const strokeId = addedData.createdAppearanceIds[1];
    const moved = await handleUpdateMotionAppearances({
      clipId: created.clipId,
      operations: [
        { operation: 'move', itemId: strokeId, index: 1 },
        { operation: 'set-visibility', itemId: gradientId, visible: false },
        { operation: 'duplicate', itemId: gradientId },
      ],
    }, useTimelineStore.getState());
    expect(moved.success).toBe(true);
    const movedData = moved.data as MotionDesignClipView & {
      createdAppearanceIds: string[];
      createdGradientStopIds: string[];
    };
    expect(movedData.appearances.map((item) => item.id).slice(0, 3)).toEqual([
      created.primaryAppearanceIds.fill,
      strokeId,
      gradientId,
    ]);
    expect(movedData.appearances.find((item) => item.id === gradientId)?.visible)
      .toBe(false);
    expect(movedData.createdAppearanceIds).toHaveLength(1);
    expect(movedData.createdGradientStopIds).toHaveLength(3);

    const beforeRoundTrip = structuredClone(
      useTimelineStore.getState().clips.find(
        (clip) => clip.id === created.clipId,
      )?.motion,
    );
    const serialized = useTimelineStore.getState().getSerializableState();
    await useTimelineStore.getState().loadState(serialized);
    const restored = useTimelineStore.getState().clips.find(
      (clip) => clip.id === created.clipId,
    );
    expect(restored?.motion).toEqual(beforeRoundTrip);
    expect(restored?.motion).not.toBe(beforeRoundTrip);
  });

  it('creates, edits, validates, and keyframes path motion properties', async () => {
    const vertices = [
      { x: -100, y: 40 },
      { x: 0, y: -60, handleIn: { x: -15, y: 0 } },
      { x: 120, y: 30, handleOut: { x: 20, y: 10 } },
    ];
    const created = await createShape({
      primitive: 'path',
      vertices,
      closed: false,
      trimStart: 0.1,
      trimEnd: 0.75,
      trimOffset: 0.05,
      dashLength: 18,
      dashGap: 7,
      dashOffset: 3,
    });

    expect(useTimelineStore.getState().clips.find(
      (clip) => clip.id === created.clipId,
    )?.motion?.shape).toMatchObject({
      primitive: 'path',
      path: {
        vertices: [
          { x: -100, y: 40, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { x: 0, y: -60, handleIn: { x: -15, y: 0 }, handleOut: { x: 0, y: 0 } },
          { x: 120, y: 30, handleIn: { x: 0, y: 0 }, handleOut: { x: 20, y: 10 } },
        ],
        closed: false,
        trim: { start: 0.1, end: 0.75, offset: 0.05 },
        dash: { length: 18, gap: 7, offset: 3 },
      },
    });

    const updated = await handleUpdateMotionProperties({
      clipId: created.clipId,
      updates: [{ path: 'shape.path.trim.start', value: 0.2 }],
    }, useTimelineStore.getState());
    expect(updated.success).toBe(true);

    const rectangle = await createShape();
    const wrongPrimitive = await handleUpdateMotionProperties({
      clipId: rectangle.clipId,
      updates: [{ path: 'shape.path.trim.start', value: 0.2 }],
    }, useTimelineStore.getState());
    expect(wrongPrimitive.success).toBe(false);
    expect(wrongPrimitive.error).toContain('Property not found for clip');

    const invalidTrim = await handleUpdateMotionProperties({
      clipId: created.clipId,
      updates: [{ path: 'shape.path.trim.start', value: 0.9 }],
    }, useTimelineStore.getState());
    expect(invalidTrim.success).toBe(false);
    expect(invalidTrim.error).toContain('must not exceed shape.path.trim.end');

    const keyframe = await handleAddKeyframe({
      clipId: created.clipId,
      property: 'shape.path.trim.end',
      value: 0.6,
      time: 0.5,
      easing: 'ease-out',
    }, useTimelineStore.getState());
    expect(keyframe.success).toBe(true);
    expect(useTimelineStore.getState().getClipKeyframes(created.clipId)).toContainEqual(
      expect.objectContaining({ property: 'shape.path.trim.end', value: 0.6, time: 0.5 }),
    );
  });

  it('configures the effective 40x25 Grid Replicator and rejects over-limit settings', async () => {
    const created = await createShape();
    const configured = await handleConfigureMotionReplicator({
      clipId: created.clipId,
      enabled: true,
      countX: 40,
      countY: 25,
      spacingX: 80,
      spacingY: 60,
      fade: 0.92,
    }, useTimelineStore.getState());
    expect(configured.success).toBe(true);
    expect((configured.data as MotionDesignClipView).effectiveReplicator).toMatchObject({
      enabled: true,
      countX: 40,
      countY: 25,
      instanceCount: 1_000,
      maxInstances: 100_000,
    });

    const rejected = await handleConfigureMotionReplicator({
      clipId: created.clipId,
      countX: 10_001,
    }, useTimelineStore.getState());
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('between 1 and 10000');
    expect((await handleGetMotionDesign(
      { clipId: created.clipId },
      useTimelineStore.getState(),
    )).data).toMatchObject({
      effectiveReplicator: { countX: 40, countY: 25, instanceCount: 1_000 },
    });
  });

  it('configures Linear and Radial layouts with revision-bound stale-write protection', async () => {
    const created = await createShape();
    const linear = await handleConfigureMotionReplicator({
      clipId: created.clipId,
      expectedRevision: 0,
      enabled: true,
      layoutMode: 'linear',
      count: 12,
      stepX: 42,
      stepY: -7,
      offsetMode: 'absolute',
      rotationDegrees: 15,
      fade: 0.8,
    }, useTimelineStore.getState());

    expect(linear.success).toBe(true);
    expect(linear.data).toMatchObject({
      effectiveReplicator: {
        enabled: true,
        layout: 'linear',
        countX: 12,
        countY: 1,
        instanceCount: 12,
      },
      replicatorRevision: { previous: 0, next: 3 },
      motion: {
        replicator: {
          layout: { mode: 'linear', count: 12, step: { x: 42, y: -7 } },
          terminalTransform: {
            mode: 'absolute',
            rotationDegrees: 15,
            opacity: 0.8,
          },
        },
      },
    });

    const beforeStaleWrite = structuredClone(
      useTimelineStore.getState().clips.find((clip) => clip.id === created.clipId)?.motion,
    );
    const stale = await handleConfigureMotionReplicator({
      clipId: created.clipId,
      expectedRevision: 0,
      layoutMode: 'radial',
      count: 8,
    }, useTimelineStore.getState());
    expect(stale.success).toBe(false);
    expect(stale.error).toContain('Stale Motion Replicator revision');
    expect(useTimelineStore.getState().clips.find(
      (clip) => clip.id === created.clipId,
    )?.motion).toEqual(beforeStaleWrite);

    const radial = await handleConfigureMotionReplicator({
      clipId: created.clipId,
      expectedRevision: 3,
      layoutMode: 'radial',
      count: 8,
      centerX: 10,
      centerY: -20,
      radius: 240,
      startAngleDegrees: 15,
      endAngleDegrees: 375,
      angleSampling: 'exclusive-end',
      autoOrient: true,
    }, useTimelineStore.getState());
    expect(radial.success).toBe(true);
    expect(radial.data).toMatchObject({
      effectiveReplicator: {
        enabled: true,
        layout: 'radial',
        countX: 8,
        countY: 1,
        instanceCount: 8,
      },
      replicatorRevision: { previous: 3, next: 4 },
      motion: {
        replicator: {
          layout: {
            mode: 'radial',
            count: 8,
            center: { x: 10, y: -20 },
            radius: 240,
            startAngleDegrees: 15,
            endAngleDegrees: 375,
            angleSampling: 'exclusive-end',
            autoOrient: true,
          },
        },
      },
    });
  });

  it('supports Motion Design property keyframes returned by getMotionDesign', async () => {
    const created = await createShape();
    const fillId = created.primaryAppearanceIds.fill!;
    const result = await handleAddKeyframe({
      clipId: created.clipId,
      property: `appearance.${fillId}.opacity`,
      value: 0,
      time: 0.5,
      easing: 'ease-out',
    }, useTimelineStore.getState());

    expect(result.success).toBe(true);
    expect(useTimelineStore.getState().getClipKeyframes(created.clipId))
      .toContainEqual(expect.objectContaining({
        property: `appearance.${fillId}.opacity`,
        value: 0,
        time: 0.5,
      }));
  });

  it('round-trips a rounded styled and animated rectangle through timeline save/load', async () => {
    const created = await createShape({
      cornerRadius: 40,
      fill: { color: '#102040', opacity: 0.85 },
      stroke: {
        enabled: true,
        color: '#f0f4ff',
        opacity: 0.75,
        width: 6,
        alignment: 'outside',
      },
    });
    await handleAddKeyframe({
      clipId: created.clipId,
      property: 'opacity',
      value: 0,
      time: 0,
      easing: 'ease-out',
    }, useTimelineStore.getState());
    await handleAddKeyframe({
      clipId: created.clipId,
      property: 'opacity',
      value: 1,
      time: 0.5,
      easing: 'ease-out',
    }, useTimelineStore.getState());

    const serialized = useTimelineStore.getState().getSerializableState();
    await useTimelineStore.getState().loadState(serialized);
    const restored = useTimelineStore.getState().clips.find(
      (clip) => clip.id === created.clipId,
    );

    expect(restored?.source?.type).toBe('motion-shape');
    expect(restored?.motion?.shape).toMatchObject({
      primitive: 'rectangle',
      size: { w: 640, h: 240 },
      cornerRadius: 40,
    });
    expect(restored?.motion?.appearance?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'color-fill',
          opacity: 0.85,
        }),
        expect.objectContaining({
          kind: 'stroke',
          opacity: 0.75,
          width: 6,
          alignment: 'outside',
        }),
      ]),
    );
    expect(useTimelineStore.getState().getClipKeyframes(created.clipId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'opacity', time: 0, value: 0 }),
        expect.objectContaining({ property: 'opacity', time: 0.5, value: 1 }),
      ]),
    );
  });

  it('round-trips path geometry, trim, and dash settings through timeline save/load', async () => {
    const created = await createShape({
      primitive: 'path',
      vertices: [
        { x: -80, y: 0 },
        { x: 0, y: -50, handleOut: { x: 16, y: 8 } },
        { x: 90, y: 10 },
      ],
      closed: true,
      trimStart: 0.15,
      trimEnd: 0.85,
      trimOffset: 0.1,
      dashLength: 14,
      dashGap: 6,
      dashOffset: 2,
    });
    const shapeBefore = structuredClone(
      useTimelineStore.getState().clips.find((clip) => clip.id === created.clipId)?.motion?.shape,
    );

    const serialized = useTimelineStore.getState().getSerializableState();
    await useTimelineStore.getState().loadState(serialized);

    expect(useTimelineStore.getState().clips.find(
      (clip) => clip.id === created.clipId,
    )?.motion?.shape).toEqual(shapeBefore);
  });

  it('aggregates Motion Design mutations in executeBatch metadata', async () => {
    const created = await createShape();
    const result = await handleExecuteBatch({
      staggerDelayMs: 0,
      actions: [
        {
          tool: 'updateMotionProperties',
          args: {
            clipId: created.clipId,
            updates: [{ path: 'shape.size.w', value: 800 }],
          },
        },
        {
          tool: 'configureMotionReplicator',
          args: {
            clipId: created.clipId,
            enabled: true,
            countX: 4,
            countY: 3,
          },
        },
      ],
    }, 'internal');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      totalActions: 2,
      succeeded: 2,
      failed: 0,
      entities: {
        updated: [{ kind: 'clip', id: created.clipId }],
      },
    });
  });

  it('constructs a lower third with editable text and animations as one real undo step', async () => {
    const ref = (action: number, path: string) => ({
      $batchResult: { action, path },
    });
    const result = await executeAITool('executeBatch', {
      staggerDelayMs: 0,
      actions: [
        {
          tool: 'createMotionShapeClip',
          args: {
            trackId: 'video-1',
            name: 'Lower Third Plate',
            primitive: 'rectangle',
            duration: 6,
            width: 900,
            height: 180,
            cornerRadius: 36,
            fill: { color: '#162040', opacity: 0.92 },
            stroke: { enabled: true, color: '#ffffff', width: 4 },
          },
        },
        {
          tool: 'createTextClip',
          args: {
            trackId: 'video-1',
            text: 'Motion Design',
            duration: 6,
            fontSize: 72,
            color: '#ffffff',
          },
        },
        {
          tool: 'addKeyframe',
          args: {
            clipId: ref(0, 'clipId'),
            property: 'opacity',
            value: 0,
            time: 0,
            easing: 'ease-out',
          },
        },
        {
          tool: 'addKeyframe',
          args: {
            clipId: ref(0, 'clipId'),
            property: 'opacity',
            value: 1,
            time: 0.5,
            easing: 'ease-out',
          },
        },
        {
          tool: 'addKeyframe',
          args: {
            clipId: ref(1, 'clipId'),
            property: 'opacity',
            value: 0,
            time: 0,
            easing: 'ease-out',
          },
        },
        {
          tool: 'addKeyframe',
          args: {
            clipId: ref(1, 'clipId'),
            property: 'opacity',
            value: 1,
            time: 0.5,
            easing: 'ease-out',
          },
        },
      ],
    }, 'internal');

    expect(result.success).toBe(true);
    const clipsAfter = useTimelineStore.getState().clips;
    const motion = clipsAfter.find((clip) => clip.source?.type === 'motion-shape');
    const text = clipsAfter.find((clip) => clip.source?.type === 'text');
    expect(motion?.motion?.shape?.cornerRadius).toBe(36);
    expect(text?.textProperties?.text).toBe('Motion Design');
    expect(useTimelineStore.getState().getClipKeyframes(motion!.id)).toHaveLength(2);
    expect(useTimelineStore.getState().getClipKeyframes(text!.id)).toHaveLength(2);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(new Set([text!.id]));
    expect(getHistoryStateView().undoStack).toHaveLength(1);

    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(getHistoryStateView().undo()).toBeNull();
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips).toHaveLength(2);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(new Set([text!.id]));
  });

  it('rejects locked/non-video creation targets and unsupported primitives', async () => {
    const locked = await handleCreateMotionShapeClip({
      trackId: 'video-locked',
    }, useTimelineStore.getState());
    const audio = await handleCreateMotionShapeClip({
      trackId: 'audio-1',
    }, useTimelineStore.getState());
    const triangle = await handleCreateMotionShapeClip({
      primitive: 'triangle',
    }, useTimelineStore.getState());

    expect(locked.error).toContain('locked');
    expect(audio.error).toContain('video track');
    expect(triangle.error).toContain('rectangle, ellipse, polygon, star, path');
    expect(useTimelineStore.getState().clips).toHaveLength(0);
  });
});
