import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { EFFECT_GRAPH_PARAM } from '../../src/services/operators/effectGraph';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { Effect } from '../../src/types/effects';

const effects = [
  { type: 'contour-map', name: 'Contour Map' },
  { type: 'crosshatch', name: 'Crosshatch' },
  { type: 'kilim', name: 'Kilim Carpet' },
  { type: 'vector-tiling', name: 'Vector Engraving' },
  { type: 'embroidery', name: 'Knitted Embroidery' },
  { type: 'outline', name: 'Outline' },
  { type: 'bricks', name: '3D Toy Bricks' },
] as const;

const effect = (type: typeof effects[number]['type'], params: Record<string, unknown> = {}): Effect => ({
  id: `${type}-fx`, type, name: type, enabled: true, params,
});

describe('geometry pattern image graph lifecycle', () => {
  it.each(effects)('$name owns authoritative catalog bindings and migrates legacy JSON', ({ type }) => {
    const definition = getEffect(type)!;
    const params = effectOperatorParams(effect(type));
    expect(params).toMatchObject({ scale: 14, amount: .75, angle: 0, colorA: '#111827', colorB: '#f8fafc' });
    expect(definition.params).toMatchObject({
      scale: { default: 14, min: 2, max: 80 }, amount: { default: .75, min: 0, max: 1 }, angle: { default: 0, min: -180, max: 180 },
    });

    const canonical = effectOperatorGraph(effect(type));
    for (const node of canonical.nodes) for (const binding of Object.values(node.bindings)) {
      expect(definition.params[binding], `${node.id}.${binding}`).toBeDefined();
    }
    const legacy = effect(type, { [EFFECT_GRAPH_PARAM]: JSON.stringify(canonical) });
    const migrated = migratePersistedEffectOperatorGraph(legacy);
    expect(migrated.params).not.toHaveProperty(EFFECT_GRAPH_PARAM);
    expect(migrated.operatorGraph).toEqual(canonical);
  });

  it.each(effects)('$name preserves independent layout/group snapshots and persisted edits', ({ type }) => {
    const original = migratePersistedEffectOperatorGraph(effect(type));
    const edited = structuredClone(original);
    edited.operatorGraph!.layout.output = { x: 777, y: 222 };
    edited.operatorGraph!.groups = [{ id: 'style', label: 'Style', color: '#64748b', nodeIds: ['mixed', 'combined'] }];
    edited.params = { ...edited.params, amount: .31, scale: 27 };
    const undoSnapshot = structuredClone(original), redoSnapshot = structuredClone(edited);

    expect(effectOperatorGraph(JSON.parse(JSON.stringify(redoSnapshot)))).toEqual(edited.operatorGraph);
    expect(effectOperatorGraph(undoSnapshot).layout.output).not.toEqual({ x: 777, y: 222 });
    expect(undoSnapshot.params).not.toHaveProperty('amount');
    expect(effectOperatorParams(redoSnapshot)).toMatchObject({ amount: .31, scale: 27 });
  });

  it.each(effects)('$name compiles changed parameters and a direct frame bypass', ({ type }) => {
    const owned = migratePersistedEffectOperatorGraph(effect(type));
    const context = effectOperatorCompileContext(owned);
    const defaults = compileImageOperatorGraph(owned.operatorGraph!, effectOperatorParams(owned), context);
    const changed = compileImageOperatorGraph(owned.operatorGraph!, effectOperatorParams({ ...owned, params: { amount: .2, scale: 31 } }), context);
    expect(changed.key).toBe(defaults.key);
    expect(changed.values).not.toEqual(defaults.values);

    const bypass = structuredClone(owned.operatorGraph!);
    const outputEdge = bypass.edges.find(edge => edge.to === 'output')!;
    outputEdge.from = 'frame'; outputEdge.output = 'image'; outputEdge.id = 'frame-output';
    const plan = compileImageOperatorGraph(bypass, effectOperatorParams(owned), context);
    expect(plan.capabilities).toEqual([]);
    expect(evaluateImageOperatorPlan(plan, [.12, .34, .56, .78])).toEqual([.12, .34, .56, .78]);
  });

  it.each(['embroidery', 'outline', 'bricks'] as const)('%s packs the supplied timeline clock deterministically', type => {
    const definition = getEffect(type)!;
    expect(definition.requiresContinuousRender).toBe(false);
    const first = definition.packUniforms({}, 29, 17, 12.25) as Float32Array;
    const second = definition.packUniforms({}, 29, 17, 12.25) as Float32Array;
    expect(first[5]).toBe(12.25);
    expect(Array.from(second)).toEqual(Array.from(first));
  });
});
