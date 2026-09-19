import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DockTabPane } from '../../src/components/dock/DockTabPane';
import { DockTabMenus } from '../../src/components/dock/tabPane/DockTabMenus';
import { HOLD_DURATION } from '../../src/components/dock/tabPane/layoutMath';
import { useDockStore } from '../../src/stores/dockStore';
import type { DockTabGroup } from '../../src/types/dock';

vi.mock('../../src/components/dock/tabPane/PanelContentHost', () => ({
  PanelContentHost: () => <div data-testid="panel-content" />,
}));

const TAB_GROUP: DockTabGroup = {
  kind: 'tab-group',
  id: 'context-behavior-group',
  panels: [
    { id: 'media-panel', type: 'media', title: 'Media' },
    { id: 'properties-panel', type: 'clip-properties', title: 'Properties' },
  ],
  activeIndex: 0,
};

const originalSetActiveTab = useDockStore.getState().setActiveTab;

afterEach(() => {
  cleanup();
  useDockStore.getState().cancelDrag();
  useDockStore.setState({ setActiveTab: originalSetActiveTab });
  vi.useRealTimers();
});

describe('dock tab context behavior', () => {
  it('orders panel actions as Hide, Change to, Undock, Undock to Window', () => {
    render(
      <DockTabMenus
        addMenuRef={createRef<HTMLDivElement>()}
        contextMenuRef={createRef<HTMLDivElement>()}
        addMenu={null}
        tabContextMenu={{
          x: 20,
          y: 20,
          panel: { id: 'preview-panel', type: 'preview', title: 'Preview' },
        }}
        getVisiblePanelTypes={() => []}
        onAddPanelType={vi.fn()}
        onHideContextPanel={vi.fn()}
        onFloatContextPanel={vi.fn()}
        onDetachContextPanelToWindow={vi.fn()}
        onChangeContextPanelType={vi.fn()}
      />,
    );

    const hide = screen.getByRole('button', { name: 'Hide' });
    const changeTo = screen.getByRole('button', { name: 'Change to' });
    const undock = screen.getByRole('button', { name: 'Undock' });
    const undockToWindow = screen.getByRole('button', { name: 'Undock to Window' });
    const menu = hide.parentElement;

    expect(menu?.children[0]).toBe(hide);
    expect(menu?.children[1]).toContainElement(changeTo);
    expect(menu?.children[2]).toBe(undock);
    expect(menu?.children[3]).toBe(undockToWindow);
    expect(within(screen.getByRole('menu', { name: 'Editing panels' })).getByRole(
      'menuitem',
      { name: 'Curves' },
    )).toBeInTheDocument();
  });

  it('opens an inactive tab context menu without activating that tab', () => {
    const setActiveTab = vi.fn();
    useDockStore.setState({ setActiveTab });
    render(<DockTabPane group={TAB_GROUP} />);

    const inactiveTab = screen.getByRole('tab', { name: 'Properties' });
    fireEvent.pointerDown(inactiveTab, {
      button: 2,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
    });
    fireEvent.contextMenu(inactiveTab, { button: 2, clientX: 40, clientY: 30 });

    expect(setActiveTab).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('does not activate an inactive tab after a touch hold', () => {
    vi.useFakeTimers();
    const setActiveTab = vi.fn();
    useDockStore.setState({ setActiveTab });
    render(<DockTabPane group={TAB_GROUP} />);

    const inactiveTab = screen.getByRole('tab', { name: 'Properties' });
    fireEvent.pointerDown(inactiveTab, {
      button: 0,
      clientX: 40,
      clientY: 30,
      isPrimary: true,
      pointerId: 2,
      pointerType: 'touch',
    });
    expect(setActiveTab).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(HOLD_DURATION + 1));
    fireEvent.pointerUp(inactiveTab, {
      button: 0,
      clientX: 40,
      clientY: 30,
      isPrimary: true,
      pointerId: 2,
      pointerType: 'touch',
    });
    fireEvent.click(inactiveTab);

    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('still activates an inactive tab after a short touch tap', () => {
    const setActiveTab = vi.fn();
    useDockStore.setState({ setActiveTab });
    render(<DockTabPane group={TAB_GROUP} />);

    const inactiveTab = screen.getByRole('tab', { name: 'Properties' });
    fireEvent.pointerDown(inactiveTab, {
      button: 0,
      clientX: 40,
      clientY: 30,
      isPrimary: true,
      pointerId: 3,
      pointerType: 'touch',
    });
    fireEvent.pointerUp(inactiveTab, {
      button: 0,
      clientX: 40,
      clientY: 30,
      isPrimary: true,
      pointerId: 3,
      pointerType: 'touch',
    });
    fireEvent.click(inactiveTab);

    expect(setActiveTab).toHaveBeenCalledOnce();
    expect(setActiveTab).toHaveBeenCalledWith(TAB_GROUP.id, 1);
  });
});
