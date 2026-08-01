import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Layer } from '../../src/types';
import {
  clearMotionFrameRuntimeCache,
  createMotionFrameRuntimeAdmission,
  getMotionRenderSizeForAdmission,
} from '../../src/engine/motion/MotionFrameRuntime';
import {
  createDefaultMotionLayerDefinition,
  createMotionExpressionBinding,
  type MotionLayerDefinition,
} from '../../src/types/motionDesign';
import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  type MotionModifierStackContractV1,
} from '../../src/services/motionDesign/modifiers/contracts';
import { handleSetMotionExpression } from '../../src/services/aiTools/handlers/motionDesign';
import {
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const STRIDE = 12;
const OPACITY_OFFSET = 6;
const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function seedAuthoringTimeline(): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [],
    tracks: [{ id: 'video-1', name: 'Video 1', type: 'video', height: 70, muted: false, visible: true, solo: false }],
    clipKeyframes: new Map(),
  });
  setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
  initHistoryStoreRefs({
    timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: useMediaStore.setState },
    dock: { getState: () => ({ layout: null }), setState: () => undefined },
  });
  setHistoryDisabledForDebug(false);
  useHistoryStore.getState().clearHistory();
}

function gridMotion(expression?: MotionLayerDefinition['expressions']): MotionLayerDefinition {
  const motion = createDefaultMotionLayerDefinition('shape', { size: { w: 32, h: 32 } });
  motion.replicator = {
    contract: 'masterselects.motion-replicator', version: 2, enabled: true, revision: 1,
    layout: { mode: 'grid', count: { columns: 3, rows: 1 }, spacing: { x: 40, y: 40 }, patternOffset: { x: 0, y: 0 } },
    terminalTransform: { mode: 'cumulative', position: { x: 0, y: 0 }, rotationDegrees: 0, scale: { x: 1, y: 1 }, opacity: 1 },
    userLimit: 100,
  };
  motion.expressions = expression;
  return motion;
}

function layer(motion: MotionLayerDefinition): Layer {
  return { id: 'expression-layer', sourceClipId: 'expression-clip', visible: true, opacity: 1, source: { type: 'motion', motion } } as unknown as Layer;
}

function render(motion: MotionLayerDefinition, consumer: 'preview' | 'export' = 'preview') {
  const subject = layer(motion);
  const admission = createMotionFrameRuntimeAdmission({
    consumer, compositionId: 'expression-composition', timelineTimeSeconds: 1, layers: [subject],
  });
  expect(admission.ok).toBe(true);
  if (!admission.ok) throw new Error(JSON.stringify(admission.failures));
  return { admission, replicator: getMotionRenderSizeForAdmission(subject, admission).replicator };
}

function opacity(data: Float32Array, index: number): number {
  return data[index * STRIDE + OPACITY_OFFSET];
}

function opacityModifier(): MotionModifierStackContractV1 {
  return {
    contract: MOTION_MODIFIER_CONTRACT_ID, version: MOTION_MODIFIER_CONTRACT_VERSION,
    revision: 1, timeBasis: 'clip-local-seconds', ticksPerSecond: 60,
    modifiers: [{
      id: 'opacity-random', order: 0, enabled: true, kind: 'random', seed: 3,
      distribution: 'uniform-signed',
      targets: [{ path: 'replicator.offset.opacity', operation: 'add', amount: 1 }],
    }],
  };
}

describe('MD8 Motion expressions', () => {
  beforeEach(() => {
    clearMotionFrameRuntimeCache();
    seedAuthoringTimeline();
  });
  afterEach(() => {
    clearMotionFrameRuntimeCache();
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  it('authors valid bindings, rejects invalid source, removes bindings, and records one history entry', async () => {
    const clipId = useTimelineStore.getState().addMotionShapeClip('video-1', 0);
    expect(clipId).toBeTruthy();
    const set = await handleSetMotionExpression({
      clipId, operation: 'set', path: 'replicator.offset.opacity', source: 'index / count',
    }, useTimelineStore.getState());
    expect(set.success).toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.motion?.expressions?.bindings)
      .toMatchObject([{ path: 'replicator.offset.opacity', source: 'index / count', fallback: 0, enabled: true }]);
    // History is 'single-entry' via the app capture mechanism, which unit
    // tests stub out — undo semantics are not assertable here (same as the
    // sibling single-entry handlers).
    expect(set.data).toMatchObject({ history: { mode: 'single-entry' } });

    const invalid = await handleSetMotionExpression({
      clipId, operation: 'set', path: 'replicator.offset.opacity', source: 'window.location',
    }, useTimelineStore.getState());
    expect(invalid.success).toBe(false);
    expect(invalid.error).toContain('position');
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.motion?.expressions?.bindings)
      .toMatchObject([{ source: 'index / count' }]);

    const removed = await handleSetMotionExpression({
      clipId, operation: 'remove', path: 'replicator.offset.opacity',
    }, useTimelineStore.getState());
    expect(removed.success).toBe(true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.motion?.expressions)
      .toBeUndefined();
  });

  it('evaluates index/count expressions in the packed instance opacity field and ignores disabled bindings', () => {
    const enabled = gridMotion({ version: 1, bindings: [
      createMotionExpressionBinding('replicator.offset.opacity', 'index / count'),
    ] });
    const enabledData = render(enabled).replicator.instanceData;
    expect(opacity(enabledData, 0)).toBe(0);
    expect(opacity(enabledData, 1)).toBeCloseTo(1 / 3);
    expect(opacity(enabledData, 2)).toBeCloseTo(2 / 3);

    const disabled = gridMotion({ version: 1, bindings: [
      createMotionExpressionBinding('replicator.offset.opacity', 'index / count', 0, false),
    ] });
    expect(Array.from(render(disabled).replicator.instanceData.filter((_, index) => index % STRIDE === OPACITY_OFFSET)))
      .toEqual([1, 1, 1]);
  });

  it('gives expressions precedence over modifier-derived offset values', () => {
    const motion = gridMotion({ version: 1, bindings: [
      createMotionExpressionBinding('replicator.offset.opacity', '0.25'),
    ] });
    motion.modifierStack = opacityModifier();
    const data = render(motion).replicator.instanceData;
    expect(opacity(data, 0)).toBe(0.25);
    expect(opacity(data, 1)).toBe(0.25);
    expect(opacity(data, 2)).toBe(0.25);
  });

  it('fails closed to the binding fallback with one diagnostic per binding', () => {
    const motion = gridMotion({ version: 1, bindings: [
      createMotionExpressionBinding('replicator.offset.opacity', '1 / 0', 0.4),
    ] });
    const result = render(motion);
    expect(opacity(result.replicator.instanceData, 0)).toBeCloseTo(0.4);
    expect(result.admission.consumerInput.frameState.diagnostics.filter((entry) => entry.source === 'expression'))
      .toHaveLength(1);
  });

  it('is byte-identical for preview/export and random is deterministic', () => {
    const motion = gridMotion({ version: 1, bindings: [
      createMotionExpressionBinding('replicator.offset.opacity', 'random(7, index)'),
    ] });
    const preview = render(motion, 'preview').replicator.instanceData;
    clearMotionFrameRuntimeCache();
    const exported = render(motion, 'export').replicator.instanceData;
    expect(Array.from(exported)).toEqual(Array.from(preview));
    clearMotionFrameRuntimeCache();
    expect(Array.from(render(motion).replicator.instanceData)).toEqual(Array.from(preview));
  });
});
