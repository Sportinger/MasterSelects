// Keyed effect evaluation stays cheap per frame and keyed rates keep their phase: the store's keyframe
// array is evaluated without copies (the property index is reused), a keyed rate is a lookup into
// cached segment integrals (same results as integrating from 0), a head trim keeps a ramp's phase,
// and runtime-only travel stored by older saves is dropped on load with stable identities.
import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { evaluateEffectKeyframes } from '../../src/stores/timeline/keyframes/effectKeyframeEvaluation';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { normalizePersistedSnapshot } from '../../src/stores/historyStore/projectHistoryPersistence';
import { convertProjectCompositionToStore } from '../../src/services/project/load/loadTimelineHydration';
import { calculateSourceTime, integrateKeyframedRate, integrateKeyframedRateBetween } from '../../src/utils/speedIntegration';
import { interpolateKeyframes } from '../../src/utils/keyframeInterpolation';
import { keyframesForProperty } from '../../src/utils/keyframePropertyIndex';
import { retimeKeyframesForEdgeTrim } from '../../src/utils/keyframeTrimAnchoring';
import type { AnimatableProperty, EasingType } from '../../src/types/animationProperties';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import type { ProjectComposition } from '../../src/services/project/types/composition.types';
import type { ProjectClip } from '../../src/services/project/types';

const SPEED = 'effect.grid.speed' as AnimatableProperty;
const key = (id: string, property: string, time: number, value: number, extra: Partial<Keyframe> = {}) =>
  ({ id, clipId: 'gen', time, property, value, easing: 'linear', ...extra }) as Keyframe;
const grid = (params: Effect['params'] = getDefaultParams('perspective-grid')): Effect =>
  ({ id: 'grid', name: 'Perspective Grid', type: 'perspective-grid', enabled: true, params });

/** The integration before the segment cache (2026-10-21): samples every segment from 0 on each call. */
function legacyIntegrate(keyframes: Keyframe[], property: AnimatableProperty, endTime: number, defaultValue: number): number {
  const rateKeyframes = keyframes.filter(k => k.property === property).sort((a, b) => a.time - b.time);
  if (rateKeyframes.length === 0) return endTime * defaultValue;
  if (rateKeyframes.length === 1) return endTime * rateKeyframes[0].value;
  if (!(endTime > 0)) return 0;
  const samplePoints = [0, ...rateKeyframes.filter(kf => kf.time > 0 && kf.time < endTime).map(kf => kf.time), endTime];
  const all: number[] = [];
  for (let i = 0; i < samplePoints.length - 1; i++) {
    const dt = (samplePoints[i + 1] - samplePoints[i]) / 10;
    for (let j = 0; j < 10; j++) all.push(samplePoints[i] + j * dt);
  }
  all.push(endTime);
  const unique = [...new Set(all)].sort((a, b) => a - b);
  let integral = 0;
  for (let i = 0; i < unique.length - 1; i++) {
    const value0 = interpolateKeyframes(keyframes, property, unique[i], defaultValue);
    const segment = rateKeyframes.findLast(k => k.time <= unique[i]);
    const value1 = segment?.hold ? value0 : interpolateKeyframes(keyframes, property, unique[i + 1], defaultValue);
    integral += (value0 + value1) / 2 * (unique[i + 1] - unique[i]);
  }
  return integral;
}

function random(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const EASINGS: EasingType[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'];
function randomKeys(next: () => number, count: number, property: string = SPEED): Keyframe[] {
  const keys: Keyframe[] = [];
  let time = next() * 0.5;
  for (let i = 0; i < count; i++) {
    const extra: Partial<Keyframe> = { easing: EASINGS[Math.floor(next() * EASINGS.length)], hold: next() < 0.15 };
    if (next() < 0.2) extra.handleOut = { x: next() * 0.3, y: next() * 4 - 2 };
    keys.push(key(`k${i}`, property, time, next() * 15 - 5, extra));
    time += next() < 0.08 ? 0 : 0.05 + next() * 1.5; // occasionally two keys at one time
  }
  return keys.toSorted(() => next() - 0.5); // unsorted as stored
}

/** Keys whose reads are counted (the cost of one evaluation, independent of wall time). */
function counted(keys: Keyframe[], counter: { reads: number }): Keyframe[] {
  return keys.map(source => {
    const copy = { ...source };
    for (const field of ['time', 'value'] as const) {
      const stored = copy[field];
      Object.defineProperty(copy, field, { get: () => { counter.reads++; return stored; }, enumerable: true });
    }
    return copy;
  });
}

describe('Keyed rate integration', () => {
  it('matches integrating from 0 on random key sets (eased, bezier, hold) and stays additive', () => {
    const next = random(20261021);
    let compared = 0;
    for (let set = 0; set < 160; set++) {
      const keys = randomKeys(next, 2 + Math.floor(next() * 14));
      const sorted = keys.toSorted((a, b) => a.time - b.time);
      const times = [0, ...sorted.map(k => k.time), ...Array.from({ length: 12 }, () => next() * (sorted.at(-1)!.time + 3))];
      // Two keys at one time are a jump; the old sampling spread it over the next sample step.
      const equalTimes = new Set(keys.map(k => k.time)).size < keys.length;
      for (const time of times) {
        const integral = integrateKeyframedRate(keys, SPEED, time, 1);
        const split = time * next();
        expect(integrateKeyframedRate(keys, SPEED, split, 1) + integrateKeyframedRateBetween(keys, SPEED, split, time, 1)).toBeCloseTo(integral, 9);
        if (equalTimes) continue;
        const expected = legacyIntegrate(keys, SPEED, time, 1);
        expect(Math.abs(integral - expected)).toBeLessThanOrEqual(1e-9 * (1 + Math.abs(expected)));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(1500);
  });

  it('integrates two keys at one time as a jump', () => {
    const step = [key('a', SPEED, 1, 2), key('b', SPEED, 1, 6), key('c', SPEED, 3, 6)];
    expect(integrateKeyframedRate(step, SPEED, 2, 0)).toBeCloseTo(2 + 6, 12);
    expect(integrateKeyframedRate(step, SPEED, 5, 0)).toBeCloseTo(2 + 6 * 4, 12);
  });

  it('keeps clip speed (source time) unchanged, including its edge cases', () => {
    const ramp = [key('a', 'speed', 0, 1), key('b', 'speed', 2, 4, { easing: 'ease-in-out' }), key('c', 'speed', 3, 0.5)];
    for (const time of [-1, 0, 0.3, 2, 2.5, 3, 7]) expect(calculateSourceTime(ramp, time, 1)).toBeCloseTo(legacyIntegrate(ramp, 'speed' as AnimatableProperty, time, 1), 12);
    expect(calculateSourceTime([], 3, -2)).toBe(-6);
    expect(calculateSourceTime([key('a', 'speed', 1, 3)], 2, 1)).toBe(6);
  });

  it('integrates between any two times, holding the first and last key value outside the keys', () => {
    const ramp = [key('a', SPEED, 1, 2), key('b', SPEED, 3, 6)];
    expect(integrateKeyframedRateBetween(ramp, SPEED, -2, 1, 0)).toBeCloseTo(6, 12); // 3 s at the first key's 2
    expect(integrateKeyframedRateBetween(ramp, SPEED, 1, 3, 0)).toBeCloseTo(8, 12);
    expect(integrateKeyframedRateBetween(ramp, SPEED, 3, 1, 0)).toBeCloseTo(-8, 12);
    expect(integrateKeyframedRateBetween(ramp, SPEED, 3, 5, 0)).toBeCloseTo(12, 12);
    expect(integrateKeyframedRateBetween([], SPEED, -1, 2, 1.5)).toBeCloseTo(4.5, 12);
  });

  it('costs O(log K) per frame once the key array is known, not O(K²)', () => {
    const readsPerCall = (count: number) => {
      const counter = { reads: 0 };
      const keys = counted(randomKeys(random(count), count), counter);
      const last = Math.max(...keys.map(k => k.time));
      integrateKeyframedRate(keys, SPEED, last * 0.99, 0); // builds the index and the segment table once
      counter.reads = 0;
      for (let frame = 0; frame < 60; frame++) integrateKeyframedRate(keys, SPEED, last * (0.5 + frame / 130), 0);
      return counter.reads / 60;
    };
    const small = readsPerCall(100), large = readsPerCall(1000);
    // A binary search for the segment plus eleven interpolations in it; integrating from 0 read
    // every segment of the curve on every frame (~10⁵ reads per frame for 1000 keys).
    expect(large).toBeLessThan(600);
    expect(large / small).toBeLessThan(1.6);
  });
});

describe('Effect keyframe evaluation', () => {
  it('evaluates the store array itself: the property index is reused instead of re-sorting every key', () => {
    const counter = { reads: 0 };
    const transforms = counted(Array.from({ length: 6000 }, (_, i) => key(`t${i}`, i % 2 ? 'position.x' : 'opacity', i / 100, i % 7)), counter);
    const effectKeys = Array.from({ length: 30 }, (_, i) => key(`e${i}`, SPEED, i * 0.4, (i % 5) - 1));
    const store = [...transforms, ...effectKeys];
    const effects = [grid(), { ...grid(), id: 'unkeyed' }];
    evaluateEffectKeyframes(effects, store, 1, 0);
    const index = keyframesForProperty(store, SPEED);
    counter.reads = 0;
    for (let frame = 0; frame < 20; frame++) {
      const [keyed, unkeyed] = evaluateEffectKeyframes(effects, store, 1 + frame / 30, 5);
      expect(keyed.params.speed).toBeCloseTo(interpolateKeyframes(store, SPEED, 1 + frame / 30, 0), 12);
      expect(unkeyed).toBe(effects[1]); // an effect without keys keeps its identity
    }
    expect(counter.reads).toBe(0); // no copy, so no transform key is touched again
    expect(keyframesForProperty(store, SPEED)).toBe(index);
    const nested = evaluateCompositionClipEffects(effects, store, 2, { startTime: 5 } as never);
    expect(nested[0].params.speedTravel).toBeCloseTo(evaluateEffectKeyframes(effects, store, 2, 5)[0].params.speedTravel as number, 12);
    expect(counter.reads).toBe(0);
  });

  it('keeps a keyed ramp\'s phase across a head trim (keys stay anchored on the timeline)', () => {
    // Speed ramps 0 → 8 rows/s over 4 s; the clip starts at 10 s.
    const ramp = [key('a', SPEED, 0, 0), key('b', SPEED, 4, 8)];
    const before = { startTime: 10, duration: 4, inPoint: 0, outPoint: 4 };
    const after = { startTime: 10.5, duration: 3.5, inPoint: 0.5, outPoint: 4 };
    const trimmed = retimeKeyframesForEdgeTrim(ramp, before, after);
    expect(trimmed.map(k => k.time)).toEqual([-0.5, 3.5]);
    for (const timeline of [10.5, 11, 13, 14, 15]) {
      const untrimmed = evaluateEffectKeyframes([grid()], ramp, timeline - before.startTime, before.startTime)[0].params.speedTravel as number;
      const kept = evaluateEffectKeyframes([grid()], trimmed, timeline - after.startTime, after.startTime)[0].params.speedTravel as number;
      expect(kept).toBeCloseTo(untrimmed, 9);
    }
    // 13 s: ∫ of the ramp over its first 3 s = 9 rows (not 19.25 from v(0) × start).
    expect(evaluateEffectKeyframes([grid()], trimmed, 2.5, 10.5)[0].params.speedTravel).toBeCloseTo(9, 9);
  });

  it('is unchanged for keys at or after the clip start: v(0) × start + ∫₀ᵗ v', () => {
    const next = random(7);
    for (let set = 0; set < 40; set++) {
      const keys = randomKeys(next, 2 + Math.floor(next() * 8));
      if (new Set(keys.map(k => k.time)).size < keys.length) continue;
      const start = next() * 100, time = next() * 12;
      const expected = interpolateKeyframes(keys, SPEED, 0, 1.5) * start + legacyIntegrate(keys, SPEED, time, 1.5);
      const travel = evaluateEffectKeyframes([grid()], keys, time, start)[0].params.speedTravel as number;
      expect(Math.abs(travel - expected)).toBeLessThanOrEqual(1e-9 * (1 + Math.abs(expected)));
    }
  });
});

describe('Stored travel from older saves', () => {
  const stored = () => grid({ ...getDefaultParams('perspective-grid'), speed: 2, speedTravel: 0.4 });
  const projectComposition = (effects: ProjectClip['effects']): ProjectComposition => ({
    id: 'comp-1', name: 'Comp', width: 1920, height: 1080, frameRate: 25, duration: 4, backgroundColor: '#000000', folderId: null,
    tracks: [{ id: 'video-1', name: 'Video 1', type: 'video', height: 60, locked: false, visible: true, muted: false, solo: false }],
    clips: [{ id: 'clip-1', trackId: 'video-1', name: 'Grid', mediaId: '', sourceType: 'solid', naturalDuration: 4, startTime: 0, duration: 4,
      inPoint: 0, outPoint: 4, transform: { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, rotation: 0, rotationX: 0, rotationY: 0, anchorX: 0.5,
        anchorY: 0.5, opacity: 1, blendMode: 'normal' }, effects, masks: [], keyframes: [], volume: 1, audioEnabled: true, reversed: false,
      disabled: false } as ProjectClip],
    markers: [] });

  it('drops it when a project, a composition or an undo history is loaded', () => {
    expect(migratePersistedEffectOperatorGraph(stored()).params).not.toHaveProperty('speedTravel');
    const spin = { id: 'wheel', name: 'Color Wheel', type: 'color-wheel', enabled: true, params: { spin: 0.2, spinTravel: 3 } } as Effect;
    expect(migratePersistedEffectOperatorGraph(spin).params).toEqual({ spin: 0.2 });
    const loaded = convertProjectCompositionToStore([projectComposition([stored()] as ProjectClip['effects'])])[0].timelineData!.clips[0].effects;
    expect(loaded[0].params).not.toHaveProperty('speedTravel');
    expect(loaded[0].params.speed).toBe(2);
    const snapshot = normalizePersistedSnapshot({ timestamp: 1, label: 'Edit', timeline: { clips: [{ id: 'c', effects: [stored()] }] },
      media: {}, dock: {}, flashboard: {}, export: {} })!;
    expect(snapshot.timeline.clips[0].effects[0].params).not.toHaveProperty('speedTravel');
  });

  it('evaluates an instance that still carries it to one stable object', () => {
    const effects = [stored()];
    const first = evaluateEffectKeyframes(effects, [], 1, 3);
    expect(first[0].params).not.toHaveProperty('speedTravel');
    expect(evaluateEffectKeyframes(effects, [], 2, 3)[0]).toBe(first[0]);
    const clean = [migratePersistedEffectOperatorGraph(effects[0])];
    expect(evaluateEffectKeyframes(clean, [], 1, 3)).toBe(clean);
  });
});
