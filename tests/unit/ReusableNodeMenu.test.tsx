import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReusableNodeMenu } from '../../src/components/panels/nodes/workspace/ReusableNodeMenu';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';

afterEach(() => { cleanup(); useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }); });
function setup(locked = false) {
  const clip = createMockClip({ id: 'menu-clip', effects: [{ id: 'image', type: 'invert', name: 'Invert', enabled: true, params: {} }] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId, locked })], isExporting: false });
  const onAdded = vi.fn();
  const view = render(<ReusableNodeMenu clipId={clip.id} effect={clip.effects[0]} position={{ x: 400, y: 250 }} onAdded={onAdded} />);
  return { ...view, onAdded };
}

describe('Reusable Nodes menu', () => {
  it('inserts a real Fisheye group into another effect with the requested position after pointer activation', async () => {
    const user = userEvent.setup(), view = setup();
    await user.click(view.getByRole('button', { name: 'Reusable Nodes' }));
    expect(view.getByText('Into Invert')).toBeVisible();
    fireEvent.blur(view.getByRole('button', { name: 'Reusable Nodes' }), { relatedTarget: null });
    expect(view.getByRole('button', { name: 'Vignette', exact: true })).toBeVisible();
    await user.click(view.getByRole('button', { name: 'Vignette', exact: true }));
    const effect = useTimelineStore.getState().clips[0].effects[0];
    const instance = effect.operatorGraph!.nodes.find(node => node.operator === 'fisheye.vignette')!;
    expect(instance).toBeDefined();
    expect(effect.operatorGraph!.layout[instance.id]).toEqual({ x: 400, y: 250 });
    expect(effectOperatorGraph(effect).groups?.some(group => group.composition?.instance.id === instance.id)).toBe(true);
    expect(view.onAdded).toHaveBeenCalledWith(`clip-graph:menu-clip:effect:image/@compound-${instance.id}`);
  });

  it('opens from the keyboard, moves focus into the list and closes with Escape', async () => {
    const user = userEvent.setup(), view = setup();
    await user.tab(); await user.keyboard('{Enter}');
    expect(view.getByRole('button', { name: 'Reusable Nodes' })).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(view.getByRole('button', { name: 'Cartesian to Polar' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(view.getByRole('button', { name: 'Reusable Nodes' })).toHaveAttribute('aria-expanded', 'false');
    expect(view.queryByRole('button', { name: 'Vignette', exact: true })).toBeNull();
  });

  it('offers the reusable HSV Hue Shift composition in its own Color section', async () => {
    const user = userEvent.setup(), view = setup();
    await user.click(view.getByRole('button', { name: 'Reusable Nodes' }));
    expect(view.getByText('Color')).toBeVisible();
    await user.click(view.getByRole('button', { name: 'Hue Shift', exact: true }));
    const effect = useTimelineStore.getState().clips[0].effects[0];
    expect(effect.operatorGraph!.nodes.some(node => node.operator === 'color.hue-shift.rgb')).toBe(true);
  });

  it('retains the menu and reports a locked target without changing the effect', async () => {
    const user = userEvent.setup(), view = setup(true);
    await user.click(view.getByRole('button', { name: 'Reusable Nodes' }));
    await user.click(view.getByRole('button', { name: 'Lens Projection', exact: true }));
    expect(view.getByRole('alert')).toHaveTextContent('locked');
    expect(view.onAdded).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().clips[0].effects[0].operatorGraph).toBeUndefined();
  });

  it('requires an image graph target', () => {
    const view = render(<ReusableNodeMenu clipId="clip" position={{ x: 0, y: 0 }} onAdded={vi.fn()} />);
    expect(view.getByRole('button', { name: 'Reusable Nodes' })).toBeDisabled();
  });
});
