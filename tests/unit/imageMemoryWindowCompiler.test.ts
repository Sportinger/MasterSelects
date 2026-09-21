import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const bindings = { size: 'size', depth: 'depth', offset: 'offset', motion: 'motion', stride: 'stride', seed: 'seed', snapshot: 'snapshot' };
const params = { size: 320, depth: '8', offset: 0, motion: 'static', stride: 64, seed: 1, snapshot: '' };
const graph = (): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
  { id: 'memory', operator: 'source.memory-window', operatorVersion: 1, bindings: { ...bindings } },
  { id: 'x', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0 } },
  { id: 'y', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0 } },
  { id: 'pixel', operator: 'vector.combine.vec2', operatorVersion: 1, bindings: {} },
  { id: 'depth', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0 } },
  { id: 'mode', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1 } },
  { id: 'gain', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1 } },
  { id: 'decode', operator: 'data.decode-byte-pixel', operatorVersion: 1, bindings: {} },
  { id: 'image', operator: 'convert.vec4-to-image', operatorVersion: 1, bindings: {} },
  { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
], edges: [
  { id: 'memory-decode', from: 'memory', output: 'memory', to: 'decode', input: 'memory' },
  { id: 'x-pixel', from: 'x', output: 'value', to: 'pixel', input: 'x' }, { id: 'y-pixel', from: 'y', output: 'value', to: 'pixel', input: 'y' },
  { id: 'pixel-decode', from: 'pixel', output: 'value', to: 'decode', input: 'pixel' },
  { id: 'depth-decode', from: 'depth', output: 'value', to: 'decode', input: 'depth' }, { id: 'mode-decode', from: 'mode', output: 'value', to: 'decode', input: 'floatMode' },
  { id: 'gain-decode', from: 'gain', output: 'value', to: 'decode', input: 'floatGain' },
  { id: 'decode-image', from: 'decode', output: 'value', to: 'image', input: 'value' }, { id: 'image-output', from: 'image', output: 'image', to: 'output', input: 'image' },
] });

describe('memory-window image resources', () => {
  it('uses a typed exact-u32 resource and portable descriptor outside the structural key', () => {
    expect(getEffectOperator('source.memory-window')?.outputs.map(port => [port.id, port.type])).toEqual([['memory', 'uint32-texture'], ['metadata', 'vec4']]);
    const first = compileImageOperatorGraph(graph(), params, { allowMemoryWindow: true });
    const changed = compileImageOperatorGraph(graph(), { ...params, offset: 12, motion: 'shuffle' }, { allowMemoryWindow: true });
    expect(first.key).toBe(changed.key);
    expect(first.resourceSampling).toEqual(['exact-u32-pixel-load']);
    expect(first.externalResources).toEqual([{ id: 'memory-window:memory', kind: 'memory-window', options: params }]);
    expect(changed.externalResources?.[0]).toMatchObject({ kind: 'memory-window', options: { offset: 12, motion: 'shuffle' } });
    expect(first.wgsl).toMatch(/decodeImageGraphBytePixel0\(v\d+, v\d+, v\d+, v\d+\)/);
  });

  it('evaluates genuine unsigned words and dynamic resource metadata', () => {
    const plan = compileImageOperatorGraph(graph(), params, { allowMemoryWindow: true });
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], {
      readResourceMetadata: () => [1, 4, 1, 0], loadUintResource: () => 0xff804000,
    })).toEqual([0, Math.fround(64 / 255), Math.fround(128 / 255), 1]);
    const metadata = compileImageOperatorPreview(graph(), params, { nodeId: 'memory', direction: 'output', portId: 'metadata' }, { allowMemoryWindow: true });
    expect(metadata.wgsl).toContain('imageGraphResourceMetadata0()');
    expect(evaluateImageOperatorPlan(metadata, [0, 0, 0, 0], { readResourceMetadata: () => [1, 4, 1, 0] })).toEqual([1, 4, 1, 0]);
  });

  it('fails closed without opt-in, bindings, or CPU callbacks', () => {
    expect(() => compileImageOperatorGraph(graph(), params)).toThrow(/explicit compile-context opt-in/);
    const invalid = graph(); delete invalid.nodes[0].bindings.snapshot;
    expect(() => compileImageOperatorGraph(invalid, params, { allowMemoryWindow: true })).toThrow(/seven owner bindings/);
    const plan = compileImageOperatorGraph(graph(), params, { allowMemoryWindow: true });
    expect(() => evaluateImageOperatorPlan(plan, [0, 0, 0, 0])).toThrow(/unsigned resource metadata callback/);
  });
});
