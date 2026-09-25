import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { addableEffectOperators } from '../../src/services/operators/effectGraphOwner';
import { textAtlasOptions } from '../../src/services/operators/imageOperatorGlyphResources';

const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
function graph(characters: string): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
    { id: 'atlas', operator: 'glyph.text-atlas', operatorVersion: 1, bindings: {},
      constants: { characters, fontFamily: 'Georgia, serif', fontWeight: 700 } },
    { id: 'uv', operator: 'image.normalized-uv', operatorVersion: 1, bindings: {} },
    { id: 'index', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 6 } },
    { id: 'sample', operator: 'glyph.sample', operatorVersion: 1, bindings: {} },
    { id: 'gray', operator: 'convert.scalar-to-vec4', operatorVersion: 1, bindings: {} },
    { id: 'image', operator: 'convert.vec4-to-image', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
  ], edges: [
    edge('atlas', 'image', 'sample', 'atlas'), edge('atlas', 'columns', 'sample', 'columns'), edge('atlas', 'rows', 'sample', 'rows'),
    edge('index', 'value', 'sample', 'index'), edge('uv', 'uv', 'sample', 'uv'), edge('sample', 'coverage', 'gray', 'value'),
    edge('gray', 'value', 'image', 'value'), edge('image', 'image', 'output', 'image'),
  ] };
}

describe('graph-local text atlas', () => {
  it('compiles without effect-owned bindings and resolves the atlas from node constants', () => {
    const plan = compileImageOperatorGraph(graph('ABCDEFGHIJ'), {});
    expect(plan.externalResources).toEqual([{ id: 'glyph-atlas:atlas', kind: 'glyph-atlas', options: {
      fontFamily: 'Georgia, serif', fontWeight: 700, charset: 'ABCDEFGHIJ', cellSize: 64,
    } }]);
    // 10 glyphs → 4 × 3 atlas; both dimensions reach the shader as dynamic values.
    expect(plan.values).toEqual(expect.arrayContaining([4, 3]));
  });

  it('keeps the characters out of the structural shader key', () => {
    const short = compileImageOperatorGraph(graph('AB'), {}), long = compileImageOperatorGraph(graph('ABCDEFGHIJKLMNOP'), {});
    expect(short.key).toBe(long.key);
    expect(short.externalResources).not.toEqual(long.externalResources);
  });

  it('falls back to one blank glyph and rejects unavailable fonts', () => {
    expect(textAtlasOptions({ id: 'atlas', constants: { characters: '' } }).charset).toBe(' ');
    expect(() => textAtlasOptions({ id: 'atlas', constants: { fontFamily: 'Comic Sans' } })).toThrow(/font/);
  });

  it('is addable in general image graphs but not in owners without glyph resources', () => {
    const ids = (type: string) => addableEffectOperators(type).map(operator => operator.id);
    expect(ids('invert')).toEqual(expect.arrayContaining(['glyph.text-atlas', 'glyph.sample']));
    expect(ids('voronoi')).not.toContain('glyph.text-atlas');
    expect(ids('analog-signal-lab')).not.toContain('glyph.text-atlas');
  });
});
