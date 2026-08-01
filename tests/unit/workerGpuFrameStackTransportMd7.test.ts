import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
  createWorkerGpuNestedOccurrenceNamespace,
  type WorkerGpuFrameStackAdmission,
  type WorkerGpuFrameStackContractV1,
  type WorkerGpuFrameStackIdentity,
} from '../../src/services/render/workerGpuFrameStackContract';
import {
  WORKER_GPU_FRAME_STACK_COMMAND_TRANSFER_POLICY,
  assertWorkerGpuPresentFrameStackCommand,
  collectWorkerGpuRuntimeCommandTransferables,
  type WorkerGpuPresentFrameStackCommand,
} from '../../src/services/render/workerGpuRuntimeCommands';

class FakeImageBitmap {
  readonly width: number;
  readonly height: number;
  closeCount = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  close(): void {
    this.closeCount += 1;
  }
}

const frame: WorkerGpuFrameStackIdentity = {
  requestId: 'request:frame-stack-transport',
  targetId: 'preview',
  compositionId: 'composition:root',
  timelineTime: 2,
  frameIndex: 60,
  intent: 'preview',
  submitByMs: 1_000,
  expireAfterMs: 2_000,
  graphVersion: 17,
  exact: true,
};

const admission: WorkerGpuFrameStackAdmission = {
  nowMs: 1_500,
  requestId: frame.requestId,
  targetId: frame.targetId,
  intent: frame.intent,
  graphVersion: frame.graphVersion,
};

function renderLayer(id: string) {
  return {
    id: `runtime:${id}`,
    sourceClipId: id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'normal' as const,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    effects: [],
  };
}

function bitmapBinding(id: string, bitmap: FakeImageBitmap) {
  return {
    layerId: id,
    runtimeSourceKind: 'image' as const,
    sourceKind: 'timeline-media' as const,
    sourceId: `timeline:${id}`,
    renderLayer: renderLayer(id),
    payload: {
      kind: 'bitmap' as const,
      bitmap: bitmap as unknown as ImageBitmap,
      width: bitmap.width,
      height: bitmap.height,
      ownership: 'transferred-once' as const,
    },
  };
}

function createCommand(): {
  readonly command: WorkerGpuPresentFrameStackCommand;
  readonly rootBitmap: FakeImageBitmap;
  readonly childBitmap: FakeImageBitmap;
} {
  const rootBitmap = new FakeImageBitmap(320, 180);
  const childBitmap = new FakeImageBitmap(160, 90);
  const childNamespace = createWorkerGpuNestedOccurrenceNamespace(
    'occurrence:root',
    'nested-child',
  );
  const child: WorkerGpuFrameStackContractV1 = {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: childNamespace,
    dimensions: { width: 160, height: 90 },
    frame: {
      ...frame,
      compositionId: 'composition:child',
      timelineTime: 0.5,
    },
    execution: { kind: 'ordered-sources', bottomToTopLayerIds: ['child-image'] },
    bindings: [bitmapBinding('child-image', childBitmap)],
  };
  const stack: WorkerGpuFrameStackContractV1 = {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: 'occurrence:root',
    dimensions: { width: 320, height: 180 },
    frame,
    execution: {
      kind: 'ordered-sources',
      bottomToTopLayerIds: ['root-image', 'nested-child'],
    },
    bindings: [
      bitmapBinding('root-image', rootBitmap),
      {
        layerId: 'nested-child',
        runtimeSourceKind: 'nestedComposition',
        sourceKind: 'nested-composition',
        sourceId: 'nested-composition:composition:child',
        renderLayer: renderLayer('nested-child'),
        payload: {
          kind: 'nested-stack',
          reference: {
            sourceId: 'nested-composition:composition:child',
            compositionId: 'composition:child',
            localTimelineTime: 0.5,
            occurrenceNamespace: childNamespace,
          },
          stack: child,
        },
      },
    ],
  };
  return {
    rootBitmap,
    childBitmap,
    command: {
      type: 'gpu.presentFrameStack',
      commandId: frame.requestId,
      admission,
      stack,
    },
  };
}

describe('MD7 atomic frame-stack transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('declares its one explicit transferable ownership path', () => {
    expect(WORKER_GPU_FRAME_STACK_COMMAND_TRANSFER_POLICY).toEqual({
      acceptsTransferables: true,
      transferableFields: [
        'stack.bindings[].payload.bitmap',
        'stack.bindings[].payload.stack (recursive)',
      ],
      payloadKind: 'validated-exact-one-shot-frame-stack',
    });
  });

  it('validates the complete recursive stack before collecting each bitmap once', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const { command, rootBitmap, childBitmap } = createCommand();

    expect(() => assertWorkerGpuPresentFrameStackCommand(command)).not.toThrow();
    expect(collectWorkerGpuRuntimeCommandTransferables(command)).toEqual([
      rootBitmap,
      childBitmap,
    ]);
  });

  it('rejects command-id and admission substitution before exposing transferables', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const { command } = createCommand();
    expect(() => collectWorkerGpuRuntimeCommandTransferables({
      ...command,
      commandId: 'request:substituted',
    })).toThrow(/MD7_FRAME_STACK_COMMAND_ENVELOPE_INVALID/u);
    expect(() => collectWorkerGpuRuntimeCommandTransferables({
      ...command,
      admission: { ...command.admission, targetId: 'target:substituted' },
    })).toThrow(/MD7_FRAME_STACK_ADMISSION_MISMATCH/u);
  });

  it('rejects duplicate recursive bitmap ownership', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const { command, rootBitmap } = createCommand();
    const nested = command.stack.bindings[1];
    if (nested?.payload.kind !== 'nested-stack') throw new Error('Expected nested stack');
    const duplicate = {
      ...command,
      stack: {
        ...command.stack,
        bindings: [
          command.stack.bindings[0],
          {
            ...nested,
            payload: {
              ...nested.payload,
              stack: {
                ...nested.payload.stack,
                bindings: [bitmapBinding('child-image', rootBitmap)],
              },
            },
          },
        ],
      },
    } satisfies WorkerGpuPresentFrameStackCommand;

    expect(() => collectWorkerGpuRuntimeCommandTransferables(duplicate))
      .toThrow(/MD7_FRAME_STACK_DUPLICATE_BITMAP_OWNERSHIP/u);
  });

  it('accepts only readback identity that exactly matches the frozen export frame', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const { command } = createCommand();
    const withReadback: WorkerGpuPresentFrameStackCommand = {
      ...command,
      readback: {
        readbackId: 'readback:frame-stack-transport',
        targetId: frame.targetId,
        compositionId: frame.compositionId,
        timelineTime: frame.timelineTime,
        frameIndex: frame.frameIndex,
        width: command.stack.dimensions.width,
        height: command.stack.dimensions.height,
        format: 'rgba8unorm',
        colorSpace: 'srgb',
      },
    };
    expect(() => assertWorkerGpuPresentFrameStackCommand(withReadback)).not.toThrow();
    expect(() => assertWorkerGpuPresentFrameStackCommand({
      ...withReadback,
      readback: { ...withReadback.readback!, timelineTime: frame.timelineTime + 1 },
    })).toThrow(/MD7_FRAME_STACK_READBACK_IDENTITY_INVALID/u);
    expect(() => assertWorkerGpuPresentFrameStackCommand({
      ...withReadback,
      readback: { ...withReadback.readback!, width: command.stack.dimensions.width + 1 },
    })).toThrow(/MD7_FRAME_STACK_READBACK_IDENTITY_INVALID/u);
  });
});
