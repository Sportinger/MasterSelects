import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { EffectControlProps } from '../../src/effects/types';

const loaders = vi.hoisted(() => ({ shown: vi.fn(), unused: vi.fn() }));
vi.mock('../../src/effects/index', () => ({
  EFFECT_REGISTRY: new Map([
    ['stateful', { id: 'stateful', params: {}, extraControls: loaders.shown }],
    ['unused', { id: 'unused', params: {}, extraControls: loaders.unused }],
  ]),
}));
vi.mock('../../src/components/panels/properties/LabeledValue', () => ({ LabeledValue: () => null }));

import { EffectControls } from '../../src/effects/EffectControls';
import { EXTRA_CONTROLS_REGISTRY } from '../../src/effects/extraControlsRegistry';

afterEach(cleanup);

function StatefulControls({ params }: EffectControlProps) {
  const [count, setCount] = useState(0);
  return <>
    <button onClick={() => setCount(value => value + 1)}>Local clicks: {count}</button>
    <output>Amount: {String(params.amount)}</output>
  </>;
}

it('loads only displayed controls and preserves their local state when effect parameters change', async () => {
  loaders.shown.mockResolvedValue({ default: StatefulControls });
  const component = EXTRA_CONTROLS_REGISTRY.stateful;
  expect(component).toBeDefined();
  expect(EXTRA_CONTROLS_REGISTRY.missing).toBeUndefined();
  expect(loaders.shown).not.toHaveBeenCalled();
  expect(loaders.unused).not.toHaveBeenCalled();

  const onChange = vi.fn();
  const { rerender } = render(<EffectControls effectType="stateful" params={{ amount: 1 }} onChange={onChange} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Local clicks: 0' }));
  expect(screen.getByRole('button', { name: 'Local clicks: 1' })).toBeInTheDocument();

  rerender(<EffectControls effectType="stateful" params={{ amount: 2 }} onChange={onChange} />);
  expect(screen.getByText('Amount: 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Local clicks: 1' })).toBeInTheDocument();
  expect(EXTRA_CONTROLS_REGISTRY.stateful).toBe(component);
  expect(loaders.shown).toHaveBeenCalledOnce();
  expect(loaders.unused).not.toHaveBeenCalled();
});
