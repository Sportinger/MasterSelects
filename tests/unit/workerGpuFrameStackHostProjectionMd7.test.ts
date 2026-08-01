import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Layer, LayerSource } from '../../src/types/layers';
import {
  collectWorkerGpuFrameStackTransferables,
  createWorkerGpuNestedOccurrenceNamespace,
  validateWorkerGpuFrameStackContract,
  type WorkerGpuFrameStackAdmission,
  type WorkerGpuFrameStackIdentity,
} from '../../src/services/render/workerGpuFrameStackContract';
import {
  WorkerGpuFrameStackHostProjectionError,
  buildWorkerGpuFrameStackProjectionRequest,
  type WorkerGpuFrameStackHostProjectionInput,
  type WorkerGpuFrameStackResolvedVideoSource,
} from '../../src/services/render/workerGpuFrameStackHostProjection';
import {
  WorkerGpuFrameStackProjectionError,
  projectWorkerGpuFrameStack,
} from '../../src/services/render/workerGpuFrameStackProjector';

class FakeImageBitmap {
  readonly close = vi.fn();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
}

const NOW_MS = 1_500;
const frame: WorkerGpuFrameStackIdentity = {
  requestId: 'request:host-frame-stack',
  targetId: 'preview:host-frame-stack',
  compositionId: 'composition:root',
  timelineTime: 2.5,
  frameIndex: 75,
  intent: 'preview',
  submitByMs: 1_000,
  expireAfterMs: 2_000,
  graphVersion: 12,
  exact: true,
};
const admission: WorkerGpuFrameStackAdmission = {
  nowMs: NOW_MS,
  requestId: frame.requestId,
  targetId: frame.targetId,
  intent: frame.intent,
  graphVersion: frame.graphVersion,
};

function layer(id: string, source: LayerSource, overrides: Partial<Layer> = {}): Layer {
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
    ...overrides,
  };
}

function adjustmentLayer(): Layer {
  return layer('adjustment', { type: 'motion-adjustment' }, {
    effects: [{
      id: 'effect:host-brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.15 },
    }],
  });
}

function hostInput(
  layers: readonly Layer[],
  resolveVideoSource: WorkerGpuFrameStackHostProjectionInput['resolveVideoSource'] = () => null,
  overrides: Partial<WorkerGpuFrameStackHostProjectionInput> = {},
): WorkerGpuFrameStackHostProjectionInput {
  return {
    layers,
    width: 640,
    height: 360,
    frame,
    occurrenceNamespace: 'occurrence:host-root',
    intent: 'preview',
    surface: 'preview',
    nowMs: NOW_MS,
    resolveVideoSource,
    ...overrides,
  };
}

function expectProjectionCode(
  promise: Promise<unknown>,
  code: WorkerGpuFrameStackProjectionError['code'],
): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code });
}

describe('MD7 Worker GPU host projection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds and projects every admitted 2D host source while keeping Adjustment operation-only', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const htmlVideo = (
      { videoWidth: 640, videoHeight: 360, kind: 'html-video' }
    ) as unknown as HTMLVideoElement;
    const currentVideoFrame = (
      { displayWidth: 320, displayHeight: 180, kind: 'video-frame' }
    ) as unknown as VideoFrame;
    const imageElement = (
      { naturalWidth: 320, naturalHeight: 180, kind: 'image' }
    ) as unknown as HTMLImageElement;
    const textCanvas = (
      { width: 400, height: 100, kind: 'text' }
    ) as unknown as HTMLCanvasElement;

    const childSolid = layer('child-solid', {
      type: 'solid',
      color: '#445566',
      intrinsicWidth: 320,
      intrinsicHeight: 180,
    });
    const childLayers = [childSolid];
    const nested = layer('nested', {
      type: 'image',
      nestedComposition: {
        compositionId: 'composition:child',
        layers: childLayers,
        width: 320,
        height: 180,
        currentTime: 0.75,
      },
    });
    const webCodecsVideo = layer('web-video', { type: 'video', mediaTime: 2.5 });
    const htmlBitmapVideo = layer('html-video', { type: 'video', videoElement: htmlVideo });
    const frameBitmapVideo = layer('frame-video', {
      type: 'video',
      videoFrame: currentVideoFrame,
    });
    const solid = layer('solid', {
      type: 'solid',
      color: '#112233',
      intrinsicWidth: 640,
      intrinsicHeight: 360,
    });
    const color = layer('color', {
      type: 'color',
      color: '#abcdef',
      intrinsicWidth: 640,
      intrinsicHeight: 360,
    });
    const image = layer('image', { type: 'image', imageElement });
    const text = layer('text', { type: 'text', textCanvas });
    const motion = layer('motion', {
      type: 'motion',
      motion: {
        version: 1,
        kind: 'shape',
        shape: { primitive: 'rectangle', size: { w: 240, h: 120 } },
        appearance: { version: 1, items: [] },
      },
    });
    const adjustment = adjustmentLayer();
    const layers = [
      adjustment,
      motion,
      text,
      image,
      color,
      solid,
      frameBitmapVideo,
      htmlBitmapVideo,
      webCodecsVideo,
      nested,
    ];
    const resolvedVideos = new Map<string, WorkerGpuFrameStackResolvedVideoSource>([
      [webCodecsVideo.id, {
        kind: 'webcodecs',
        sourceId: 'timeline:video:webcodecs',
        mediaTime: 2.5,
        width: 640,
        height: 360,
      }],
      [htmlBitmapVideo.id, {
        kind: 'bitmap',
        sourceId: 'timeline:video:html',
        source: htmlVideo,
        width: 640,
        height: 360,
      }],
      [frameBitmapVideo.id, {
        kind: 'bitmap',
        sourceId: 'timeline:video:frame',
        source: currentVideoFrame,
        width: 320,
        height: 180,
      }],
    ]);
    const resolveVideoSource = vi.fn((target: Layer) => resolvedVideos.get(target.id) ?? null);

    const request = buildWorkerGpuFrameStackProjectionRequest(hostInput(
      layers,
      resolveVideoSource,
    ));

    expect(resolveVideoSource).toHaveBeenCalledTimes(3);
    expect(request.sources.map((source) => ({
      layerId: source.layerId,
      kind: source.kind,
      runtimeSourceKind: source.runtimeSourceKind,
      sourceId: source.sourceId,
    }))).toEqual([
      {
        layerId: motion.id,
        kind: 'motion',
        runtimeSourceKind: 'motion',
        sourceId: 'motion-media-source/v1:image:clip%3Amotion',
      },
      {
        layerId: text.id,
        kind: 'bitmap',
        runtimeSourceKind: 'text',
        sourceId: 'text:clip:text',
      },
      {
        layerId: image.id,
        kind: 'bitmap',
        runtimeSourceKind: 'image',
        sourceId: 'image:clip:image',
      },
      {
        layerId: color.id,
        kind: 'solid',
        runtimeSourceKind: 'color',
        sourceId: 'color:clip:color',
      },
      {
        layerId: solid.id,
        kind: 'solid',
        runtimeSourceKind: 'solid',
        sourceId: 'solid:clip:solid',
      },
      {
        layerId: frameBitmapVideo.id,
        kind: 'bitmap',
        runtimeSourceKind: 'video',
        sourceId: 'timeline:video:frame',
      },
      {
        layerId: htmlBitmapVideo.id,
        kind: 'bitmap',
        runtimeSourceKind: 'video',
        sourceId: 'timeline:video:html',
      },
      {
        layerId: webCodecsVideo.id,
        kind: 'webcodecs',
        runtimeSourceKind: 'video',
        sourceId: 'timeline:video:webcodecs',
      },
      {
        layerId: nested.id,
        kind: 'nested-stack',
        runtimeSourceKind: 'nestedComposition',
        sourceId: 'nested-composition:composition:child',
      },
    ]);
    expect(request.sources.some((source) => source.layerId === adjustment.id)).toBe(false);

    const nestedSource = request.sources.at(-1);
    if (!nestedSource || nestedSource.kind !== 'nested-stack') {
      throw new Error('Expected nested host source');
    }
    const childNamespace = createWorkerGpuNestedOccurrenceNamespace(
      request.occurrenceNamespace,
      'clip:nested',
    );
    expect(nestedSource.request).toMatchObject({
      layers: childLayers,
      width: 320,
      height: 180,
      occurrenceNamespace: childNamespace,
      frame: {
        ...frame,
        compositionId: 'composition:child',
        timelineTime: 0.75,
      },
    });

    const createdBySource = new Map<object, FakeImageBitmap>();
    const snapshotBitmap = vi.fn(async (input: {
      readonly source: ImageBitmapSource;
      readonly sourceWidth: number;
      readonly sourceHeight: number;
    }) => {
      const bitmap = new FakeImageBitmap(input.sourceWidth, input.sourceHeight);
      createdBySource.set(input.source as object, bitmap);
      return {
        bitmap: bitmap as unknown as ImageBitmap,
        width: input.sourceWidth,
        height: input.sourceHeight,
      };
    });
    const projected = await projectWorkerGpuFrameStack({
      ...request,
      clock: () => NOW_MS,
      snapshotBitmap,
    });

    expect(snapshotBitmap).toHaveBeenCalledTimes(4);
    expect(projected.bindings.map((binding) => binding.layerId)).toEqual([
      'clip:nested',
      'clip:web-video',
      'clip:html-video',
      'clip:frame-video',
      'clip:solid',
      'clip:color',
      'clip:image',
      'clip:text',
      'clip:motion',
    ]);
    expect(projected.execution.kind).toBe('frozen-adjustment');
    if (projected.execution.kind !== 'frozen-adjustment') {
      throw new Error('Expected frozen Adjustment execution');
    }
    expect(projected.execution.plan.passes).toContainEqual(expect.objectContaining({
      kind: 'apply-adjustment-effect',
      layerId: 'clip:adjustment',
      effectId: 'effect:host-brightness',
    }));
    expect(projected.execution.plan.passes.filter((pass) => pass.kind === 'resolve-source'))
      .toHaveLength(9);

    const nestedBinding = projected.bindings[0];
    if (!nestedBinding || nestedBinding.payload.kind !== 'nested-stack') {
      throw new Error('Expected nested projected binding');
    }
    expect(nestedBinding.payload.reference).toEqual({
      sourceId: 'nested-composition:composition:child',
      compositionId: 'composition:child',
      localTimelineTime: 0.75,
      occurrenceNamespace: childNamespace,
    });
    expect(nestedBinding.payload.stack.frame).toEqual({
      ...frame,
      compositionId: 'composition:child',
      timelineTime: 0.75,
    });
    expect(validateWorkerGpuFrameStackContract(projected, admission).ok).toBe(true);
    expect(collectWorkerGpuFrameStackTransferables(projected, admission))
      .toHaveLength(4);
    for (const created of createdBySource.values()) {
      expect(created.close).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['target-preview', 'nested-preview'],
    ['export', 'export'],
  ] as const)('propagates %s adjustment semantics into the correct nested surface', async (
    rootSurface,
    expectedNestedSurface,
  ) => {
    const childSolid = layer('surface-child-solid', {
      type: 'solid',
      color: '#224466',
      intrinsicWidth: 320,
      intrinsicHeight: 180,
    });
    const childAdjustment = adjustmentLayer();
    const nested = layer('surface-nested', {
      type: 'image',
      nestedComposition: {
        compositionId: 'composition:surface-child',
        layers: [childAdjustment, childSolid],
        width: 320,
        height: 180,
        currentTime: 0.5,
      },
    });
    const intent = rootSurface === 'export' ? 'export' : 'preview';
    const rootFrame = { ...frame, intent };
    const projectionRequest = buildWorkerGpuFrameStackProjectionRequest(hostInput(
        [adjustmentLayer(), nested],
        () => null,
        {
          frame: rootFrame,
          intent,
          surface: rootSurface,
        },
      ));
    const projected = await projectWorkerGpuFrameStack({
      ...projectionRequest,
      clock: () => NOW_MS,
    });

    expect(projected.execution.kind).toBe('frozen-adjustment');
    if (projected.execution.kind !== 'frozen-adjustment') {
      throw new Error('Expected root Adjustment plan');
    }
    expect(projected.execution.plan.renderPlan.surface).toBe(rootSurface);
    const nestedPayload = projected.bindings[0]?.payload;
    expect(nestedPayload?.kind).toBe('nested-stack');
    if (!nestedPayload || nestedPayload.kind !== 'nested-stack') {
      throw new Error('Expected nested stack payload');
    }
    expect(nestedPayload.stack.execution.kind).toBe('frozen-adjustment');
    if (nestedPayload.stack.execution.kind !== 'frozen-adjustment') {
      throw new Error('Expected nested Adjustment plan');
    }
    expect(nestedPayload.stack.execution.plan.renderPlan.surface).toBe(expectedNestedSurface);
  });

  it('admits bitmap video as timeline-media/bitmap and closes its snapshot once on failure', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const borrowedFrame = {
      displayWidth: 320,
      displayHeight: 180,
      close: vi.fn(),
    } as unknown as VideoFrame;
    const video = layer('bitmap-video-contract', {
      type: 'video',
      videoFrame: borrowedFrame,
    });
    const resolveVideoSource = (): WorkerGpuFrameStackResolvedVideoSource => ({
      kind: 'bitmap',
      sourceId: 'timeline:video:bitmap-contract',
      source: borrowedFrame,
      width: 320,
      height: 180,
    });
    const request = buildWorkerGpuFrameStackProjectionRequest(hostInput(
      [video],
      resolveVideoSource,
    ));
    const transferred = new FakeImageBitmap(320, 180);
    const projected = await projectWorkerGpuFrameStack({
      ...request,
      clock: () => NOW_MS,
      snapshotBitmap: async () => ({
        bitmap: transferred as unknown as ImageBitmap,
        width: 320,
        height: 180,
      }),
    });

    expect(projected.bindings).toHaveLength(1);
    expect(projected.bindings[0]).toMatchObject({
      runtimeSourceKind: 'video',
      sourceKind: 'timeline-media',
      sourceId: 'timeline:video:bitmap-contract',
      payload: {
        kind: 'bitmap',
        bitmap: transferred,
        ownership: 'transferred-once',
      },
    });
    expect(validateWorkerGpuFrameStackContract(projected, admission).ok).toBe(true);
    expect(collectWorkerGpuFrameStackTransferables(projected, admission)).toEqual([transferred]);
    expect(transferred.close).not.toHaveBeenCalled();
    expect(borrowedFrame.close).not.toHaveBeenCalled();

    const rejected = new FakeImageBitmap(319, 180);
    await expectProjectionCode(projectWorkerGpuFrameStack({
      ...request,
      clock: () => NOW_MS,
      snapshotBitmap: async () => ({
        bitmap: rejected as unknown as ImageBitmap,
        width: 319,
        height: 180,
      }),
    }), 'MD7_FRAME_STACK_PROJECTOR_BITMAP_SNAPSHOT_FAILED');
    expect(rejected.close).toHaveBeenCalledOnce();
    expect(borrowedFrame.close).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'image raw source',
      target: layer('missing-image', { type: 'image' }),
      message: 'has no exact raw bitmap source',
    },
    {
      label: 'text intrinsic dimensions',
      target: layer('missing-text-size', {
        type: 'text',
        textCanvas: {} as HTMLCanvasElement,
      }),
      message: 'has no positive intrinsic dimensions',
    },
  ])('rejects a missing $label before projection', ({ target, message }) => {
    expect(() => buildWorkerGpuFrameStackProjectionRequest(hostInput([target])))
      .toThrowError(expect.objectContaining({
        name: 'WorkerGpuFrameStackHostProjectionError',
        layerId: target.id,
        message: expect.stringContaining(message),
      }));
  });

  it('rejects a nested host source without an exact currentTime', () => {
    const nested = layer('missing-nested-time', {
      type: 'image',
      nestedComposition: {
        compositionId: 'composition:missing-time',
        layers: [],
        width: 320,
        height: 180,
      },
    });

    expect(() => buildWorkerGpuFrameStackProjectionRequest(hostInput([nested])))
      .toThrowError(expect.objectContaining({
        name: 'WorkerGpuFrameStackHostProjectionError',
        layerId: nested.id,
        message: expect.stringContaining('no exact local frame time'),
      }));
  });

  it('rejects 3D semantics and unsupported host source kinds', async () => {
    const threeD = layer('three-d', { type: 'solid', color: '#123456' }, { is3D: true });
    const request = buildWorkerGpuFrameStackProjectionRequest(hostInput([threeD]));
    await expectProjectionCode(projectWorkerGpuFrameStack({
      ...request,
      clock: () => NOW_MS,
    }), 'MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE');

    const camera = layer('camera', { type: 'camera' });
    expect(() => buildWorkerGpuFrameStackProjectionRequest(hostInput([camera])))
      .toThrowError(WorkerGpuFrameStackHostProjectionError);
  });

  it('rejects video when the host resolver returns null', () => {
    const video = layer('unresolved-video', { type: 'video', mediaTime: 2.5 });
    const resolveVideoSource = vi.fn(() => null);

    expect(() => buildWorkerGpuFrameStackProjectionRequest(hostInput(
      [video],
      resolveVideoSource,
    ))).toThrowError(expect.objectContaining({
      name: 'WorkerGpuFrameStackHostProjectionError',
      layerId: video.id,
      message: expect.stringContaining('neither an admitted Worker WebCodecs source'),
    }));
    expect(resolveVideoSource).toHaveBeenCalledOnce();
  });
});
