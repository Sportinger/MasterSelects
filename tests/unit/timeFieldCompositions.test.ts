import { describe, expect, it } from 'vitest';
import { TIME_FIELD_COMPOSITIONS } from '../../src/services/operators/timeFieldCompositions';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { expandOperatorCompositions, packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

function recipe(id: string, values: Record<string, number | [number, number]>, output = 'value') {
  const definition = TIME_FIELD_COMPOSITIONS.find(item => item.id === id)!;
  const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', layout: {},
    nodes: [{ id: 'field', operator: id, operatorVersion: 1, bindings: {} },
      { id: 'rgba', operator: 'convert.scalar-to-vec4', operatorVersion: 1, bindings: {} },
      { id: 'result-image', operator: 'convert.vec4-to-image', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} }],
    edges: [{ id: 'field-out', from: 'field', output, to: 'rgba', input: 'value' },
      { id: 'rgba-out', from: 'rgba', output: 'value', to: 'result-image', input: 'value' },
      { id: 'image-out', from: 'result-image', output: 'image', to: 'output', input: 'image' }] };
  for (const input of definition.inputs) {
    const value = values[input.id] ?? 0;
    graph.nodes.push({ id: input.id, operator: input.type === 'image' ? 'image.frame' : input.type === 'vec2' ? 'vector.combine.vec2' : 'values.number',
      operatorVersion: 1, bindings: {}, ...(input.type === 'number' ? { constants: { value: value as number } } : {}) });
    if (Array.isArray(value)) value.forEach((n, i) => {
      const id = `${input.id}-${i}`;
      graph.nodes.push({ id, operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: n } });
      graph.edges.push({ id, from: id, output: 'value', to: input.id, input: i ? 'y' : 'x' });
    });
    graph.edges.push({ id: `${input.id}-input`, from: input.id, output: input.type === 'image' ? 'image' : 'value', to: 'field', input: input.id });
  }
  return graph;
}

function evaluate(id: string, values: Record<string, number | [number, number]>, pixel: [number, number, number, number] = [0, 0, 0, 1], output = 'value') {
  return evaluateImageOperatorPlan(compileImageOperatorGraph(recipe(id, values, output)), pixel)[0];
}

describe('reusable time field compositions', () => {
  it('reuses Sobel sampling with known constant and horizontal luminance gradients', () => {
    const plan = compileImageOperatorGraph(recipe('field.sobel', { uv: [.5, .5], resolution: [100, 100] }));
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 1], {
      sampleImage: () => [.4, .4, .4, 1],
    })[0]).toBeCloseTo(0);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 1], {
      sampleImage: uv => [uv[0], uv[0], uv[0], 1],
    })[0]).toBeCloseTo(.08);
  });
  it('extracts source-encoded channels and supplies a separate gray-hue validity weight', () => {
    const pixel: [number, number, number, number] = [.2, .4, .6, .8];
    const expected = [.2 * .2126 + .4 * .7152 + .6 * .0722, .8, .2, .4, .6];
    expected.forEach((value, channel) => expect(evaluate('field.image-channel', { channel, phase: 0, hueRamp: 0 }, pixel)).toBeCloseTo(value));
    expect(evaluate('field.image-channel', { channel: 6 }, pixel)).toBeCloseTo(2 / 3);
    expect(evaluate('field.image-channel', { channel: 7 }, pixel)).toBeCloseTo(.6);
    expect(evaluate('field.image-channel', { channel: 5 }, [.5, .5, .5, 1], 'weight')).toBe(0);
    expect(evaluate('field.image-channel', { channel: 0 }, [.5, .5, .5, 1], 'weight')).toBe(1);
    expect(evaluate('field.image-channel', { channel: 5 }, [1, 0, .00001, 1])).toBeCloseTo(evaluate('field.image-channel', { channel: 5 }, [1, .00001, 0, 1]), 4);
  });

  it('normalizes safely at range boundaries, applies gamma and then inversion', () => {
    const values = { value: .5, min: .25, max: .75, gamma: 2, invert: 0 };
    expect(evaluate('field.normalize', values)).toBeCloseTo(.25);
    expect(evaluate('field.normalize', { ...values, invert: 1 })).toBeCloseTo(.75);
    expect(evaluate('field.normalize', { ...values, value: -1 })).toBe(0);
    expect(evaluate('field.normalize', { ...values, value: 2 })).toBe(1);
    expect(evaluate('field.normalize', { ...values, max: .25 })).toBe(0);
    expect(evaluate('field.normalize', { ...values, max: 0 })).toBe(0);
  });

  it('produces deterministic continuous noise and distinct constant hard cells', () => {
    const values = { uv: [.31, .42] as [number, number], scale: 4, seed: 3, time: 2, drift: [.02, -.03] as [number, number], hard: 0 };
    const value = evaluate('field.noise2d', values);
    expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1);
    evaluate('field.noise2d', { ...values, time: 100 });
    expect(evaluate('field.noise2d', values)).toBe(value);
    expect(evaluate('field.noise2d', { ...values, time: 2.0001 })).toBeCloseTo(value, 3);
    expect(evaluate('field.noise2d', { ...values, hard: 1, uv: [.3101, .4201] })).toBe(evaluate('field.noise2d', { ...values, hard: 1 }));
    expect(evaluate('field.noise2d', { ...values, seed: 4 })).not.toBe(value);
  });

  it('combines fields with neutral zero strength and bounded results', () => {
    for (let operation = 0; operation <= 4; operation++) expect(evaluate('field.combine', { a: .3, b: .8, operation, amount: 0 })).toBeCloseTo(.3);
    const expected = [.8, .6, .24, .3, .8];
    expected.forEach((value, operation) => expect(evaluate('field.combine', { a: .3, b: .8, operation, amount: 1 })).toBeCloseTo(value));
    expect(evaluate('field.combine', { a: .9, b: 1, operation: 1, amount: 1 })).toBe(1);
  });

  it('maps motion magnitude and signed direction with confidence fallback', () => {
    const values = { mode: 0, angle: 0, min: 0, max: 1, confidence: .2 };
    expect(evaluate('field.motion', values, [.3, .4, 1, 1])).toBeCloseTo(.5);
    expect(evaluate('field.motion', { ...values, mode: 1 }, [.3, .4, 1, 1])).toBeCloseTo(.3);
    expect(evaluate('field.motion', { ...values, mode: 1, angle: Math.PI / 2 }, [.3, .4, 1, 1])).toBeCloseTo(.4);
    expect(evaluate('field.motion', { ...values, mode: 1, min: -1 }, [-.5, 0, 1, 1])).toBeCloseTo(.25);
    expect(evaluate('field.motion', values, [0, 0, 1, 1])).toBe(0);
    expect(evaluate('field.motion', values, [1, 1, .1, 1], 'weight')).toBe(0);
    expect(evaluate('field.motion', values, [1, 1, 1, 0], 'weight')).toBe(0);
    expect(evaluate('field.motion', values, [1, 1, 1, 1], 'weight')).toBe(1);
    expect(evaluate('field.motion', { ...values, max: 0 }, [1, 1, 1, 1])).toBe(0);
  });

  it('keeps typed boundaries valid and survives expand/pack without changing results', () => {
    for (const definition of TIME_FIELD_COMPOSITIONS) {
      const values = Object.fromEntries(definition.inputs.filter(input => input.type !== 'image')
        .map(input => [input.id, input.type === 'vec2' ? [.3, .7] as [number, number] : 1]));
      const graph = recipe(definition.id, values), before = structuredClone(graph);
      const expanded = expandOperatorCompositions(graph);
      expect(validateEffectGraph(expanded)).toEqual([]);
      const packed = packOperatorCompositions(expanded);
      const context = { sampleImage: (): [number, number, number, number] => [.2, .4, .6, 1] };
      expect(evaluateImageOperatorPlan(compileImageOperatorGraph(packed), [.2, .4, .6, 1], context))
        .toEqual(evaluateImageOperatorPlan(compileImageOperatorGraph(graph), [.2, .4, .6, 1], context));
      expect(graph).toEqual(before);
    }
  });
});
