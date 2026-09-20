import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { getInterpolatedClipTransform } from '../../src/utils/keyframeInterpolation';
import { evaluateParentedClipTransform } from '../../src/services/layerBuilder/parentTransformEvaluation';
import { resolveSceneClipTransform } from '../../src/engine/scene/SceneTimelineUtils';
import { evaluateTransitionMappedAnimation } from '../../src/services/compositionRender/transitionMappedAnimation';
import type { Keyframe, TimelineClip } from '../../src/types';

const transform = { ...DEFAULT_TRANSFORM, position: { x: 0.2, y: -0.1, z: 0 }, scale: { x: 2, y: 2 } };
const keys: Keyframe[] = [
  { id: 'face-stabilize:x', clipId: 'clip', property: 'position.x', time: 0, value: 3, easing: 'linear' },
  { id: 'face-stabilize:r', clipId: 'clip', property: 'rotation.z', time: 0, value: 30, easing: 'linear' },
  { id: 'manual-scale', clipId: 'clip', property: 'scale.x', time: 0, value: 2.5, easing: 'linear' },
];
const clip = { id: 'clip', startTime: 0, transform, effects: [], videoInspectorSections: { stabilization: false } } as TimelineClip;

describe('face stabilization bypass', () => {
  it('restores base framing, keeps manual animation and re-enables the same baked keys', () => {
    const before = structuredClone(keys);
    const bypassed = getInterpolatedClipTransform(keys, 0.5, transform, { stabilizationEnabled: false });
    expect(bypassed.position).toEqual(transform.position);
    expect(bypassed.rotation.z).toBe(0);
    expect(bypassed.scale).toEqual({ x: 2.5, y: 2 });
    expect(getInterpolatedClipTransform(keys, 0.5, transform).position.x).toBe(3);
    expect(keys).toEqual(before);
  });
  it('agrees in preview/export parent evaluation, native 3D and composition evaluation', () => {
    const expected = getInterpolatedClipTransform(keys, 0.5, transform, { stabilizationEnabled: false });
    const parent = evaluateParentedClipTransform({ clip, clips: [clip], clipLocalTime: 0.5, parentTimelineTime: 0.5, getKeyframes: () => keys });
    expect(parent.ok && parent.transform).toEqual(expected);
    expect(resolveSceneClipTransform(clip, 0.5, 0.5, { clips: [clip], clipKeyframes: new Map([[clip.id, keys]]) })).toEqual(expected);
    expect(evaluateTransitionMappedAnimation(clip, keys, 0.5)?.transform).toEqual(expected);
  });
  it('also bypasses stabilization inherited through transition source timing', () => {
    const mapped = { ...clip, transitionSourceMap: { version: 2 as const, mediaDuration: 2,
      parent: { duration: 2, inPoint: 0, outPoint: 2, defaultSpeed: 1,
        animation: { baseTransform: transform, keyframes: keys, sourceEffectIds: [], sourceMaskIds: [] } },
      segments: [{ kind: 'parent-linear' as const, compStart: 0, compEnd: 2, parentStart: 0, parentEnd: 2 }],
    } };
    expect(evaluateTransitionMappedAnimation(mapped, [], 0.5)?.transform.position.x).toBe(0.2);
    expect(evaluateTransitionMappedAnimation({ ...mapped, videoInspectorSections: { stabilization: true } }, [], 0.5)?.transform.position.x).toBe(3);
  });
});
