import { describe, expect, it } from 'vitest';
import type { Keyframe } from '../../src/types/keyframes';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import {
  evaluateFlockValues,
  indexFlockKeyframes,
  resolveFlockStep,
} from '../../src/services/flock/compiler/flockParamEvaluation';
import {
  applyFlockLoop,
  createFlockClipTimeMap,
  flockStepForSourceTime,
} from '../../src/services/flock/time/flockTimeMapper';
import { addFlockNode } from '../../src/services/flock/mutations/flockGraphMutations';

describe('flock time mapping', () => {
  it('maps source time to fixed steps with warm-up and loop reset', () => {
    const program = { stepRate: 60, loopSeconds: 0, simulation: { warmupSteps: 30 } };
    expect(flockStepForSourceTime(program, 1.5)).toMatchObject({ step: 120, alpha: 0 });
    const between = flockStepForSourceTime(program, 1 / 120);
    expect(between.step).toBe(30);
    expect(between.alpha).toBeCloseTo(0.5, 5);
    expect(applyFlockLoop({ loopSeconds: 4 }, 9)).toBeCloseTo(1, 8);
  });

  it('keeps split continuity: the second piece starts at the cut source time', () => {
    const original = createFlockClipTimeMap({ inPoint: 0, outPoint: 10, duration: 10, speed: 1 });
    const second = createFlockClipTimeMap({ inPoint: 4, outPoint: 10, duration: 6, speed: 1 });
    expect(second.toSourceTime(0)).toBeCloseTo(original.toSourceTime(4), 8);
    expect(second.toClipLocalTime(7)).toBeCloseTo(3, 4);
    // Keys before the visible window keep a (negative) local position instead of being discarded.
    expect(second.toClipLocalTime(1)).toBeCloseTo(-3, 3);
  });

  it('inverts reverse and speed maps', () => {
    const reversed = createFlockClipTimeMap({ inPoint: 0, outPoint: 8, duration: 4, speed: 2, reversed: true });
    expect(reversed.toSourceTime(1)).toBeCloseTo(6, 8);
    expect(reversed.toClipLocalTime(6)).toBeCloseTo(1, 4);
    const flat = createFlockClipTimeMap({ inPoint: 0, outPoint: 0, duration: 2, speed: 1 }, () => 0);
    expect(flat.toClipLocalTime(0)).toBeNull();
  });
});

describe('flock parameter evaluation', () => {
  it('interpolates source-time keyframes on node parameters', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const program = compileFlockDefinition(definition).program!;
    const rules = program.ops.find((op) => op.kind === 'rules')!;
    const property = rules.params.numbers.cohesion.property!;
    const keyframes: Keyframe[] = [
      { id: 'k1', clipId: 'c', time: 0, property, value: 0, easing: 'linear' },
      { id: 'k2', clipId: 'c', time: 2, property, value: 4, easing: 'linear' },
    ];
    const context = { keyframesByProperty: indexFlockKeyframes(keyframes) };
    const step = resolveFlockStep(program, program.stepRate, context);
    expect(step.time).toBeCloseTo(1, 8);
    expect(step.ops.find((op) => op.spec.kind === 'rules')!.p.n.cohesion).toBeCloseTo(2, 6);
  });

  it('reports unavailable audio analysis instead of inventing a level', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const added = addFlockNode(definition, 'flock.audio', { params: { clipId: 'clip-audio-1', floor: 0.2 } });
    if (!added.ok) throw new Error('add failed');
    const program = compileFlockDefinition(added.definition).program!;
    const audioProgram = { values: [{ nodeId: added.nodeId, sourceNodeId: added.nodeId, operator: 'flock.audio', kind: 'audio' as const, params: {
      numbers: { gain: { base: 1 }, offset: { base: 0 }, floor: { base: 0.2 }, smoothing: { base: 0 } },
      vectors: {}, colors: {}, enums: {}, integers: {}, booleans: {}, assets: { clipId: 'clip-audio-1' },
    } }] };
    const missing = evaluateFlockValues(audioProgram, 1, { keyframesByProperty: new Map(), audio: () => null });
    expect(missing.values[0]).toBe(0.2);
    expect(missing.unavailableAudioClipIds).toEqual(['clip-audio-1']);
    const present = evaluateFlockValues(audioProgram, 1, { keyframesByProperty: new Map(), audio: () => 0.8 });
    expect(present.values[0]).toBeCloseTo(0.8, 8);
    expect(program.capacity).toBeGreaterThan(0);
  });
});
