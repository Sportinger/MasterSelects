import { describe, expect, it } from 'vitest';
import { fieldNoise, fieldRamp, fieldShapeDistance } from '../../src/services/operators/fields/fieldFunctions';
import { createDefaultWeaveGraph, geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { addableEffectOperators } from '../../src/services/operators/effectGraphOwner';
import { exposedGraphValues } from '../../src/services/operators/exposedGraphValues';

const radiusAt = (reveal: number) => {
  const program = compileGeometryGraph(createDefaultWeaveGraph(), geometryParameterReader({ reveal_value: reveal }));
  expect(isGeometryProgram(structuredClone(program))).toBe(true);
  return evaluateGeometryProgram(program);
};

describe('Weave reveal fields', () => {
  it('measures signed distances to shapes', () => {
    expect(fieldShapeDistance([3, 4, 0], [0, 0, 0], 1, 0)).toBeCloseTo(4, 12);
    expect(fieldShapeDistance([0.2, 0, 0], [0, 0, 0], 0.5, 1)).toBeCloseTo(-0.3, 12);
    expect(fieldShapeDistance([2, 0, 0], [0, 0, 0], 0.5, 1)).toBeCloseTo(1.5, 12);
    expect(fieldShapeDistance([5, -2, 1], [0, 1, 0], 9, 2)).toBe(-3);
  });

  it('maps values through a smooth three-key ramp', () => {
    const keys = [-0.1, 1, 0, 1.6, 0.1, 0];
    expect(fieldRamp(-1, keys)).toBe(1);
    expect(fieldRamp(0, keys)).toBe(1.6);
    expect(fieldRamp(0.05, keys)).toBeCloseTo(0.8, 12);
    expect(fieldRamp(3, keys)).toBe(0);
  });

  it('produces bounded, deterministic noise', () => {
    const samples = Array.from({ length: 200 }, (_, index) => fieldNoise([index * 0.137, index * 0.071, -index * 0.05], 3, 0.5, 2, 3));
    expect(samples.every(value => Math.abs(value) <= 0.5)).toBe(true);
    expect(new Set(samples.map(value => value.toFixed(6))).size).toBeGreaterThan(150);
    expect(fieldNoise([1, 2, 3], 3, 0.5, 2, 3)).toBe(fieldNoise([1, 2, 3], 3, 0.5, 2, 3));
    expect(fieldNoise([1, 2, 3], 3, 0.5, 3, 3)).not.toBe(fieldNoise([1, 2, 3], 3, 0.5, 2, 3));
  });

  it('grows the default weave from its center with a swollen front', () => {
    expect(validateWeaveGraph(createDefaultWeaveGraph())).toEqual([]);
    expect(exposedGraphValues(createDefaultWeaveGraph())).toMatchObject([{ nodeId: 'reveal', key: 'reveal_value', label: 'Reveal', min: 0, max: 1 }]);
    const full = radiusAt(1).radius!;
    expect(Math.min(...full)).toBe(1);
    const hidden = radiusAt(0).radius!;
    expect(hidden.filter(value => value > 0).length / hidden.length).toBeLessThan(0.02);
    const growing = radiusAt(0.4).radius!;
    expect(growing.some(value => value === 0)).toBe(true);
    expect(growing.some(value => value === 1)).toBe(true);
    expect(Math.max(...growing)).toBeGreaterThan(1.4);
  });

  it('offers the field nodes and Time in geometry graphs only', () => {
    const offered = new Set(addableEffectOperators('weave').map(operator => operator.id));
    for (const id of ['field.shape-distance', 'field.noise', 'field.ramp', 'image.timeline-time']) expect(offered.has(id), id).toBe(true);
    for (const owner of ['invert', 'face-cables', 'voxel-relief']) {
      expect(addableEffectOperators(owner).some(operator => operator.id.startsWith('field.shape') || operator.id === 'field.ramp'), owner).toBe(false);
    }
  });

  it('reads the composition clock in Time nodes', () => {
    const graph = createDefaultWeaveGraph();
    graph.nodes.push({ id: 'clock', operator: 'image.timeline-time', bindings: {}, operatorVersion: 1 });
    graph.edges = graph.edges.filter(edge => edge.id !== 'reveal-value-reveal-radius-a');
    graph.edges.push({ id: 'clock-radius', from: 'clock', output: 'value', to: 'reveal-radius', input: 'a' });
    const program = compileGeometryGraph(graph, geometryParameterReader({}), undefined, { time: 0.25 });
    const shape = program.stages.find(stage => stage.kind === 'yarn-profile');
    expect(shape && 'radius' in shape && shape.radius?.instructions.some(item => item.operation === 'constant' && item.value === 0.25)).toBe(true);
  });
});
