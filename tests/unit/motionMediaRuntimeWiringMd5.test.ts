import { afterEach, describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types';
import {
  clearMotionFrameRuntimeCache,
  createMotionFrameRuntimeAdmission,
} from '../../src/engine/motion/MotionFrameRuntime';
import {
  createDefaultMotionLayerDefinition,
  type MotionLayerDefinition,
} from '../../src/types/motionDesign';
import { buildMotionMediaReuseKey } from '../../src/services/motionDesign/media/reuseKeyPlanner';

function layerFor(id: string, motion: MotionLayerDefinition): Layer {
  return {
    id,
    sourceClipId: `${id}-clip`,
    visible: true,
    opacity: 1,
    source: { type: 'motion', motion },
  } as unknown as Layer;
}

function motionWithTexture(mediaFileId?: string): MotionLayerDefinition {
  const motion = createDefaultMotionLayerDefinition('shape', { size: { w: 20, h: 10 } });
  // Frame media entries exist per effective replicator instance; a DISABLED
  // replicator evaluates to effectiveCount 0 and the frozen contract then
  // forbids media entries for the layer. Use an enabled 1x1 grid so exactly
  // one stable index (0) is covered.
  if (motion.replicator) {
    motion.replicator.enabled = true;
    motion.replicator.layout = {
      mode: 'grid',
      count: { columns: 1, rows: 1 },
      spacing: { x: 0, y: 0 },
      patternOffset: { x: 0, y: 0 },
    };
  }
  motion.appearance = {
    version: 1,
    items: [{
      id: 'texture-fill',
      kind: 'texture-fill',
      name: 'Texture Fill',
      visible: true,
      opacity: 1,
      mediaFileId,
      fit: 'contain',
      transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 },
    }],
  };
  return motion;
}

function frame(layers: readonly Layer[]) {
  const admission = createMotionFrameRuntimeAdmission({
    consumer: 'preview',
    compositionId: 'md5-runtime-composition',
    timelineTimeSeconds: 0.25,
    layers,
  });
    if (!admission.ok) throw new Error(JSON.stringify(admission.failures));
  return admission.consumerInput.frameState;
}

afterEach(() => {
  clearMotionFrameRuntimeCache();
});

describe('MD5 runtime media wiring', () => {
  it('places a texture-fill media evaluation in the evaluated frame', () => {
    const evaluated = frame([layerFor('md5-layer', motionWithTexture('image-alpha'))]);

    expect(evaluated.media.entries).toHaveLength(1);
    expect(evaluated.media.entries[0]?.evaluation).toMatchObject({
      sourceId: 'motion-media-source/v1:image:image-alpha',
      status: 'ready',
      resolvedTime: { ticks: 0, ticksPerSecond: 1, seconds: 0 },
    });
    expect(evaluated.media.entries[0]?.evaluation.reuseKey).toBe(buildMotionMediaReuseKey(
      'motion-media-source/v1:image:image-alpha',
      { ticks: 0, ticksPerSecond: 1, seconds: 0 },
      {
        targetWidth: 20,
        targetHeight: 10,
        pixelRatio: 1,
        fitMode: 'fit',
        positionX: 0,
        positionY: 0,
        scaleX: 1,
        scaleY: 1,
        rotationDegrees: 0,
        tileRepeatX: 1,
        tileRepeatY: 1,
        tileOffsetX: 0,
        tileOffsetY: 0,
        sampling: 'linear',
      },
    ));
  });

  it('keeps frames without texture fills empty', () => {
    const motion = createDefaultMotionLayerDefinition('shape', { size: { w: 20, h: 10 } });
    const evaluated = frame([layerFor('md5-layer', motion)]);

    expect(evaluated.media.entries).toEqual([]);
    expect(evaluated.diagnostics).toEqual([]);
  });

  it('includes media binding changes in the evaluated frame identity', () => {
    const first = frame([layerFor('md5-layer', motionWithTexture('image-alpha'))]);
    const second = frame([layerFor('md5-layer', motionWithTexture('image-beta'))]);

    expect(second.evaluationRevision).not.toBe(first.evaluationRevision);
    expect(second.entityRevisions).toContainEqual({
      kind: 'media-binding',
      entityId: 'md5-layer',
      revision: 'media:image-beta',
    });
  });

  it('deduplicates matching texture fills through the media pool plan', () => {
    const evaluated = frame([
      layerFor('md5-layer-a', motionWithTexture('image-alpha')),
      layerFor('md5-layer-b', motionWithTexture('image-alpha')),
    ]);

    expect(evaluated.media.entries.map((entry) => entry.evaluation.reuseKey)).toEqual([
      evaluated.media.entries[0]?.evaluation.reuseKey,
      evaluated.media.entries[0]?.evaluation.reuseKey,
    ]);
    expect(evaluated.media.poolPlan.framePool.admittedFrames).toHaveLength(1);
    expect(evaluated.media.poolPlan.requests[1]?.reusesFrame).toBe(true);
  });

  it('is byte-deterministic across builds', () => {
    const first = frame([layerFor('md5-layer', motionWithTexture('image-alpha'))]);
    const second = frame([layerFor('md5-layer', motionWithTexture('image-alpha'))]);

    expect(JSON.stringify(second.media.entries)).toBe(JSON.stringify(first.media.entries));
  });

  it('ignores a texture fill without mediaFileId without a diagnostic', () => {
    const evaluated = frame([layerFor('md5-layer', motionWithTexture())]);

    expect(evaluated.media.entries).toEqual([]);
    expect(evaluated.diagnostics).toEqual([]);
  });

  it('produces no media entries for a disabled replicator (contract forbids them at effectiveCount 0)', () => {
    const motion = motionWithTexture('image-alpha');
    if (motion.replicator) motion.replicator.enabled = false;
    const evaluated = frame([layerFor('md5-disabled', motion)]);

    // The engine renders plain texture fills directly from the motion
    // definition; frame media entries exist for replicated decode planning.
    expect(evaluated.media.entries).toEqual([]);
    expect(evaluated.diagnostics).toEqual([]);
  });

  it('fans media entries out per effective instance for a replicated layer', () => {
    const motion = motionWithTexture('image-alpha');
    if (motion.replicator) {
      motion.replicator.layout = {
        mode: 'grid',
        count: { columns: 3, rows: 2 },
        spacing: { x: 30, y: 20 },
        patternOffset: { x: 0, y: 0 },
      };
    }
    const evaluated = frame([layerFor('md5-fanout', motion)]);

    expect(evaluated.media.entries).toHaveLength(6);
    expect(evaluated.media.entries.map((entry) => entry.request.instanceIndex))
      .toEqual([0, 1, 2, 3, 4, 5]);
  });
});
