import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTitleAdjustmentMontageFixture,
  createTwoAdjustmentFixture,
} from '../../src/services/motionDesign/adjustment/contractFixtures';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import {
  planMotionAdjustmentWorkerGpuExecution,
  type MotionAdjustmentWorkerGpuExecutionPlan,
} from '../../src/services/motionDesign/adjustment/workerGpuAdjustmentPlan';
import {
  validateWorkerGpuAdjustmentEnvelope,
  type WorkerGpuAdjustmentEnvelopeInput,
} from '../../src/services/render/workerGpuAdjustmentEnvelope';
import type { WorkerGpuWebCodecsFrameLayer } from '../../src/services/render/workerGpuRuntimeCommands';
import {
  workerRenderHostRuntimeHandler,
  type WorkerRenderHostRuntimeJobInput,
} from '../../src/services/render/workerRenderHostRuntimeHandlers';

const REQUEST_ID = 'request:adjustment-frame-300';
const TARGET_ID = 'preview-target';
const FRAME_INDEX = 300;
const SUBMIT_BY_MS = 1_000;
const EXPIRE_AFTER_MS = 1_100;

function createPlan(): MotionAdjustmentWorkerGpuExecutionPlan {
  const packet = planMotionAdjustmentOperations(createTwoAdjustmentFixture());
  return planMotionAdjustmentWorkerGpuExecution(packet, 'preview', {
    deadline: {
      requestId: REQUEST_ID,
      targetId: TARGET_ID,
      compositionId: packet.compositionId,
      timelineTime: packet.evaluationTime,
      frameIndex: FRAME_INDEX,
      intent: 'preview',
      submitByMs: SUBMIT_BY_MS,
      expireAfterMs: EXPIRE_AFTER_MS,
      exact: true,
    },
    graphVersion: 7,
    resourceNamespace: 'nested-occurrence:A',
  });
}

function createMixedPlan(): MotionAdjustmentWorkerGpuExecutionPlan {
  const packet = planMotionAdjustmentOperations(createTitleAdjustmentMontageFixture());
  return planMotionAdjustmentWorkerGpuExecution(packet, 'preview', {
    deadline: {
      requestId: REQUEST_ID,
      targetId: TARGET_ID,
      compositionId: packet.compositionId,
      timelineTime: packet.evaluationTime,
      frameIndex: FRAME_INDEX,
      intent: 'preview',
      submitByMs: SUBMIT_BY_MS,
      expireAfterMs: EXPIRE_AFTER_MS,
      exact: true,
    },
    graphVersion: 7,
    resourceNamespace: 'nested-occurrence:mixed',
  });
}

function createLayer(
  overrides: Partial<WorkerGpuWebCodecsFrameLayer> = {},
): WorkerGpuWebCodecsFrameLayer {
  return {
    sourceId: 'timeline-media:montage',
    mediaTime: 8,
    opacity: 1,
    blendMode: 'normal',
    renderLayer: {
      id: 'runtime-layer:montage',
      sourceClipId: 'montage',
      name: 'Montage',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      effects: [],
    },
    ...overrides,
  };
}

function createEnvelope(
  overrides: Partial<WorkerGpuAdjustmentEnvelopeInput> = {},
): WorkerGpuAdjustmentEnvelopeInput {
  const adjustmentPlan = createPlan();
  return {
    commandType: 'gpu.presentWebCodecsFrame',
    requestId: adjustmentPlan.frame.requestId,
    targetId: adjustmentPlan.frame.targetId,
    compositionId: adjustmentPlan.frame.compositionId,
    timelineTime: adjustmentPlan.frame.timelineTime,
    frameIndex: adjustmentPlan.frame.frameIndex,
    nowMs: 1_050,
    primarySourceId: 'timeline-media:montage',
    layers: [createLayer()],
    adjustmentPlan,
    ...overrides,
  };
}

function expectDiagnostic(
  input: WorkerGpuAdjustmentEnvelopeInput,
  code: string,
): void {
  const result = validateWorkerGpuAdjustmentEnvelope(input);
  expect(result).toMatchObject({
    ok: false,
    code,
    message: expect.stringContaining(`[${code}]`),
  });
}

function createRuntimeContext() {
  return {
    signal: new AbortController().signal,
    log: vi.fn(),
    progress: vi.fn(),
    diagnostic: vi.fn(),
  } as unknown as Parameters<typeof workerRenderHostRuntimeHandler>[1];
}

describe('MD7 Worker GPU adjustment runtime envelope gates', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_050);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('admits only the exact one-shot command and frozen source binding', () => {
    const input = createEnvelope();
    const result = validateWorkerGpuAdjustmentEnvelope(input);

    expect(result).toEqual({ ok: true, plan: input.adjustmentPlan });
  });

  it('admits generic title and timeline bindings only when their frozen kinds match', () => {
    const plan = createMixedPlan();
    const input = {
      commandType: 'gpu.presentFrameStack' as const,
      requestId: plan.frame.requestId,
      targetId: plan.frame.targetId,
      compositionId: plan.frame.compositionId,
      timelineTime: plan.frame.timelineTime,
      frameIndex: plan.frame.frameIndex,
      nowMs: 1_050,
      sourceBindings: [
        { layerId: 'montage', sourceKind: 'timeline-media' as const, sourceId: 'timeline-media:montage' },
        { layerId: 'title', sourceKind: 'title' as const, sourceId: 'title:hero' },
      ],
      adjustmentPlan: plan,
    };

    expect(validateWorkerGpuAdjustmentEnvelope(input)).toEqual({ ok: true, plan });
    expect(validateWorkerGpuAdjustmentEnvelope({
      ...input,
      sourceBindings: input.sourceBindings.map((binding) => (
        binding.layerId === 'title'
          ? { ...binding, sourceKind: 'timeline-media' as const }
          : binding
      )),
    })).toMatchObject({
      ok: false,
      code: 'MD7_ADJUSTMENT_SOURCE_KIND_MISMATCH',
    });
  });

  it.each([
    ['requestId', { requestId: 'request:other' }, 'MD7_ADJUSTMENT_REQUEST_ID_MISMATCH'],
    ['targetId', { targetId: 'target:other' }, 'MD7_ADJUSTMENT_TARGET_ID_MISMATCH'],
    ['compositionId', { compositionId: 'composition:other' }, 'MD7_ADJUSTMENT_COMPOSITION_ID_MISMATCH'],
    ['missing compositionId', { compositionId: undefined }, 'MD7_ADJUSTMENT_COMPOSITION_ID_MISMATCH'],
    ['frameIndex', { frameIndex: FRAME_INDEX + 1 }, 'MD7_ADJUSTMENT_FRAME_INDEX_MISMATCH'],
    ['timelineTime', { timelineTime: 8.001 }, 'MD7_ADJUSTMENT_TIMELINE_TIME_MISMATCH'],
  ] as const)('rejects a mismatched %s', (_field, overrides, code) => {
    expectDiagnostic(createEnvelope(overrides), code);
  });

  it('rejects non-exact, invalid, and expired plans deterministically', () => {
    const nonExact = structuredClone(createPlan());
    (nonExact.frame as { exact: boolean }).exact = false;

    expectDiagnostic(
      createEnvelope({ adjustmentPlan: nonExact }),
      'MD7_ADJUSTMENT_EXACT_FRAME_REQUIRED',
    );
    expectDiagnostic(
      createEnvelope({ adjustmentPlan: { contractVersion: 999 } }),
      'MD7_ADJUSTMENT_PLAN_INVALID',
    );
    expectDiagnostic(
      createEnvelope({ nowMs: EXPIRE_AFTER_MS }),
      'MD7_ADJUSTMENT_PLAN_EXPIRED',
    );
  });

  it('rejects autonomous stream plans before considering frame bindings', () => {
    expectDiagnostic(
      createEnvelope({
        commandType: 'gpu.startWebCodecsStream',
        layers: [],
      }),
      'MD7_ADJUSTMENT_STREAM_FORBIDDEN',
    );
  });

  it('rejects missing, mismatched, and extra source bindings', () => {
    expectDiagnostic(
      createEnvelope({ layers: [{ ...createLayer(), renderLayer: undefined }] }),
      'MD7_ADJUSTMENT_SOURCE_BINDING_MISSING',
    );
    expectDiagnostic(
      createEnvelope({
        primarySourceId: 'timeline-media:wrong',
        layers: [createLayer({ sourceId: 'timeline-media:wrong' })],
      }),
      'MD7_ADJUSTMENT_SOURCE_ID_MISMATCH',
    );
    expectDiagnostic(
      createEnvelope({
        layers: [createLayer(), createLayer({ sourceId: 'timeline-media:extra' })],
      }),
      'MD7_ADJUSTMENT_SOURCE_BINDING_COUNT_MISMATCH',
    );
    expectDiagnostic(
      createEnvelope({ layers: [createLayer({ sourceKind: 'title' })] }),
      'MD7_ADJUSTMENT_SOURCE_KIND_UNSUPPORTED',
    );
    expectDiagnostic(
      createEnvelope({ primarySourceId: 'timeline-media:not-present' }),
      'MD7_ADJUSTMENT_PRIMARY_SOURCE_MISMATCH',
    );
  });

  it('returns stable diagnostics for malformed structured-clone envelopes', () => {
    for (const malformed of [
      null,
      { ...createEnvelope(), requestId: null },
      { ...createEnvelope(), sourceBindings: {} },
      { ...createEnvelope(), layers: [], sourceBindings: [] },
    ]) {
      expect(validateWorkerGpuAdjustmentEnvelope(malformed)).toMatchObject({
        ok: false,
        code: 'MD7_ADJUSTMENT_COMMAND_ENVELOPE_INVALID',
      });
    }
  });

  it('rejects an adjustment stream at the runtime handler before target or GPU work', async () => {
    const plan = createPlan();
    const command = {
      type: 'gpu.startWebCodecsStream',
      commandId: plan.frame.requestId,
      targetId: plan.frame.targetId,
      compositionId: plan.frame.compositionId,
      sourceId: 'timeline-media:montage',
      timelineTime: plan.frame.timelineTime,
      mediaTime: 8,
      frameIndex: plan.frame.frameIndex,
      playbackRate: 1,
      targetFps: 30,
      layers: [createLayer()],
      adjustmentPlan: plan,
    } as const;
    const input: WorkerRenderHostRuntimeJobInput = {
      command,
      sentAtMs: 1_000,
      nowMs: 1_050,
    };

    const result = await workerRenderHostRuntimeHandler(input, createRuntimeContext());

    expect(result).toMatchObject({
      output: {
        presentedFrameId: null,
        statusEvents: [
          { type: 'command-accepted', requestId: REQUEST_ID },
          {
            type: 'error',
            message: expect.stringContaining('[MD7_ADJUSTMENT_STREAM_FORBIDDEN]'),
            recoverable: false,
          },
          {
            type: 'stats',
            stats: {
              'workerGpu.adjustment.envelopeAccepted': false,
              'workerGpu.adjustment.envelopeDiagnosticCode': 'MD7_ADJUSTMENT_STREAM_FORBIDDEN',
            },
          },
        ],
      },
    });
  });

  it('rejects a stale one-shot envelope before checking target availability', async () => {
    const plan = createPlan();
    const input: WorkerRenderHostRuntimeJobInput = {
      command: {
        type: 'gpu.presentWebCodecsFrame',
        commandId: 'request:stale-envelope',
        targetId: plan.frame.targetId,
        compositionId: plan.frame.compositionId,
        sourceId: 'timeline-media:montage',
        timelineTime: plan.frame.timelineTime,
        mediaTime: 8,
        frameIndex: plan.frame.frameIndex,
        mode: 'advance',
        layers: [createLayer()],
        adjustmentPlan: plan,
      },
      sentAtMs: 1_000,
      nowMs: 1_050,
    };

    const result = await workerRenderHostRuntimeHandler(input, createRuntimeContext());

    expect(result).toMatchObject({
      output: {
        presentedFrameId: null,
        statusEvents: [
          { type: 'command-accepted', requestId: 'request:stale-envelope' },
          {
            type: 'error',
            message: expect.stringContaining('[MD7_ADJUSTMENT_REQUEST_ID_MISMATCH]'),
            recoverable: false,
          },
          {
            type: 'stats',
            stats: {
              'workerGpu.adjustment.envelopeAccepted': false,
              'workerGpu.adjustment.envelopeDiagnosticCode': 'MD7_ADJUSTMENT_REQUEST_ID_MISMATCH',
            },
          },
        ],
      },
    });
  });
});
