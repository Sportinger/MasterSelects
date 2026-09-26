import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { NodeContextMenu } from '../../src/components/panels/nodes/workspace/NodeContextMenu';
import type { NodeMenuEntry } from '../../src/components/panels/nodes/workspace/NodeMenuTree';

const entries: NodeMenuEntry[] = [
  { kind: 'submenu', id: 'nodes', label: 'Nodes', children: [
    { kind: 'submenu', id: 'math', label: 'Math', children: [{ kind: 'item', id: 'add', label: 'Add', onSelect: vi.fn() }] },
    { kind: 'submenu', id: 'color', label: 'Color', children: [{ kind: 'item', id: 'hue', label: 'Hue', onSelect: vi.fn() }] },
  ] },
];

function renderMenu() {
  const onClose = vi.fn();
  const view = render(<NodeContextMenu x={10} y={10} targetNode={null} canDeleteTarget={false} entries={entries}
    onClose={onClose} onDeleteNode={vi.fn()} />);
  return { ...view, onClose, menu: view.getByRole('menu', { name: 'Add node' }) };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('node context menu auto close', () => {
  it('closes shortly after opening when the pointer never enters it', () => {
    const { onClose } = renderMenu();
    act(() => { vi.advanceTimersByTime(1400); });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open while hovered and closes after the pointer leaves', () => {
    const { onClose, menu } = renderMenu();
    fireEvent.mouseEnter(menu);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseLeave(menu);
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.mouseEnter(menu);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseLeave(menu);
    act(() => { vi.advanceTimersByTime(700); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps an open flyout while the pointer briefly leaves its row', () => {
    const { getByRole } = renderMenu();
    const nodes = getByRole('button', { name: 'Nodes' });
    fireEvent.mouseEnter(nodes.parentElement!);
    const math = getByRole('button', { name: 'Math' });
    fireEvent.mouseEnter(math.parentElement!);
    expect(math).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseLeave(math.parentElement!);
    act(() => { vi.advanceTimersByTime(300); });
    expect(math).toHaveAttribute('aria-expanded', 'true');
    act(() => { vi.advanceTimersByTime(200); });
    expect(math).toHaveAttribute('aria-expanded', 'false');
  });
});
