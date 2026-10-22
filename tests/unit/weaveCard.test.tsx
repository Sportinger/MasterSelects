// The Weave card: a new Weave shows Form and its recipe controls (it used to say "No parameters"),
// and a Weave saved with its own graph shows each exposed value once, without Form.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EffectsTab } from '../../src/components/panels/properties/EffectsTab';
import { getDefaultParams } from '../../src/effects';
import { createDefaultWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

/** The Woven Cloth as Weaves saved it before Form existed: Reach 1.7, Wind and Color fixed in the graph. */
function earlierSavedGraph(): EffectOperatorGraph {
  const graph = createDefaultWeaveGraph(), node = (id: string) => graph.nodes.find(item => item.id === id)!;
  node('reach').constants = { value: 1.7 };
  node('wind').bindings = {};
  node('fiber').bindings = {};
  return graph;
}
import type { Effect } from '../../src/types/effects';

afterEach(cleanup);
const weave = (extra: Partial<Effect> = {}): Effect => ({ id: 'weave-card', type: 'weave', name: 'Weave', enabled: true,
  params: getDefaultParams('weave') as Effect['params'], ...extra });

describe('Weave card', () => {
  it('shows Form, Color and the controls of both forms on a new Weave, the other form dimmed', () => {
    render(<EffectsTab clipId="clip:weave-card" effects={[weave()]} />);
    expect(screen.queryByText('No parameters')).toBeNull();
    for (const label of ['Preset', 'Form', 'Color', 'Weave Speed', 'Reveal', 'Irregularity', 'Wind', 'Pulse Rate', 'Pulse Size', 'Curl Strength']) {
      expect(screen.getAllByText(label), label).toHaveLength(1);
    }
    expect(screen.getAllByText('Acts on the Qualle form only.')).toHaveLength(3);
  });

  it('shows each exposed value of a graph saved before Form once and leaves Form out', () => {
    render(<EffectsTab clipId="clip:weave-card" effects={[weave({ operatorGraph: earlierSavedGraph() })]} />);
    for (const label of ['Form', 'Pulse Rate', 'Wind']) expect(screen.queryByText(label), label).toBeNull();
    for (const label of ['Weave Speed', 'Reveal', 'Irregularity']) expect(screen.getAllByText(label), label).toHaveLength(1);
  });
});
