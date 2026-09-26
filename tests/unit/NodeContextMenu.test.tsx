import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { NodeContextMenu } from '../../src/components/panels/nodes/workspace/NodeContextMenu';
import { buildCableInsertEntries, buildNodeContextMenuEntries } from '../../src/components/panels/nodes/workspace/nodeContextMenuEntries';
import { addEffectGraphNode } from '../../src/components/panels/nodes/workspace/addEffectGraphNode';
import { getCategoriesWithEffects } from '../../src/effects';
import { addableEffectOperators, effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { useTimelineStore } from '../../src/stores/timeline';
import { FREE_NODE_GRAPH_NAME, freeNodeGraphEffectId } from '../../src/services/operators/imageNodeGraphEffect';
import { createMockClip, createMockTrack } from '../helpers/mockData';

afterEach(() => { cleanup(); useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }); });

function Menu({ withGraph = true, onAdded, onEffect }: { withGraph?: boolean; onAdded: (id: string) => void; onEffect: (id: string) => void }) {
  const [error, setError] = useState('');
  const effect = useTimelineStore.getState().clips[0]?.effects[0];
  const insert = (effectId: () => string) => (operatorId: string) => {
    try { onAdded(addEffectGraphNode('menu-clip', effectId(), operatorId, { x: 400, y: 250 })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const entries = buildNodeContextMenuEntries({
    clipStages: { canAddVisual: true, canAddKeyframes: true, onAddAI: vi.fn(), onAddKeyframes: vi.fn(), onAddStage: vi.fn() },
    effects: { groups: getCategoriesWithEffects(), onAdd: onEffect },
    graphs: { owners: [
      ...(withGraph && effect ? [{ effectId: effect.id, effectName: 'Invert', operators: addableEffectOperators(effect.type), onAdd: insert(() => effect.id) }] : []),
      { effectId: 'free', effectName: FREE_NODE_GRAPH_NAME, operators: addableEffectOperators('invert'), onAdd: insert(() => freeNodeGraphEffectId('menu-clip')) },
      { effectId: 'new:voxel-relief', effectName: 'new Voxel Relief', operators: addableEffectOperators('voxel-relief'), onAdd: vi.fn() },
    ] },
    controls: { disabled: false, onAdd: vi.fn() },
  });
  return <NodeContextMenu x={10} y={10} targetNode={null} canDeleteTarget={false} entries={entries} error={error}
    onClose={vi.fn()} onDeleteNode={vi.fn()} />;
}

function setup(options: { locked?: boolean; withGraph?: boolean } = {}) {
  const clip = createMockClip({ id: 'menu-clip', effects: [{ id: 'image', type: 'invert', name: 'invert', enabled: true, params: {} }] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId, locked: options.locked })], isExporting: false });
  const onAdded = vi.fn(), onEffect = vi.fn();
  return { ...render(<Menu withGraph={options.withGraph} onAdded={onAdded} onEffect={onEffect} />), onAdded, onEffect };
}

describe('node workspace context menu', () => {
  it('separates basic nodes from reusable node groups', async () => {
    const user = userEvent.setup(), view = setup();
    await user.click(view.getByRole('button', { name: 'Nodes' }));
    await user.click(view.getByRole('button', { name: 'Math' }));
    expect(view.getByRole('menuitem', { name: 'Add' })).toBeVisible();
    expect(view.queryByRole('button', { name: 'Coordinates & Lens' })?.closest('[aria-label="Nodes"]')?.textContent ?? '').not.toContain('Lens Vignette');
    await user.click(view.getByRole('button', { name: 'Node Groups' }));
    await user.click(view.getAllByRole('button', { name: 'Coordinates & Lens' }).at(-1)!);
    expect(view.getByRole('menuitem', { name: 'Lens Vignette' })).toBeVisible();
  });

  it('nests every node group by category and inserts it at the requested position', async () => {
    const user = userEvent.setup(), view = setup();
    await user.click(view.getByRole('button', { name: 'Node Groups' }));
    await user.click(view.getByRole('button', { name: 'Coordinates & Lens' }));
    await user.click(view.getByRole('menuitem', { name: 'Lens Vignette' }));
    const effect = useTimelineStore.getState().clips[0].effects[0];
    const instance = effect.operatorGraph!.nodes.find(node => node.operator === 'fisheye.vignette')!;
    expect(effect.operatorGraph!.layout[instance.id]).toEqual({ x: 400, y: 250 });
    expect(effectOperatorGraph(effect).groups?.some(group => group.composition?.instance.id === instance.id)).toBe(true);
    expect(view.onAdded).toHaveBeenCalledWith(`clip-graph:menu-clip:effect:image/@compound-${instance.id}`);
  });

  it('files clip stages and controls under the node categories', async () => {
    const user = userEvent.setup(), view = setup();
    expect(view.queryByRole('button', { name: 'Clip Stages' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Controls' })).toBeNull();
    await user.click(view.getByRole('button', { name: 'Nodes' }));
    await user.click(view.getByRole('button', { name: 'Color & Mask' }));
    expect(view.getByRole('menuitem', { name: 'Mask' })).toBeVisible();
    expect(view.getByRole('menuitem', { name: 'Color Grade' })).toBeVisible();
    await user.click(view.getByRole('button', { name: 'Values & Time' }));
    expect(view.getByRole('menuitem', { name: 'Oscillator (Control)' })).toBeVisible();
  });

  it('shows effects in look groups and hides styles that are only kept for saved projects', async () => {
    const user = userEvent.setup(), view = setup();
    await user.click(view.getByRole('button', { name: 'Effects' }));
    await user.click(view.getByRole('button', { name: 'Keying' }));
    await user.click(view.getByRole('menuitem', { name: 'Chroma Key' }));
    expect(view.onEffect).toHaveBeenCalledWith('chroma-key');
    await user.click(view.getByRole('button', { name: 'Light & Stylize' }));
    expect(view.getByRole('menuitem', { name: 'Acuarela' })).toBeVisible();
    expect(view.queryByRole('menuitem', { name: 'Rom1' })).toBeNull();
  });

  it('opens nested submenus from the keyboard and closes them with Escape', async () => {
    const user = userEvent.setup(), view = setup();
    const effects = view.getByRole('button', { name: 'Effects' });
    effects.focus();
    await user.keyboard('{Enter}');
    expect(effects).toHaveAttribute('aria-expanded', 'true');
    await vi.waitFor(() => expect(view.getByRole('button', { name: 'Color & Tone' })).toHaveFocus());
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(view.getByRole('menuitem', { name: 'Brightness' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(view.getByRole('button', { name: 'Color & Tone' })).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Escape}');
    expect(effects).toHaveAttribute('aria-expanded', 'false');
  });

  it('searches labels, descriptions and synonyms and shows where a hit lives', async () => {
    const user = userEvent.setup(), view = setup();
    await user.type(view.getByRole('searchbox', { name: 'Search nodes' }), 'green screen');
    expect(view.getByRole('button', { name: /Chroma Key.*Effects › Keying/ })).toBeVisible();
    await user.keyboard('{Enter}');
    expect(view.onEffect).toHaveBeenCalledWith('chroma-key');
  });

  it('lists nodes of every graph kind and routes each to a graph that accepts it', async () => {
    const user = userEvent.setup(), view = setup();
    await user.click(view.getByRole('button', { name: 'Nodes' }));
    await user.click(view.getByRole('button', { name: 'Shading' }));
    expect(view.getByRole('menuitem', { name: 'Relief Light' })).toHaveAttribute('title', expect.stringContaining('Adds to new Voxel Relief'));
  });

  it('always lists effect building parts and shows how many entries each submenu holds', async () => {
    const user = userEvent.setup(), view = setup();
    const groups = view.getByRole('button', { name: 'Node Groups' });
    expect(Number(groups.querySelector('.node-workspace-context-count')?.textContent)).toBeGreaterThan(10);
    await user.click(groups);
    await user.click(view.getByRole('button', { name: 'Coordinates & Lens' }));
    expect(view.getByRole('menuitem', { name: 'Eight Sample Offsets' })).toBeVisible();
  });

  it('keeps the menu open and reports a locked target without changing the effect', async () => {
    const user = userEvent.setup(), view = setup({ locked: true });
    await user.click(view.getByRole('button', { name: 'Node Groups' }));
    await user.click(view.getByRole('button', { name: 'Coordinates & Lens' }));
    await user.click(view.getByRole('menuitem', { name: 'Lens Projection' }));
    expect(view.getByRole('alert')).toHaveTextContent('locked');
    expect(view.onAdded).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().clips[0].effects[0].operatorGraph).toBeUndefined();
  });

  it('creates nodes freely in the clip node graph when no graph node is targeted', async () => {
    const user = userEvent.setup(), view = setup({ withGraph: false });
    await user.click(view.getByRole('button', { name: 'Nodes' }));
    await user.click(view.getByRole('button', { name: 'Math' }));
    expect(view.getByRole('menuitem', { name: 'Add' })).toHaveAttribute('title', expect.stringContaining('Adds to Node Graph'));
    await user.click(view.getByRole('menuitem', { name: 'Add' }));
    await user.click(view.getByRole('button', { name: 'Nodes' }));
    await user.click(view.getByRole('button', { name: 'Math' }));
    await user.click(view.getByRole('menuitem', { name: 'Multiply' }));
    const graphs = useTimelineStore.getState().clips[0].effects.filter(effect => effect.name === FREE_NODE_GRAPH_NAME);
    expect(graphs).toHaveLength(1);
    expect(graphs[0].operatorGraph!.nodes.map(node => node.operator)).toEqual(expect.arrayContaining(['math.add.scalar', 'math.multiply.scalar']));
  });
  it('offers every node and node group of a cable graph without type filtering', () => {
    const onAdd = vi.fn();
    const entries = buildCableInsertEntries({ effectId: 'fx', effectName: 'Invert', operators: addableEffectOperators('invert'), onAdd });
    expect(entries.map(entry => entry.label)).toEqual(['Nodes', 'Node Groups']);
    const categories = entries[0].kind === 'submenu' ? entries[0].children.map(entry => entry.label) : [];
    expect(categories).toEqual(expect.arrayContaining(['Math', 'Color & Mask', 'Sampling & Filter', 'Time & Motion']));
    const math = entries[0].kind === 'submenu' ? entries[0].children.find(entry => entry.label === 'Math') : undefined;
    const add = math?.kind === 'submenu' ? math.children.find(entry => entry.label === 'Add') : undefined;
    if (add?.kind === 'item') add.onSelect();
    expect(onAdd).toHaveBeenCalledWith(expect.stringMatching(/^math\.add\./));
  });
});
