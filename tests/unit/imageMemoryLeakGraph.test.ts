import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { createDefaultMemoryLeakGraph } from '../../src/services/operators/memoryLeakEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

describe('Memory Leak image operator graph', () => {
  const definition = getEffect('memory-leak')!;
  const defaults = () => Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default]));
  const compile = (params = defaults()) => compileImageOperatorGraph(createDefaultMemoryLeakGraph(), params,
    { parameterSchema: definition.params, allowMemoryWindow: true });

  it('keeps memory provenance, metadata dimensions, decoding, opacity, and availability explicit', () => {
    const graph = createDefaultMemoryLeakGraph();
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(graph.nodes.find(node => node.id === 'memory')?.bindings)
      .toEqual({ size: 'size', depth: 'depth', offset: 'offset', motion: 'motion', stride: 'stride', seed: 'seed', snapshot: 'snapshot' });
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'metadata-parts', output: 'y', to: 'interpreted-width' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'words-per-pixel', to: 'interpreted-width' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'has-memory', to: 'selected', input: 'condition' }));
    const plan = compile();
    expect(plan.resourceSampling).toEqual(['exact-u32-pixel-load']);
    expect(plan.wgsl).toContain('decodeImageGraphBytePixel0(v');
  });

  it('lazily bypasses unavailable memory without requiring a uint load callback', () => {
    const source: [number, number, number, number] = [.1, .2, .3, .4], plan = compile();
    expect(evaluateImageOperatorPlan(plan, source, { uv: [.5, .5], readResourceMetadata: () => [0, 1, 1, 0] })).toEqual(source);
  });

  it('decodes, forces optional opacity, and mixes whole RGBA', () => {
    const source: [number, number, number, number] = [.1, .2, .3, .4];
    const output = evaluateImageOperatorPlan(compile({ ...defaults(), opaque: true, mix: 1, depth: '8' }), source, {
      uv: [0, 0], readResourceMetadata: () => [1, 1, 1, 0], loadUintResource: () => 0x80402000,
    });
    expect(output).toEqual([0, Math.fround(32 / 255), Math.fround(64 / 255), 1]);
  });
});
