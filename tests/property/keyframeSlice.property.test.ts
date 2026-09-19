import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { AnimatableProperty, ClipTransform } from '../../src/types';
import { createTestTimelineStore } from '../helpers/storeFactory';
import { createMockClip } from '../helpers/mockData';
import { normalizeTimelinePropertyValue } from '../../src/stores/timeline/keyframes/keyframePropertyValue';

const propertyOptions = { numRuns: 100, seed: 0x4b465002 };
const durationValue = fc.double({ min: 0.001, max: 10_000, noNaN: true, noDefaultInfinity: true });
const timeValue = fc.double({ min: -20_000, max: 20_000, noNaN: true, noDefaultInfinity: true });
const finiteValue = fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true, noDefaultInfinity: true });
const transformProperties = [
  'opacity',
  'position.x',
  'position.y',
  'position.z',
  'scale.x',
  'scale.y',
  'rotation.x',
  'rotation.y',
  'rotation.z',
] as const satisfies readonly AnimatableProperty[];
const transformProperty = fc.constantFrom(...transformProperties);

function clampTime(time: number, duration: number): number {
  return Math.max(0, Math.min(time, duration));
}

function createStoreWithClip(duration: number, playheadPosition = 0) {
  const clip = createMockClip({
    id: 'clip-1',
    trackId: 'video-1',
    startTime: 0,
    duration,
    outPoint: duration,
  });

  return createTestTimelineStore({ clips: [clip], playheadPosition });
}

function getTransformValue(transform: ClipTransform, property: AnimatableProperty): number {
  switch (property) {
    case 'opacity':
      return transform.opacity;
    case 'position.x':
      return transform.position.x;
    case 'position.y':
      return transform.position.y;
    case 'position.z':
      return transform.position.z;
    case 'scale.x':
      return transform.scale.x;
    case 'scale.y':
      return transform.scale.y;
    case 'rotation.x':
      return transform.rotation.x;
    case 'rotation.y':
      return transform.rotation.y;
    case 'rotation.z':
      return transform.rotation.z;
    default:
      throw new Error(`Unsupported test property: ${property}`);
  }
}

function expectFiniteKeyframeValues(values: number[]): void {
  for (const value of values) {
    expect(Number.isFinite(value)).toBe(true);
  }
}

describe('keyframeSlice properties', () => {
  it('addKeyframe clamps generated times into the owning clip duration', () => {
    fc.assert(
      fc.property(durationValue, timeValue, finiteValue, transformProperty, (duration, time, value, property) => {
        const store = createStoreWithClip(duration);

        store.getState().addKeyframe('clip-1', property, value, time);

        const keyframes = store.getState().clipKeyframes.get('clip-1') ?? [];
        expect(keyframes).toHaveLength(1);
        expect(keyframes[0].time).toBeCloseTo(clampTime(time, duration));
        expect(keyframes[0].time).toBeGreaterThanOrEqual(0);
        expect(keyframes[0].time).toBeLessThanOrEqual(duration);
      }),
      propertyOptions,
    );
  });

  it('moveKeyframe clamps generated target times into the owning clip duration', () => {
    fc.assert(
      fc.property(durationValue, timeValue, timeValue, finiteValue, transformProperty, (duration, initialTime, targetTime, value, property) => {
        const store = createStoreWithClip(duration);
        store.getState().addKeyframe('clip-1', property, value, initialTime);
        const keyframeId = store.getState().clipKeyframes.get('clip-1')![0].id;

        store.getState().moveKeyframe(keyframeId, targetTime);

        const moved = store.getState().clipKeyframes.get('clip-1')!.find(keyframe => keyframe.id === keyframeId);
        expect(moved?.time).toBeCloseTo(clampTime(targetTime, duration));
        expect(moved?.time).toBeGreaterThanOrEqual(0);
        expect(moved?.time).toBeLessThanOrEqual(duration);
      }),
      propertyOptions,
    );
  });

  it('moveKeyframes keeps grouped moves within duration and leaves unselected keyframes untouched', () => {
    fc.assert(
      fc.property(
        durationValue,
        timeValue,
        timeValue,
        timeValue,
        finiteValue,
        finiteValue,
        finiteValue,
        (duration, firstTime, secondTime, targetTime, firstValue, secondValue, untouchedValue) => {
          const store = createStoreWithClip(duration);
          store.getState().addKeyframe('clip-1', 'opacity', firstValue, firstTime);
          store.getState().addKeyframe('clip-1', 'scale.x', secondValue, secondTime);
          store.getState().addKeyframe('clip-1', 'rotation.z', untouchedValue, duration / 2);

          const keyframesBefore = store.getState().clipKeyframes.get('clip-1')!;
          const selectedIds = keyframesBefore
            .filter(keyframe => keyframe.property === 'opacity' || keyframe.property === 'scale.x')
            .map(keyframe => keyframe.id);
          const untouched = keyframesBefore.find(keyframe => keyframe.property === 'rotation.z')!;

          store.getState().moveKeyframes(selectedIds, targetTime);

          const keyframesAfter = store.getState().clipKeyframes.get('clip-1')!;
          const clampedTarget = clampTime(targetTime, duration);
          const selectedAfter = keyframesAfter.filter(keyframe => selectedIds.includes(keyframe.id));
          expect(selectedAfter).toHaveLength(2);
          for (const keyframe of selectedAfter) {
            expect(keyframe.time).toBeCloseTo(clampedTarget);
            expect(keyframe.time).toBeGreaterThanOrEqual(0);
            expect(keyframe.time).toBeLessThanOrEqual(duration);
          }

          const untouchedAfter = keyframesAfter.find(keyframe => keyframe.id === untouched.id)!;
          expect(untouchedAfter.time).toBe(untouched.time);
          expect(keyframesAfter.every(keyframe => keyframe.time >= 0 && keyframe.time <= duration)).toBe(true);
        },
      ),
      propertyOptions,
    );
  });

  it('setPropertyValue while recording stores finite bounded values as keyframes', () => {
    fc.assert(
      fc.property(durationValue, timeValue, finiteValue, transformProperty, (duration, playheadPosition, value, property) => {
        const store = createStoreWithClip(duration, playheadPosition);
        store.getState().toggleKeyframeRecording('clip-1', property);

        store.getState().setPropertyValue('clip-1', property, value);

        const keyframes = store.getState().clipKeyframes.get('clip-1') ?? [];
        const expectedValue = normalizeTimelinePropertyValue(property, value);
        expect(keyframes).toHaveLength(1);
        expect(keyframes[0].property).toBe(property);
        expect(keyframes[0].value).toBe(expectedValue);
        expect(keyframes[0].time).toBeCloseTo(clampTime(playheadPosition, duration));
        expectFiniteKeyframeValues(keyframes.map(keyframe => keyframe.value));
      }),
      propertyOptions,
    );
  });

  it('setPropertyValue with existing keyframes updates or appends finite bounded values', () => {
    fc.assert(
      fc.property(durationValue, timeValue, finiteValue, finiteValue, transformProperty, (duration, playheadPosition, initialValue, nextValue, property) => {
        const store = createStoreWithClip(duration, playheadPosition);
        store.getState().addKeyframe('clip-1', property, initialValue, 0);

        store.getState().setPropertyValue('clip-1', property, nextValue);

        const keyframes = (store.getState().clipKeyframes.get('clip-1') ?? [])
          .filter(keyframe => keyframe.property === property);
        const expectedValue = normalizeTimelinePropertyValue(property, nextValue);
        expect(keyframes.length).toBeGreaterThanOrEqual(1);
        expect(keyframes.some(keyframe => keyframe.value === expectedValue)).toBe(true);
        expect(keyframes.every(keyframe => keyframe.time >= 0 && keyframe.time <= duration)).toBe(true);
        expectFiniteKeyframeValues(keyframes.map(keyframe => keyframe.value));
      }),
      propertyOptions,
    );
  });

  it('disablePropertyKeyframes removes the property keyframes and preserves the provided current transform value', () => {
    fc.assert(
      fc.property(durationValue, timeValue, finiteValue, finiteValue, transformProperty, (duration, time, keyedValue, currentValue, property) => {
        const store = createStoreWithClip(duration);
        store.getState().addKeyframe('clip-1', property, keyedValue, time);

        store.getState().disablePropertyKeyframes('clip-1', property, currentValue);

        const remaining = store.getState().clipKeyframes.get('clip-1') ?? [];
        expect(remaining.some(keyframe => keyframe.property === property)).toBe(false);
        const clip = store.getState().clips.find(candidate => candidate.id === 'clip-1')!;
        expect(getTransformValue(clip.transform, property)).toBe(
          normalizeTimelinePropertyValue(property, currentValue),
        );
        expect(store.getState().isRecording('clip-1', property)).toBe(false);
      }),
      propertyOptions,
    );
  });
});
