import { describe, expect, it } from 'vitest';

import type { Keyframe } from '../../src/types/keyframes';
import type {
  TransitionSourceMap,
  TransitionSourceMapV2,
  TransitionSourceMapV2Segment,
} from '../../src/types/timelineCore';
import {
  isValidTransitionSourceMap,
  resolveTransitionRecipeBlendMode,
  resolveTransitionSourceMapTime,
} from '../../src/services/timeline/transitionSourceMap';
import { calculateSourceTime, getSpeedAtTime } from '../../src/utils/speedIntegration';
import {
  createVectorAnimationDataBindingProperty,
  createVectorAnimationInputProperty,
  createVectorAnimationStateProperty,
} from '../../src/types/vectorAnimation';

const sourceMap: TransitionSourceMap = {
  version: 1,
  segments: [
    { kind: 'hold', compStart: 0, compEnd: 1, sourceTime: 4 },
    { kind: 'linear', compStart: 1, compEnd: 3, sourceStart: 4, sourceEnd: 10 },
    { kind: 'hold', compStart: 3, compEnd: 4, sourceTime: 10 },
  ],
};

describe('transition source map', () => {
  it('resolves linear time with hold segments before and after it', () => {
    expect(resolveTransitionSourceMapTime(sourceMap, 0.5)).toEqual({ sourceTime: 4, sourceRate: 0, isHold: true });
    expect(resolveTransitionSourceMapTime(sourceMap, 2)).toEqual({ sourceTime: 7, sourceRate: 3, isHold: false });
    expect(resolveTransitionSourceMapTime(sourceMap, 3.5)).toEqual({ sourceTime: 10, sourceRate: 0, isHold: true });
  });

  it('uses deterministic boundary ownership and clamps outside map bounds', () => {
    expect(resolveTransitionSourceMapTime(sourceMap, 1)).toEqual({ sourceTime: 4, sourceRate: 3, isHold: false });
    expect(resolveTransitionSourceMapTime(sourceMap, 3)).toEqual({ sourceTime: 10, sourceRate: 0, isHold: true });
    expect(resolveTransitionSourceMapTime(sourceMap, -1)).toEqual({ sourceTime: 4, sourceRate: 0, isHold: true });
    expect(resolveTransitionSourceMapTime(sourceMap, 9)).toEqual({ sourceTime: 10, sourceRate: 0, isHold: true });
  });

  it('keeps the signed linear rate and treats a zero-rate linear segment as a hold', () => {
    const reverseMap: TransitionSourceMap = {
      version: 1,
      segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 10, sourceEnd: 4 }],
    };
    const zeroRateMap: TransitionSourceMap = {
      version: 1,
      segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 4, sourceEnd: 4 }],
    };

    expect(resolveTransitionSourceMapTime(reverseMap, 1)).toEqual({ sourceTime: 7, sourceRate: -3, isHold: false });
    expect(resolveTransitionSourceMapTime(zeroRateMap, 1)).toEqual({ sourceTime: 4, sourceRate: 0, isHold: true });
  });

  it('rejects empty, zero-length, and non-contiguous maps without mutation', () => {
    const original = structuredClone(sourceMap);
    const zeroLength = {
      version: 1,
      segments: [{ kind: 'linear', compStart: 0, compEnd: 0, sourceStart: 1, sourceEnd: 1 }],
    };
    const gapped = {
      version: 1,
      segments: [
        { kind: 'hold', compStart: 0, compEnd: 1, sourceTime: 1 },
        { kind: 'hold', compStart: 2, compEnd: 3, sourceTime: 1 },
      ],
    };
    const malformed = { version: 1, segments: [null] };

    expect(resolveTransitionSourceMapTime(undefined, 0)).toBeNull();
    expect(resolveTransitionSourceMapTime(zeroLength, 0)).toBeNull();
    expect(resolveTransitionSourceMapTime(gapped, 1.5)).toBeNull();
    expect(resolveTransitionSourceMapTime(malformed, 0)).toBeNull();
    expect(resolveTransitionSourceMapTime(sourceMap, Number.NaN)).toBeNull();
    expect(sourceMap).toEqual(original);
  });
});

describe('transition recipe blend windows', () => {
  it('uses the base blend outside windows and gives an exact shared boundary to the next window', () => {
    const windows = [
      { compStart: 0.25, compEnd: 0.75, blendMode: 'add' as const },
      { compStart: 0.75, compEnd: 1.25, blendMode: 'multiply' as const },
    ];
    const original = structuredClone(windows);

    expect(resolveTransitionRecipeBlendMode(windows, 0, 'normal')).toBe('normal');
    expect(resolveTransitionRecipeBlendMode(windows, 0.5, 'normal')).toBe('add');
    expect(resolveTransitionRecipeBlendMode(windows, 0.75, 'normal')).toBe('multiply');
    expect(resolveTransitionRecipeBlendMode(windows, 1.25, 'normal')).toBe('normal');
    expect(windows).toEqual(original);
  });
});

function v2Map({
  mediaDuration = 20,
  duration = 4,
  inPoint = 2,
  outPoint = 18,
  defaultSpeed = 1,
  keyframes = [],
  segments = [{ kind: 'parent-linear', compStart: 0, compEnd: 4, parentStart: 0, parentEnd: 4 }],
}: {
  mediaDuration?: number;
  duration?: number;
  inPoint?: number;
  outPoint?: number;
  defaultSpeed?: number;
  keyframes?: Keyframe[];
  segments?: TransitionSourceMapV2Segment[];
} = {}): TransitionSourceMapV2 {
  return {
    version: 2,
    mediaDuration,
    parent: {
      duration,
      inPoint,
      outPoint,
      defaultSpeed,
      animation: {
        baseTransform: {
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        keyframes,
        sourceEffectIds: ['effect-a'],
        sourceMaskIds: ['mask-a'],
      },
    },
    segments,
  };
}

function validKeyframe(
  property: Keyframe['property'],
  overrides: Partial<Keyframe> = {},
): Keyframe {
  return {
    id: `keyframe:${property}`,
    clipId: 'parent',
    property,
    time: 0,
    value: 1,
    easing: 'linear',
    ...overrides,
  };
}

function rawKeyframe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'keyframe',
    clipId: 'parent',
    property: 'opacity',
    time: 0,
    value: 1,
    easing: 'linear',
    ...overrides,
  };
}

function mapWithRawKeyframes(keyframes: readonly unknown[]): unknown {
  const map = v2Map();
  return {
    ...map,
    parent: {
      ...map.parent,
      animation: { ...map.parent.animation, keyframes },
    },
  };
}

describe('transition source map v2', () => {
  it('validates serializable animation data without mutating it', () => {
    const map = v2Map({
      keyframes: [{
        id: 'path',
        clipId: 'parent',
        property: 'mask.mask-a.path',
        time: 1,
        value: 0,
        easing: 'linear',
        handleIn: { x: -0.25, y: 0 },
        handleOut: { x: 0.25, y: 0 },
        pathValue: {
          closed: true,
          vertices: [{
            id: 'vertex-a', x: 0, y: 0,
            handleIn: { x: 0, y: 0 }, handleOut: { x: 0.25, y: 0 },
          }],
        },
      } as Keyframe],
    });
    const original = structuredClone(map);

    expect(isValidTransitionSourceMap(map)).toBe(true);
    expect(resolveTransitionSourceMapTime(map, 1)?.animationTime).toBe(1);
    expect(map).toEqual(original);
  });

  it('accepts the project keyframe property grammar', () => {
    const pathValue = {
      closed: true,
      vertices: [{
        id: 'vertex-a', x: 0, y: 0,
        handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'mirrored' as const,
      }],
    };
    const map = v2Map({ keyframes: [
      validKeyframe('effect.effect-a.blur.amount'),
      validKeyframe('mask.mask-a.path', { pathValue }),
      validKeyframe('node.node-a.parameter'),
      validKeyframe(createVectorAnimationInputProperty('machine.name', 'input.name')),
      validKeyframe(createVectorAnimationStateProperty('machine.name')),
      validKeyframe(createVectorAnimationDataBindingProperty('model.opacity')),
      validKeyframe('shape.size.w'),
      validKeyframe('textBounds.position.x'),
      validKeyframe('camera.fov'),
    ] });

    expect(isValidTransitionSourceMap(map)).toBe(true);
  });

  it('rejects invalid enum values and arbitrary keyframe properties', () => {
    const baseMap = v2Map();
    const invalids: unknown[] = [
      {
        ...baseMap,
        parent: {
          ...baseMap.parent,
          animation: {
            ...baseMap.parent.animation,
            baseTransform: { ...baseMap.parent.animation.baseTransform, blendMode: 'invalid-blend-mode' },
          },
        },
      },
      mapWithRawKeyframes([rawKeyframe({ easing: 'easeOut' })]),
      mapWithRawKeyframes([rawKeyframe({ rotationInterpolation: 'longest' })]),
      mapWithRawKeyframes([rawKeyframe({
        property: 'mask.mask-a.path',
        pathValue: {
          closed: true,
          vertices: [{
            id: 'vertex-a', x: 0, y: 0,
            handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'linked',
          }],
        },
      })]),
      mapWithRawKeyframes([rawKeyframe({ property: 'arbitrary.property' })]),
    ];

    invalids.forEach((map) => expect(isValidTransitionSourceMap(map)).toBe(false));
  });

  it('uses signed default speed for forward, slow, and reverse playback', () => {
    const forward = resolveTransitionSourceMapTime(v2Map({ defaultSpeed: 2 }), 1.5)!;
    const slow = resolveTransitionSourceMapTime(v2Map({ defaultSpeed: 0.5 }), 1.5)!;
    const reverse = resolveTransitionSourceMapTime(v2Map({ defaultSpeed: -2 }), 1.5)!;

    expect(forward).toMatchObject({ sourceTime: 5, sourceRate: 2, isHold: false, animationTime: 1.5 });
    expect(slow).toMatchObject({ sourceTime: 2.75, sourceRate: 0.5, isHold: false, animationTime: 1.5 });
    expect(reverse).toMatchObject({ sourceTime: 15, sourceRate: -2, isHold: false, animationTime: 1.5 });
  });

  it('uses canonical eased speed integration at non-anchor parent time', () => {
    const keyframes: Keyframe[] = [
      { id: 'speed-a', clipId: 'parent', property: 'speed', time: 0, value: 1, easing: 'ease-in' },
      { id: 'speed-b', clipId: 'parent', property: 'speed', time: 2, value: 3, easing: 'linear' },
    ];
    const map = v2Map({ duration: 2, keyframes, segments: [
      { kind: 'parent-linear', compStart: 0, compEnd: 2, parentStart: 0, parentEnd: 2 },
    ] });
    const result = resolveTransitionSourceMapTime(map, 1)!;
    const canonicalSource = 2 + calculateSourceTime(keyframes, 1, 1);
    const canonicalRate = getSpeedAtTime(keyframes, 1, 1);
    const chord = 2 + calculateSourceTime(keyframes, 2, 1) / 2;

    expect(result.sourceTime).toBeCloseTo(canonicalSource, 10);
    expect(result.sourceRate).toBeCloseTo(canonicalRate, 10);
    expect(result.sourceTime).not.toBeCloseTo(chord, 3);
    expect(result.animationTime).toBe(1);
  });

  it('keeps signed speed changes and explicit parent holds exact', () => {
    const keyframes: Keyframe[] = [
      { id: 'speed-a', clipId: 'parent', property: 'speed', time: 0, value: 1, easing: 'linear' },
      { id: 'speed-b', clipId: 'parent', property: 'speed', time: 2, value: -1, easing: 'linear' },
    ];
    const changing = v2Map({ duration: 2, keyframes, segments: [
      { kind: 'parent-linear', compStart: 0, compEnd: 2, parentStart: 0, parentEnd: 2 },
    ] });
    const zero = resolveTransitionSourceMapTime(changing, 1)!;
    const negative = resolveTransitionSourceMapTime(changing, 1.5)!;
    const held = resolveTransitionSourceMapTime(v2Map({ defaultSpeed: 2, segments: [
      { kind: 'parent-hold', compStart: 0, compEnd: 2, parentTime: 1 },
    ] }), 1)!;

    expect(zero).toMatchObject({ sourceRate: 0, isHold: true, animationTime: 1 });
    expect(negative.sourceRate).toBeCloseTo(getSpeedAtTime(keyframes, 1.5, 1), 10);
    expect(negative.isHold).toBe(false);
    expect(held).toMatchObject({ sourceTime: 4, sourceRate: 0, isHold: true, animationTime: 1 });
  });

  it('extends the canonical parent contract before and after its duration', () => {
    const map = v2Map({ duration: 2, inPoint: 0, defaultSpeed: 2, segments: [
      { kind: 'parent-linear', compStart: 0, compEnd: 4, parentStart: -1, parentEnd: 3 },
    ] });

    expect(resolveTransitionSourceMapTime(map, 0)).toMatchObject({
      sourceTime: 0, sourceRate: 0, isHold: true, animationTime: -1,
    });
    expect(resolveTransitionSourceMapTime(map, 1)).toMatchObject({
      sourceTime: 0, sourceRate: 2, isHold: false, animationTime: 0,
    });
    expect(resolveTransitionSourceMapTime(map, 4)).toMatchObject({
      sourceTime: 6, sourceRate: 2, isHold: false, animationTime: 3,
    });
  });

  it('holds at media bounds only while moving outward', () => {
    const forward = v2Map({ mediaDuration: 10, duration: 1, inPoint: 8, outPoint: 10, defaultSpeed: 2, segments: [
      { kind: 'parent-linear', compStart: 0, compEnd: 3, parentStart: 0, parentEnd: 3 },
    ] });
    const reverse = v2Map({ mediaDuration: 10, duration: 10, inPoint: 0, outPoint: 10, defaultSpeed: -1, segments: [
      { kind: 'parent-linear', compStart: 0, compEnd: 10, parentStart: 0, parentEnd: 10 },
    ] });

    expect(resolveTransitionSourceMapTime(forward, 0)).toMatchObject({ sourceTime: 8, sourceRate: 2, isHold: false });
    expect(resolveTransitionSourceMapTime(forward, 1)).toMatchObject({ sourceTime: 10, sourceRate: 0, isHold: true });
    expect(resolveTransitionSourceMapTime(forward, 2)).toMatchObject({
      sourceTime: 10, sourceRate: 0, isHold: true, animationTime: 2,
    });
    expect(resolveTransitionSourceMapTime(reverse, 0)).toMatchObject({ sourceTime: 10, sourceRate: -1, isHold: false });
    expect(resolveTransitionSourceMapTime(reverse, 10)).toMatchObject({ sourceTime: 0, sourceRate: 0, isHold: true });
  });

  it('holds outward at epsilon media bounds, keeps inward playback active, and clamps', () => {
    const epsilon = 1e-9;
    const lower = (parentStart: number, parentEnd: number) => v2Map({
      mediaDuration: 10, duration: 1, inPoint: 0, outPoint: 10,
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart, parentEnd }],
    });
    const upper = (parentStart: number, parentEnd: number) => v2Map({
      mediaDuration: 10, duration: 1, inPoint: 10, outPoint: 10,
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart, parentEnd }],
    });

    expect(resolveTransitionSourceMapTime(lower(-epsilon / 2, -epsilon * 1.5), 0))
      .toMatchObject({ sourceTime: 0, sourceRate: 0, isHold: true });
    expect(resolveTransitionSourceMapTime(lower(-epsilon / 2, epsilon / 2), 0))
      .toMatchObject({ sourceTime: 0, sourceRate: epsilon, isHold: false });
    expect(resolveTransitionSourceMapTime(lower(-epsilon * 2, -epsilon * 3), 0))
      .toMatchObject({ sourceTime: 0, sourceRate: 0, isHold: true });

    expect(resolveTransitionSourceMapTime(upper(epsilon / 2, epsilon * 1.5), 0))
      .toMatchObject({ sourceTime: 10, sourceRate: 0, isHold: true });
    expect(resolveTransitionSourceMapTime(upper(epsilon / 2, -epsilon / 2), 0))
      .toMatchObject({ sourceTime: 10, sourceRate: -epsilon, isHold: false });
    expect(resolveTransitionSourceMapTime(upper(epsilon * 2, epsilon * 3), 0))
      .toMatchObject({ sourceTime: 10, sourceRate: 0, isHold: true });
  });

  it('gives shared boundaries to the next segment and the final endpoint to the last', () => {
    const map = v2Map({ duration: 3, segments: [
      { kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 2 },
      { kind: 'parent-hold', compStart: 1, compEnd: 2, parentTime: 2 },
      { kind: 'parent-linear', compStart: 2, compEnd: 3, parentStart: 2, parentEnd: 3 },
    ] });

    expect(resolveTransitionSourceMapTime(map, 0.5)).toMatchObject({ sourceTime: 3, sourceRate: 2, isHold: false, animationTime: 1 });
    expect(resolveTransitionSourceMapTime(map, 1)).toMatchObject({ sourceTime: 4, sourceRate: 0, isHold: true, animationTime: 2 });
    expect(resolveTransitionSourceMapTime(map, 2)).toMatchObject({ sourceTime: 4, sourceRate: 1, isHold: false, animationTime: 2 });
    expect(resolveTransitionSourceMapTime(map, 3)).toMatchObject({ sourceTime: 5, sourceRate: 1, isHold: false, animationTime: 3 });
  });

  it('rejects malformed v2 contracts and segments', () => {
    const invalids = [
      { ...v2Map(), mediaDuration: 0 },
      { ...v2Map(), parent: { ...v2Map().parent, outPoint: 21 } },
      { ...v2Map(), parent: { ...v2Map().parent, animation: { ...v2Map().parent.animation, sourceMaskIds: [1] } } },
      { ...v2Map(), parent: { ...v2Map().parent, animation: { ...v2Map().parent.animation, keyframes: [{
        id: 'bad', clipId: 'parent', property: 'speed', time: 0, value: 1, easing: 'linear', handleOut: { x: Number.NaN, y: 0 },
      }] } } },
      { ...v2Map(), segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 1 }, {
        kind: 'parent-hold', compStart: 1.1, compEnd: 2, parentTime: 1,
      }] },
    ];

    invalids.forEach((map) => {
      expect(isValidTransitionSourceMap(map)).toBe(false);
      expect(resolveTransitionSourceMapTime(map, 0)).toBeNull();
    });
  });

  it('rejects mixed-version segments and every finite gap or overlap', () => {
    const exact = v2Map({ segments: [
      { kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 1 },
      { kind: 'parent-hold', compStart: 1, compEnd: 2, parentTime: 1 },
    ] });
    const gapped = v2Map({ segments: [
      { kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 1 },
      { kind: 'parent-hold', compStart: 1 + Number.EPSILON, compEnd: 2, parentTime: 1 },
    ] });
    const overlapping = v2Map({ segments: [
      { kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 1 },
      { kind: 'parent-hold', compStart: 1 - Number.EPSILON, compEnd: 2, parentTime: 1 },
    ] });
    const mixedV1 = {
      version: 1,
      segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 1 }],
    };
    const mixedV2 = {
      ...v2Map(),
      segments: [{ kind: 'linear', compStart: 0, compEnd: 1, sourceStart: 0, sourceEnd: 1 }],
    };

    expect(isValidTransitionSourceMap(exact)).toBe(true);
    [0, 0.5, 1, 1.5, 2].forEach((time) => {
      expect(resolveTransitionSourceMapTime(exact, time)).not.toBeNull();
    });
    [gapped, overlapping, mixedV1, mixedV2].forEach((map) => {
      expect(isValidTransitionSourceMap(map)).toBe(false);
      expect(resolveTransitionSourceMapTime(map, 1)).toBeNull();
    });
  });
});
