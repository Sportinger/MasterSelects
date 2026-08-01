import { describe, expect, it } from 'vitest';

import { buildWorkerGpuAdjustmentExecutionPlan } from '../../src/services/render/workerGpuAdjustmentPlanAdapter';
import type {
  WorkerGpuAdjustmentRuntimeSourceKind,
  WorkerGpuAdjustmentSourceBinding,
} from '../../src/services/render/workerGpuAdjustmentPlanAdapter';
import type { Layer, LayerSource } from '../../src/types/layers';

describe('MD7 mixed-source worker GPU adjustment plan adapter', () => {
  it('freezes bottom-to-top mixed-source order with a title above the adjustment', () => {
    const layers = [
      sourceLayer('title', { type: 'text' }),
      adjustmentLayer(),
      sourceLayer('motion', { type: 'motion' }),
      sourceLayer('nested', {
        type: 'image',
        nestedComposition: {
          compositionId: 'composition:child',
          layers: [],
          width: 1920,
          height: 1080,
        },
      }),
      sourceLayer('color', { type: 'color', color: '#112233' }),
      sourceLayer('solid', { type: 'solid' }),
      sourceLayer('image', { type: 'image' }),
      sourceLayer('video', { type: 'video', mediaTime: 3 }),
    ];
    const plan = buildPlan(layers, [
      binding('title', 'text', 'title:hero'),
      binding('motion', 'motion', 'motion-media-source/v1:image:motion-asset'),
      binding('nested', 'nestedComposition', 'nested-composition:child'),
      binding('color', 'color', 'timeline-media:color'),
      binding('solid', 'solid', 'timeline-media:solid'),
      binding('image', 'image', 'timeline-media:image'),
      binding('video', 'video', 'timeline-media:video'),
    ]);

    expect(plan).not.toBeNull();
    expect(plan?.passes.map((pass) => {
      if (pass.kind === 'resolve-source') {
        return `${pass.kind}:${pass.layerId}:${pass.sourceKind}`;
      }
      if ('layerId' in pass) return `${pass.kind}:${pass.layerId}`;
      return pass.kind;
    })).toEqual([
      'initialize-accumulator',
      'resolve-source:clip:video:timeline-media',
      'composite-source:clip:video',
      'resolve-source:clip:image:timeline-media',
      'composite-source:clip:image',
      'resolve-source:clip:solid:timeline-media',
      'composite-source:clip:solid',
      'resolve-source:clip:color:timeline-media',
      'composite-source:clip:color',
      'resolve-source:clip:nested:nested-composition',
      'composite-source:clip:nested',
      'resolve-source:clip:motion:motion-media',
      'composite-source:clip:motion',
      'snapshot-accumulator:clip:adjustment',
      'apply-adjustment-effect:clip:adjustment',
      'mix-adjustment-result:clip:adjustment',
      'resolve-source:clip:title:title',
      'composite-source:clip:title',
    ]);
  });

  it('retains the legacy videoSources input path', () => {
    const plan = buildWorkerGpuAdjustmentExecutionPlan({
      ...baseInput([adjustmentLayer(), sourceLayer('video', { type: 'video' })]),
      videoSources: [{ layerId: 'runtime:video', sourceId: 'timeline-media:video' }],
    });

    expect(plan?.passes).toContainEqual(expect.objectContaining({
      kind: 'resolve-source',
      layerId: 'clip:video',
      sourceKind: 'timeline-media',
      sourceId: 'timeline-media:video',
    }));
    expect(plan?.frame).toMatchObject({
      requestId: 'request:md7-mixed',
      targetId: 'preview',
      compositionId: 'composition:md7-mixed',
      timelineTime: 3,
      frameIndex: 18,
      intent: 'preview',
      submitByMs: 1_000,
      expireAfterMs: 2_000,
      exact: true,
      graphVersion: 18,
    });
  });

  it('preserves a complete frozen frame identity without deriving graph version or TTL', () => {
    const frozenFrameIdentity = {
      requestId: 'request:frozen-identity',
      targetId: 'export-target',
      compositionId: 'composition:md7-mixed',
      timelineTime: 3,
      frameIndex: 18,
      intent: 'export' as const,
      submitByMs: 7_250,
      expireAfterMs: 11_625,
      exact: true as const,
      graphVersion: 731,
    };
    const plan = buildWorkerGpuAdjustmentExecutionPlan({
      ...baseInput([adjustmentLayer(), sourceLayer('video', { type: 'video' })]),
      videoSources: [{ layerId: 'runtime:video', sourceId: 'timeline-media:video' }],
      frameIdentity: frozenFrameIdentity,
    });

    expect(frozenFrameIdentity.graphVersion).not.toBe(frozenFrameIdentity.frameIndex);
    expect(frozenFrameIdentity.expireAfterMs - frozenFrameIdentity.submitByMs).toBe(4_375);
    expect(plan?.frame).toEqual(frozenFrameIdentity);
  });

  it.each([
    'camera',
    'light',
    'model',
    'gaussian-avatar',
    'gaussian-splat',
  ] as const)('rejects unsupported %s bindings before frozen plan construction', (sourceKind) => {
    expect(() => buildPlan(
      [adjustmentLayer(), sourceLayer('unsupported', { type: sourceKind })],
      [binding('unsupported', sourceKind, `unsupported:${sourceKind}`)],
    )).toThrow(`Worker GPU adjustment source kind is not supported: ${sourceKind}`);
  });

  it('rejects an unsupported source layer even without a binding', () => {
    expect(() => buildPlan(
      [adjustmentLayer(), sourceLayer('camera', { type: 'camera' })],
      [],
    )).toThrow(
      'Worker GPU adjustment stack does not support source layer clip:camera (camera)',
    );
  });

  it('rejects duplicate and conflicting bindings deterministically', () => {
    const layers = [adjustmentLayer(), sourceLayer('video', { type: 'video' })];
    const admitted = binding('video', 'video', 'timeline-media:video');

    expect(() => buildPlan(layers, [admitted, admitted])).toThrow(
      'Worker GPU adjustment duplicate source binding: runtime:video',
    );
    expect(() => buildPlan(layers, [
      admitted,
      binding('video', 'video', 'timeline-media:other'),
    ])).toThrow(
      'Worker GPU adjustment conflicting source binding: runtime:video',
    );
  });

  it('rejects a binding whose runtime kind disagrees with its layer', () => {
    expect(() => buildPlan(
      [adjustmentLayer(), sourceLayer('image', { type: 'image' })],
      [binding('image', 'video', 'timeline-media:image')],
    )).toThrow(
      'Worker GPU adjustment source kind mismatch: clip:image (video != image)',
    );
  });

  it('rejects extra and non-admitted bindings before plan construction', () => {
    const video = sourceLayer('video', { type: 'video' });
    expect(() => buildPlan(
      [adjustmentLayer(), video],
      [
        binding('video', 'video', 'timeline-media:video'),
        binding('extra', 'image', 'timeline-media:extra'),
      ],
    )).toThrow(
      'Worker GPU adjustment source binding is not consumed: runtime:extra',
    );
    expect(() => buildPlan(
      [adjustmentLayer(), { ...video, opacity: 0 }],
      [binding('video', 'video', 'timeline-media:video')],
    )).toThrow(
      'Worker GPU adjustment source binding is not consumed: runtime:video',
    );
  });
});

function buildPlan(
  layers: readonly Layer[],
  sourceBindings: readonly WorkerGpuAdjustmentSourceBinding[],
) {
  return buildWorkerGpuAdjustmentExecutionPlan({
    ...baseInput(layers),
    sourceBindings,
  });
}

function baseInput(layers: readonly Layer[]) {
  return {
    layers,
    frameContext: { compositionId: 'composition:md7-mixed', timelineTimeSeconds: 3 },
    requestId: 'request:md7-mixed',
    targetId: 'preview',
    frameIndex: 18,
    intent: 'preview' as const,
    nowMs: 1_000,
    resourceNamespace: 'composition:md7-mixed:preview',
  };
}

function binding(
  id: string,
  sourceKind: WorkerGpuAdjustmentRuntimeSourceKind,
  sourceId: string,
): WorkerGpuAdjustmentSourceBinding {
  return { layerId: `runtime:${id}`, sourceKind, sourceId };
}

function sourceLayer(id: string, source: LayerSource): Layer {
  return layer(`runtime:${id}`, `clip:${id}`, source);
}

function adjustmentLayer(): Layer {
  return {
    ...layer(
      'runtime:adjustment',
      'clip:adjustment',
      { type: 'motion-adjustment' },
    ),
    effects: [{
      id: 'effect:brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.15 },
    }],
  };
}

function layer(id: string, sourceClipId: string, source: LayerSource): Layer {
  return {
    id,
    sourceClipId,
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
