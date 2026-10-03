import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContextMenu } from '../../src/components/panels/nodes/unified/WorkspaceContextMenu';
import { WorkspaceControllerMenus } from '../../src/components/panels/nodes/unified/WorkspaceControllerMenus';
import { workspaceRouting } from '../../src/components/panels/nodes/unified/workspaceRouting';
import { workspaceClipGroup, workspaceClipId } from '../../src/services/nodeGraph/unified/workspaceIds';
import { namespaceClipGraph } from '../../src/services/nodeGraph/unified/namespaceClipGraph';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { NodeGraph } from '../../src/types/nodeGraph';
import type { ClipWorkspaceControllerValue } from '../../src/components/panels/nodes/unified/ClipWorkspaceController';

vi.mock('../../src/components/panels/nodes/unified/useClipDomainAdapter', () => ({ clipWorkspaceBatch: (_label: string, run: () => void) => run() }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('shared workspace context menus', () => {
  it('renders outside a scaled workspace so menu dimensions stay in screen pixels', () => {
    const view = render(createElement('div', { style: { transform: 'scale(0.4)' }, 'data-testid': 'scaled-workspace' },
      createElement(WorkspaceContextMenu, { ownerName: 'Add to Clip', x: 80, y: 100,
        targetNode: null, canDeleteTarget: false, onDeleteNode: () => {}, onClose: () => {}, entries: [] })));
    const menu = screen.getByRole('menu');
    expect(view.container.contains(menu)).toBe(false);
    expect(menu.closest('.workspace-screen-menu')?.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  it('keeps search state through a selection/inspector owner change, autofocuses and blocks shortcuts', () => {
    vi.useFakeTimers();
    const shortcut = vi.fn(); window.addEventListener('keydown', shortcut);
    function Harness() {
      const [selected, select] = useState('first');
      const [opened, open] = useState(true);
      const menus = opened ? createElement(WorkspaceContextMenu, { ownerName: 'Add to First clip', x: 80, y: 100,
        targetNode: null, canDeleteTarget: false, onDeleteNode: () => {}, onClose: () => open(false),
        entries: [{ kind: 'item', id: 'transform', label: 'Transform', onSelect: () => open(false) }] }) : null;
      return createElement('div', null,
        createElement('button', { onClick: () => select('second') }, `Select ${selected}`),
        createElement('button', { onClick: () => open(true) }, 'Open menu'),
        createElement(WorkspaceControllerMenus, { controllers: new Map([['first', { menus }], ['second', { menus: null }]]) }));
    }
    render(createElement(Harness));
    const input = screen.getByRole('searchbox', { name: 'Search nodes' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'trans' } });
    for (const key of [' ', 'g', 'i']) fireEvent.keyDown(input, { key });
    expect(shortcut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Select first' }));
    expect(screen.getByRole('button', { name: 'Select second' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search nodes' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('trans');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole('searchbox')).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(shortcut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    fireEvent.click(document.querySelector('.node-workspace-context-backdrop')!);
    expect(screen.queryByRole('menu')).toBeNull();
    window.removeEventListener('keydown', shortcut);
  });
  it('uses the clicked group owner and local coordinates, not the selected clip', () => {
    const openA = vi.fn(), openB = vi.fn(), openComposition = vi.fn();
    const local = connectionFixture;
    const graphs = ['a', 'b'].map(id => namespaceClipGraph(local, id, { x: 100, y: 200 }));
    const graph: NodeGraph = { id: 'composition', owner: { kind: 'composition', id: 'main', name: 'Main' },
      nodes: graphs.flatMap(graph => graph.nodes), edges: [], workspace: { defaultNodes: {}, clips: Object.fromEntries(['a', 'b'].map(id => [id,
        { graph: local, origin: { x: 100, y: 200 }, placement: { nodes: {}, groups: {} } }])) } };
    const controllers = new Map(['a', 'b'].map((id, i) => [id, { closeMenus: vi.fn(),
      canvasProps: { onOpenAddMenu: i ? openB : openA } } as unknown as ClipWorkspaceControllerValue]));
    const composition = { connect: vi.fn(), toggle: vi.fn(), message: vi.fn(), openMenu: openComposition };
    const menu = { x: 450, y: 300, layout: { x: 170, y: 290 }, nodeId: null, groupId: workspaceClipGroup('b') };
    const routes = workspaceRouting(graph, controllers, [workspaceClipId('a', 'Source')], vi.fn(), composition);
    routes.onOpenAddMenu!(menu);
    expect(openA).not.toHaveBeenCalled();
    expect(openB).toHaveBeenCalledWith({ ...menu, groupId: null, layout: { x: 70, y: 90 } });
    routes.onOpenAddMenu!({ ...menu, groupId: null });
    expect(openComposition).toHaveBeenCalledWith({ ...menu, groupId: null });
    const root = { ...graph, owner: { kind: 'clip' as const, id: 'a', name: 'First clip' } };
    workspaceRouting(root, controllers, [], vi.fn(), composition).onOpenAddMenu!({ ...menu, groupId: null });
    expect(openA).toHaveBeenCalledWith({ ...menu, groupId: null, layout: { x: 70, y: 90 } });
  });
});
