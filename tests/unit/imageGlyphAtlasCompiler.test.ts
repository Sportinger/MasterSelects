import { describe, expect, it, vi } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview } from '../../src/services/operators/imageOperatorGraph';
import type { ImageOperatorGlyphAtlasBindings } from '../../src/services/operators/imageOperatorGlyphResources';

const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
function graph(): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
    { id: 'atlas', operator: 'glyph.atlas', operatorVersion: 1, bindings: {
      rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight',
    } },
    { id: 'scale', operator: 'math.multiply.image-scalar', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
  ], edges: [edge('atlas', 'image', 'scale', 'a'), edge('atlas', 'glyphCount', 'scale', 'b'), edge('scale', 'value', 'output', 'image')] };
}

describe('glyph atlas image resource producer', () => {
  it('lowers image and metadata through existing resource and dynamic parameter contracts', () => {
    const resolver = vi.fn((_bindings: ImageOperatorGlyphAtlasBindings, params: Record<string, unknown>) => ({ fontFamily: 'monospace', fontWeight: 600,
      charset: String(params.customRamp), cellSize: 64 }));
    const plan = compileImageOperatorGraph(graph(), { customRamp: ' .#' }, { resolveGlyphAtlas: resolver });
    expect(resolver).toHaveBeenCalledWith({ rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight' }, { customRamp: ' .#' });
    expect(plan.resourceInputs).toEqual(['glyph-atlas:atlas']);
    expect(plan.resourceSampling).toEqual(['hardware-linear-clamp']);
    expect(plan.externalResources).toEqual([{ id: 'glyph-atlas:atlas', kind: 'glyph-atlas', options: {
      fontFamily: 'monospace', fontWeight: 600, charset: ' .#', cellSize: 64,
    } }]);
    expect(plan.values).toEqual([3]);
  });

  it('keeps atlas options and derived metadata out of the structural shader key', () => {
    const compile = (charset: string) => compileImageOperatorGraph(graph(), { customRamp: charset }, {
      resolveGlyphAtlas: (_bindings, params) => ({ fontFamily: 'monospace', fontWeight: 600, charset: String(params.customRamp), cellSize: 64 }),
    });
    const short = compile('01'), long = compile('0123456789');
    expect(short.key).toBe(long.key);
    expect(short.wgsl).toBe(long.wgsl);
    expect(short.values).toEqual([2]);
    expect(long.values).toEqual([10]);
    expect(short.externalResources).not.toEqual(long.externalResources);
  });

  it('retains producer-only external resources on a multi-pass top-level plan', () => {
    const source = graph();
    source.nodes.push({ id: 'store', operator: 'image.materialize', operatorVersion: 1, bindings: {} });
    const outputEdge = source.edges.find(item => item.to === 'output')!; outputEdge.to = 'store'; outputEdge.input = 'image';
    source.edges.push(edge('store', 'image', 'output', 'image'));
    const plan = compileImageOperatorGraph(source, {}, { resolveGlyphAtlas: () => ({ fontFamily: 'serif', charset: 'ab', cellSize: 64 }) });
    expect(plan.passes).toHaveLength(2);
    expect(plan.passes?.[0].program.externalResources?.map(resource => resource.id)).toEqual(['glyph-atlas:atlas']);
    expect(plan.externalResources?.map(resource => resource.id)).toEqual(['glyph-atlas:atlas']);
    expect(plan.resources?.map(resource => resource.id)).not.toContain('glyph-atlas:atlas');
  });

  it('exposes canonical atlas dimensions on numeric output ports', () => {
    const source = graph(), context = { resolveGlyphAtlas: () => ({ fontFamily: 'serif', charset: 'abcdefghi', cellSize: 64 }) };
    const columns = compileImageOperatorPreview(source, {}, { nodeId: 'atlas', direction: 'output', portId: 'columns' }, context);
    const rows = compileImageOperatorPreview(source, {}, { nodeId: 'atlas', direction: 'output', portId: 'rows' }, context);
    expect(columns.values).toEqual([3]);
    expect(rows.values).toEqual([3]);
    expect(columns.externalResources).toBeUndefined();
    expect(rows.externalResources).toBeUndefined();
  });

  it('fails closed for missing resolver, malformed bindings, and invalid options', () => {
    expect(() => compileImageOperatorGraph(graph())).toThrow(/transient atlas resolver/);
    const malformed = graph(); delete malformed.nodes[0].bindings.customRamp;
    expect(() => compileImageOperatorGraph(malformed, {}, { resolveGlyphAtlas: () => ({ fontFamily: 'serif', charset: 'x', cellSize: 64 }) }))
      .toThrow(/requires rampPreset, customRamp, fontFamily, and fontWeight/);
    expect(() => compileImageOperatorGraph(graph(), {}, { resolveGlyphAtlas: () => ({ fontFamily: '', charset: 'x', cellSize: 64 }) }))
      .toThrow(/invalid options/);
  });
});
