import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { projectImageRadius, rotateImageCoordinate, unprojectImageRadius } from '../../src/services/operators/imageOpticsSemantics';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({
  id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }),
});
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${to}-${input}`, from, output, to, input });

function opticsGraph(model: number): EffectOperatorGraph {
  return {
    version: 1, schemaVersion: 1, domain: 'image', layout: {},
    nodes: [node('frame', 'image.frame'), node('output', 'image.output'), node('theta', 'values.number', .7),
      node('radius', 'values.number', .42), node('max-theta', 'values.number', 1.2), node('model', 'values.number', model),
      node('project', 'optics.project-radius.scalar'), node('unproject', 'optics.unproject-radius.scalar'),
      node('x', 'values.number', 1), node('y', 'values.number', 0), node('vector', 'vector.combine.vec2'),
      node('angle', 'values.number', Math.PI / 2), node('rotate', 'coordinates.rotate.vec2')],
    edges: [edge('frame', 'image', 'output', 'image'), edge('theta', 'value', 'project', 'theta'),
      edge('max-theta', 'value', 'project', 'maxTheta'), edge('model', 'value', 'project', 'model'),
      edge('radius', 'value', 'unproject', 'radius'), edge('max-theta', 'value', 'unproject', 'maxTheta'),
      edge('model', 'value', 'unproject', 'model'), edge('x', 'value', 'vector', 'x'), edge('y', 'value', 'vector', 'y'),
      edge('vector', 'value', 'rotate', 'value'), edge('angle', 'value', 'rotate', 'angle')],
  };
}

function scalarPreview(graph: EffectOperatorGraph, nodeId: string): number {
  const plan = compileImageOperatorPreview(graph, {}, { nodeId, direction: 'output', portId: 'value' });
  return evaluateImageOperatorPlan(plan, [0, 0, 0, 0])[0];
}

describe('image optics primitives', () => {
  it.each([0, 1, 2, 3])('matches projection model %i and its inverse', model => {
    const graph = opticsGraph(model), theta = .7, maxTheta = 1.2, radius = .42;
    const expectedProjection = model === 0 ? theta / maxTheta
      : model === 1 ? Math.sin(theta / 2) / Math.sin(maxTheta / 2)
      : model === 2 ? Math.tan(theta / 2) / Math.tan(maxTheta / 2)
      : Math.sin(theta) / Math.sin(maxTheta);
    const expectedInverse = model === 0 ? radius * maxTheta
      : model === 1 ? 2 * Math.asin(radius * Math.sin(maxTheta / 2))
      : model === 2 ? 2 * Math.atan(radius * Math.tan(maxTheta / 2))
      : Math.asin(radius * Math.sin(maxTheta));
    expect(scalarPreview(graph, 'project')).toBeCloseTo(expectedProjection, 12);
    expect(scalarPreview(graph, 'unproject')).toBeCloseTo(expectedInverse, 12);
  });

  it('rotates vec2 coordinates in radians and emits shared helpers only when used', () => {
    const graph = opticsGraph(0);
    const rotate = compileImageOperatorPreview(graph, {}, { nodeId: 'rotate', direction: 'output', portId: 'value' });
    const result = evaluateImageOperatorPlan(rotate, [0, 0, 0, 0]);
    expect(result[0]).toBeCloseTo(0, 12);
    expect(result[1]).toBeCloseTo(1, 12);
    expect(rotate.wgsl).toContain('fn imageRotate2d(');
    expect(rotate.wgsl).not.toContain('fn imageGraphProjectRadius(');
    const project = compileImageOperatorPreview(graph, {}, { nodeId: 'project', direction: 'output', portId: 'value' });
    expect(project.wgsl).toContain('fn imageGraphProjectRadius(');
    expect(project.wgsl).toContain('fn imageGraphUnprojectRadius(');
  });

  it('preserves projection epsilon, inverse domain clamps, and signed rotation components', () => {
    expect(projectImageRadius(.3, 0, 0)).toBeCloseTo(3000, 12);
    expect(projectImageRadius(.3, 0, 1)).toBeCloseTo(Math.sin(.15) / .0001, 12);
    expect(unprojectImageRadius(3, 1, 1)).toBeCloseTo(Math.PI, 12);
    expect(unprojectImageRadius(3, 1, 3)).toBeCloseTo(Math.PI / 2, 12);
    expect(unprojectImageRadius(-3, 1, 1)).toBeCloseTo(-Math.PI, 12);
    expect(unprojectImageRadius(-3, 1, 3)).toBeCloseTo(-Math.PI / 2, 12);
    const rotated = rotateImageCoordinate([.25, -.5], .7);
    expect(rotated[0]).toBeCloseTo(.25 * Math.cos(.7) + .5 * Math.sin(.7), 12);
    expect(rotated[1]).toBeCloseTo(.25 * Math.sin(.7) - .5 * Math.cos(.7), 12);
    expect(rotated[1]).toBeLessThan(0);
  });

  it('passes the input through without lowering rotation when bypassed', () => {
    const graph = opticsGraph(0);
    graph.nodes.find(candidate => candidate.id === 'rotate')!.bypassed = true;
    const plan = compileImageOperatorPreview(graph, {}, { nodeId: 'rotate', direction: 'output', portId: 'value' });
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0])).toEqual([1, 0, 0, 1]);
    expect(plan.instructions.some(instruction => instruction.operation === 'rotate-vec2')).toBe(false);
    expect(plan.wgsl).not.toContain('fn imageRotate2d(');
  });
});
