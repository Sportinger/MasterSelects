import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeJobClient } from '../../src/runtime/worker';
import {
  WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
  createWorkerGpuNestedOccurrenceNamespace,
  type WorkerGpuFrameStackAdmission,
  type WorkerGpuFrameStackContractV1,
  type WorkerGpuFrameStackIdentity,
} from '../../src/services/render/workerGpuFrameStackContract';
import type { WorkerGpuPresentFrameStackCommand } from '../../src/services/render/workerGpuRuntimeCommands';
import {
  WORKER_RENDER_HOST_COMMAND_HANDLER_ID,
  WORKER_RENDER_HOST_PROVIDER_ID,
  type WorkerRenderHostRuntimeJobOutput,
} from '../../src/services/render/workerRenderHostRuntimeHandlers';
import { WorkerRenderHostRuntimeBridge } from '../../src/services/render/workerRenderHostRuntimeBridge';

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
  requestId: 'request:frame-stack-bridge',
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
    'occurrence:bridge-root',
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
    occurrenceNamespace: 'occurrence:bridge-root',
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

const output = {
  accepted: true,
  commandType: 'gpu.presentFrameStack',
} as WorkerRenderHostRuntimeJobOutput;

function createBridge() {
  const runJob = vi.fn(() => ({
    jobId: 'job:frame-stack',
    promise: Promise.resolve({
      jobId: 'job:frame-stack',
      output,
      diagnostics: [],
      logs: [],
    }),
    cancel: vi.fn(),
  }));
  const dispose = vi.fn();
  const client = { runJob, dispose } as unknown as RuntimeJobClient;
  return {
    bridge: new WorkerRenderHostRuntimeBridge({ client, now: () => 1_550 }),
    dispose,
    runJob,
  };
}

describe('MD7 Worker GPU FrameStack runtime bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates and sends every recursive bitmap exactly once at one-shot GPU priority', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const { command, rootBitmap, childBitmap } = createCommand();
    const { bridge, runJob } = createBridge();

    await expect(bridge.presentGpuFrameStack(command)).resolves.toBe(output);

    expect(runJob).toHaveBeenCalledOnce();
    const [request, options] = runJob.mock.calls[0] ?? [];
    expect(request).toEqual({
      providerId: WORKER_RENDER_HOST_PROVIDER_ID,
      handlerId: WORKER_RENDER_HOST_COMMAND_HANDLER_ID,
      input: {
        command,
        sentAtMs: 1_550,
        nowMs: 1_550,
      },
      priority: 20,
    });
    expect(options).toEqual({ transfer: [rootBitmap, childBitmap] });
    expect(new Set(options?.transfer).size).toBe(2);
    expect(rootBitmap.closeCount).toBe(0);
    expect(childBitmap.closeCount).toBe(0);
  });

  it('does not enqueue a job when the command envelope is invalid', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const { command } = createCommand();
    const { bridge, runJob } = createBridge();

    expect(() => bridge.presentGpuFrameStack({
      ...command,
      commandId: 'request:substituted',
    })).toThrow(/MD7_FRAME_STACK_COMMAND_ENVELOPE_INVALID/u);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('does not enqueue or expose transfer ownership for duplicate recursive bitmaps', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const { command, rootBitmap } = createCommand();
    const nested = command.stack.bindings[1];
    if (nested?.payload.kind !== 'nested-stack') throw new Error('Expected nested stack');
    const duplicate: WorkerGpuPresentFrameStackCommand = {
      ...command,
      stack: {
        ...command.stack,
        bindings: [
          command.stack.bindings[0]!,
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
    };
    const { bridge, runJob } = createBridge();

    expect(() => bridge.presentGpuFrameStack(duplicate))
      .toThrow(/MD7_FRAME_STACK_DUPLICATE_BITMAP_OWNERSHIP/u);
    expect(runJob).not.toHaveBeenCalled();
    expect(rootBitmap.closeCount).toBe(0);
  });
});
