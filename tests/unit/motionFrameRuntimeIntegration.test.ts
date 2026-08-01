import { afterEach, describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types';
import {
  clearMotionFrameRuntimeCache,
  createMotionFrameRuntimeAdmission,
  getMotionRenderSizeForAdmission,
  hasMotionFrameLayers,
  rebindMotionFrameRuntimeAdmission,
} from '../../src/engine/motion/MotionFrameRuntime';
import {
  createDefaultMotionLayerDefinition,
  createStrokeAppearance,
  type MotionLayerDefinition,
} from '../../src/types/motionDesign';
import { createLegacyReplicatorContractFixture } from '../../src/services/motionDesign/replicator/contractFixtures';

function createMotionLayer(
  id: string,
  motion: MotionLayerDefinition,
  nestedLayers?: readonly Layer[],
): Layer {
  return {
    id,
    sourceClipId: `${id}:clip`,
    visible: true,
    opacity: 1,
    source: {
      type: 'motion',
      motion,
      ...(nestedLayers
        ? {
            nestedComposition: {
              compositionId: `${id}:nested`,
              width: 1920,
              height: 1080,
              currentTime: 0,
              layers: nestedLayers,
            },
          }
        : {}),
    },
  } as unknown as Layer;
}

function createEnabledGridMotion(
  columns = 3,
  rows = 2,
): MotionLayerDefinition {
  const motion = createDefaultMotionLayerDefinition('shape', {
    size: { w: 100, h: 50 },
  });
  if (motion.replicator?.layout.mode !== 'grid') {
    throw new Error('Expected the default Replicator to use grid layout');
  }
  motion.replicator.enabled = true;
  motion.replicator.layout.count = { columns, rows };
  motion.replicator.layout.spacing = { x: 50, y: 80 };
  return motion;
}

afterEach(() => {
  clearMotionFrameRuntimeCache();
});

describe('MotionFrameRuntime integration', () => {
  it('collects visible nested Motion layers and migrates legacy Replicators to V2', () => {
    const legacyMotion = createDefaultMotionLayerDefinition('shape');
    legacyMotion.replicator = createLegacyReplicatorContractFixture() as unknown as MotionLayerDefinition['replicator'];
    const child = createMotionLayer('child-motion', legacyMotion);
    const root = createMotionLayer(
      'root-motion',
      createDefaultMotionLayerDefinition('shape'),
      [child],
    );

    const admission = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 1.5,
      layers: [root],
    });

    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    const childState = admission.consumerInput.frameState.replicators.find(
      (entry) => entry.layerId === 'child-motion',
    );
    expect(childState?.contract.version).toBe(2);
    expect(childState?.contract.layout).toMatchObject({
      mode: 'grid',
      count: { columns: 3, rows: 2 },
    });
    expect(childState?.evaluation.effectiveCount).toBe(6);
  });

  it('admits exact source bounds including visible outside strokes', () => {
    const motion = createEnabledGridMotion();
    motion.appearance?.items.push({
      ...createStrokeAppearance({ r: 1, g: 1, b: 1, a: 1 }),
      visible: true,
      width: 12,
      alignment: 'outside',
    });
    const admission = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [createMotionLayer('stroke-motion', motion)],
    });

    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.consumerInput.frameState.replicators[0]?.sourceBounds).toEqual({
      minX: -62,
      minY: -37,
      maxX: 62,
      maxY: 37,
    });
  });

  it('changes evaluation identity when content changes without a revision bump', () => {
    const firstMotion = createEnabledGridMotion();
    const first = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [createMotionLayer('motion-a', firstMotion)],
    });
    const secondMotion = structuredClone(firstMotion);
    if (secondMotion.replicator?.layout.mode !== 'grid') {
      throw new Error('Expected grid Replicator');
    }
    secondMotion.replicator.layout.spacing.x = 125;
    const second = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [createMotionLayer('motion-a', secondMotion)],
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.consumerInput.frameState).not.toBe(first.consumerInput.frameState);
    expect(second.consumerInput.frameState.evaluationRevision)
      .not.toBe(first.consumerInput.frameState.evaluationRevision);
    expect(second.consumerInput.frameState.replicators[0]?.evaluation.cacheKey)
      .not.toBe(first.consumerInput.frameState.replicators[0]?.evaluation.cacheKey);
  });

  it('assigns distinct runtime entry ids to repeated nested layer ids', () => {
    const duplicateChild = createMotionLayer('duplicate', createEnabledGridMotion());
    const duplicateRoot = createMotionLayer(
      'duplicate',
      createEnabledGridMotion(),
      [duplicateChild],
    );

    const admission = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [duplicateRoot],
    });

    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.consumerInput.frameState.replicators.map((entry) => entry.layerId))
      .toEqual(['duplicate', 'duplicate#2']);
  });

  it('detects Motion recursively for nested-only render surfaces', () => {
    const child = createMotionLayer('nested-motion', createEnabledGridMotion());
    const wrapper = {
      ...createMotionLayer('wrapper', createDefaultMotionLayerDefinition('shape'), [child]),
      source: {
        ...createMotionLayer('wrapper-source', createDefaultMotionLayerDefinition('shape'), [child]).source,
        type: 'solid',
        motion: undefined,
      },
    } as unknown as Layer;

    expect(hasMotionFrameLayers([wrapper])).toBe(true);
  });

  it('fails closed when Motion shares a cyclic nested layer tree', () => {
    const cyclicLayers: Layer[] = [];
    const wrapper = {
      ...createMotionLayer('cycle-wrapper', createDefaultMotionLayerDefinition('shape')),
      source: {
        type: 'solid',
        nestedComposition: {
          compositionId: 'cycle-comp',
          width: 1920,
          height: 1080,
          currentTime: 0,
          layers: cyclicLayers,
        },
      },
    } as unknown as Layer;
    cyclicLayers.push(createMotionLayer('cycle-motion', createEnabledGridMotion()), wrapper);

    expect(hasMotionFrameLayers(cyclicLayers)).toBe(true);
    expect(createMotionFrameRuntimeAdmission({
      consumer: 'export',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: cyclicLayers,
    })).toMatchObject({
      ok: false,
      failures: [{ code: 'MOTION_FRAME_RUNTIME_INVALID' }],
    });
  });

  it('rejects Replicator texture dimensions during frame admission', () => {
    const motion = createEnabledGridMotion(2, 1);
    if (motion.replicator?.layout.mode !== 'grid') return;
    motion.replicator.layout.spacing.x = 10_000;

    expect(createMotionFrameRuntimeAdmission({
      consumer: 'export',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [createMotionLayer('oversized-motion', motion)],
      deviceMaxTextureDimension2D: 4096,
      renderTargetMaxTexturePixels: 16 * 1024 * 1024,
    })).toMatchObject({
      ok: false,
      failures: [{ code: 'MOTION_REPLICATOR_TEXTURE_DIMENSION_EXCEEDED' }],
    });
  });

  it('fails before evaluation when the frame aggregate instance budget is exceeded', () => {
    const leftMotion = createEnabledGridMotion(300, 200);
    const rightMotion = createEnabledGridMotion(300, 200);
    if (!leftMotion.replicator || !rightMotion.replicator) return;
    leftMotion.replicator.userLimit = 100_000;
    rightMotion.replicator.userLimit = 100_000;

    const admission = createMotionFrameRuntimeAdmission({
      consumer: 'export',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [
        createMotionLayer('motion-a', leftMotion),
        createMotionLayer('motion-b', rightMotion),
      ],
    });

    expect(admission).toMatchObject({
      ok: false,
      failures: [{ code: 'MOTION_FRAME_RUNTIME_FRAME_BUDGET_EXCEEDED' }],
    });
  });

  it('rejects invalid explicit runtime limits instead of silently widening them', () => {
    const admission = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [createMotionLayer('motion-a', createEnabledGridMotion())],
      deviceMaxInstances: Number.NaN,
    });

    expect(admission).toMatchObject({
      ok: false,
      failures: [{ code: 'MOTION_FRAME_RUNTIME_INVALID_LIMIT' }],
    });
  });

  it('invalidates same-time frame state when appearance changes at identical bounds', () => {
    const firstMotion = createEnabledGridMotion();
    const firstLayer = createMotionLayer('motion-a', firstMotion);
    const first = createMotionFrameRuntimeAdmission({
      consumer: 'nested-preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 1,
      layers: [firstLayer],
    });
    const secondMotion = structuredClone(firstMotion);
    secondMotion.appearance!.items[0].opacity = 0.25;
    const second = createMotionFrameRuntimeAdmission({
      consumer: 'nested-preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 1,
      layers: [createMotionLayer('motion-a', secondMotion)],
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.consumerInput.frameState).not.toBe(first.consumerInput.frameState);
    expect(second.consumerInput.frameState.evaluationRevision)
      .not.toBe(first.consumerInput.frameState.evaluationRevision);
  });

  it('invalidates same-time frame state for mask, transition, and color changes', () => {
    const motion = createEnabledGridMotion();
    const baseLayer = createMotionLayer('motion-a', motion);
    const variants: Layer[] = [
      baseLayer,
      { ...baseLayer, maskFeather: 12 },
      {
        ...baseLayer,
        transitionRender: { kind: 'wipe', direction: 'left', progress: 0.5 },
      },
      {
        ...baseLayer,
        colorCorrection: { exposure: 0.25 } as unknown as Layer['colorCorrection'],
      },
    ];
    const admissions = variants.map((layer) => createMotionFrameRuntimeAdmission({
      consumer: 'nested-preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 1,
      layers: [layer],
    }));

    expect(admissions.every((admission) => admission.ok)).toBe(true);
    const revisions = admissions.flatMap((admission) => (
      admission.ok ? [admission.consumerInput.frameState.evaluationRevision] : []
    ));
    expect(new Set(revisions).size).toBe(variants.length);
  });

  it('fails closed for a structurally forged runtime admission', () => {
    const layer = createMotionLayer('motion-a', createEnabledGridMotion());
    const real = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 0,
      layers: [layer],
    });
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    const forged = {
      ...real,
      layerEntryIds: new WeakMap([[layer, 'motion-a']]),
    } as typeof real;

    expect(getMotionRenderSizeForAdmission(layer, forged).replicator).toMatchObject({
      enabled: false,
      instanceCount: 0,
    });
  });

  it('rebinds one frozen frame-state object to all four consumers', () => {
    const preview = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 2,
      layers: [createMotionLayer('motion-a', createEnabledGridMotion())],
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const nested = rebindMotionFrameRuntimeAdmission(preview, 'nested-preview');
    const target = rebindMotionFrameRuntimeAdmission(preview, 'target-preview');
    const exported = rebindMotionFrameRuntimeAdmission(preview, 'export');
    expect(nested?.ok && target?.ok && exported?.ok).toBe(true);
    if (!nested?.ok || !target?.ok || !exported?.ok) return;
    expect(nested.consumerInput.frameState).toBe(preview.consumerInput.frameState);
    expect(target.consumerInput.frameState).toBe(preview.consumerInput.frameState);
    expect(exported.consumerInput.frameState).toBe(preview.consumerInput.frameState);
    expect(Object.isFrozen(preview.consumerInput.frameState)).toBe(true);
  });

  it('reuses a composition superset state for a filtered target subset', () => {
    const layerA = createMotionLayer('motion-a', createEnabledGridMotion(2, 2));
    const layerB = createMotionLayer('motion-b', createEnabledGridMotion(4, 1));
    const preview = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 3,
      layers: [layerA, layerB],
    });
    const target = createMotionFrameRuntimeAdmission({
      consumer: 'target-preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 3,
      layers: [layerB],
      allowSupersetReuse: true,
    });

    expect(preview.ok && target.ok).toBe(true);
    if (!preview.ok || !target.ok) return;
    expect(target.consumerInput.frameState).toBe(preview.consumerInput.frameState);
    expect(target.consumerInput.frameState.replicators.map((entry) => entry.layerId))
      .toEqual(['motion-a', 'motion-b']);
  });

  it('does not reuse stale supersets for authoritative root requests', () => {
    const layerA = createMotionLayer('motion-a', createEnabledGridMotion(2, 2));
    const layerB = createMotionLayer('motion-b', createEnabledGridMotion(4, 1));
    const first = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 3,
      layers: [layerA, layerB],
    });
    const afterDeletion = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'composition-a',
      timelineTimeSeconds: 3,
      layers: [layerB],
    });

    expect(first.ok && afterDeletion.ok).toBe(true);
    if (!first.ok || !afterDeletion.ok) return;
    expect(afterDeletion.consumerInput.frameState).not.toBe(first.consumerInput.frameState);
    expect(afterDeletion.consumerInput.frameState.replicators.map((entry) => entry.layerId))
      .toEqual(['motion-b']);
  });
});
