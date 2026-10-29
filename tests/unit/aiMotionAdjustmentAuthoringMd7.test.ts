import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeAITool } from '../../src/services/aiTools';
import { getDefaultParams } from '../../src/effects';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { createDefaultColorEffectGraph } from '../../src/services/operators/colorEffectGraphs';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { effectOperatorGraph, effectOperatorParams, migrateLoadedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { Effect } from '../../src/types/effects';
import { createDefaultColorCorrectionState } from '../../src/types/colorCorrection';

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

  afterEach(async () => {
    // Tool feedback opens the inspector after 50 ms and then lazily imports the dock.
    // Drain that work before jsdom is torn down and the stores are reset.
    await new Promise(resolve => setTimeout(resolve, 60));
    await vi.dynamicImportSettled();
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
      effects: [{ type: 'slit-scan', parameters: {} }],
    }, 'internal');
    expect(unsupported).toMatchObject({
      success: false,
      data: { code: 'MD7_ADJUSTMENT_UNSUPPORTED_EFFECT' },
    });
    expect(unsupported.error).toContain('source video');

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

  it('keeps a layer editable that holds an unavailable effect from an older project and reports it', async () => {
    const { clipId } = await createAdjustment({ effects: [{ type: 'invert' }] });
    // An older or pasted project: Slit Scan already on the layer (no picker or tool offers it).
    useTimelineStore.setState({
      clips: useTimelineStore.getState().clips.map((clip) => clip.id === clipId
        ? { ...clip, effects: [{ id: 'legacy-slit', name: 'Slit Scan', type: 'slit-scan', enabled: true, params: {} }, ...clip.effects] as Effect[] }
        : clip),
    });

    const moved = await executeAITool('editMotionAdjustment', { operation: 'move', clipId, startTime: 2 }, 'internal');
    expect(moved.success).toBe(true);
    expect((moved.data as { after: { bypassedEffects?: Array<{ effectId: string; reason: string }> } }).after.bypassedEffects)
      .toEqual([expect.objectContaining({ effectId: 'legacy-slit', reason: expect.stringContaining('source video') })]);

    // The repair an agent makes: replace the list; the unavailable effect goes, nothing is reported after.
    const repaired = await executeAITool('editMotionAdjustment', {
      operation: 'configure',
      clipId,
      effects: [{ type: 'invert' }],
    }, 'internal');
    expect(repaired.success).toBe(true);
    const receipt = repaired.data as { before: { bypassedEffects?: unknown[] }; after: { bypassedEffects?: unknown[] }; removedEffectIds: string[] };
    expect(receipt.before.bypassedEffects).toHaveLength(1);
    expect(receipt.after.bypassedEffects).toBeUndefined();
    expect(receipt.removedEffectIds).toContain('legacy-slit');
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects.map((effect) => effect.type))
      .toEqual(['invert']);
  });

  it('keeps editing a layer whose effect was switched off once (node layout) or that carries a colour grade', async () => {
    const { clipId } = await createAdjustment({ effects: [{ type: 'invert' }] });
    const effectId = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!.effects[0].id;
    // A bypass collapses the effect's node group: node-graph layout on the clip, nothing that renders.
    useTimelineStore.getState().setClipEffectEnabled(clipId, effectId, false);
    useTimelineStore.getState().setClipEffectEnabled(clipId, effectId, true);
    useTimelineStore.getState().updateClip(clipId, { colorCorrection: createDefaultColorCorrectionState() });
    const before = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!;
    expect(before.nodeGraph).toBeDefined();

    const configured = await executeAITool('editMotionAdjustment', { operation: 'configure', clipId, opacity: 0.5 }, 'internal');
    expect(configured.success).toBe(true);
    const after = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!;
    expect(after.transform.opacity).toBe(0.5);
    expect(after.nodeGraph).toEqual(before.nodeGraph);
    expect(after.colorCorrection).toEqual(before.colorCorrection);

    useTimelineStore.getState().updateClip(clipId, { sourceRect: { x: 0, y: 0, width: 0.5, height: 1 } });
    // Tool results name what the layer renders without.
    const added = await executeAITool('addEffect', { clipId, effectType: 'invert' }, 'internal');
    expect(added.success).toBe(true);
    expect((added.data as { warnings?: string[] }).warnings).toEqual([
      expect.stringContaining('Adjustment layer renders without a property: It has a source crop rectangle'),
    ]);
    // A crop rectangle is a state the frozen v1 stack contract still refuses to edit: the tool says so.
    const refused = await executeAITool('editMotionAdjustment', { operation: 'configure', clipId, opacity: 0.4 }, 'internal');
    expect(refused).toMatchObject({ success: false, error: expect.stringContaining('unsupported v1 layer state') });
  });

  it('blocks generic AI effect paths from injecting unsupported adjustment data', async () => {
    const { clipId } = await createAdjustment();
    getHistoryStateView().clearHistory();

    const unsupported = await executeAITool('addEffect', {
      clipId,
      effectType: 'hud-tracker',
    }, 'internal');
    expect(unsupported).toMatchObject({
      success: false,
      data: { code: 'MD7_ADJUSTMENT_UNSUPPORTED_EFFECT' },
    });
    expect(unsupported.error).toContain('landmarks');

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

  it('accepts every admitted registry effect through both AI paths with their own defaults', async () => {
    const { clipId } = await createAdjustment({
      effects: [{ type: 'pixelate', parameters: { size: 24 } }, { type: 'glow' }],
    });
    const created = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!;
    expect(created.effects.map((effect) => effect.type)).toEqual(['pixelate', 'glow']);
    expect(created.effects[0]!.params).toMatchObject({ ...getDefaultParams('pixelate'), size: 24 });
    // A new registry effect stores its defaults explicitly, as addClipEffect does.
    expect(created.effects[1]!.params).toEqual(getDefaultParams('glow'));

    const wrongType = await executeAITool('editMotionAdjustment', {
      operation: 'configure',
      clipId,
      effects: [{ type: 'pixelate', parameters: { size: 'large' } }],
    }, 'internal');
    expect(wrongType).toMatchObject({ success: false });
    expect(wrongType.error).toContain('size must be a finite number');

    const added = await executeAITool('addEffect', { clipId, effectType: 'vignette' }, 'internal');
    expect(added.success).toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects.map((effect) => effect.type))
      .toEqual(['pixelate', 'glow', 'vignette']);
  });

  it('refuses misspelled parameter names and reports out-of-range values instead of clamping them silently', async () => {
    const { clipId } = await createAdjustment({ effects: [{ type: 'invert' }] });
    getHistoryStateView().clearHistory();
    const misspelled = await executeAITool('editMotionAdjustment', {
      operation: 'configure',
      clipId,
      effects: [{ type: 'glow', parameters: { intensty: 3, amount: 4 } }],
    }, 'internal');
    expect(misspelled).toMatchObject({ success: false, data: { code: 'MD7_ADJUSTMENT_INVALID_EFFECT' } });
    expect(misspelled.error).toContain('Unknown parameter for glow (effects[0]): intensty. Valid:');
    expect(misspelled.error).toContain('amount');
    expect(getHistoryStateView().undo()).toBeNull();

    // Glow Amount 9 is above its 0..5 slider but renders as set on a clip: stored as set, no warning.
    // Vignette Size 2 is above its rendered maximum 1.5: stored as set, and the result says what renders.
    const configured = await executeAITool('editMotionAdjustment', {
      operation: 'configure',
      clipId,
      effects: [{ type: 'glow', parameters: { amount: 9 } }, { type: 'vignette', parameters: { size: 2 } }],
    }, 'internal');
    expect(configured.success).toBe(true);
    const effects = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!.effects;
    expect(effects[0]!.params.amount).toBe(9);
    expect(effects[1]!.params.size).toBe(2);
    const warnings = (configured.data as { warnings?: string[] }).warnings ?? [];
    // The same note updateEffect gives on a clip (effectParamWarnings), named by effect.
    expect(warnings).toEqual([expect.stringMatching(/^Vignette \(.+\): Size 2 .+/)]);
  });

  it('stores a Stick Figure choreography longer than the 4 KB key budget through editMotionAdjustment', async () => {
    const actions = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      id: `action-${index}`, action: 'walk', start: index, duration: 1, from: { x: 0.1, y: 0.8 }, to: { x: 0.9, y: 0.8 },
    })));
    expect(actions.length).toBeGreaterThan(4_096);
    const result = await executeAITool('editMotionAdjustment', {
      operation: 'create', trackId: 'video-1', startTime: 1, duration: 5,
      effects: [{ type: 'stick-figure', parameters: { actions } }],
    }, 'internal');
    expect(result.error).toBeUndefined();
    const clipId = (result.data as { clipId: string }).clipId;
    const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId)!;
    expect(clip.effects[0]).toMatchObject({ type: 'stick-figure', params: { actions } });
    // Later edits of the composition still plan around it.
    const moved = await executeAITool('editMotionAdjustment', { operation: 'move', clipId, startTime: 2 }, 'internal');
    expect(moved.error).toBeUndefined();
    expect((moved.data as { after: { bypassedEffects?: unknown[] } }).after.bypassedEffects).toBeUndefined();
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

  it('keeps the saved color math of effects that configure keeps and gives new color effects the recipe', async () => {
    const { clipId } = await createAdjustment({
      effects: [
        { id: 'effect:fade', type: 'brightness', parameters: { amount: -1 } },
        { id: 'effect:punch', type: 'contrast', parameters: { amount: 1.2 } },
      ],
    });
    const created = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!;
    for (const effect of created.effects) {
      expect(matchesEffectRecipe(effect.operatorGraph!, createDefaultColorEffectGraph(effect.type as 'brightness' | 'contrast'))).toBe(true);
    }
    // An old project: both effects loaded without a graph, so they carry the original color math.
    useTimelineStore.setState({
      clips: useTimelineStore.getState().clips.map((clip) => clip.id === clipId
        ? { ...clip, effects: clip.effects.map(({ operatorGraph: _dropped, ...effect }) => migrateLoadedEffectOperatorGraph(effect as Effect)) }
        : clip),
    });
    const configured = await executeAITool('editMotionAdjustment', {
      operation: 'configure',
      clipId,
      effects: [
        { id: 'effect:fade', type: 'brightness', parameters: { amount: -1 } },
        { id: 'effect:punch', type: 'contrast', parameters: { amount: 1.5 } },
        { id: 'effect:mute', type: 'saturation', parameters: { amount: 0.5 } },
      ],
    }, 'internal');
    expect(configured.success).toBe(true);
    const [fade, punch, mute] = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)!.effects;
    const rgb = (effect: Effect) => evaluateImageOperatorPlan(
      compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect)), [0.5, 0.3, 0.2, 1]).slice(0, 3);
    // Original brightness: an additive offset, so -1 still fades to black (the recipe curve would end near 0.15).
    rgb(fade).forEach((channel) => expect(channel).toBeCloseTo(0, 5));
    // Original contrast: linear around 0.5 with a clip, now at 1.5.
    [0.5, 0.2, 0.05].forEach((value, index) => expect(rgb(punch)[index]).toBeCloseTo(value, 5));
    expect(matchesEffectRecipe(punch.operatorGraph!, createDefaultColorEffectGraph('contrast'))).toBe(false);
    expect(matchesEffectRecipe(mute.operatorGraph!, createDefaultColorEffectGraph('saturation'))).toBe(true);
  });
});
