import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorNodeCanvas } from '../../src/components/panels/color/ColorNodeCanvas';
import { createMockClip } from '../helpers/mockData';
import { createDefaultColorCorrectionState } from '../../src/types/colorCorrection';

const spies = vi.hoisted(() => ({ move: vi.fn(), connect: vi.fn(), add: vi.fn(), disconnect: vi.fn() }));
vi.mock('../../src/services/nodeGraph/colorNodeActions', () => ({ createColorNodeActions: () => ({
  moveNode: spies.move, connectPorts: spies.connect, addNode: spies.add, disconnectEdge: spies.disconnect,
  deleteNode: vi.fn(), toggleBypass: vi.fn(),
}) }));
vi.mock('../../src/stores/historyStore', () => ({ startBatch: () => ({ opened: true }), endBatch: vi.fn() }));
vi.mock('../../src/components/panels/nodes/NodeGraphCanvas', () => ({ NodeGraphCanvas: (props: any) => <div data-testid="shared-canvas">
  <span>{props.graph.nodes.length} nodes</span>
  <button onClick={() => props.onMoveNode('node_primary', { x: 400, y: 80 })}>Move fixture</button>
  <button onClick={() => props.onConnectPorts({ fromNodeId: 'node_input', fromPortId: 'out', toNodeId: 'node_primary', toPortId: 'in' })}>Connect fixture</button>
  <button onClick={() => props.onSelectNode('node_primary')}>Select fixture</button>
</div> }));

describe('focused Color canvas', () => {
  it('uses the shared canvas and the same owner actions, without writing layout on open', () => {
    const clip = createMockClip({ colorCorrection: createDefaultColorCorrectionState() });
    const before = JSON.stringify(clip), onSelectNode = vi.fn();
    render(<ColorNodeCanvas clip={clip} onSelectNode={onSelectNode} addNodeDisabled={false} />);
    expect(screen.getByTestId('shared-canvas')).toBeInTheDocument();
    expect(JSON.stringify(clip)).toBe(before);
    fireEvent.click(screen.getByText('Move fixture'));
    expect(spies.move).toHaveBeenCalledWith('node_primary', { x: 400, y: 80 });
    fireEvent.click(screen.getByText('Connect fixture'));
    expect(spies.connect).toHaveBeenCalledWith({ fromNodeId: 'node_input', fromPortId: 'out', toNodeId: 'node_primary', toPortId: 'in' });
    fireEvent.click(screen.getByText('Select fixture'));
    expect(onSelectNode).toHaveBeenCalledWith('node_primary');
  });
  it('keeps validation failures visible', () => {
    spies.connect.mockImplementationOnce(() => { throw new Error('This connection would create a cycle.'); });
    render(<ColorNodeCanvas clip={createMockClip({ colorCorrection: createDefaultColorCorrectionState() })} onSelectNode={vi.fn()} addNodeDisabled={false} />);
    fireEvent.click(screen.getByText('Connect fixture'));
    expect(screen.getByRole('status')).toHaveTextContent('This connection would create a cycle.');
  });
});
