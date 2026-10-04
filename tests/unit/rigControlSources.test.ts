import { describe, expect, it } from 'vitest';
import { createControlNode } from '../../src/services/parameterSources/controlOperators';
import { createParameterSourceEvaluator } from '../../src/services/parameterSources/parameterSourceEvaluation';
import { applyParameterSourcesToTransform } from '../../src/services/parameterSources/parameterSourceRendering';
import { getParameterSourceTarget, parameterSourceTargets, type ParameterSourceClip } from '../../src/services/parameterSources/parameterSourceTargets';
import { envelopeValue, markerTriggerValue, smoothNoise, solveTwoBoneIk } from '../../src/services/parameterSources/controlSignalMath';
import { freezeMarkerParameterContext } from '../../src/services/parameterSources/markerParameterContext';
import { transformParameterPatch } from '../../src/services/parameterSources/transformParameterTargets';
import type { BoundOperatorNode, OperatorEdge } from '../../src/types/operatorGraph';
import type { ParameterSourceBinding } from '../../src/types/parameterSources';
import type { ClipTransform } from '../../src/types/timelineCore';

const TRANSFORM: ClipTransform = { opacity: 1, blendMode: 'normal', position: { x: 0.1, y: 0.2, z: 0 },
  anchor: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 15 } };

function clip(nodes: BoundOperatorNode[], targets: Record<string, ParameterSourceBinding>, edges: OperatorEdge[] = []): ParameterSourceClip {
  return { id: 'clip', startTime: 10, effects: [], transform: structuredClone(TRANSFORM),
    nodeGraph: { version: 1, nodes: [], parameterSources: { version: 1, clipTimeOffset: 0,
      graph: { version: 1, nodes, edges, layout: {} }, targets } } };
}
function node(operator: string, id: string, constants: Record<string, number | string> = {}): BoundOperatorNode {
  const created = createControlNode(operator, id);
  created.constants = { ...created.constants, ...constants };
  return created;
}

describe('control signal math', () => {
  it('produces deterministic, bounded and continuous noise', () => {
    const samples = Array.from({ length: 400 }, (_, i) => smoothNoise(i * 0.05, 7, 3));
    expect(samples).toEqual(Array.from({ length: 400 }, (_, i) => smoothNoise(i * 0.05, 7, 3)));
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(1);
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(0.5);
    expect(smoothNoise(3.3, 1)).not.toBe(smoothNoise(3.3, 2));
  });

  it('shapes attack, hold and decay', () => {
    expect(envelopeValue(-0.1, 0.1, 0.1, 0.5, 'linear')).toBe(0);
    expect(envelopeValue(0.05, 0.1, 0.1, 0.5, 'linear')).toBeCloseTo(0.5);
    expect(envelopeValue(0.15, 0.1, 0.1, 0.5, 'linear')).toBe(1);
    expect(envelopeValue(0.45, 0.1, 0.1, 0.5, 'linear')).toBeCloseTo(0.5);
    expect(envelopeValue(1, 0.1, 0.1, 0.5, 'linear')).toBe(0);
    expect(envelopeValue(0, 0, 0, 0.3, 'exponential')).toBe(1);
    expect(envelopeValue(0.3, 0, 0, 0.3, 'exponential')).toBeLessThan(0.01);
  });

  it('derives timing from matching markers', () => {
    const markers = [{ time: 4, label: 'hit' }, { time: 1, label: 'hit' }, { time: 2, label: 'beat' }];
    expect(markerTriggerValue(markers, 0.5, 'hit', 'since')).toBe(-1);
    expect(markerTriggerValue(markers, 1, 'hit', 'since')).toBe(0);
    expect(markerTriggerValue(markers, 3, 'hit', 'since')).toBe(2);
    expect(markerTriggerValue(markers, 3, '', 'since')).toBe(1);
    expect(markerTriggerValue(markers, 3, 'hit', 'until')).toBe(1);
    expect(markerTriggerValue(markers, 5, 'hit', 'until')).toBe(-1);
    expect(markerTriggerValue(markers, 3, '', 'count')).toBe(2);
    expect(markerTriggerValue(markers, 2.5, 'hit', 'progress')).toBeCloseTo(0.5);
  });

  it('solves a reachable two-bone chain whose forward kinematics hit the target', () => {
    for (const bend of [1, -1] as const) {
      const ik = solveTwoBoneIk(0.1, 0.2, 0.5, 0.6, 0.4, 0.3, bend);
      const a1 = ik.angle1 * Math.PI / 180, a2 = a1 + ik.angle2 * Math.PI / 180;
      expect(ik.jointX).toBeCloseTo(0.1 + Math.cos(a1) * 0.4);
      expect(ik.jointY).toBeCloseTo(0.2 + Math.sin(a1) * 0.4);
      expect(ik.jointX + Math.cos(a2) * 0.3).toBeCloseTo(0.5);
      expect(ik.jointY + Math.sin(a2) * 0.3).toBeCloseTo(0.6);
      expect(ik.endX).toBeCloseTo(0.5);
      expect(Math.sign(ik.angle2)).toBe(-bend);
    }
    const stretched = solveTwoBoneIk(0, 0, 3, 0, 1, 1, 1);
    expect(stretched).toMatchObject({ angle1: 0, angle2: 0, endX: 2, endY: 0, reach: 1 });
    expect(() => solveTwoBoneIk(0, 0, 1, 0, 0, 1, 1)).toThrow('greater than zero');
  });
});

describe('control sources driving transforms', () => {
  it('offers transform targets with stored-unit values and hard opacity limits', () => {
    const subject = clip([], {});
    expect(getParameterSourceTarget(subject, 'rotation.z')).toMatchObject({ value: 15, unit: 'degrees' });
    expect(getParameterSourceTarget(subject, 'opacity')).toMatchObject({ hardMin: 0, hardMax: 1 });
    expect(parameterSourceTargets({ ...subject, transform: undefined }).some(target => target.path === 'position.x')).toBe(false);
    expect(transformParameterPatch('position.y', 3)).toEqual({ position: { y: 3 } });
  });

  it('returns the same transform object when nothing is bound', () => {
    const subject = clip([node('control.lfo', 'lfo')], {});
    const transform = structuredClone(TRANSFORM);
    expect(applyParameterSourcesToTransform(subject, [], 0, transform)).toBe(transform);
  });

  it('overrides only the bound properties and keeps the clip data untouched', () => {
    const subject = clip([node('values.number', 'spin', { value: 90 }), node('values.number', 'slide', { value: -0.4 })], {
      'rotation.z': { source: { nodeId: 'spin', portId: 'value' } },
      'position.x': { source: { nodeId: 'slide', portId: 'value' } },
      'position.y': { source: { nodeId: 'slide', portId: 'value' }, enabled: false },
    });
    const result = applyParameterSourcesToTransform(subject, [], 0, structuredClone(TRANSFORM));
    expect(result.rotation).toEqual({ x: 0, y: 0, z: 90 });
    expect(result.position).toEqual({ x: -0.4, y: 0.2, z: 0 });
    expect(subject.transform).toEqual(TRANSFORM);
  });

  it('keeps the interpolated value when a source fails', () => {
    const subject = clip([node('values.number', 'too-much', { value: 2 })], { opacity: { source: { nodeId: 'too-much', portId: 'value' } } });
    expect(applyParameterSourcesToTransform(subject, [], 0, structuredClone(TRANSFORM)).opacity).toBe(1);
  });

  it('wires a multi-output IK node port by port into rotations', () => {
    const ik = node('control.ik-two-bone', 'leg', { rootX: 0, rootY: 0, targetX: 0.5, targetY: 0.3, length1: 0.35, length2: 0.35 });
    const subject = clip([ik, node('values.number', 'reach', { value: 0.3 })], {
      'rotation.z': { source: { nodeId: 'leg', portId: 'angle1' } },
      'rotation.x': { source: { nodeId: 'leg', portId: 'angle2' } },
    }, [{ id: 'e', from: 'reach', output: 'value', to: 'leg', input: 'targetY' }]);
    const evaluator = createParameterSourceEvaluator(subject, [], 0);
    const solved = solveTwoBoneIk(0, 0, 0.5, 0.3, 0.35, 0.35, 1);
    expect(evaluator.resolve('rotation.z').value).toBeCloseTo(solved.angle1);
    expect(evaluator.resolve('rotation.x').value).toBeCloseTo(solved.angle2);
    expect(evaluator.evaluateNode({ nodeId: 'leg', portId: 'jointY' })).toBeCloseTo(solved.jointY);
    expect(() => evaluator.evaluateNode({ nodeId: 'leg', portId: 'value' })).toThrow('Unknown control output');
  });

  it('rejects seconds driving a rotation without an explicit remap', () => {
    const subject = clip([node('control.time', 'clock')], { 'rotation.z': { source: { nodeId: 'clock', portId: 'value' } } });
    expect(() => createParameterSourceEvaluator(subject, [], 1).resolve('rotation.z')).toThrow('Incompatible units');
  });

  it('runs noise and envelope on clip time when unwired', () => {
    const subject = clip([node('control.noise', 'wobble', { frequency: 3, amplitude: 2, seed: 5 }),
      node('control.envelope', 'pulse', { decay: 1, curve: 'linear' })], {
      'position.x': { source: { nodeId: 'wobble', portId: 'value' } },
      'scale.all': { source: { nodeId: 'pulse', portId: 'value' } },
    });
    const evaluator = createParameterSourceEvaluator(subject, [], 0.25);
    expect(evaluator.resolve('position.x').value).toBeCloseTo(2 * smoothNoise(0.75, 5, 1));
    expect(evaluator.resolve('scale.all').value).toBeCloseTo(0.75);
  });

  it('reads frozen markers on the timeline clock', () => {
    const trigger = node('control.marker-trigger', 'beat', { label: 'hit' });
    const subject = clip([trigger, node('control.envelope', 'pulse', { decay: 0.5, curve: 'linear' })],
      { opacity: { source: { nodeId: 'pulse', portId: 'value' } } },
      [{ id: 'age', from: 'beat', output: 'value', to: 'pulse', input: 'age' }]);
    freezeMarkerParameterContext(subject.nodeGraph!.parameterSources!.graph, [{ time: 11, label: 'hit' }, { time: 13, label: 'other' }]);
    // Clip starts at 10: local 1.25 is timeline 11.25, a quarter second after the marker.
    expect(createParameterSourceEvaluator(subject, [], 1.25).resolve('opacity').value).toBeCloseTo(0.5);
    expect(createParameterSourceEvaluator(subject, [], 0.5).resolve('opacity').value).toBe(0);
  });
});
