import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeAITool } from '../../src/services/aiTools';
import { motionDesignToolDefinitions } from '../../src/services/aiTools/definitions/motionDesign';
import { getRegisteredToolHandlerNames } from '../../src/services/aiTools/handlers';
import { handleExecuteBatch } from '../../src/services/aiTools/handlers/batch';
import { handleAddKeyframe } from '../../src/services/aiTools/handlers/keyframes';
import {
  handleConfigureMotionReplicator,
  handleCreateMotionShapeClip,
  handleGetMotionCapabilities,
  handleGetMotionDesign,
  handleUpdateMotionAppearances,
  handleUpdateMotionProperties,
} from '../../src/services/aiTools/handlers/motionDesign';
import {
  getRegisteredToolPolicyNames,
  getToolPolicy,
} from '../../src/services/aiTools/policy/registry';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import type { MotionDesignClipView } from '../../src/services/motionDesign/mvpCapabilities';
import {
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
  useHistoryStore,
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
  'configureMotionReplicator',
] as const;

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
    useHistoryStore.getState().clearHistory();
  });

  afterEach(() => {
    useHistoryStore.getState().clearHistory();
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

    expect(getToolPolicy('getMotionCapabilities')?.readOnly).toBe(true);
    expect(getToolPolicy('getMotionDesign')?.readOnly).toBe(true);
    for (const name of MOTION_TOOL_NAMES.slice(2)) {
      expect(getToolPolicy(name)?.readOnly, `${name} policy`).toBe(false);
      expect(MODIFYING_TOOLS.has(name), `${name} history classification`).toBe(true);
    }
  });

  it('reports renderer-supported shape and appearance capabilities and limits', async () => {
    const result = await handleGetMotionCapabilities({}, useTimelineStore.getState());
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      capabilityVersion: 2,
      layerKinds: ['shape'],
      primitives: ['rectangle', 'ellipse', 'polygon', 'star'],
      appearances: ['color-fill', 'stroke', 'linear-gradient', 'radial-gradient'],
      appearanceLimits: {
        maxItems: 8,
        maxGradientStops: 8,
        blendModes: ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference'],
      },
      replicator: {
        layouts: ['grid'],
        maxCountPerAxis: 10,
        maxInstances: 100,
      },
    });
    expect((result.data as { unsupportedUntilLaterPhases: string[] })
      .unsupportedUntilLaterPhases.join(' ')).toContain('texture');
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
        { path: 'replicator.offset.rotation', value: 45 },
      ],
    }, useTimelineStore.getState());
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('not supported by the current renderer');
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

  it('configures the effective Grid Replicator and rejects over-limit settings', async () => {
    const created = await createShape();
    const configured = await handleConfigureMotionReplicator({
      clipId: created.clipId,
      enabled: true,
      countX: 10,
      countY: 10,
      spacingX: 80,
      spacingY: 60,
      fade: 0.92,
    }, useTimelineStore.getState());
    expect(configured.success).toBe(true);
    expect((configured.data as MotionDesignClipView).effectiveReplicator).toMatchObject({
      enabled: true,
      countX: 10,
      countY: 10,
      instanceCount: 100,
      maxInstances: 100,
    });

    const rejected = await handleConfigureMotionReplicator({
      clipId: created.clipId,
      countX: 11,
    }, useTimelineStore.getState());
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('between 1 and 10');
    expect((await handleGetMotionDesign(
      { clipId: created.clipId },
      useTimelineStore.getState(),
    )).data).toMatchObject({
      effectiveReplicator: { countX: 10, countY: 10, instanceCount: 100 },
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
    expect(useHistoryStore.getState().undoStack).toHaveLength(1);

    expect(useHistoryStore.getState().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(useHistoryStore.getState().undo()).toBeNull();
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
    expect(triangle.error).toContain('rectangle, ellipse, polygon, star');
    expect(useTimelineStore.getState().clips).toHaveLength(0);
  });
});
