import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layer, LayerSource } from '../../src/types/layers';
import type { MotionLayerDefinition } from '../../src/types/motionDesign';
import {
  buildWorkerGpuAdjustmentExecutionPlan,
  type WorkerGpuAdjustmentRuntimeSourceKind,
  type WorkerGpuAdjustmentSourceBinding,
} from '../../src/services/render/workerGpuAdjustmentPlanAdapter';
import type { MotionAdjustmentWorkerGpuExecutionPlan } from '../../src/services/motionDesign/adjustment/workerGpuAdjustmentPlan';
import type { WorkerGpuWebCodecsRenderLayer } from '../../src/services/render/workerGpuRuntimeCommands';
import {
  WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
  WORKER_GPU_FRAME_STACK_MAX_NESTING_DEPTH,
  WORKER_GPU_FRAME_STACK_MAX_TOTAL_BINDINGS,
  WorkerGpuFrameStackContractError,
  assertWorkerGpuFrameStackContract,
  collectWorkerGpuFrameStackTransferables,
  createWorkerGpuNestedOccurrenceNamespace,
  validateWorkerGpuFrameStackContract,
  type WorkerGpuFrameStackAdmission,
  type WorkerGpuFrameStackContractV1,
  type WorkerGpuFrameStackIdentity,
  type WorkerGpuFrameStackSourceBinding,
} from '../../src/services/render/workerGpuFrameStackContract';

const REQUEST_ID = 'request:frame-stack';
const TARGET_ID = 'preview';
const FRAME_INDEX = 42;
const SUBMIT_BY_MS = 1_000;
const EXPIRE_AFTER_MS = 2_000;

class FakeImageBitmap {
  readonly width: number;
  readonly height: number;

  constructor(width = 64, height = 36) {
    this.width = width;
    this.height = height;
  }

  close(): void {}
}

function bitmap(width = 64, height = 36): ImageBitmap {
  return new FakeImageBitmap(width, height) as unknown as ImageBitmap;
}

function frame(
  compositionId: string,
  timelineTime = 2,
): WorkerGpuFrameStackIdentity {
  return {
    requestId: REQUEST_ID,
    targetId: TARGET_ID,
    compositionId,
    timelineTime,
    frameIndex: FRAME_INDEX,
    intent: 'preview',
    submitByMs: SUBMIT_BY_MS,
    expireAfterMs: EXPIRE_AFTER_MS,
    graphVersion: FRAME_INDEX,
    exact: true,
  };
}

function renderLayer(layerId: string): WorkerGpuWebCodecsRenderLayer {
  return {
    id: `runtime:${layerId}`,
    name: layerId,
    sourceClipId: layerId,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    effects: [],
  };
}

function binding(
  layerId: string,
  overrides: Partial<WorkerGpuFrameStackSourceBinding> = {},
): WorkerGpuFrameStackSourceBinding {
  const result: WorkerGpuFrameStackSourceBinding = {
    layerId,
    runtimeSourceKind: 'video',
    sourceKind: 'timeline-media',
    sourceId: `timeline:${layerId}`,
    renderLayer: renderLayer(layerId),
    payload: { kind: 'webcodecs', mediaTime: 2, width: 640, height: 360 },
    ...overrides,
  };
  if (overrides.runtimeSourceKind !== undefined) return result;
  const payloadKind = result.payload.kind;
  return {
    ...result,
    runtimeSourceKind: result.sourceKind === 'title'
      ? 'text'
      : result.sourceKind === 'nested-composition'
        ? 'nestedComposition'
        : result.sourceKind === 'motion-media'
          ? payloadKind === 'webcodecs'
            ? 'motionVideo'
            : payloadKind === 'bitmap'
              ? 'motionImage'
              : payloadKind === 'nested-stack'
                ? 'motionNestedComposition'
                : 'motion'
          : payloadKind === 'bitmap'
            ? 'image'
            : payloadKind === 'solid'
              ? 'solid'
              : 'video',
  };
}

function orderedStack(input: {
  readonly compositionId: string;
  readonly occurrenceNamespace: string;
  readonly bindings?: readonly WorkerGpuFrameStackSourceBinding[];
  readonly timelineTime?: number;
  readonly width?: number;
  readonly height?: number;
  readonly order?: readonly string[];
}): WorkerGpuFrameStackContractV1 {
  const bindings = input.bindings ?? [];
  return {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: input.occurrenceNamespace,
    dimensions: {
      width: input.width ?? 640,
      height: input.height ?? 360,
    },
    frame: frame(input.compositionId, input.timelineTime),
    execution: {
      kind: 'ordered-sources',
      bottomToTopLayerIds: input.order ?? bindings.map((entry) => entry.layerId),
    },
    bindings,
  };
}

function frozenStack(input: {
  readonly plan: MotionAdjustmentWorkerGpuExecutionPlan;
  readonly bindings: readonly WorkerGpuFrameStackSourceBinding[];
  readonly width?: number;
  readonly height?: number;
}): WorkerGpuFrameStackContractV1 {
  return {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: input.plan.resourceNamespace,
    dimensions: { width: input.width ?? 1920, height: input.height ?? 1080 },
    frame: { ...input.plan.frame, exact: true },
    execution: { kind: 'frozen-adjustment', plan: input.plan },
    bindings: input.bindings,
  };
}

function layer(id: string, source: LayerSource): Layer {
  return {
    id: `runtime:${id}`,
    sourceClipId: `clip:${id}`,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source,
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
}

function adjustmentLayer(id = 'adjustment'): Layer {
  return {
    ...layer(id, { type: 'motion-adjustment' }),
    effects: [{
      id: `effect:${id}:brightness`,
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.2 },
    }],
  };
}

function plan(input: {
  readonly compositionId: string;
  readonly occurrenceNamespace: string;
  readonly timelineTime?: number;
  readonly layers: readonly Layer[];
  readonly sourceBindings: readonly WorkerGpuAdjustmentSourceBinding[];
}): MotionAdjustmentWorkerGpuExecutionPlan {
  const result = buildWorkerGpuAdjustmentExecutionPlan({
    layers: input.layers,
    sourceBindings: input.sourceBindings,
    frameContext: {
      compositionId: input.compositionId,
      timelineTimeSeconds: input.timelineTime ?? 2,
    },
    requestId: REQUEST_ID,
    targetId: TARGET_ID,
    frameIndex: FRAME_INDEX,
    intent: 'preview',
    nowMs: 1_000,
    resourceNamespace: input.occurrenceNamespace,
  });
  if (!result) throw new Error('Expected a frozen Adjustment plan');
  return result;
}

function sourceBinding(
  id: string,
  sourceKind: WorkerGpuAdjustmentRuntimeSourceKind,
  sourceId: string,
): WorkerGpuAdjustmentSourceBinding {
  return { layerId: `runtime:${id}`, sourceKind, sourceId };
}

function admission(nowMs = 1_500): WorkerGpuFrameStackAdmission {
  return {
    nowMs,
    requestId: REQUEST_ID,
    targetId: TARGET_ID,
    intent: 'preview',
    graphVersion: FRAME_INDEX,
  };
}

function diagnosticCode(value: unknown, nowMs = 1_500): string | null {
  const result = validateWorkerGpuFrameStackContract(value, admission(nowMs));
  return result.ok ? null : result.code;
}

function nestedPayload(
  parentOccurrenceNamespace: string,
  parentLayerId: string,
  sourceId: string,
  stack: WorkerGpuFrameStackContractV1,
) {
  return {
    kind: 'nested-stack' as const,
    reference: {
      sourceId,
      compositionId: stack.frame.compositionId,
      localTimelineTime: stack.frame.timelineTime,
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
        parentOccurrenceNamespace,
        parentLayerId,
      ),
    },
    stack,
  };
}

const motionDefinition: MotionLayerDefinition = {
  version: 1,
  kind: 'shape',
  shape: { primitive: 'rectangle', size: { w: 320, h: 180 } },
  appearance: { version: 1, items: [] },
};

describe('MD7 recursive exact Worker GPU frame-stack contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the same intent domain as Worker GPU runtime commands', () => {
    for (const intent of ['playback', 'scrub', 'seek', 'preview', 'export', 'proof'] as const) {
      const stack = orderedStack({
        compositionId: `composition:intent:${intent}`,
        occurrenceNamespace: `occurrence:intent:${intent}`,
      });
      expect(validateWorkerGpuFrameStackContract({
        ...stack,
        frame: { ...stack.frame, intent },
      }, {
        ...admission(),
        intent,
      }).ok).toBe(true);
    }
    const stack = orderedStack({
      compositionId: 'composition:intent:thumbnail',
      occurrenceNamespace: 'occurrence:intent:thumbnail',
    });
    expect(validateWorkerGpuFrameStackContract({
      ...stack,
      frame: { ...stack.frame, intent: 'thumbnail' },
    }, {
      ...admission(),
      intent: 'thumbnail',
    } as unknown as WorkerGpuFrameStackAdmission)).toMatchObject({
      ok: false,
      code: 'MD7_FRAME_STACK_ADMISSION_MISMATCH',
    });
  });

  it('freezes a title above an Adjustment after the lower source', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const rootPlan = plan({
      compositionId: 'composition:root',
      occurrenceNamespace: 'occurrence:root',
      layers: [
        layer('title', { type: 'text' }),
        adjustmentLayer(),
        layer('video', { type: 'video', mediaTime: 2 }),
      ],
      sourceBindings: [
        sourceBinding('title', 'text', 'title:hero'),
        sourceBinding('video', 'video', 'timeline:video'),
      ],
    });
    const value = frozenStack({
      plan: rootPlan,
      bindings: [
        binding('clip:video', { sourceId: 'timeline:video' }),
        binding('clip:title', {
          sourceKind: 'title',
          sourceId: 'title:hero',
          payload: {
            kind: 'bitmap',
            bitmap: bitmap(),
            width: 64,
            height: 36,
            ownership: 'transferred-once',
          },
        }),
      ],
    });

    expect(validateWorkerGpuFrameStackContract(value, admission())).toEqual({ ok: true, contract: value });
    expect(rootPlan.passes.map((entry) => (
      'layerId' in entry ? `${entry.kind}:${entry.layerId}` : entry.kind
    ))).toEqual([
      'initialize-accumulator',
      'resolve-source:clip:video',
      'composite-source:clip:video',
      'snapshot-accumulator:clip:adjustment',
      'apply-adjustment-effect:clip:adjustment',
      'mix-adjustment-result:clip:adjustment',
      'resolve-source:clip:title',
      'composite-source:clip:title',
    ]);
  });

  it('admits an inner frozen Adjustment plan as an atomic recursive nested stack', () => {
    const childPlan = plan({
      compositionId: 'composition:child',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace('occurrence:root', 'clip:nested'),
      timelineTime: 1.5,
      layers: [adjustmentLayer('child-adjustment'), layer('child-video', { type: 'video', mediaTime: 1.5 })],
      sourceBindings: [sourceBinding('child-video', 'video', 'timeline:child-video')],
    });
    const child = frozenStack({
      plan: childPlan,
      bindings: [binding('clip:child-video', {
        sourceId: 'timeline:child-video',
        payload: { kind: 'webcodecs', mediaTime: 1.5, width: 1280, height: 720 },
      })],
      width: 1280,
      height: 720,
    });
    const root = orderedStack({
      compositionId: 'composition:root',
      occurrenceNamespace: 'occurrence:root',
      bindings: [binding('clip:nested', {
        sourceKind: 'nested-composition',
        sourceId: 'nested-composition:composition:child',
        payload: nestedPayload(
          'occurrence:root',
          'clip:nested',
          'nested-composition:composition:child',
          child,
        ),
      })],
    });

    expect(validateWorkerGpuFrameStackContract(root, admission())).toEqual({ ok: true, contract: root });
    expect(child.execution.kind).toBe('frozen-adjustment');
    expect(childPlan.passes.map((entry) => entry.kind)).toEqual([
      'initialize-accumulator',
      'resolve-source',
      'composite-source',
      'snapshot-accumulator',
      'apply-adjustment-effect',
      'mix-adjustment-result',
    ]);
    expect(child.execution.kind === 'frozen-adjustment'
      ? child.execution.plan.passes.map((entry) => entry.passId)
      : []).toEqual(childPlan.passes.map((entry) => entry.passId));
  });

  it('rejects stale frame identity, namespace, missing nested plan, and non-bijective execution', () => {
    const rootPlan = plan({
      compositionId: 'composition:root',
      occurrenceNamespace: 'occurrence:root',
      layers: [adjustmentLayer(), layer('video', { type: 'video', mediaTime: 2 })],
      sourceBindings: [sourceBinding('video', 'video', 'timeline:video')],
    });
    const valid = frozenStack({
      plan: rootPlan,
      bindings: [binding('clip:video', { sourceId: 'timeline:video' })],
    });

    expect(diagnosticCode({
      ...valid,
      frame: { ...valid.frame, timelineTime: valid.frame.timelineTime + 0.001 },
    })).toBe('MD7_FRAME_STACK_FRAME_IDENTITY_MISMATCH');
    expect(diagnosticCode({
      ...valid,
      occurrenceNamespace: 'occurrence:wrong',
    })).toBe('MD7_FRAME_STACK_NESTED_NAMESPACE_MISMATCH');
    expect(diagnosticCode({ ...valid, bindings: [] }))
      .toBe('MD7_FRAME_STACK_PLAN_BINDING_MISMATCH');
    expect(diagnosticCode({
      ...valid,
      bindings: [{ ...valid.bindings[0], sourceId: 'timeline:other' }],
    })).toBe('MD7_FRAME_STACK_PLAN_BINDING_MISMATCH');

    const child = orderedStack({
      compositionId: 'composition:child',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace('occurrence:root', 'clip:nested'),
    });
    const missingNestedPlan = {
      ...child,
      execution: { kind: 'frozen-adjustment' },
    };
    const root = orderedStack({
      compositionId: 'composition:root',
      occurrenceNamespace: 'occurrence:root',
      bindings: [binding('clip:nested', {
        sourceKind: 'nested-composition',
        sourceId: 'nested-composition:composition:child',
        payload: nestedPayload(
          'occurrence:root',
          'clip:nested',
          'nested-composition:composition:child',
          missingNestedPlan as WorkerGpuFrameStackContractV1,
        ),
      })],
    });
    expect(diagnosticCode(root)).toBe('MD7_FRAME_STACK_NESTED_PLAN_REQUIRED');

    const childPlan = plan({
      compositionId: 'composition:child-plan',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
        'occurrence:namespace-root',
        'clip:nested-plan',
      ),
      layers: [adjustmentLayer('child-adjustment'), layer('child-video', { type: 'video', mediaTime: 2 })],
      sourceBindings: [sourceBinding('child-video', 'video', 'timeline:child-video')],
    });
    const childWithWrongNamespace = {
      ...frozenStack({
        plan: childPlan,
        bindings: [binding('clip:child-video', { sourceId: 'timeline:child-video' })],
      }),
      occurrenceNamespace: 'occurrence:wrong-child-plan',
    };
    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:namespace-root',
      occurrenceNamespace: 'occurrence:namespace-root',
      bindings: [binding('clip:nested-plan', {
        sourceKind: 'nested-composition',
        sourceId: 'nested-composition:composition:child-plan',
        payload: nestedPayload(
          'occurrence:namespace-root',
          'clip:nested-plan',
          'nested-composition:composition:child-plan',
          childWithWrongNamespace,
        ),
      })],
    }))).toBe('MD7_FRAME_STACK_NESTED_NAMESPACE_MISMATCH');

    const ordered = orderedStack({
      compositionId: 'composition:ordered',
      occurrenceNamespace: 'occurrence:ordered',
      bindings: [binding('clip:a'), binding('clip:b')],
      order: ['clip:a', 'clip:a'],
    });
    expect(diagnosticCode(ordered)).toBe('MD7_FRAME_STACK_PLAN_BINDING_MISMATCH');
  });

  it('allows repeated sibling compositions only with distinct occurrence namespaces', () => {
    const childA = orderedStack({
      compositionId: 'composition:reused',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace('occurrence:root', 'clip:nested-a'),
    });
    const childB = orderedStack({
      compositionId: 'composition:reused',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace('occurrence:root', 'clip:nested-b'),
    });
    const root = orderedStack({
      compositionId: 'composition:root',
      occurrenceNamespace: 'occurrence:root',
      bindings: [
        binding('clip:nested-a', {
          sourceKind: 'nested-composition',
          sourceId: 'nested-composition:composition:reused',
          payload: nestedPayload(
            'occurrence:root',
            'clip:nested-a',
            'nested-composition:composition:reused',
            childA,
          ),
        }),
        binding('clip:nested-b', {
          sourceKind: 'nested-composition',
          sourceId: 'nested-composition:composition:reused',
          payload: nestedPayload(
            'occurrence:root',
            'clip:nested-b',
            'nested-composition:composition:reused',
            childB,
          ),
        }),
      ],
    });
    expect(validateWorkerGpuFrameStackContract(root, admission()).ok).toBe(true);

    const duplicateNamespace = {
      ...root,
      bindings: [
        root.bindings[0],
        {
          ...root.bindings[1],
          payload: nestedPayload(
            'occurrence:root',
            'clip:nested-b',
            'nested-composition:composition:reused',
            { ...childB, occurrenceNamespace: childA.occurrenceNamespace },
          ),
        },
      ],
    };
    expect(diagnosticCode(duplicateNamespace))
      .toBe('MD7_FRAME_STACK_DUPLICATE_OCCURRENCE_NAMESPACE');
  });

  it('rejects composition ancestry cycles and nesting beyond depth eight', () => {
    const cycleChild = orderedStack({
      compositionId: 'composition:root',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
        'occurrence:cycle-root',
        'clip:cycle',
      ),
    });
    const cycleRoot = orderedStack({
      compositionId: 'composition:root',
      occurrenceNamespace: 'occurrence:cycle-root',
      bindings: [binding('clip:cycle', {
        sourceKind: 'nested-composition',
        sourceId: 'nested-composition:composition:root',
        payload: nestedPayload(
          'occurrence:cycle-root',
          'clip:cycle',
          'nested-composition:composition:root',
          cycleChild,
        ),
      })],
    });
    expect(diagnosticCode(cycleRoot)).toBe('MD7_FRAME_STACK_COMPOSITION_CYCLE');

    const buildDeep = (index: number, occurrenceNamespace: string): WorkerGpuFrameStackContractV1 => {
      if (index > WORKER_GPU_FRAME_STACK_MAX_NESTING_DEPTH) {
        return orderedStack({
          compositionId: `composition:depth-${index}`,
          occurrenceNamespace,
        });
      }
      const layerId = `clip:depth-${index}`;
      const child = buildDeep(
        index + 1,
        createWorkerGpuNestedOccurrenceNamespace(occurrenceNamespace, layerId),
      );
      const sourceId = `nested-composition:composition:depth-${index + 1}`;
      return orderedStack({
        compositionId: `composition:depth-${index}`,
        occurrenceNamespace,
        bindings: [binding(layerId, {
          sourceKind: 'nested-composition',
          sourceId,
          payload: nestedPayload(occurrenceNamespace, layerId, sourceId, child),
        })],
      });
    };
    const deep = buildDeep(0, 'occurrence:depth-root');
    expect(diagnosticCode(deep)).toBe('MD7_FRAME_STACK_NESTING_DEPTH_EXCEEDED');
  });

  it('enforces bounded dimensions, total pixels, and total recursive bindings', () => {
    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:dimension',
      occurrenceNamespace: 'occurrence:dimension',
      width: 16_385,
      height: 1,
    }))).toBe('MD7_FRAME_STACK_DIMENSION_LIMIT');
    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:pixels',
      occurrenceNamespace: 'occurrence:pixels',
      width: 8_193,
      height: 8_193,
    }))).toBe('MD7_FRAME_STACK_PIXEL_BUDGET_EXCEEDED');

    const tooManyBindings = Array.from(
      { length: WORKER_GPU_FRAME_STACK_MAX_TOTAL_BINDINGS + 1 },
      (_, index) => binding(`clip:budget-${index}`),
    );
    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:bindings',
      occurrenceNamespace: 'occurrence:bindings',
      bindings: tooManyBindings,
    }))).toBe('MD7_FRAME_STACK_BINDING_BUDGET_EXCEEDED');

    const childBindings = Array.from(
      { length: Math.ceil(WORKER_GPU_FRAME_STACK_MAX_TOTAL_BINDINGS / 2) },
      (_, index) => binding(`clip:child-budget-${index}`),
    );
    const child = orderedStack({
      compositionId: 'composition:binding-child',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
        'occurrence:binding-root',
        'clip:binding-child',
      ),
      bindings: childBindings,
      width: 1,
      height: 1,
    });
    const rootBindings = Array.from(
      { length: Math.floor(WORKER_GPU_FRAME_STACK_MAX_TOTAL_BINDINGS / 2) },
      (_, index) => binding(`clip:root-budget-${index}`),
    );
    rootBindings.push(binding('clip:binding-child', {
      sourceKind: 'nested-composition',
      sourceId: 'nested-composition:composition:binding-child',
      payload: nestedPayload(
        'occurrence:binding-root',
        'clip:binding-child',
        'nested-composition:composition:binding-child',
        child,
      ),
    }));
    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:binding-root',
      occurrenceNamespace: 'occurrence:binding-root',
      bindings: rootBindings,
      width: 1,
      height: 1,
    }))).toBe('MD7_FRAME_STACK_BINDING_BUDGET_EXCEEDED');
  });

  it('admits only the exact source-kind, payload, and canonical motion-media subtype matrix', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const nested = orderedStack({
      compositionId: 'composition:child',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
        'occurrence:matrix',
        'clip:motion-nested',
      ),
    });
    const valid = orderedStack({
      compositionId: 'composition:matrix',
      occurrenceNamespace: 'occurrence:matrix',
      bindings: [
        binding('clip:title', {
          sourceKind: 'title',
          sourceId: 'title:hero',
          payload: { kind: 'bitmap', bitmap: bitmap(), width: 64, height: 36, ownership: 'transferred-once' },
        }),
        binding('clip:solid', {
          sourceId: 'timeline:solid',
          payload: { kind: 'solid', color: '#ff00aa', width: 640, height: 360 },
        }),
        binding('clip:motion', {
          sourceKind: 'motion-media',
          sourceId: 'motion-media-source/v1:image:motion-asset',
          payload: {
            kind: 'motion',
            definition: motionDefinition,
            timelineTime: 2,
            width: 320,
            height: 180,
          },
        }),
        binding('clip:motion-video', {
          sourceKind: 'motion-media',
          sourceId: 'motion-media-source/v1:video:video-asset',
          payload: { kind: 'webcodecs', mediaTime: 2, width: 640, height: 360 },
        }),
        binding('clip:motion-image', {
          sourceKind: 'motion-media',
          sourceId: 'motion-media-source/v1:image:image-asset',
          payload: { kind: 'bitmap', bitmap: bitmap(), width: 64, height: 36, ownership: 'transferred-once' },
        }),
        binding('clip:motion-nested', {
          sourceKind: 'motion-media',
          sourceId: 'motion-media-source/v1:nested-composition:child-asset',
          payload: nestedPayload(
            'occurrence:matrix',
            'clip:motion-nested',
            'motion-media-source/v1:nested-composition:child-asset',
            nested,
          ),
        }),
      ],
    });
    expect(validateWorkerGpuFrameStackContract(valid, admission()).ok).toBe(true);

    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:title-invalid',
      occurrenceNamespace: 'occurrence:title-invalid',
      bindings: [binding('clip:title', {
        sourceKind: 'title',
        sourceId: 'title:hero',
        payload: { kind: 'webcodecs', mediaTime: 2, width: 640, height: 360 },
      })],
    }))).toBe('MD7_FRAME_STACK_RUNTIME_SOURCE_KIND_MISMATCH');
    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:subtype-invalid',
      occurrenceNamespace: 'occurrence:subtype-invalid',
      bindings: [binding('clip:motion-video', {
        sourceKind: 'motion-media',
        sourceId: 'motion-media-source/v1:image:not-video',
        payload: { kind: 'webcodecs', mediaTime: 2, width: 640, height: 360 },
      })],
    }))).toBe('MD7_FRAME_STACK_SOURCE_ID_PAYLOAD_MISMATCH');
    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:motion-invalid',
      occurrenceNamespace: 'occurrence:motion-invalid',
      bindings: [binding('clip:motion', {
        sourceKind: 'timeline-media',
        sourceId: 'timeline:motion',
        payload: {
          kind: 'motion',
          definition: motionDefinition,
          timelineTime: 2,
          width: 320,
          height: 180,
        },
      })],
    }))).toBe('MD7_FRAME_STACK_RUNTIME_SOURCE_KIND_MISMATCH');
    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:image-subtype-invalid',
      occurrenceNamespace: 'occurrence:image-subtype-invalid',
      bindings: [binding('clip:motion-image', {
        sourceKind: 'motion-media',
        sourceId: 'motion-media-source/v1:video:not-image',
        payload: { kind: 'bitmap', bitmap: bitmap(), width: 64, height: 36, ownership: 'transferred-once' },
      })],
    }))).toBe('MD7_FRAME_STACK_SOURCE_ID_PAYLOAD_MISMATCH');
    const invalidNested = {
      ...nested,
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
        'occurrence:nested-subtype-invalid',
        'clip:motion-nested',
      ),
    };
    expect(diagnosticCode(orderedStack({
      compositionId: 'composition:nested-subtype-invalid',
      occurrenceNamespace: 'occurrence:nested-subtype-invalid',
      bindings: [binding('clip:motion-nested', {
        sourceKind: 'motion-media',
        sourceId: 'motion-media-source/v1:image:not-nested',
        payload: nestedPayload(
          'occurrence:nested-subtype-invalid',
          'clip:motion-nested',
          'motion-media-source/v1:image:not-nested',
          invalidNested,
        ),
      })],
    }))).toBe('MD7_FRAME_STACK_SOURCE_ID_PAYLOAD_MISMATCH');
  });

  it('rejects software/cache payloads and requires transferred-once bitmap ownership', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const base = orderedStack({
      compositionId: 'composition:ownership',
      occurrenceNamespace: 'occurrence:ownership',
      bindings: [binding('clip:image', {
        payload: {
          kind: 'bitmap',
          bitmap: bitmap(),
          width: 64,
          height: 36,
          ownership: 'transferred-once',
        },
      })],
    });
    const payload = base.bindings[0]?.payload;
    if (!payload || payload.kind !== 'bitmap') throw new Error('Expected bitmap payload');

    expect(diagnosticCode({
      ...base,
      bindings: [{
        ...base.bindings[0],
        payload: { ...payload, ownership: 'retained' },
      }],
    })).toBe('MD7_FRAME_STACK_BITMAP_OWNERSHIP_INVALID');
    expect(diagnosticCode({
      ...base,
      bindings: [{
        ...base.bindings[0],
        payload: { ...payload, retained: true },
      }],
    })).toBe('MD7_FRAME_STACK_INVALID_PAYLOAD');
    expect(diagnosticCode({
      ...base,
      bindings: [{
        ...base.bindings[0],
        payload: { kind: 'cached-bitmap', cacheKey: 'cache:a', width: 64, height: 36 },
      }],
    })).toBe('MD7_FRAME_STACK_INVALID_PAYLOAD');
    expect(diagnosticCode({
      ...base,
      bindings: [{
        ...base.bindings[0],
        payload: { kind: 'nested-frame', frame: { size: { x: 64, y: 36 }, layers: [] } },
      }],
    })).toBe('MD7_FRAME_STACK_INVALID_PAYLOAD');
  });

  it('rejects non-cloneable Motion data with the stable assertion diagnostic', () => {
    const invalid = orderedStack({
      compositionId: 'composition:motion-data',
      occurrenceNamespace: 'occurrence:motion-data',
      bindings: [binding('clip:motion', {
        sourceKind: 'motion-media',
        sourceId: 'motion-media-source/v1:image:motion-asset',
        payload: {
          kind: 'motion',
          definition: {
            ...motionDefinition,
            ui: { propertiesSearch: (() => 'not cloneable') as unknown as string },
          },
          timelineTime: 2,
          width: 320,
          height: 180,
        },
      })],
    });

    expect(diagnosticCode(invalid)).toBe('MD7_FRAME_STACK_NON_CLONEABLE_DATA');
    expect(() => assertWorkerGpuFrameStackContract(invalid, admission())).toThrowError(
      expect.objectContaining<Partial<WorkerGpuFrameStackContractError>>({
        code: 'MD7_FRAME_STACK_NON_CLONEABLE_DATA',
      }),
    );
  });

  it('rejects non-renderable Motion controls and non-canonical Worker solid colors', () => {
    const nonRenderableMotion = orderedStack({
      compositionId: 'composition:motion-control',
      occurrenceNamespace: 'occurrence:motion-control',
      bindings: [binding('clip:motion-control', {
        sourceKind: 'motion-media',
        sourceId: 'motion-media-source/v1:image:motion-control',
        payload: {
          kind: 'motion',
          definition: { version: 1, kind: 'null' },
          timelineTime: 2,
          width: 320,
          height: 180,
        },
      })],
    });
    expect(diagnosticCode(nonRenderableMotion)).toBe('MD7_FRAME_STACK_INVALID_PAYLOAD');

    const invalidMotionSize = orderedStack({
      compositionId: 'composition:motion-size',
      occurrenceNamespace: 'occurrence:motion-size',
      bindings: [binding('clip:motion-size', {
        sourceKind: 'motion-media',
        sourceId: 'motion-media-source/v1:image:motion-size',
        payload: {
          kind: 'motion',
          definition: {
            ...motionDefinition,
            shape: { primitive: 'rectangle', size: { w: 0, h: 180 } },
          },
          timelineTime: 2,
          width: 320,
          height: 180,
        },
      })],
    });
    expect(diagnosticCode(invalidMotionSize)).toBe('MD7_FRAME_STACK_DIMENSION_LIMIT');

    const invalidSolidColor = orderedStack({
      compositionId: 'composition:solid-color',
      occurrenceNamespace: 'occurrence:solid-color',
      bindings: [binding('clip:solid-color', {
        sourceId: 'timeline:solid-color',
        payload: { kind: 'solid', color: 'red', width: 320, height: 180 },
      })],
    });
    expect(diagnosticCode(invalidSolidColor)).toBe('MD7_FRAME_STACK_INVALID_PAYLOAD');
  });

  it('rejects malformed renderable Motion schemas before MotionRenderer can consume them', () => {
    const malformedGradient = orderedStack({
      compositionId: 'composition:malformed-gradient',
      occurrenceNamespace: 'occurrence:malformed-gradient',
      bindings: [binding('clip:motion-gradient', {
        sourceKind: 'motion-media',
        sourceId: 'motion-media-source/v1:image:malformed-gradient',
        payload: {
          kind: 'motion',
          definition: {
            ...motionDefinition,
            appearance: {
              version: 1,
              items: [{
                id: 'appearance:gradient',
                kind: 'linear-gradient',
                name: 'Gradient',
                visible: true,
                opacity: 1,
              } as never],
            },
          },
          timelineTime: 2,
          width: 320,
          height: 180,
        },
      })],
    });
    expect(diagnosticCode(malformedGradient)).toBe('MD7_FRAME_STACK_INVALID_PAYLOAD');

    const malformedReplicator = orderedStack({
      compositionId: 'composition:malformed-replicator',
      occurrenceNamespace: 'occurrence:malformed-replicator',
      bindings: [binding('clip:motion-replicator', {
        sourceKind: 'motion-media',
        sourceId: 'motion-media-source/v1:image:malformed-replicator',
        payload: {
          kind: 'motion',
          definition: {
            ...motionDefinition,
            replicator: {
              contract: 'masterselects.motion-replicator',
              version: 2,
              enabled: true,
            } as never,
          },
          timelineTime: 2,
          width: 320,
          height: 180,
        },
      })],
    });
    expect(diagnosticCode(malformedReplicator)).toBe('MD7_FRAME_STACK_INVALID_PAYLOAD');
  });

  it('charges declared media surfaces and frozen Adjustment intermediates to the pixel budget', () => {
    const oversizedMotion = orderedStack({
      compositionId: 'composition:motion-pixels',
      occurrenceNamespace: 'occurrence:motion-pixels',
      width: 1,
      height: 1,
      bindings: [binding('clip:motion-pixels', {
        sourceKind: 'motion-media',
        sourceId: 'motion-media-source/v1:image:motion-pixels',
        payload: {
          kind: 'motion',
          definition: motionDefinition,
          timelineTime: 2,
          width: 8_192,
          height: 8_192,
        },
      })],
    });
    expect(diagnosticCode(oversizedMotion)).toBe('MD7_FRAME_STACK_PIXEL_BUDGET_EXCEEDED');

    const adjustmentPlan = plan({
      compositionId: 'composition:adjustment-pixels',
      occurrenceNamespace: 'occurrence:adjustment-pixels',
      layers: [adjustmentLayer(), layer('video', { type: 'video', mediaTime: 2 })],
      sourceBindings: [sourceBinding('video', 'video', 'timeline:video')],
    });
    const oversizedAdjustment = frozenStack({
      plan: adjustmentPlan,
      width: 4_096,
      height: 4_096,
      bindings: [binding('clip:video', {
        sourceId: 'timeline:video',
        payload: { kind: 'webcodecs', mediaTime: 2, width: 4_096, height: 4_096 },
      })],
    });
    expect(diagnosticCode(oversizedAdjustment)).toBe('MD7_FRAME_STACK_PIXEL_BUDGET_EXCEEDED');
  });

  it('binds admission and expiry recursively instead of accepting stale exact plans', () => {
    const root = orderedStack({
      compositionId: 'composition:admission',
      occurrenceNamespace: 'occurrence:admission',
    });
    expect(diagnosticCode(root, EXPIRE_AFTER_MS)).toBe('MD7_FRAME_STACK_FRAME_EXPIRED');
    expect(diagnosticCode({
      ...root,
      frame: { ...root.frame, intent: 'export' },
    })).toBe('MD7_FRAME_STACK_ADMISSION_MISMATCH');
    expect(diagnosticCode({
      ...root,
      frame: { ...root.frame, graphVersion: FRAME_INDEX + 1 },
    })).toBe('MD7_FRAME_STACK_ADMISSION_MISMATCH');

    const childLayerId = 'clip:expiring-child';
    const child = {
      ...orderedStack({
        compositionId: 'composition:expiring-child',
        occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
          'occurrence:expiry-root',
          childLayerId,
        ),
      }),
      frame: {
        ...frame('composition:expiring-child'),
        expireAfterMs: 1_400,
      },
    };
    const nestedRoot = orderedStack({
      compositionId: 'composition:expiry-root',
      occurrenceNamespace: 'occurrence:expiry-root',
      bindings: [binding(childLayerId, {
        sourceKind: 'nested-composition',
        sourceId: 'nested-composition:composition:expiring-child',
        payload: nestedPayload(
          'occurrence:expiry-root',
          childLayerId,
          'nested-composition:composition:expiring-child',
          child,
        ),
      })],
    });
    expect(diagnosticCode(nestedRoot)).toBe('MD7_FRAME_STACK_FRAME_EXPIRED');
  });

  it('binds runtime subtypes and nested child metadata exactly', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const videoAsBitmap = orderedStack({
      compositionId: 'composition:video-as-bitmap',
      occurrenceNamespace: 'occurrence:video-as-bitmap',
      bindings: [binding('clip:video-as-bitmap', {
        runtimeSourceKind: 'video',
        sourceKind: 'timeline-media',
        sourceId: 'timeline:video-as-bitmap',
        payload: {
          kind: 'bitmap',
          bitmap: bitmap(),
          width: 64,
          height: 36,
          ownership: 'transferred-once',
        },
      })],
    });
    // HTMLVideoElement/VideoFrame sources are snapshotted on Main and remain
    // timeline-media/video even though their transfer payload is a bitmap.
    expect(diagnosticCode(videoAsBitmap)).toBeNull();

    const childLayerId = 'clip:bound-child';
    const child = orderedStack({
      compositionId: 'composition:bound-child',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
        'occurrence:bound-root',
        childLayerId,
      ),
      timelineTime: 0.75,
    });
    const sourceId = 'nested-composition:composition:bound-child';
    const validPayload = nestedPayload(
      'occurrence:bound-root',
      childLayerId,
      sourceId,
      child,
    );
    const substituted = orderedStack({
      compositionId: 'composition:bound-root',
      occurrenceNamespace: 'occurrence:bound-root',
      bindings: [binding(childLayerId, {
        sourceKind: 'nested-composition',
        sourceId,
        payload: {
          ...validPayload,
          reference: {
            ...validPayload.reference,
            compositionId: 'composition:other-child',
          },
        },
      })],
    });
    expect(diagnosticCode(substituted)).toBe('MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH');
  });

  it('enforces a global structured-clone string budget on render payload data', () => {
    const tooWide = orderedStack({
      compositionId: 'composition:clone-budget',
      occurrenceNamespace: 'occurrence:clone-budget',
      bindings: [binding('clip:clone-budget', {
        renderLayer: {
          ...renderLayer('clip:clone-budget'),
          name: 'x'.repeat(4_097),
        },
      })],
    });
    expect(diagnosticCode(tooWide)).toBe('MD7_FRAME_STACK_NON_CLONEABLE_DATA');
  });

  it('round-trips recursively nested data-only stacks through structuredClone', () => {
    const child = orderedStack({
      compositionId: 'composition:data-child',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
        'occurrence:data-root',
        'clip:nested',
      ),
      bindings: [binding('clip:solid', {
        sourceId: 'timeline:solid',
        payload: { kind: 'solid', color: '#101820', width: 320, height: 180 },
      })],
    });
    const root = orderedStack({
      compositionId: 'composition:data-root',
      occurrenceNamespace: 'occurrence:data-root',
      bindings: [binding('clip:nested', {
        sourceKind: 'nested-composition',
        sourceId: 'nested-composition:composition:data-child',
        payload: nestedPayload(
          'occurrence:data-root',
          'clip:nested',
          'nested-composition:composition:data-child',
          child,
        ),
      })],
    });

    const cloned = structuredClone(root);
    expect(cloned).toEqual(root);
    expect(validateWorkerGpuFrameStackContract(cloned, admission()).ok).toBe(true);
  });

  it('rejects duplicate bitmap owners and collects unique recursive transferables once', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const rootOnly = bitmap();
    const childShared = bitmap();
    const childOnly = bitmap();
    const child = orderedStack({
      compositionId: 'composition:transfer-child',
      occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
        'occurrence:transfer-root',
        'clip:nested',
      ),
      bindings: [
        binding('clip:shared-child', {
          payload: { kind: 'bitmap', bitmap: childShared, width: 64, height: 36, ownership: 'transferred-once' },
        }),
        binding('clip:child-only', {
          payload: { kind: 'bitmap', bitmap: childOnly, width: 64, height: 36, ownership: 'transferred-once' },
        }),
      ],
    });
    const root = orderedStack({
      compositionId: 'composition:transfer-root',
      occurrenceNamespace: 'occurrence:transfer-root',
      bindings: [
        binding('clip:shared-root', {
          sourceKind: 'title',
          sourceId: 'title:shared',
          payload: { kind: 'bitmap', bitmap: rootOnly, width: 64, height: 36, ownership: 'transferred-once' },
        }),
        binding('clip:nested', {
          sourceKind: 'nested-composition',
          sourceId: 'nested-composition:composition:transfer-child',
          payload: nestedPayload(
            'occurrence:transfer-root',
            'clip:nested',
            'nested-composition:composition:transfer-child',
            child,
          ),
        }),
      ],
    });

    expect(collectWorkerGpuFrameStackTransferables(root, admission())).toEqual([
      rootOnly,
      childShared,
      childOnly,
    ]);

    const duplicateOwner = {
      ...root,
      bindings: [{
        ...root.bindings[0],
        payload: {
          kind: 'bitmap' as const,
          bitmap: childShared,
          width: 64,
          height: 36,
          ownership: 'transferred-once' as const,
        },
      }, root.bindings[1]],
    };
    expect(diagnosticCode(duplicateOwner))
      .toBe('MD7_FRAME_STACK_DUPLICATE_BITMAP_OWNERSHIP');
  });
});
