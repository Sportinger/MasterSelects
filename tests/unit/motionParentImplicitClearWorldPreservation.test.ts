import { describe, expect, it } from 'vitest';
import type {
  ClipTransform,
  Keyframe,
  TimelineClip,
  TimelineTrack,
} from '../../src/types';
import type { ClipboardClipData } from '../../src/stores/timeline/types';
import { getInterpolatedClipTransform } from '../../src/utils/keyframeInterpolation';
import { composeMotionParentTransforms2D } from '../../src/services/motionDesign/structure/parentTransformMath';
import type { MotionParentTransform2D } from '../../src/services/motionDesign/structure/contracts';
import { applyDeleteClipsOperation } from '../../src/stores/timeline/editOperations/deleteOperations';
import { applySplitAtTimesOperation } from '../../src/stores/timeline/editOperations/splitBatchOperations';
import { createPastedClipboardClipsPlan } from '../../src/stores/timeline/clipboard/clipboardClipPastePlanner';

const TRACKS: TimelineTrack[] = [{
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  height: 70,
  muted: false,
  visible: true,
  solo: false,
}];

function transform(overrides: Partial<ClipTransform> = {}): ClipTransform {
  return {
    opacity: overrides.opacity ?? 1,
    blendMode: overrides.blendMode ?? 'normal',
    position: { x: 0, y: 0, z: 0, ...overrides.position },
    scale: { all: 1, x: 1, y: 1, ...overrides.scale },
    rotation: { x: 0, y: 0, z: 0, ...overrides.rotation },
  };
}

function clip(
  id: string,
  clipTransform: ClipTransform,
  options: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    id,
    trackId: 'video-1',
    name: id,
    file: new File([], `${id}.png`, { type: 'image/png' }),
    startTime: 0,
    duration: 6,
    inPoint: 0,
    outPoint: 6,
    source: { type: 'image', naturalDuration: 6 },
    transform: clipTransform,
    effects: [],
    ...options,
  };
}

function toParentTransform(value: ClipTransform): MotionParentTransform2D {
  return {
    position: { x: value.position.x, y: value.position.y },
    scale: {
      all: value.scale.all ?? 1,
      x: value.scale.x,
      y: value.scale.y,
    },
    rotationZ: value.rotation.z,
    opacity: value.opacity,
  };
}

function localAt(
  target: TimelineClip,
  keyframes: readonly Keyframe[],
  timelineTime: number,
): MotionParentTransform2D {
  return toParentTransform(getInterpolatedClipTransform(
    [...keyframes],
    timelineTime - target.startTime,
    target.transform,
  ));
}

function expectTransformClose(
  actual: MotionParentTransform2D,
  expected: MotionParentTransform2D,
): void {
  expect(actual.position.x).toBeCloseTo(expected.position.x, 8);
  expect(actual.position.y).toBeCloseTo(expected.position.y, 8);
  expect(actual.scale.all).toBeCloseTo(expected.scale.all, 8);
  expect(actual.scale.x).toBeCloseTo(expected.scale.x, 8);
  expect(actual.scale.y).toBeCloseTo(expected.scale.y, 8);
  expect(actual.rotationZ).toBeCloseTo(expected.rotationZ, 8);
  expect(actual.opacity).toBeCloseTo(expected.opacity, 8);
}

describe('implicit Motion parent clears preserve world transforms', () => {
  it('bakes the static child world transform before deleting its parent', () => {
    const parent = clip('parent', transform({
      opacity: 0.8,
      position: { x: 120, y: -30, z: 0 },
      scale: { all: 1.1, x: 0.75, y: 1.25 },
      rotation: { x: 0, y: 0, z: 35 },
    }));
    const child = clip('child', transform({
      opacity: 0.65,
      position: { x: -15, y: 45, z: 0 },
      scale: { all: 0.9, x: 1.4, y: 0.8 },
      rotation: { x: 0, y: 0, z: -10 },
    }), { parentClipId: parent.id });
    const expectedWorld = composeMotionParentTransforms2D(
      toParentTransform(parent.transform),
      toParentTransform(child.transform),
    );

    const result = applyDeleteClipsOperation({
      id: 'delete-parent',
      type: 'delete-clips',
      clipIds: [parent.id],
      includeLinked: false,
    }, [parent, child], TRACKS, new Set(), {
      clipKeyframes: new Map(),
      timelineTime: 2,
    });

    const survivor = result.clips[0];
    expect(survivor.parentClipId).toBeUndefined();
    expectTransformClose(toParentTransform(survivor.transform), expectedWorld);
  });

  it('writes one complete current-time tuple when delete detaches an animated child', () => {
    const parent = clip('animated-parent', transform({ position: { x: 20, y: 10, z: 0 } }));
    const child = clip('animated-child', transform({ position: { x: 5, y: 8, z: 0 } }), {
      parentClipId: parent.id,
    });
    const parentKeyframes: Keyframe[] = [{
      id: 'parent-x', clipId: parent.id, property: 'position.x', time: 2, value: 90, easing: 'linear',
    }];
    const childKeyframes: Keyframe[] = [{
      id: 'child-x-current', clipId: child.id, property: 'position.x', time: 2, value: 30, easing: 'linear',
    }];
    const expectedWorld = composeMotionParentTransforms2D(
      localAt(parent, parentKeyframes, 2),
      localAt(child, childKeyframes, 2),
    );

    const result = applyDeleteClipsOperation({
      id: 'delete-animated-parent',
      type: 'delete-clips',
      clipIds: [parent.id],
      includeLinked: false,
    }, [parent, child], TRACKS, new Set(), {
      clipKeyframes: new Map([
        [parent.id, parentKeyframes],
        [child.id, childKeyframes],
      ]),
      timelineTime: 2,
    });

    const survivor = result.clips.find((candidate) => candidate.id === child.id)!;
    const survivorKeyframes = result.clipKeyframes!.get(child.id)!;
    expectTransformClose(localAt(survivor, survivorKeyframes, 2), expectedWorld);
    expect(new Set(
      survivorKeyframes.filter((keyframe) => keyframe.time === 2).map((keyframe) => keyframe.property),
    )).toEqual(new Set([
      'position.x',
      'position.y',
      'scale.all',
      'scale.x',
      'scale.y',
      'rotation.z',
      'opacity',
    ]));
    expect(survivorKeyframes.find((keyframe) => keyframe.property === 'position.x')?.id)
      .toBe('child-x-current');
  });

  it('preserves a spanning animated child at the split time when no parent part can own it', () => {
    const parent = clip('split-parent', transform({ rotation: { x: 0, y: 0, z: 20 } }));
    const child = clip('spanning-child', transform({ position: { x: 10, y: 5, z: 0 } }), {
      parentClipId: parent.id,
      startTime: 2,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
    });
    const parentKeyframes: Keyframe[] = [{
      id: 'split-parent-x', clipId: parent.id, property: 'position.x', time: 3, value: 75, easing: 'linear',
    }];
    const childKeyframes: Keyframe[] = [{
      id: 'split-child-y', clipId: child.id, property: 'position.y', time: 1, value: 35, easing: 'linear',
    }];
    const expectedWorld = composeMotionParentTransforms2D(
      localAt(parent, parentKeyframes, 3),
      localAt(child, childKeyframes, 3),
    );

    const result = applySplitAtTimesOperation({
      id: 'split-parent-at-three',
      type: 'split-at-times',
      clipId: parent.id,
      times: [3],
      includeLinked: false,
    }, [parent, child], TRACKS, {
      clipKeyframes: new Map([
        [parent.id, parentKeyframes],
        [child.id, childKeyframes],
      ]),
      timelineTime: 0,
    });

    const survivor = result.clips.find((candidate) => candidate.id === child.id)!;
    const survivorKeyframes = result.clipKeyframes!.get(child.id)!;
    expect(survivor.parentClipId).toBeUndefined();
    expectTransformClose(localAt(survivor, survivorKeyframes, 3), expectedWorld);
    expect(survivorKeyframes.filter((keyframe) => keyframe.time === 1)).toHaveLength(7);
  });

  it('bakes the copy-time world snapshot when a child is pasted without its parent', () => {
    const worldTransform: MotionParentTransform2D = {
      position: { x: 240, y: -60 },
      scale: { all: 1.2, x: 0.7, y: 1.4 },
      rotationZ: 42,
      opacity: 0.55,
    };
    const clipboardChild: ClipboardClipData = {
      id: 'clipboard-child',
      trackId: 'video-1',
      trackType: 'video',
      name: 'Clipboard child',
      startTime: 2,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      sourceType: 'image',
      transform: transform({ position: { x: 10, y: 20, z: 0 } }),
      effects: [],
      parentClipId: 'external-parent',
      worldTransformAtCopyTime: worldTransform,
      keyframes: [{
        id: 'clipboard-child-x',
        clipId: 'clipboard-child',
        property: 'position.x',
        time: 0,
        value: 10,
        easing: 'linear',
      }],
    };
    let suffix = 0;

    const plan = createPastedClipboardClipsPlan({
      clipboardData: [clipboardChild],
      playheadPosition: 10,
      tracks: TRACKS,
      clipKeyframes: new Map(),
      timestamp: 123,
      createSuffix: () => `stable-${suffix += 1}`,
    });

    const pasted = plan.newClips[0];
    const pastedKeyframes = plan.newKeyframes.get(pasted.id)!;
    expect(pasted.parentClipId).toBeUndefined();
    expectTransformClose(localAt(pasted, pastedKeyframes, 10), worldTransform);
    expect(pastedKeyframes.filter((keyframe) => keyframe.time === 0)).toHaveLength(7);
  });

  it('rejects implicit parent clears that would mutate a child on a locked track', () => {
    const lockedTrack: TimelineTrack = {
      ...TRACKS[0],
      id: 'video-locked-child',
      name: 'Locked child',
      locked: true,
    };
    const parent = clip('unlocked-parent', transform());
    const child = clip('locked-child', transform({ position: { x: 25, y: 0, z: 0 } }), {
      trackId: lockedTrack.id,
      parentClipId: parent.id,
      startTime: 2,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
    });
    const tracks = [...TRACKS, lockedTrack];

    const deleted = applyDeleteClipsOperation({
      id: 'delete-parent-with-locked-child',
      type: 'delete-clips',
      clipIds: [parent.id],
      includeLinked: false,
    }, [parent, child], tracks, new Set(), {
      clipKeyframes: new Map(),
      timelineTime: 3,
    });
    const split = applySplitAtTimesOperation({
      id: 'split-parent-with-locked-child',
      type: 'split-at-times',
      clipId: parent.id,
      times: [3],
      includeLinked: false,
    }, [parent, child], tracks, {
      clipKeyframes: new Map(),
      timelineTime: 3,
    });

    expect(deleted.changedClipIds).toEqual([]);
    expect(deleted.clips).toEqual([parent, child]);
    expect(deleted.warnings[0]?.code).toBe('track-locked');
    expect(split.changedClipIds).toEqual([]);
    expect(split.clips).toEqual([parent, child]);
    expect(split.warnings[0]?.code).toBe('track-locked');
  });
});
