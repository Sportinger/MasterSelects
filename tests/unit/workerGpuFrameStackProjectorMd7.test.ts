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
  WorkerGpuFrameStackProjectionError,
  projectWorkerGpuFrameStack,
  type WorkerGpuFrameStackHostSource,
  type WorkerGpuFrameStackProjectionRequest,
} from '../../src/services/render/workerGpuFrameStackProjector';

class FakeImageBitmap {
  readonly width: number;
  readonly height: number;
  closeCount = 0;

  constructor(width = 320, height = 180) {
    this.width = width;
    this.height = height;
  }

  close(): void {
    this.closeCount += 1;
  }
}

const frame: WorkerGpuFrameStackIdentity = {
  requestId: 'request:projector',
  targetId: 'preview',
  compositionId: 'composition:root',
  timelineTime: 2,
  frameIndex: 60,
  intent: 'preview',
  submitByMs: 1_000,
  expireAfterMs: 2_000,
  graphVersion: 60,
  exact: true,
};

const admission: WorkerGpuFrameStackAdmission = {
  nowMs: 1_500,
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
      id: 'effect:brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.2 },
    }],
  });
}

function request(
  layers: readonly Layer[],
  sources: readonly WorkerGpuFrameStackHostSource[],
  overrides: Partial<WorkerGpuFrameStackProjectionRequest> = {},
): WorkerGpuFrameStackProjectionRequest & { readonly clock: () => number } {
  return {
    layers,
    sources,
    width: 1920,
    height: 1080,
    frame,
    occurrenceNamespace: 'occurrence:root',
    intent: 'preview',
    surface: 'preview',
    nowMs: admission.nowMs,
    clock: () => admission.nowMs,
    ...overrides,
  };
}

function expectCode(
  promise: Promise<unknown>,
  code: WorkerGpuFrameStackProjectionError['code'],
): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code });
}

describe('MD7 Worker GPU host frame-stack projector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('projects title above Adjustment and video from one normalized runtime-id manifest', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const title = layer('title', { type: 'text' }, {
      effects: [{
        id: 'effect:title:contrast',
        name: 'Contrast',
        type: 'contrast',
        enabled: true,
        params: { amount: 1.2 },
      }],
    });
    const video = layer('video', { type: 'video', mediaTime: 2, videoRotation: 90 });
    const titleBitmap = new FakeImageBitmap();
    const rawTitleSource = { raw: 'title-canvas', width: 320, height: 180 } as unknown as ImageBitmapSource;
    const snapshotBitmap = vi.fn(async (input) => {
      expect(input).toEqual({
        source: rawTitleSource,
        sourceWidth: 320,
        sourceHeight: 180,
        maxSize: { width: 320, height: 180 },
      });
      return { bitmap: titleBitmap as unknown as ImageBitmap, width: 320, height: 180 };
    });

    const projected = await projectWorkerGpuFrameStack({
      ...request(
        [title, adjustmentLayer(), video],
        [{
          kind: 'bitmap',
          layerId: title.id,
          runtimeSourceKind: 'text',
          sourceId: 'title:hero',
          source: rawTitleSource,
          sourceWidth: 320,
          sourceHeight: 180,
        }, {
          kind: 'webcodecs',
          layerId: video.id,
          runtimeSourceKind: 'video',
          sourceId: 'gpu-video:hero',
          mediaTime: 2,
          width: 1920,
          height: 1080,
        }],
      ),
      snapshotBitmap,
    });

    expect(snapshotBitmap).toHaveBeenCalledOnce();
    expect(projected.execution.kind).toBe('frozen-adjustment');
    expect(projected.bindings.map((binding) => ({
      layerId: binding.layerId,
      runtimeSourceKind: binding.runtimeSourceKind,
      sourceKind: binding.sourceKind,
      sourceId: binding.sourceId,
    }))).toEqual([{
      layerId: 'clip:video',
      runtimeSourceKind: 'video',
      sourceKind: 'timeline-media',
      sourceId: 'gpu-video:hero',
    }, {
      layerId: 'clip:title',
      runtimeSourceKind: 'text',
      sourceKind: 'title',
      sourceId: 'title:hero',
    }]);
    const titleBinding = projected.bindings[1];
    expect(titleBinding?.renderLayer.effects).toEqual(title.effects);
    expect(titleBinding?.payload.kind).toBe('bitmap');
    expect(projected.bindings[0]?.renderLayer.videoRotation).toBe(90);
    expect(collectWorkerGpuFrameStackTransferables(projected, admission)).toEqual([titleBitmap]);
    expect(validateWorkerGpuFrameStackContract(projected, admission).ok).toBe(true);
    expect(titleBitmap.closeCount).toBe(0);
  });

  it('projects a non-Adjustment stack in explicit bottom-to-top order', async () => {
    const back = layer('back', { type: 'solid', color: '#112233' });
    const front = layer('front', {
      type: 'motion',
      motion: {
        version: 1,
        kind: 'shape',
        shape: { primitive: 'ellipse', size: { w: 400, h: 240 } },
        appearance: { version: 1, items: [] },
      },
    });
    const projected = await projectWorkerGpuFrameStack(request(
      [front, back],
      [{
        kind: 'motion',
        layerId: front.id,
        runtimeSourceKind: 'motion',
        sourceId: 'motion-media-source/v1:image:front-shape',
        width: 400,
        height: 240,
      }, {
        kind: 'solid',
        layerId: back.id,
        runtimeSourceKind: 'solid',
        sourceId: 'timeline:back',
        width: 1920,
        height: 1080,
      }],
    ));

    expect(projected.execution).toEqual({
      kind: 'ordered-sources',
      bottomToTopLayerIds: ['clip:back', 'clip:front'],
    });
    expect(projected.bindings.map((binding) => binding.payload.kind))
      .toEqual(['solid', 'motion']);
  });

  it('projects nested stacks recursively with derived occurrence identity', async () => {
    const childSolid = layer('child-solid', { type: 'solid', color: '#445566ff' });
    const childLayers = [childSolid];
    const nestedLayer = layer('nested', {
      type: 'image',
      nestedComposition: {
        compositionId: 'composition:child',
        layers: childLayers,
        width: 640,
        height: 360,
        currentTime: 0.75,
      },
    });
    const childNamespace = createWorkerGpuNestedOccurrenceNamespace(
      'occurrence:root',
      'clip:nested',
    );
    const childFrame: WorkerGpuFrameStackIdentity = {
      ...frame,
      compositionId: 'composition:child',
      timelineTime: 0.75,
    };
    const childRequest = request(
      childLayers,
      [{
        kind: 'solid',
        layerId: childSolid.id,
        runtimeSourceKind: 'solid',
        sourceId: 'timeline:child-solid',
        width: 640,
        height: 360,
      }],
      {
        width: 640,
        height: 360,
        frame: childFrame,
        occurrenceNamespace: childNamespace,
        surface: 'nested-preview',
      },
    );
    const sourceId = 'nested-composition:composition:child';
    const projected = await projectWorkerGpuFrameStack(request(
      [nestedLayer],
      [{
        kind: 'nested-stack',
        layerId: nestedLayer.id,
        runtimeSourceKind: 'nestedComposition',
        sourceId,
        request: childRequest,
      }],
    ));

    const payload = projected.bindings[0]?.payload;
    expect(payload?.kind).toBe('nested-stack');
    if (!payload || payload.kind !== 'nested-stack') throw new Error('Expected nested payload');
    expect(payload.reference).toEqual({
      sourceId,
      compositionId: 'composition:child',
      localTimelineTime: 0.75,
      occurrenceNamespace: childNamespace,
    });
    expect(payload.stack.execution).toEqual({
      kind: 'ordered-sources',
      bottomToTopLayerIds: ['clip:child-solid'],
    });
  });

  it('closes every newly-created bitmap when a later projection fails', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const first = layer('first', { type: 'image' });
    const invalid = layer('invalid', { type: 'solid', color: 'red' });
    const created = new FakeImageBitmap();
    const projected = projectWorkerGpuFrameStack({
      ...request(
        [invalid, first],
        [{
          kind: 'bitmap',
          layerId: first.id,
          runtimeSourceKind: 'image',
          sourceId: 'timeline:first',
          source: { width: 320, height: 180 } as ImageBitmapSource,
          sourceWidth: 320,
          sourceHeight: 180,
        }, {
          kind: 'solid',
          layerId: invalid.id,
          runtimeSourceKind: 'solid',
          sourceId: 'timeline:invalid',
          width: 1920,
          height: 1080,
        }],
      ),
      snapshotBitmap: async () => ({
        bitmap: created as unknown as ImageBitmap,
        width: 320,
        height: 180,
      }),
    });

    await expectCode(projected, 'MD7_FRAME_STACK_PROJECTOR_CONTRACT_REJECTED');
    expect(created.closeCount).toBe(1);
  });

  it('fails closed for missing, extra, inactive, mismatched, and stale source manifests', async () => {
    const video = layer('video', { type: 'video', mediaTime: 2 });
    await expectCode(
      projectWorkerGpuFrameStack(request([video], [])),
      'MD7_FRAME_STACK_PROJECTOR_MISSING_SOURCE',
    );
    await expectCode(
      projectWorkerGpuFrameStack(request([], [{
        kind: 'webcodecs',
        layerId: video.id,
        runtimeSourceKind: 'video',
        sourceId: 'gpu-video:extra',
        mediaTime: 2,
        width: 1920,
        height: 1080,
      }])),
      'MD7_FRAME_STACK_PROJECTOR_UNKNOWN_SOURCE',
    );
    await expectCode(
      projectWorkerGpuFrameStack(request(
        [{ ...video, visible: false }],
        [{
          kind: 'webcodecs',
          layerId: video.id,
          runtimeSourceKind: 'video',
          sourceId: 'gpu-video:inactive',
          mediaTime: 2,
          width: 1920,
          height: 1080,
        }],
      )),
      'MD7_FRAME_STACK_PROJECTOR_INACTIVE_SOURCE',
    );
    await expectCode(
      projectWorkerGpuFrameStack(request([video], [{
        kind: 'bitmap',
        layerId: video.id,
        runtimeSourceKind: 'image',
        sourceId: 'timeline:wrong-kind',
        source: { width: 320, height: 180 } as ImageBitmapSource,
        sourceWidth: 320,
        sourceHeight: 180,
      }])),
      'MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH',
    );
    await expectCode(
      projectWorkerGpuFrameStack(request([video], [{
        kind: 'webcodecs',
        layerId: video.id,
        runtimeSourceKind: 'video',
        sourceId: 'gpu-video:stale-time',
        mediaTime: 3,
        width: 1920,
        height: 1080,
      }])),
      'MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH',
    );
  });

  it('rejects nested namespace substitution before creating sibling snapshots', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const image = layer('image', { type: 'image' });
    const nestedLayer = layer('nested', {
      type: 'image',
      nestedComposition: {
        compositionId: 'composition:child',
        layers: [],
        width: 640,
        height: 360,
        currentTime: 2,
      },
    });
    const created = new FakeImageBitmap();
    const childRequest = request([], [], {
      frame: { ...frame, compositionId: 'composition:child' },
      occurrenceNamespace: 'occurrence:substituted',
    });

    const snapshotBitmap = vi.fn(async () => ({
      bitmap: created as unknown as ImageBitmap,
      width: 320,
      height: 180,
    }));
    await expectCode(projectWorkerGpuFrameStack({
      ...request(
        [nestedLayer, image],
        [{
          kind: 'bitmap',
          layerId: image.id,
          runtimeSourceKind: 'image',
          sourceId: 'timeline:image',
          source: { width: 320, height: 180 } as ImageBitmapSource,
          sourceWidth: 320,
          sourceHeight: 180,
        }, {
          kind: 'nested-stack',
          layerId: nestedLayer.id,
          runtimeSourceKind: 'nestedComposition',
          sourceId: 'nested-composition:composition:child',
          request: childRequest,
        }],
      ),
      snapshotBitmap,
    }), 'MD7_FRAME_STACK_PROJECTOR_NESTED_REFERENCE_MISMATCH');
    expect(snapshotBitmap).not.toHaveBeenCalled();
    expect(created.closeCount).toBe(0);
  });

  it('binds a nested request to the evaluated child composition, local time, dimensions, and layers', async () => {
    const child = layer('child', { type: 'solid', color: '#123456' });
    const childLayers = [child];
    const nested = layer('nested-bound', {
      type: 'image',
      nestedComposition: {
        compositionId: 'composition:child-bound',
        layers: childLayers,
        width: 640,
        height: 360,
        currentTime: 0.5,
      },
    });
    const namespace = createWorkerGpuNestedOccurrenceNamespace(
      'occurrence:root',
      'clip:nested-bound',
    );
    const childSource: WorkerGpuFrameStackHostSource = {
      kind: 'solid',
      layerId: child.id,
      runtimeSourceKind: 'solid',
      sourceId: 'timeline:child-bound',
      width: 640,
      height: 360,
    };
    const validChild = request(childLayers, [childSource], {
      width: 640,
      height: 360,
      occurrenceNamespace: namespace,
      surface: 'nested-preview',
      frame: {
        ...frame,
        compositionId: 'composition:child-bound',
        timelineTime: 0.5,
      },
    });
    const rootSource = (childRequest: WorkerGpuFrameStackProjectionRequest): WorkerGpuFrameStackHostSource => ({
      kind: 'nested-stack',
      layerId: nested.id,
      runtimeSourceKind: 'nestedComposition',
      sourceId: 'nested-composition:composition:child-bound',
      request: childRequest,
    });

    await expectCode(projectWorkerGpuFrameStack(request(
      [nested],
      [rootSource({
        ...validChild,
        frame: { ...validChild.frame, compositionId: 'composition:substituted' },
      })],
    )), 'MD7_FRAME_STACK_PROJECTOR_NESTED_REFERENCE_MISMATCH');
    await expectCode(projectWorkerGpuFrameStack(request(
      [nested],
      [rootSource({
        ...validChild,
        frame: { ...validChild.frame, timelineTime: 0.75 },
      })],
    )), 'MD7_FRAME_STACK_PROJECTOR_NESTED_REFERENCE_MISMATCH');
    await expectCode(projectWorkerGpuFrameStack(request(
      [nested],
      [rootSource({ ...validChild, width: 320 })],
    )), 'MD7_FRAME_STACK_PROJECTOR_NESTED_REFERENCE_MISMATCH');
    await expectCode(projectWorkerGpuFrameStack(request(
      [nested],
      [rootSource({ ...validChild, layers: [...childLayers] })],
    )), 'MD7_FRAME_STACK_PROJECTOR_NESTED_REFERENCE_MISMATCH');
  });

  it('freezes semantic input before an asynchronous bitmap snapshot can race it', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const image = layer('race-image', { type: 'image' });
    const adjustment = adjustmentLayer();
    const mutableFrame = { ...frame };
    const projectedBitmap = new FakeImageBitmap();
    let release!: (snapshot: { bitmap: ImageBitmap; width: number; height: number }) => void;
    const deferred = new Promise<{ bitmap: ImageBitmap; width: number; height: number }>((resolve) => {
      release = resolve;
    });
    const snapshotBitmap = vi.fn(() => deferred);
    const mutableRequest = request(
      [adjustment, image],
      [{
        kind: 'bitmap',
        layerId: image.id,
        runtimeSourceKind: 'image',
        sourceId: 'timeline:race-image',
        source: { width: 320, height: 180 } as ImageBitmapSource,
        sourceWidth: 320,
        sourceHeight: 180,
      }],
      { frame: mutableFrame },
    );
    const projection = projectWorkerGpuFrameStack({ ...mutableRequest, snapshotBitmap });
    expect(snapshotBitmap).toHaveBeenCalledOnce();

    (mutableFrame as { timelineTime: number }).timelineTime = 99;
    (mutableRequest as { width: number }).width = 640;
    (adjustment.effects[0].params as { amount: number }).amount = 0.9;
    release({
      bitmap: projectedBitmap as unknown as ImageBitmap,
      width: 320,
      height: 180,
    });

    const projected = await projection;
    expect(projected.frame.timelineTime).toBe(2);
    expect(projected.dimensions.width).toBe(1920);
    expect(JSON.stringify(projected.execution)).toContain('"amount":0.2');
    expect(JSON.stringify(projected.execution)).not.toContain('"amount":0.9');
  });

  it('rechecks expiry after a deferred snapshot and closes the newly-created bitmap', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const image = layer('expiring-image', { type: 'image' });
    const created = new FakeImageBitmap();
    let nowMs = admission.nowMs;
    let release!: (snapshot: { bitmap: ImageBitmap; width: number; height: number }) => void;
    const deferred = new Promise<{ bitmap: ImageBitmap; width: number; height: number }>((resolve) => {
      release = resolve;
    });
    const projection = projectWorkerGpuFrameStack({
      ...request([image], [{
        kind: 'bitmap',
        layerId: image.id,
        runtimeSourceKind: 'image',
        sourceId: 'timeline:expiring-image',
        source: { width: 320, height: 180 } as ImageBitmapSource,
        sourceWidth: 320,
        sourceHeight: 180,
      }]),
      clock: () => nowMs,
      snapshotBitmap: () => deferred,
    });
    nowMs = frame.expireAfterMs;
    release({ bitmap: created as unknown as ImageBitmap, width: 320, height: 180 });

    await expectCode(projection, 'MD7_FRAME_STACK_PROJECTOR_FRAME_MISMATCH');
    expect(created.closeCount).toBe(1);
  });

  it('rejects a source whose actual size exceeds its declared bitmap budget before allocation', async () => {
    const image = layer('oversized-image', { type: 'image' });
    const snapshotBitmap = vi.fn();
    await expectCode(projectWorkerGpuFrameStack({
      ...request([image], [{
        kind: 'bitmap',
        layerId: image.id,
        runtimeSourceKind: 'image',
        sourceId: 'timeline:oversized-image',
        source: { width: 20_000, height: 20_000 } as ImageBitmapSource,
        sourceWidth: 320,
        sourceHeight: 180,
      }]),
      snapshotBitmap,
    }), 'MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH');
    expect(snapshotBitmap).not.toHaveBeenCalled();
  });

  it('rejects borrowed bitmap aliasing without closing the host-owned input', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const image = layer('aliased-image', { type: 'image' });
    const borrowed = new FakeImageBitmap();
    await expectCode(projectWorkerGpuFrameStack({
      ...request([image], [{
        kind: 'bitmap',
        layerId: image.id,
        runtimeSourceKind: 'image',
        sourceId: 'timeline:aliased-image',
        source: borrowed as unknown as ImageBitmapSource,
        sourceWidth: 320,
        sourceHeight: 180,
      }]),
      snapshotBitmap: async () => ({
        bitmap: borrowed as unknown as ImageBitmap,
        width: 320,
        height: 180,
      }),
    }), 'MD7_FRAME_STACK_PROJECTOR_BITMAP_OWNERSHIP_INVALID');
    expect(borrowed.closeCount).toBe(0);
  });

  it('fails closed when ordered-source execution would discard 3D or vector-mask semantics', async () => {
    const solidSource = (target: Layer): WorkerGpuFrameStackHostSource => ({
      kind: 'solid',
      layerId: target.id,
      runtimeSourceKind: 'solid',
      sourceId: `timeline:${target.id}`,
      width: 1920,
      height: 1080,
    });
    const threeD = layer('three-d', { type: 'solid', color: '#123456' }, { is3D: true });
    await expectCode(
      projectWorkerGpuFrameStack(request([threeD], [solidSource(threeD)])),
      'MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE',
    );
    const masked = layer('masked', { type: 'solid', color: '#123456' }, {
      masks: [{} as NonNullable<Layer['masks']>[number]],
    });
    await expectCode(
      projectWorkerGpuFrameStack(request([masked], [solidSource(masked)])),
      'MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE',
    );
    const legacyMasked = layer('legacy-masked', { type: 'solid', color: '#123456' }, {
      maskClipId: 'mask:legacy',
    });
    await expectCode(
      projectWorkerGpuFrameStack(request([legacyMasked], [solidSource(legacyMasked)])),
      'MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE',
    );
    await expectCode(
      projectWorkerGpuFrameStack(request(
        [adjustmentLayer(), legacyMasked],
        [solidSource(legacyMasked)],
      )),
      'MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE',
    );
  });

  it('rejects non-exact frames and invalid deadline order before bitmap work', async () => {
    const image = layer('invalid-frame-image', { type: 'image' });
    const source: WorkerGpuFrameStackHostSource = {
      kind: 'bitmap',
      layerId: image.id,
      runtimeSourceKind: 'image',
      sourceId: 'timeline:invalid-frame-image',
      source: { width: 320, height: 180 } as ImageBitmapSource,
      sourceWidth: 320,
      sourceHeight: 180,
    };
    const snapshotBitmap = vi.fn();
    await expectCode(projectWorkerGpuFrameStack({
      ...request([image], [source], {
        frame: { ...frame, exact: false } as WorkerGpuFrameStackIdentity,
      }),
      snapshotBitmap,
    }), 'MD7_FRAME_STACK_PROJECTOR_FRAME_MISMATCH');
    await expectCode(projectWorkerGpuFrameStack({
      ...request([image], [source], {
        nowMs: 500,
        frame: { ...frame, submitByMs: 1_000, expireAfterMs: 900 },
      }),
      clock: () => 500,
      snapshotBitmap,
    }), 'MD7_FRAME_STACK_PROJECTOR_FRAME_MISMATCH');
    await expectCode(projectWorkerGpuFrameStack({
      ...request([image], [source], {
        occurrenceNamespace: '',
        frame: { ...frame, graphVersion: -1 },
      }),
      snapshotBitmap,
    }), 'MD7_FRAME_STACK_PROJECTOR_FRAME_MISMATCH');
    expect(snapshotBitmap).not.toHaveBeenCalled();
  });

  it('starts all source snapshots before any earlier snapshot can delay the frame', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const first = layer('concurrent-first', { type: 'image' });
    const second = layer('concurrent-second', { type: 'image' });
    const releases = new Map<ImageBitmapSource, (value: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }) => void>();
    const snapshotBitmap = vi.fn((input: { source: ImageBitmapSource }) => (
      new Promise<{ bitmap: ImageBitmap; width: number; height: number }>((resolve) => {
        releases.set(input.source, resolve);
      })
    ));
    const firstRaw = { width: 320, height: 180 } as ImageBitmapSource;
    const secondRaw = { width: 320, height: 180 } as ImageBitmapSource;
    const projection = projectWorkerGpuFrameStack({
      ...request([first, second], [{
        kind: 'bitmap',
        layerId: first.id,
        runtimeSourceKind: 'image',
        sourceId: 'timeline:concurrent-first',
        source: firstRaw,
        sourceWidth: 320,
        sourceHeight: 180,
      }, {
        kind: 'bitmap',
        layerId: second.id,
        runtimeSourceKind: 'image',
        sourceId: 'timeline:concurrent-second',
        source: secondRaw,
        sourceWidth: 320,
        sourceHeight: 180,
      }]),
      snapshotBitmap,
    });

    expect(snapshotBitmap).toHaveBeenCalledTimes(2);
    releases.get(firstRaw)?.({
      bitmap: new FakeImageBitmap() as unknown as ImageBitmap,
      width: 320,
      height: 180,
    });
    releases.get(secondRaw)?.({
      bitmap: new FakeImageBitmap() as unknown as ImageBitmap,
      width: 320,
      height: 180,
    });
    await expect(projection).resolves.toMatchObject({ bindings: expect.any(Array) });
  });

  it('rejects a snapshot that aliases any sibling borrowed source', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const first = layer('borrowed-first', { type: 'image' });
    const second = layer('borrowed-second', { type: 'image' });
    const firstBorrowed = new FakeImageBitmap();
    const secondBorrowed = new FakeImageBitmap();
    const created = new FakeImageBitmap();
    await expectCode(projectWorkerGpuFrameStack({
      ...request([first, second], [{
        kind: 'bitmap',
        layerId: first.id,
        runtimeSourceKind: 'image',
        sourceId: 'timeline:borrowed-first',
        source: firstBorrowed as unknown as ImageBitmapSource,
        sourceWidth: 320,
        sourceHeight: 180,
      }, {
        kind: 'bitmap',
        layerId: second.id,
        runtimeSourceKind: 'image',
        sourceId: 'timeline:borrowed-second',
        source: secondBorrowed as unknown as ImageBitmapSource,
        sourceWidth: 320,
        sourceHeight: 180,
      }]),
      snapshotBitmap: async ({ source }) => ({
        bitmap: source === secondBorrowed as unknown as ImageBitmapSource
          ? firstBorrowed as unknown as ImageBitmap
          : created as unknown as ImageBitmap,
        width: 320,
        height: 180,
      }),
    }), 'MD7_FRAME_STACK_PROJECTOR_BITMAP_OWNERSHIP_INVALID');
    expect(firstBorrowed.closeCount).toBe(0);
    expect(secondBorrowed.closeCount).toBe(0);
    expect(created.closeCount).toBe(1);
  });
});
