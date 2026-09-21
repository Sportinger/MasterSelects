import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NodeGraphPlugs } from '../../src/components/panels/nodes/canvas/NodeGraphPlugs';
import { getConnectionPlugs } from '../../src/components/panels/nodes/canvas/connectionPlugs';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

afterEach(cleanup);
describe('canvas plug interaction targets', () => {
  function setup(readOnly = false) {
    const nodes = connectionFixture.nodes;
    const plugs = getConnectionPlugs(connectionFixture.edges.map(edge => ({ ...edge, readOnly })), new Map(nodes.map(node => [node.id, node])));
    const drag = vi.fn(), select = vi.fn(), disconnect = vi.fn();
    const view = render(<NodeGraphPlugs canvasRendered plugs={plugs} nodes={nodes} draft={null} hoveredPort={null}
      hoveredEdgeId={null} selectedEdgeId={null} onSelectEdge={select} onStartDrag={drag}
      onStartConnectionDrag={vi.fn()} onDisconnectEdge={disconnect} />);
    return { ...view, drag, select, disconnect, plugs };
  }
  it('preserves distinct fan-out grips, pointer actions, keyboard delete and focus', () => {
    const view = setup();
    const surface = view.getByRole('button', { name: 'Source, Image out: cable to Surface' });
    const depth = view.getByRole('button', { name: 'Source, Image out: cable to Depth' });
    expect(surface.tagName).toBe('BUTTON');
    expect(parseFloat(depth.style.width)).toBe(16);
    expect(parseFloat(surface.style.width)).toBe(16);
    expect(depth.style.left).not.toBe(surface.style.left);
    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'mouse' });
    expect(view.drag).toHaveBeenCalledWith(expect.anything(), view.plugs.find(p => p.edge.id === 'surface-link' && p.port.direction === 'output'));
    surface.focus(); fireEvent.click(surface, { detail: 1 });
    expect(surface).not.toHaveFocus(); expect(view.select).toHaveBeenCalledWith('surface-link');
    depth.focus(); fireEvent.click(depth, { detail: 0 });
    expect(depth).toHaveFocus();
    fireEvent.keyDown(depth, { key: 'Delete' }); expect(view.disconnect).toHaveBeenCalledWith('depth-link');
  });
  it('does not disconnect read-only bake dependencies through keyboard or context menu', () => {
    const view = setup(true), target = view.getByRole('button', { name: 'Source, Image out: cable to Surface' });
    fireEvent.keyDown(target, { key: 'Delete' }); fireEvent.contextMenu(target);
    expect(view.disconnect).not.toHaveBeenCalled();
  });
});
