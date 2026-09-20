import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, compileImageOperatorPreview, createDefaultInvertImageGraph, evaluateImageOperatorPlan, migrateImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES, packImageOperatorParameters } from '../../src/services/operators/imageOperatorParameters';

describe('local image operator compiler', () => {
  it('compiles the default invert as one inline DAG and preserves alpha', () => {
    const plan = compileImageOperatorGraph(createDefaultInvertImageGraph());
    expect(plan.fusion).toBe('inline');
    expect(plan.instructions.filter(item => item.operation === 'subtract')).toHaveLength(3);
    expect(plan.instructions.filter(item => item.operation === 'constant')).toHaveLength(1);
    expect(plan.instructions.map(item => item.operation)).toEqual(expect.arrayContaining(['input', 'image-to-vec4', 'split-component', 'combine-vector', 'vec4-to-image']));
    expect(evaluateImageOperatorPlan(plan, [0.2, 0.7, 1, 0.35])).toEqual([0.8, 0.30000000000000004, 0, 0.35]);
    expect(plan.wgsl).toContain('fn evaluateImageGraph(inputColor: vec4f) -> vec4f');
  });

  it('previews typed intermediate ports through the same lowering and RGBA WGSL contract', () => {
    const graph = createDefaultInvertImageGraph();
    const channel = compileImageOperatorPreview(graph, {}, { nodeId: 'invert-r', direction: 'output', portId: 'value' });
    const vector = compileImageOperatorPreview(graph, {}, { nodeId: 'combine', direction: 'output', portId: 'value' });
    expect(channel.instructions.some(item => item.operation === 'subtract')).toBe(true);
    expect(channel.wgsl).toMatch(/vec4f\(v\d+, v\d+, v\d+, 1\.0\)/);
    expect(vector.wgsl).toMatch(/return v\d+;/);
  });

  it('migrates the short-lived invert primitive to generic vector and typed math nodes', () => {
    const graph = { version: 1 as const, schemaVersion: 1 as const, domain: 'image' as const,
      nodes: ['frame:image.frame', 'split:image.rgb-split', 'invert:color.invert.rgb', 'combine:image.rgb-combine', 'output:image.output'].map(value => {
        const [id, operator] = value.split(':'); return { id, operator, operatorVersion: 1 as const, bindings: {} };
      }),
      edges: [
        { id: 'a', from: 'frame', output: 'image', to: 'split', input: 'image' }, { id: 'b', from: 'split', output: 'rgb', to: 'invert', input: 'rgb' },
        { id: 'c', from: 'invert', output: 'rgb', to: 'combine', input: 'rgb' }, { id: 'd', from: 'split', output: 'alpha', to: 'combine', input: 'alpha' },
        { id: 'e', from: 'combine', output: 'image', to: 'output', input: 'image' },
      ], layout: { frame: { x: 7, y: 9 }, split: { x: 200, y: 0 }, invert: { x: 410, y: 30 }, combine: { x: 620, y: 0 }, output: { x: 800, y: 0 } } };
    const migrated = migrateImageOperatorGraph(graph);
    expect(migrated.nodes.map(node => node.operator)).toEqual(expect.arrayContaining(['vector.split.rgba', 'vector.combine.rgba', 'values.number', 'convert.scalar-to-rgb', 'math.subtract.rgb']));
    expect(migrated.nodes.some(node => node.operator === 'color.invert.rgb')).toBe(false);
    expect(migrated.layout.frame).toEqual({ x: 7, y: 9 });
    expect(migrated.layout.invert).toEqual({ x: 410, y: 30 });
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(migrated), [0.2, 0.7, 1, 0.35])).toEqual([0.8, 0.30000000000000004, 0, 0.35]);
  });

  it('uses actual wiring and rejects a disconnected alpha channel', () => {
    const graph = createDefaultInvertImageGraph();
    graph.edges = graph.edges.filter(edge => edge.id !== 'alpha-combine');
    expect(() => compileImageOperatorGraph(graph)).toThrow('combine:w is not connected');
  });

  it('creates a deterministic key from reachable operations and constants', () => {
    const first = compileImageOperatorGraph(createDefaultInvertImageGraph());
    const second = compileImageOperatorGraph(createDefaultInvertImageGraph());
    expect(first.key).toBe(second.key);
  });

  it('keeps bound scalar values dynamic while constants remain specialized', () => {
    const graph = createDefaultInvertImageGraph();
    const one = graph.nodes.find(node => node.id === 'one')!;
    one.bindings.value = 'amount';
    delete one.constants;
    graph.nodes.push({ id: 'one-copy', operator: 'values.number', operatorVersion: 1, bindings: { value: 'amount' } });
    graph.edges = graph.edges.map(edge => edge.id === 'one-g' ? { ...edge, from: 'one-copy' } : edge);
    const first = compileImageOperatorGraph(graph, { amount: 0.6 });
    const second = compileImageOperatorGraph(graph, { amount: 0.8 });
    expect(first.key).toBe(second.key);
    expect(first.wgsl).toBe(second.wgsl);
    expect(first.values).toEqual([0.6]);
    expect(second.values).toEqual([0.8]);
    const parameterInstructions = first.instructions.filter(item => item.operation === 'parameter');
    expect(parameterInstructions).toHaveLength(2);
    expect(parameterInstructions.map(item => item.value)).toEqual([0, 0]);
    expect(first.wgsl).toContain('inputColor: vec4f, imageParameters: ImageOperatorParameters');
    expect(evaluateImageOperatorPlan(first, [0.2, 0.3, 0.4, 0.5])).toEqual([0.39999999999999997, 0.3, 0.19999999999999996, 0.5]);
    const packed = packImageOperatorParameters(first.values);
    expect(packed.byteLength).toBe(IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES);
    expect([...packed.slice(0, 2)]).toEqual([expect.closeTo(0.6), 0]);
    expect(() => packImageOperatorParameters(Array.from({ length: 65 }, () => 0))).toThrow(/exceeds 64/);
  });

  it('passes RGB through when invert is bypassed', () => {
    const graph = createDefaultInvertImageGraph();
    graph.nodes.filter(node => node.id.startsWith('invert-')).forEach(node => { node.bypassed = true; });
    const plan = compileImageOperatorGraph(graph);
    expect(evaluateImageOperatorPlan(plan, [0.2, 0.7, 1, 0.35])).toEqual([0.2, 0.7, 1, 0.35]);
    expect(plan.instructions.some(item => item.operation === 'subtract')).toBe(false);
  });

  it('rejects unknown durable versions and non-finite scalar constants', () => {
    const schema = createDefaultInvertImageGraph();
    (schema as { schemaVersion?: number }).schemaVersion = 2;
    expect(() => compileImageOperatorGraph(schema)).toThrow('schema version');

    const version = createDefaultInvertImageGraph();
    (version.nodes[0] as { operatorVersion?: number }).operatorVersion = 2;
    expect(() => compileImageOperatorGraph(version)).toThrow('operator version');

    const graph = createDefaultInvertImageGraph();
    graph.nodes.splice(1, 0, { id: 'bad', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: Number.NaN } });
    expect(() => compileImageOperatorGraph(graph)).toThrow('must be finite');
  });

  it('rejects cycles in reachable image wiring', () => {
    const graph = createDefaultInvertImageGraph();
    graph.edges = graph.edges.map(edge => edge.id === 'frame-rgba' ? { ...edge, from: 'image', output: 'image' } : edge);
    expect(() => compileImageOperatorGraph(graph)).toThrow('cycle');
  });
});
