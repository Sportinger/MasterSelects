import { describe, expect, it } from 'vitest';

import {
  createMotionFrameRuntimeAdmission,
} from '../../src/engine/motion/MotionFrameRuntime';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';
import type { Keyframe } from '../../src/types/keyframes';
import type { Layer } from '../../src/types/layers';
import type { TimelineClip } from '../../src/types/timeline';
import { getInterpolatedMotionLayer } from '../../src/utils/motionInterpolation';

function createAnimatedReplicatorClip(): TimelineClip {
  const motion = createDefaultMotionLayerDefinition('shape', {
    size: { w: 8, h: 8 },
  });
  if (motion.replicator?.layout.mode !== 'grid') {
    throw new Error('Expected the default Replicator to use the Grid layout');
  }
  motion.replicator.enabled = true;
  motion.replicator.layout.count = { columns: 40, rows: 25 };
  motion.replicator.layout.spacing = { x: 12, y: 10 };
  motion.replicator.layout.patternOffset = { x: 0, y: 0 };

  return {
    id: 'md3-animated-pattern',
    trackId: 'video-1',
    name: 'MD3 animated 40x25 pattern',
    file: new File([], 'md3-animated-pattern.msmotion'),
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: { type: 'motion-shape', naturalDuration: 4 },
    motion,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      anchor: { x: 0.5, y: 0.5 },
    },
    effects: [],
    isLoading: false,
  };
}

function createLayer(clip: TimelineClip, motion: NonNullable<TimelineClip['motion']>): Layer {
  return {
    id: clip.id,
    sourceClipId: clip.id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    effects: [],
    source: { type: 'motion', motion },
  } as unknown as Layer;
}

describe('MD3 Replicator gate-closure animated scenario', () => {
  it('evaluates an animated 40x25 pattern as 1,000 stable instances', () => {
    const clip = createAnimatedReplicatorClip();
    const persistedRevision = clip.motion?.replicator?.revision;
    const keyframes: Keyframe[] = [
      {
        id: 'spacing-start',
        clipId: clip.id,
        property: 'replicator.spacing.x',
        time: 0,
        value: 12,
        easing: 'linear',
      },
      {
        id: 'spacing-end',
        clipId: clip.id,
        property: 'replicator.spacing.x',
        time: 2,
        value: 20,
        easing: 'linear',
      },
      {
        id: 'pattern-offset-start',
        clipId: clip.id,
        property: 'replicator.patternOffset.x',
        time: 0,
        value: 0,
        easing: 'linear',
      },
      {
        id: 'pattern-offset-end',
        clipId: clip.id,
        property: 'replicator.patternOffset.x',
        time: 2,
        value: 16,
        easing: 'linear',
      },
      {
        id: 'rotation-start',
        clipId: clip.id,
        property: 'replicator.offset.rotation',
        time: 0,
        value: 0,
        easing: 'linear',
      },
      {
        id: 'rotation-end',
        clipId: clip.id,
        property: 'replicator.offset.rotation',
        time: 2,
        value: 90,
        easing: 'linear',
      },
    ];

    const startMotion = getInterpolatedMotionLayer(clip, keyframes, 0);
    const middleMotion = getInterpolatedMotionLayer(clip, keyframes, 1);
    expect(startMotion?.replicator?.revision).toBe(persistedRevision);
    expect(middleMotion?.replicator?.revision).toBe(persistedRevision);
    expect(middleMotion?.replicator).toMatchObject({
      layout: {
        mode: 'grid',
        count: { columns: 40, rows: 25 },
        spacing: { x: 16, y: 10 },
        patternOffset: { x: 8, y: 0 },
      },
      terminalTransform: { rotationDegrees: 45 },
    });

    const startAdmission = createMotionFrameRuntimeAdmission({
      consumer: 'preview',
      compositionId: 'md3-gate-closure',
      timelineTimeSeconds: 0,
      layers: [createLayer(clip, startMotion!)],
    });
    const middleAdmission = createMotionFrameRuntimeAdmission({
      consumer: 'export',
      compositionId: 'md3-gate-closure',
      timelineTimeSeconds: 1,
      layers: [createLayer(clip, middleMotion!)],
    });

    expect(startAdmission.ok && middleAdmission.ok).toBe(true);
    if (!startAdmission.ok || !middleAdmission.ok) return;
    const startEvaluation = startAdmission.consumerInput.frameState.replicators[0]?.evaluation;
    const middleEvaluation = middleAdmission.consumerInput.frameState.replicators[0]?.evaluation;
    expect(startEvaluation).toMatchObject({
      ok: true,
      requestedCount: 1_000,
      effectiveCount: 1_000,
      diagnostics: [],
    });
    expect(middleEvaluation).toMatchObject({
      ok: true,
      requestedCount: 1_000,
      effectiveCount: 1_000,
      diagnostics: [],
    });
    if (!startEvaluation?.ok || !middleEvaluation?.ok) return;
    expect(middleEvaluation.instances[0]?.index).toBe(0);
    expect(middleEvaluation.instances.at(-1)?.index).toBe(999);
    expect(middleEvaluation.instances.at(-1)?.normalizedIndex).toBe(1);
    expect(middleEvaluation.instances.at(-1)?.offsetTransform.rotationDegrees).toBe(45);
    expect(middleEvaluation.cacheKey).not.toBe(startEvaluation.cacheKey);
  });
});
