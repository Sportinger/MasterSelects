import { describe, expect, it } from 'vitest';

import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import type { Layer } from '../../src/types/layers';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';

describe('worker software glyph graph admission', () => {
  it('admits a canonical glyph-atlas resource plan through the shared predicate', () => {
    const legacy: Layer = {
      id: 'glyph-layer', name: 'Glyph', visible: true, opacity: 1, blendMode: 'normal',
      source: { type: 'solid' }, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
      effects: [{ id: 'ascii-effect', name: 'ASCII', type: 'ascii', enabled: true, params: {} }],
    };
    expect(workerSoftwareEffectPlanForLayer(legacy)).toBeNull();
    const migrated = migratePersistedEffectOperatorGraph(legacy.effects[0]);
    const layer = { ...legacy, effects: [migrated] };
    const plan = workerSoftwareEffectPlanForLayer(layer);
    expect(plan?.pixelEffects.imageOperatorPlans).toHaveLength(1);
    expect(plan?.pixelEffects.imageOperatorPlans?.[0]?.resourceInputs).toEqual(['glyph-atlas:atlas']);

    const editedGraph = structuredClone(migrated.operatorGraph!);
    const amount = editedGraph.nodes.find(node => node.id === 'amount')!;
    amount.bindings = {};
    amount.constants = { value: .35 };
    const edited = workerSoftwareEffectPlanForLayer({ ...legacy, effects: [{ ...migrated, operatorGraph: editedGraph }] });
    expect(edited?.pixelEffects.imageOperatorPlans).toHaveLength(1);
    expect(edited?.pixelEffects.imageOperatorPlans?.[0]?.resourceInputs).toEqual(['glyph-atlas:atlas']);
  });
});
