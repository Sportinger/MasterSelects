import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EffectsTab } from '../../src/components/panels/properties/EffectsTab';
import type { Effect } from '../../src/types/effects';

afterEach(cleanup);

describe('EffectsTab numeric controls', () => {
  it('uses the shared Transform-style labeled draggable value without a separate slider', () => {
    const brightness: Effect = {
      id: 'effect:brightness:test',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.25 },
    };

    const { container } = render(
      <EffectsTab clipId="clip:effects-controls" effects={[brightness]} />,
    );

    const value = screen.getByLabelText('Amount');
    expect(value).toHaveClass('draggable-number');
    expect(value).toHaveAttribute('role', 'slider');
    expect(value.closest('.labeled-value')).toHaveClass('effect-param-value');
    expect(container.querySelector('.param-slider')).not.toBeInTheDocument();
  });
});
