// The Weave card: a new Weave shows Form and its recipe controls (it used to say "No parameters"),
// and a Weave saved with its own graph shows each exposed value once, without Form.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EffectsTab } from '../../src/components/panels/properties/EffectsTab';
import { getDefaultParams } from '../../src/effects';
import { createDefaultWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { listBuiltInWeavePresets } from '../../src/services/operators/geometry/weavePresets';
import { instantiateEffectPreset } from '../../src/services/nodeGraph/effectPresetLibrary';

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
  it('shows Form, Color and the controls of the Woven Cloth on a new Weave, the Qualle rows folded into one closed section', () => {
    render(<EffectsTab clipId="clip:weave-card" effects={[weave()]} />);
    expect(screen.queryByText('No parameters')).toBeNull();
    for (const label of ['Preset', 'Form', 'Color', 'Weave Speed', 'Reveal', 'Irregularity', 'Wind', 'Qualle controls']) {
      expect(screen.getAllByText(label), label).toHaveLength(1);
    }
    // The Qualle rows stay in the card (presets and tools reach them) but sit folded, with the reason once.
    for (const label of ['Pulse Rate', 'Pulse Size', 'Curl Strength', 'Jellyfish Pulse', 'Return Curls']) expect(screen.queryByText(label), label).toBeNull();
    expect(screen.queryByText('Acts on the Qualle form only.')).toBeNull();
    fireEvent.click(screen.getByText('Qualle controls'));
    for (const label of ['Pulse Rate', 'Pulse Size', 'Curl Strength']) expect(screen.getAllByText(label), label).toHaveLength(1);
    expect(screen.getAllByText('Acts on the Qualle form only.')).toHaveLength(1);
  });

  it('folds the Woven Cloth rows when Form is Qualle', () => {
    render(<EffectsTab clipId="clip:weave-card" effects={[weave({ params: { ...getDefaultParams('weave'), form: 'qualle' } as Effect['params'] })]} />);
    for (const label of ['Pulse Rate', 'Pulse Size', 'Curl Strength', 'Woven Cloth controls']) expect(screen.getAllByText(label), label).toHaveLength(1);
    for (const label of ['Weave Speed', 'Reveal', 'Irregularity', 'Wind']) expect(screen.queryByText(label), label).toBeNull();
  });

  it('shows each exposed value of a graph saved before Form once and leaves Form out', () => {
    render(<EffectsTab clipId="clip:weave-card" effects={[weave({ operatorGraph: earlierSavedGraph() })]} />);
    for (const label of ['Form', 'Pulse Rate', 'Wind']) expect(screen.queryByText(label), label).toBeNull();
    for (const label of ['Weave Speed', 'Reveal', 'Irregularity']) expect(screen.getAllByText(label), label).toHaveLength(1);
    // Its presets cannot set Form or Color: the card says so instead of applying them silently.
    expect(screen.getAllByText(/runs its own graph/)).toHaveLength(1);
  });

  it('keeps the Jellyfish graph\'s own rows working: no Form, nothing folded or dimmed, the graph\'s labels and ranges', () => {
    const template = listBuiltInWeavePresets().find(preset => preset.id === 'builtin:weave:jellyfish-reference')!;
    const jelly = instantiateEffectPreset(template) as Effect;
    const { container } = render(<EffectsTab clipId="clip:weave-card" effects={[jelly]} />);
    for (const label of ['Form', 'Qualle controls', 'Woven Cloth controls', 'Acts on the Qualle form only.']) expect(screen.queryByText(label), label).toBeNull();
    for (const label of ['Pulse Rate (Hz)', 'Pulse Strength', 'Curl Strength', 'Irregularity']) expect(screen.getAllByText(label), label).toHaveLength(1);
    const slider = container.querySelector('[aria-label="Pulse Rate (Hz) slider"]')!;
    expect(slider.getAttribute('aria-disabled')).not.toBe('true');
    expect(container.querySelector('[aria-label="Curl Strength slider"]')!.getAttribute('aria-valuemax')).toBe('0.5');
    expect(container.querySelector('[aria-label="Irregularity slider"]')!.getAttribute('aria-valuemax')).toBe('1');
  });
});
