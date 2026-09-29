import { describe, expect, it } from 'vitest';
import { lowerPointwiseNode, pointwiseLoweringFor, type PointwiseInstruction } from '../../src/services/operators/fields/pointwiseLowering';
import { pointwiseOperation } from '../../src/services/operators/fields/pointwiseOperations';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const PORT_TYPE: Record<string, string> = { scalar: 'number', boolean: 'boolean', vec2: 'vec2', vec3: 'vec3', vec4: 'vec4', rgb: 'rgb', alpha: 'alpha', image: 'image' };

describe('shared pointwise lowering', () => {
  it('matches every lowered operator contract and has an executable operation', () => {
    const operators = ['math.add.scalar', 'math.subtract.scalar', 'math.clamp.scalar', 'math.mix.scalar', 'math.sin.scalar', 'math.step.scalar',
      'math.atan2.scalar', 'math.smoothstep.scalar', 'vector.combine.vec3', 'vector.split.vec3', 'vector.dot.vec2', 'math.mix.rgb',
      'select.scalar', 'compare.greater.scalar', 'vector.split.rgba', 'vector.combine.rgba', 'convert.scalar-to-alpha'];
    for (const id of operators) {
      const definition = getEffectOperator(id);
      expect(definition, id).toBeDefined();
      for (const output of definition!.outputs) {
        const rule = pointwiseLoweringFor(id, output.id);
        expect(rule, `${id}:${output.id}`).toBeDefined();
        expect(pointwiseOperation(rule!.operation), rule!.operation).toBeDefined();
        expect(PORT_TYPE[rule!.type], `${id}:${output.id}`).toBe(output.type);
        const inputs = new Set(definition!.inputs.map(port => port.id));
        for (const input of rule!.inputs) expect(inputs.has(input), `${id}.${input}`).toBe(true);
        if (rule!.bypass) expect(rule!.inputs).toContain(rule!.bypass);
      }
    }
  });

  it('ignores inherited object keys', () => {
    expect(pointwiseLoweringFor('constructor', 'value')).toBeUndefined();
    expect(pointwiseOperation('toString')).toBeUndefined();
  });

  it('visits the bypass input first and skips the remaining inputs when bypassed', () => {
    const rule = pointwiseLoweringFor('math.subtract.scalar', 'value')!;
    const visited: string[] = [], emitted: PointwiseInstruction[] = [];
    const visit = (input: string) => { visited.push(input); return visited.length; };
    const emit = (instruction: PointwiseInstruction) => emitted.push(instruction) + 99;
    expect(lowerPointwiseNode(rule, { id: 'n', bypassed: true }, visit, emit)).toBe(1);
    expect(visited).toEqual(['b']);
    expect(emitted).toEqual([]);
    visited.length = 0;
    lowerPointwiseNode(rule, { id: 'n' }, visit, emit);
    expect(visited).toEqual(['b', 'a']);
    expect(emitted).toEqual([{ nodeId: 'n', operation: 'subtract', type: 'scalar', inputs: [2, 1] }]);
  });

  it('keeps WGSL and the CPU reference of an image graph in agreement', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image',
      nodes: [
        { id: 'frame', operator: 'image.frame', bindings: {}, operatorVersion: 1 },
        { id: 'split', operator: 'vector.split.rgba', bindings: {}, operatorVersion: 1 },
        { id: 'luma', operator: 'color.luminance-rec709.rgb', bindings: {}, operatorVersion: 1 },
        { id: 'wave', operator: 'math.sin.scalar', bindings: {}, operatorVersion: 1 },
        { id: 'gray', operator: 'convert.scalar-to-rgb', bindings: {}, operatorVersion: 1 },
        { id: 'join', operator: 'vector.combine.rgba', bindings: {}, operatorVersion: 1 },
        { id: 'output', operator: 'image.output', bindings: {}, operatorVersion: 1 },
      ],
      edges: [
        { id: 'e1', from: 'frame', output: 'image', to: 'split', input: 'image' },
        { id: 'e2', from: 'split', output: 'rgb', to: 'luma', input: 'rgb' },
        { id: 'e3', from: 'luma', output: 'value', to: 'wave', input: 'value' },
        { id: 'e4', from: 'wave', output: 'value', to: 'gray', input: 'value' },
        { id: 'e5', from: 'gray', output: 'rgb', to: 'join', input: 'rgb' },
        { id: 'e6', from: 'split', output: 'alpha', to: 'join', input: 'alpha' },
        { id: 'e7', from: 'join', output: 'image', to: 'output', input: 'image' },
      ], layout: {} };
    const plan = compileImageOperatorGraph(graph);
    expect(plan.wgsl).toMatch(/dot\(v\d+\.rgb, vec3f\(0\.2126, 0\.7152, 0\.0722\)\)/);
    expect(plan.wgsl).toMatch(/= sin\(v\d+\);/);
    const pixel: [number, number, number, number] = [0.2, 0.6, 0.4, 0.5];
    const luma = 0.2 * 0.2126 + 0.6 * 0.7152 + 0.4 * 0.0722, wave = Math.sin(luma);
    expect(evaluateImageOperatorPlan(plan, pixel)).toEqual([wave, wave, wave, 0.5]);
  });
});
