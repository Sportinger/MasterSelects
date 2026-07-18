import { describe, expect, it } from 'vitest';

import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import type { ClipMask } from '../../src/types/masks';
import type { ClipTransform, TransitionSourceMap, TransitionSourceMapV2 } from '../../src/types/timelineCore';
import {
  evaluateTransitionMappedAnimation,
  type TransitionMappedAnimationClip,
} from '../../src/services/compositionRender/transitionMappedAnimation';
import {
  evaluateCompositionClipEffects,
  evaluateCompositionClipMasks,
  evaluateCompositionClipTransform,
} from '../../src/services/compositionRender/keyframeEvaluation';
import { resolveTransitionSourceMapTime } from '../../src/services/timeline/transitionSourceMap';

const parentBase: ClipTransform = {
  opacity: 0.5,
  blendMode: 'normal',
  position: { x: 10, y: 20, z: 3 },
  scale: { all: 1.25, x: 2, y: 3, z: 4 },
  rotation: { x: 5, y: 350, z: 350 },
};

function keyframe(
  property: Keyframe['property'],
  time: number,
  value: number,
  overrides: Partial<Keyframe> = {},
): Keyframe {
  return {
    id: `${property}-${time}`,
    clipId: 'mapped-clip',
    property,
    time,
    value,
    easing: 'linear',
    ...overrides,
  };
}

function mask(id: string, overrides: Partial<ClipMask> = {}): ClipMask {
  return {
    id,
    name: id,
    vertices: [{
      id: `${id}-a`, x: 0, y: 0,
      handleIn: { x: -0.1, y: 0 }, handleOut: { x: 0.1, y: 0 }, handleMode: 'mirrored',
    }, {
      id: `${id}-b`, x: 1, y: 1,
      handleIn: { x: -0.2, y: 0 }, handleOut: { x: 0.2, y: 0 }, handleMode: 'split',
    }],
    closed: true,
    opacity: 1,
    feather: 2,
    featherQuality: 50,
    inverted: false,
    mode: 'add',
    expanded: false,
    position: { x: 0, y: 0 },
    enabled: true,
    visible: true,
    ...overrides,
  };
}

function effect(id: string, amount: number): Effect {
  return { id, name: id, type: 'brightness', enabled: true, params: { amount } };
}

function v2Map({
  baseTransform = parentBase,
  keyframes = [],
  sourceEffectIds = ['source-effect'],
  sourceMaskIds = ['source-mask'],
  mediaDuration = 20,
  duration = 4,
  inPoint = 2,
  outPoint = 18,
  defaultSpeed = 1,
  segments = [{ kind: 'parent-linear' as const, compStart: 0, compEnd: 4, parentStart: 0, parentEnd: 4 }],
}: Partial<Omit<TransitionSourceMapV2, 'version' | 'parent'>> & {
  baseTransform?: ClipTransform;
  keyframes?: Keyframe[];
  sourceEffectIds?: string[];
  sourceMaskIds?: string[];
  duration?: number;
  inPoint?: number;
  outPoint?: number;
  defaultSpeed?: number;
} = {}): TransitionSourceMapV2 {
  return {
    version: 2,
    mediaDuration,
    parent: {
      duration,
      inPoint,
      outPoint,
      defaultSpeed,
      animation: { baseTransform, keyframes, sourceEffectIds, sourceMaskIds },
    },
    segments,
  };
}

describe('evaluateTransitionMappedAnimation', () => {
  it('keeps source prefixes and generated animation domains independent while preserving array order', () => {
    const sourceMask = mask('source-mask');
    const generatedMask = mask('generated-mask', { feather: 5 });
    const sourceEffect = effect('source-effect', 4);
    const generatedEffect = effect('generated-effect', 1);
    const parentKeyframes = [
      keyframe('opacity', 0, 0.5, { easing: 'bezier', handleOut: { x: 1, y: 0.1 } }),
      keyframe('opacity', 4, 0.9, { handleIn: { x: -1, y: -0.1 } }),
      keyframe('position.x', 0, 10, { easing: 'bezier', handleOut: { x: 1, y: 12 } }),
      keyframe('position.x', 4, 30, { handleIn: { x: -1, y: -6 } }),
      keyframe('position.y', 0, 20), keyframe('position.y', 4, 50),
      keyframe('position.z', 0, 3), keyframe('position.z', 4, 7),
      keyframe('scale.all', 0, 1.25), keyframe('scale.all', 4, 2),
      keyframe('scale.x', 0, 2), keyframe('scale.x', 4, 4),
      keyframe('scale.y', 0, 3), keyframe('scale.y', 4, 6),
      keyframe('scale.z', 0, 4), keyframe('scale.z', 4, 8),
      keyframe('rotation.x', 0, 5), keyframe('rotation.x', 4, 45),
      keyframe('rotation.y', 0, 350, { rotationInterpolation: 'continuous' }), keyframe('rotation.y', 4, 10),
      keyframe('rotation.z', 0, 350, { rotationInterpolation: 'shortest' }), keyframe('rotation.z', 4, 10),
      keyframe('effect.source-effect.amount', 0, 4, { easing: 'ease-in' }),
      keyframe('effect.source-effect.amount', 4, 12),
      keyframe('mask.source-mask.feather', 0, 2, { easing: 'ease-out' }),
      keyframe('mask.source-mask.feather', 4, 10),
      keyframe('mask.source-mask.path', 0, 0, { pathValue: { closed: true, vertices: sourceMask.vertices } }),
      keyframe('mask.source-mask.path', 4, 0, { pathValue: {
        closed: false,
        vertices: [{
          id: 'source-mask-a', x: 0.25, y: 0.5,
          handleIn: { x: -0.3, y: 0.2 }, handleOut: { x: 0.4, y: -0.1 }, handleMode: 'mirrored',
        }, {
          id: 'source-mask-b', x: 0.75, y: 0.25,
          handleIn: { x: -0.4, y: 0.1 }, handleOut: { x: 0.2, y: 0.3 }, handleMode: 'split',
        }],
      } }),
    ];
    const generatedKeyframes = [
      keyframe('opacity', 0, 0.25), keyframe('opacity', 2, 0.75),
      keyframe('position.x', 0, 10), keyframe('position.x', 2, 50),
      keyframe('position.y', 0, 20), keyframe('position.y', 2, 30),
      keyframe('position.z', 0, 3), keyframe('position.z', 2, 9),
      keyframe('scale.all', 0, 1.25), keyframe('scale.all', 2, 1.5),
      keyframe('scale.x', 0, 2), keyframe('scale.x', 2, 3),
      keyframe('scale.y', 0, 3), keyframe('scale.y', 2, 2),
      keyframe('scale.z', 0, 4), keyframe('scale.z', 2, 6),
      keyframe('rotation.x', 0, 5), keyframe('rotation.x', 2, 15),
      keyframe('rotation.y', 0, 350), keyframe('rotation.y', 2, 20),
      keyframe('rotation.z', 0, 350), keyframe('rotation.z', 2, 30),
      keyframe('effect.generated-effect.amount', 0, 1), keyframe('effect.generated-effect.amount', 2, 5),
      keyframe('mask.generated-mask.feather', 0, 5), keyframe('mask.generated-mask.feather', 2, 15),
    ];
    const clip: TransitionMappedAnimationClip = {
      transform: { ...parentBase, blendMode: 'screen' },
      effects: [sourceEffect, generatedEffect],
      masks: [sourceMask, generatedMask],
      transitionSourceMap: v2Map({
        keyframes: parentKeyframes,
        segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 2, parentStart: 0.5, parentEnd: 3.5 }],
      }),
    };
    const before = structuredClone(clip);
    const compositionLocalTime = 1.5;
    const result = evaluateTransitionMappedAnimation(clip, generatedKeyframes, compositionLocalTime)!;
    const original = evaluateCompositionClipTransform(parentBase, parentKeyframes, result.animationTime);
    const generated = evaluateCompositionClipTransform(clip.transform, generatedKeyframes, compositionLocalTime);

    expect(result.animationTime).toBe(2.75);
    expect(result.transform).toMatchObject({
      opacity: original.opacity * generated.opacity / parentBase.opacity,
      blendMode: 'screen',
      position: {
        x: original.position.x + generated.position.x - parentBase.position.x,
        y: original.position.y + generated.position.y - parentBase.position.y,
        z: original.position.z + generated.position.z - parentBase.position.z,
      },
      rotation: {
        x: original.rotation.x + generated.rotation.x - parentBase.rotation.x,
        y: original.rotation.y + generated.rotation.y - parentBase.rotation.y,
        z: original.rotation.z + generated.rotation.z - parentBase.rotation.z,
      },
    });
    expect(result.transform.scale).toEqual({
      all: original.scale.all! * generated.scale.all! / parentBase.scale.all!,
      x: original.scale.x * generated.scale.x / parentBase.scale.x,
      y: original.scale.y * generated.scale.y / parentBase.scale.y,
      z: original.scale.z! * generated.scale.z! / parentBase.scale.z!,
    });
    expect(original.rotation.z).toBeGreaterThan(350);
    expect(original.rotation.y).toBeLessThan(350);

    expect(result.effects).toEqual([
      evaluateCompositionClipEffects([sourceEffect], parentKeyframes, result.animationTime)[0],
      evaluateCompositionClipEffects([generatedEffect], generatedKeyframes, compositionLocalTime)[0],
    ]);
    expect(result.masks).toEqual([
      evaluateCompositionClipMasks([sourceMask], parentKeyframes, result.animationTime)![0],
      evaluateCompositionClipMasks([generatedMask], generatedKeyframes, compositionLocalTime)![0],
    ]);
    expect(result.effects.map(({ id }) => id)).toEqual(['source-effect', 'generated-effect']);
    expect(result.masks!.map(({ id }) => id)).toEqual(['source-mask', 'generated-mask']);
    expect(result.masks![0].vertices[0].handleMode).toBe('mirrored');
    expect(result.masks![0].vertices).not.toBe(sourceMask.vertices);
    expect(result.effects[1]).not.toBe(generatedEffect);
    expect(clip).toEqual(before);
  });

  it('fails closed when source effect or mask prefixes are missing, reordered, or mismatched', () => {
    const sourceEffect = effect('source-effect', 1);
    const sourceMask = mask('source-mask');
    const generatedEffect = effect('generated-effect', 2);
    const generatedMask = mask('generated-mask');
    const transitionSourceMap = v2Map();
    const base = { transform: parentBase, transitionSourceMap };

    [
      [],
      [generatedEffect, sourceEffect],
      [effect('wrong-effect', 3)],
    ].forEach((effects) => {
      expect(evaluateTransitionMappedAnimation({ ...base, effects, masks: [sourceMask] }, [], 1)).toBeNull();
    });

    [
      undefined,
      [generatedMask, sourceMask],
      [mask('wrong-mask')],
    ].forEach((masks) => {
      expect(evaluateTransitionMappedAnimation({ ...base, effects: [sourceEffect], masks }, [], 1)).toBeNull();
    });
  });

  it('uses source-prefix occurrences in the parent domain and a later duplicate in the generated domain', () => {
    const sourceEffectA = effect('shared-effect', 1);
    const sourceEffectB = effect('shared-effect', 2);
    const generatedEffect = effect('shared-effect', 3);
    const sourceMaskA = mask('shared-mask', { feather: 1 });
    const sourceMaskB = mask('shared-mask', { feather: 2 });
    const generatedMask = mask('shared-mask', { feather: 3 });
    const parentKeyframes = [
      keyframe('effect.shared-effect.amount', 0, 1), keyframe('effect.shared-effect.amount', 4, 9),
      keyframe('mask.shared-mask.feather', 0, 1), keyframe('mask.shared-mask.feather', 4, 9),
    ];
    const generatedKeyframes = [
      keyframe('effect.shared-effect.amount', 0, 30), keyframe('effect.shared-effect.amount', 2, 50),
      keyframe('mask.shared-mask.feather', 0, 30), keyframe('mask.shared-mask.feather', 2, 50),
    ];
    const clip: TransitionMappedAnimationClip = {
      transform: parentBase,
      effects: [sourceEffectA, sourceEffectB, generatedEffect],
      masks: [sourceMaskA, sourceMaskB, generatedMask],
      transitionSourceMap: v2Map({
        keyframes: parentKeyframes,
        sourceEffectIds: ['shared-effect', 'shared-effect'],
        sourceMaskIds: ['shared-mask', 'shared-mask'],
        segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 2, parentStart: 0, parentEnd: 4 }],
      }),
    };
    const before = structuredClone(clip);
    const result = evaluateTransitionMappedAnimation(clip, generatedKeyframes, 1)!;

    expect(result.animationTime).toBe(2);
    expect(result.effects).toEqual([
      evaluateCompositionClipEffects([sourceEffectA], parentKeyframes, 2)[0],
      evaluateCompositionClipEffects([sourceEffectB], parentKeyframes, 2)[0],
      evaluateCompositionClipEffects([generatedEffect], generatedKeyframes, 1)[0],
    ]);
    expect(result.masks).toEqual([
      evaluateCompositionClipMasks([sourceMaskA], parentKeyframes, 2)![0],
      evaluateCompositionClipMasks([sourceMaskB], parentKeyframes, 2)![0],
      evaluateCompositionClipMasks([generatedMask], generatedKeyframes, 1)![0],
    ]);
    expect(clip).toEqual(before);
  });

  it('continues parent animation while the mapped source media is held at its bound', () => {
    const parentKeyframes = [keyframe('position.x', 0, 10), keyframe('position.x', 4, 50)];
    const map = v2Map({
      keyframes: parentKeyframes,
      mediaDuration: 2,
      inPoint: 1,
      outPoint: 2,
      sourceEffectIds: [],
      sourceMaskIds: [],
    });
    const resolved = resolveTransitionSourceMapTime(map, 2)!;
    const clip: TransitionMappedAnimationClip = {
      transform: parentBase,
      effects: [],
      transitionSourceMap: map,
    };
    const result = evaluateTransitionMappedAnimation(clip, [], 2)!;

    expect(resolved).toMatchObject({ sourceTime: 2, sourceRate: 0, isHold: true, animationTime: 2 });
    expect(result.animationTime).toBe(2);
    expect(result.transform).toEqual(evaluateCompositionClipTransform(parentBase, parentKeyframes, 2));
  });

  it('uses reverse speed-keyframed maps for parent time without sampling an anchor', () => {
    const parentKeyframes = [
      keyframe('speed', 0, -1, { easing: 'ease-out' }), keyframe('speed', 4, -2),
      keyframe('position.x', 0, 10), keyframe('position.x', 4, 50),
    ];
    const map = v2Map({
      keyframes: parentKeyframes,
      defaultSpeed: -1,
      sourceEffectIds: [],
      sourceMaskIds: [],
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 2, parentStart: 4, parentEnd: 0 }],
    });
    const result = evaluateTransitionMappedAnimation({
      transform: parentBase,
      effects: [],
      transitionSourceMap: map,
    }, [], 0.75)!;

    expect(resolveTransitionSourceMapTime(map, 0.75)?.animationTime).toBe(2.5);
    expect(result.animationTime).toBe(2.5);
    expect(result.transform).toEqual(evaluateCompositionClipTransform(parentBase, parentKeyframes, 2.5));
  });

  it('accepts empty source prefixes and keeps zero-base opacity and scale finite', () => {
    const zeroBase: ClipTransform = {
      opacity: 0,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { all: 0, x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const generated: ClipTransform = {
      opacity: 0.8,
      blendMode: 'screen',
      position: { x: 0, y: 0, z: 0 },
      scale: { all: 2, x: 3, y: 4, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const result = evaluateTransitionMappedAnimation({
      transform: generated,
      effects: [],
      transitionSourceMap: v2Map({ baseTransform: zeroBase, sourceEffectIds: [], sourceMaskIds: [] }),
    }, [], 1)!;

    expect(result.transform.opacity).toBe(0);
    expect(result.transform.scale).toEqual({ all: 0, x: 0, y: 0, z: 0 });
    expect(Object.values(result.transform.scale).every(Number.isFinite)).toBe(true);
  });

  it('keeps v1 and absent maps on the canonical single-domain path and fails closed for invalid or unresolved v2 maps', () => {
    const effects = [effect('generated-effect', 2)];
    const masks = [mask('generated-mask')];
    const keyframes = [
      keyframe('position.x', 0, 10), keyframe('position.x', 2, 30),
      keyframe('effect.generated-effect.amount', 0, 2), keyframe('effect.generated-effect.amount', 2, 6),
      keyframe('mask.generated-mask.feather', 0, 2), keyframe('mask.generated-mask.feather', 2, 8),
    ];
    const singleDomain = (transitionSourceMap?: TransitionSourceMap): TransitionMappedAnimationClip => ({
      transform: parentBase,
      effects,
      masks,
      transitionSourceMap,
    });
    const v1: TransitionSourceMap = {
      version: 1,
      segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 0, sourceEnd: 2 }],
    };
    const invalidV2 = { version: 2, segments: [] } as unknown as TransitionSourceMap;

    [singleDomain(), singleDomain(v1)].forEach((clip) => {
      const result = evaluateTransitionMappedAnimation(clip, keyframes, 1)!;
      expect(result).toEqual({
        transform: evaluateCompositionClipTransform(parentBase, keyframes, 1),
        effects: evaluateCompositionClipEffects(effects, keyframes, 1),
        masks: evaluateCompositionClipMasks(masks, keyframes, 1),
        animationTime: 1,
      });
    });

    expect(evaluateTransitionMappedAnimation(singleDomain(invalidV2), keyframes, 1)).toBeNull();
    expect(evaluateTransitionMappedAnimation(singleDomain(v2Map()), [], Number.NaN)).toBeNull();
  });
});
