import { describe, expect, it } from 'vitest';
import { migrateAnalogSignalGraph } from '../../src/services/operators/analogSignalMigration';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings });
const edge = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });
function legacy(bypassed = false): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'analog-signal', nodes: [node('frame', 'image.frame'), node('decode', 'analog.pal-decode'),
    { ...node('resolve', 'analog.display-resolve', { amount: 'mix-key', crtAmount: 'crt-key' }), constants: { crtAmount: .4 }, bypassed },
    node('output', 'image.output')], edges: [edge('source', 'frame', 'image', 'resolve', 'source'), edge('decoded', 'decode', 'image', 'resolve', 'decoded'),
      edge('outgoing', 'resolve', 'image', 'output', 'image')], layout: { resolve: { x: 900, y: 240 } },
    groups: [{ id: 'legacy-group', label: 'Legacy', color: '#123456', nodeIds: ['frame', 'resolve', 'output'] }] };
}

describe('Analog Signal legacy Display Resolve migration', () => {
  it('expands a real PAL decode into one flat, idempotent island', () => {
    const migrated = migrateAnalogSignalGraph(legacy());
    expect(migrated.nodes.some(item => item.operator === 'analog.display-resolve')).toBe(false);
    expect(migrated.nodes).toHaveLength(136);
    expect(migrated.edges).toHaveLength(203);
    expect(migrated.edges.find(item => item.id === 'outgoing')).toMatchObject({ from: 'resolve-active-select', output: 'image' });
    expect(migrated.edges).toContainEqual(expect.objectContaining({ from: 'decode', output: 'signalAmount', to: 'resolve-signal-clamp', input: 'value' }));
    expect(migrated.layout['resolve-zero']).toEqual({ x: 900, y: 240 });
    expect(migrated.groups?.find(group => group.id === 'legacy-group')?.nodeIds).toEqual(expect.arrayContaining(['frame', 'resolve-zero', 'output']));
    expect(migrated.groups?.find(group => group.id === 'resolve-group')?.nodeIds).toHaveLength(133);
    expect(migrated.nodes.find(item => item.id === 'resolve-amount')).toMatchObject({ bindings: { value: 'mix-key' } });
    expect(migrated.nodes.find(item => item.id === 'resolve-crtAmount')).toMatchObject({ bindings: { value: 'crt-key' }, constants: { value: .4 } });
    expect(migrateAnalogSignalGraph(migrated)).toEqual(migrated);
  });

  it('aliases a bypassed legacy node directly to its arbitrary original source', () => {
    const source = legacy(true);
    source.edges[0] = edge('source', 'custom-source', 'image', 'resolve', 'source');
    source.nodes.unshift(node('custom-source', 'image.frame'));
    const migrated = migrateAnalogSignalGraph(source);
    expect(migrated.nodes.some(item => item.id === 'resolve')).toBe(false);
    expect(migrated.nodes.some(item => item.id.startsWith('resolve-'))).toBe(false);
    expect(migrated.edges.find(item => item.id === 'outgoing')).toMatchObject({ from: 'custom-source', output: 'image' });
    expect(migrated.groups?.[0].nodeIds).toEqual(['frame', 'output']);
  });

  it('materializes legacy defaults when bindings were absent and retains disconnected editable islands', () => {
    const source = legacy(), resolve = source.nodes.find(item => item.id === 'resolve')!;
    resolve.bindings = {}; delete resolve.constants;
    source.edges = source.edges.filter(item => item.id !== 'outgoing');
    const ownerParams = { amount: .13, crtAmount: .91 };
    const migrated = migrateAnalogSignalGraph(source);
    expect(ownerParams.amount).not.toBe(1);
    expect(migrated.nodes.find(item => item.id === 'resolve-amount')).toMatchObject({ bindings: {}, constants: { value: 1 } });
    expect(migrated.nodes.find(item => item.id === 'resolve-crtAmount')).toMatchObject({ bindings: {}, constants: { value: .25 } });
    expect(migrated.nodes.some(item => item.id === 'resolve-active-select')).toBe(true);
    expect(migrated.edges.some(item => item.from === 'resolve-active-select')).toBe(false);
  });

  it('chooses deterministic collision-free IDs without rewriting unrelated nodes', () => {
    const source = legacy(); source.nodes.push(node('resolve-zero', 'values.number')); source.layout['resolve-zero'] = { x: 1, y: 2 };
    const migrated = migrateAnalogSignalGraph(source);
    expect(migrated.nodes.find(item => item.id === 'resolve-zero')?.operator).toBe('values.number');
    expect(migrated.nodes.some(item => item.id === 'resolve-2-zero')).toBe(true);
    expect(new Set(migrated.nodes.map(item => item.id)).size).toBe(migrated.nodes.length);
  });

  it('rejects unsupported decoded provenance and budget overflow instead of inventing defaults', () => {
    const malformed = legacy(); malformed.edges.find(item => item.id === 'decoded')!.from = 'frame';
    expect(() => migrateAnalogSignalGraph(malformed)).toThrow(/analog\.pal-decode image predecessor/);
    const oversized = legacy();
    for (let index = 0; index < 124; index++) oversized.nodes.push(node(`filler-${index}`, 'values.number'));
    expect(() => migrateAnalogSignalGraph(oversized)).toThrow(/exceeds its node or edge budget/);
  });

  it('does not erase invalid source or version data through bypass migration', () => {
    const missing = legacy(true); missing.edges.find(item => item.id === 'source')!.from = 'missing';
    expect(() => migrateAnalogSignalGraph(missing)).toThrow(/invalid source image predecessor/);
    const badPort = legacy(true); badPort.edges.find(item => item.id === 'source')!.output = 'missing';
    expect(() => migrateAnalogSignalGraph(badPort)).toThrow(/invalid source image predecessor/);
    const version = legacy(true); (version.nodes.find(item => item.id === 'resolve') as unknown as { operatorVersion: number }).operatorVersion = 2;
    expect(() => migrateAnalogSignalGraph(version)).toThrow(/unsupported operator version/);
  });
});
