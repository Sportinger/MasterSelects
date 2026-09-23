import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';

import { EffectsTab } from '../../src/components/panels/properties/EffectsTab';
import type { Effect } from '../../src/types/effects';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('EffectsTab numeric controls', () => {
  it('writes only the edited parameter from a complete control snapshot', () => {
    const numeric = vi.spyOn(useTimelineStore.getState(), 'setPropertyValue').mockImplementation(() => {});
    const patch = vi.spyOn(useTimelineStore.getState(), 'updateClipEffect').mockImplementation(() => {});
    const effect: Effect = { id: 'single-edit', type: 'brightness', name: 'Brightness', enabled: true,
      params: { amount: 0.25, unchangedNumber: 12, unchangedSelect: 'keep' } };
    render(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
    fireEvent.contextMenu(screen.getByLabelText('Amount'));
    expect(numeric).toHaveBeenCalledTimes(1);
    expect(numeric).toHaveBeenCalledWith('clip:effects-controls', 'effect.single-edit.amount', 0);
    expect(patch).not.toHaveBeenCalled();
  });
  it('refreshes displayed parameters after otherwise identical effect snapshots', () => {
    const effect: Effect = { id: 'animated', type: 'brightness', name: 'Brightness', enabled: true, params: { amount: 0.25 } };
    const view = render(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
    view.rerender(<EffectsTab clipId="clip:effects-controls" effects={[{ ...effect, params: { ...effect.params } }]} />);
    expect(screen.getByLabelText('Amount')).toHaveAttribute('aria-valuenow', '0.25');
    view.rerender(<EffectsTab clipId="clip:effects-controls" effects={[{ ...effect, params: { amount: 0.75 } }]} />);
    expect(screen.getByLabelText('Amount')).toHaveAttribute('aria-valuenow', '0.75');
  });

  it('collapses on bypass and stays collapsed when enabled again', () => {
    const effect: Effect = { id: 'bypass-test', type: 'brightness', name: 'Brightness', enabled: true, params: { amount: 0.25 } };
    const view = render(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
    expect(screen.getByLabelText('Amount')).toBeVisible();
    view.rerender(<EffectsTab clipId="clip:effects-controls" effects={[{ ...effect, enabled: false }]} />);
    expect(screen.queryByLabelText('Amount')).toBeNull();
    view.rerender(<EffectsTab clipId="clip:effects-controls" effects={[effect]} />);
    expect(screen.getByTitle('Expand Brightness')).toHaveAttribute('aria-expanded', 'false');
  });

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
