import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { NodeCableMenu } from '../../src/components/panels/nodes/canvas/NodeCableMenu';
import type { RoutedCable } from '../../src/components/panels/nodes/canvas/cableBranches';

// Right-clicking a cable and typing a node name must search, not fire timeline shortcuts
// (L played forward, I and O set in and out points).
afterEach(cleanup);
const menu = { cableId: 'c', clientX: 40, clientY: 40, point: { x: 0, y: 0 }, cable: { edge: { id: 'e' } } as unknown as RoutedCable };
const props = { menu, onClose: vi.fn(), onAddBranch: vi.fn(), onRemoveBranch: vi.fn(), onDisconnect: vi.fn() };

describe('cable menu focus', () => {
  it('puts the focus into the insert search when nodes can be inserted', () => {
    render(<NodeCableMenu {...props} insertEntries={[{ kind: 'item', id: 'yarn', label: 'Yarn Profile', onSelect: vi.fn() }]} />);
    expect(document.activeElement).toBe(document.querySelector('input[type="search"]'));
  });

  it('focuses the first action when there is nothing to insert', () => {
    render(<NodeCableMenu {...props} />);
    expect(document.activeElement?.textContent).toBe('Add branch point here');
  });
});
