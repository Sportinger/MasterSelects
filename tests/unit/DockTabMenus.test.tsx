import { createRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DockTabMenus } from '../../src/components/dock/tabPane/DockTabMenus';

describe('DockTabMenus', () => {
  it('shows categorized Change to submenus and forwards the selected panel type', () => {
    const onChangeContextPanelType = vi.fn();

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
        onChangeContextPanelType={onChangeContextPanelType}
      />,
    );

    const categoryMenu = screen.getByRole('menu', { name: 'Change panel category' });
    expect(within(categoryMenu).getByRole('menuitem', { name: 'Editing' })).toHaveClass('is-current');
    expect(within(categoryMenu).getByRole('menuitem', { name: 'Color' })).toBeInTheDocument();
    expect(within(categoryMenu).getByRole('menuitem', { name: 'Live' })).toBeInTheDocument();

    const editingMenu = screen.getByRole('menu', { name: 'Editing panels' });
    expect(within(editingMenu).getByRole('menuitem', { name: 'Preview' })).toBeDisabled();

    fireEvent.click(within(screen.getByRole('menu', { name: 'Audio panels' })).getByRole(
      'menuitem',
      { name: 'Audio Mixer' },
    ));

    expect(onChangeContextPanelType).toHaveBeenCalledOnce();
    expect(onChangeContextPanelType).toHaveBeenCalledWith('audio-mixer');
  });

  it('opens nested menus to the left near the right viewport edge', () => {
    render(
      <DockTabMenus
        addMenuRef={createRef<HTMLDivElement>()}
        contextMenuRef={createRef<HTMLDivElement>()}
        addMenu={null}
        tabContextMenu={{
          x: window.innerWidth - 180,
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

    expect(screen.getByRole('button', { name: 'Change to' }).parentElement?.parentElement).toHaveClass(
      'dock-tab-context-menu--cascade-left',
    );
  });

  it('groups the add-panel menu and preserves its existing-panel behavior', () => {
    const onAddPanelType = vi.fn();
    const innerWidthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360);

    render(
      <DockTabMenus
        addMenuRef={createRef<HTMLDivElement>()}
        contextMenuRef={createRef<HTMLDivElement>()}
        addMenu={{ x: 172, y: 20 }}
        tabContextMenu={null}
        getVisiblePanelTypes={() => ['media']}
        onAddPanelType={onAddPanelType}
        onHideContextPanel={vi.fn()}
        onFloatContextPanel={vi.fn()}
        onDetachContextPanelToWindow={vi.fn()}
        onChangeContextPanelType={vi.fn()}
      />,
    );

    const categoryMenu = screen.getByRole('menu', { name: 'Add panel category' });
    expect(categoryMenu).toHaveClass('dock-tab-add-menu--fold-left');
    expect(within(categoryMenu).getByRole('menuitem', { name: 'Editing' })).toBeInTheDocument();
    expect(within(categoryMenu).getByRole('menuitem', { name: 'Live' })).toBeInTheDocument();

    const editingMenu = screen.getByRole('menu', { name: 'Editing panels to add' });
    const mediaMenuItem = within(editingMenu).getByRole('menuitem', { name: /Media\s*open/ });
    expect(mediaMenuItem).toHaveClass('is-current');
    fireEvent.click(mediaMenuItem);

    expect(onAddPanelType).toHaveBeenCalledOnce();
    expect(onAddPanelType).toHaveBeenCalledWith('media');
    innerWidthSpy.mockRestore();
  });
});
