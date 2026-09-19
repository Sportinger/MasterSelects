import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceBar } from '../../src/components/common/WorkspaceBar';
import {
  FACTORY_COLOR_LAYOUT_ID,
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';

const originalDockState = useDockStore.getState();

beforeEach(() => {
  act(() => {
    useDockStore.setState({
      activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      loadSavedLayout: vi.fn(),
      overLayoutBaseId: null,
      mediumLayoutOverride: null,
      mobileLayoutOverride: null,
      savedLayouts: getFactoryDockLayouts(),
      setMediumLayoutOverride: vi.fn(),
      setMobileLayoutOverride: vi.fn(),
    });
  });
});

afterEach(() => {
  act(() => {
    useDockStore.setState(originalDockState, true);
  });
});

describe('WorkspaceBar', () => {
  it('keeps Mobile above the selected base layout instead of listing it as a workspace', () => {
    act(() => {
      useDockStore.setState({
        activeSavedLayoutId: FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
        overLayoutBaseId: FACTORY_COLOR_LAYOUT_ID,
      });
    });
    render(<WorkspaceBar />);

    expect(screen.getByRole('navigation', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.queryByTitle('Load Mobile')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Load Medium')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mobile mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Load Color')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTitle('Load Video')).not.toHaveAttribute('aria-current');
  });

  it('enables Mobile mode from the global toggle', () => {
    render(<WorkspaceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Mobile mode' }));

    expect(useDockStore.getState().setMobileLayoutOverride).toHaveBeenCalledWith(true);
  });

  it('enables Medium beside Mobile while keeping Video selected underneath', () => {
    render(<WorkspaceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Medium mode' }));

    expect(useDockStore.getState().setMediumLayoutOverride).toHaveBeenCalledWith(true);
    expect(screen.getByTitle('Load Video')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTitle('Load Medium')).not.toBeInTheDocument();
  });

  it('can re-enable Mobile from an exact unsaved desktop layout', () => {
    act(() => {
      useDockStore.setState({
        activeSavedLayoutId: null,
        mobileLayoutOverride: false,
      });
    });
    render(<WorkspaceBar />);
    const mobileToggle = screen.getByRole('button', { name: 'Mobile mode' });

    expect(mobileToggle).not.toBeDisabled();
    fireEvent.click(mobileToggle);

    expect(useDockStore.getState().setMobileLayoutOverride).toHaveBeenCalledWith(true);
  });

  it('releases pointer focus from the Mobile toggle after a touch or click', () => {
    render(<WorkspaceBar />);
    const mobileToggle = screen.getByRole('button', { name: 'Mobile mode' });
    mobileToggle.focus();

    fireEvent.pointerUp(mobileToggle, { pointerType: 'touch' });

    expect(mobileToggle).not.toHaveFocus();
  });

  it('releases pointer focus from sub-layouts without affecting keyboard activation', () => {
    render(<WorkspaceBar />);
    const videoButton = screen.getByTitle('Load Video');
    videoButton.focus();

    fireEvent.pointerUp(videoButton, { pointerType: 'mouse' });
    expect(videoButton).not.toHaveFocus();

    videoButton.focus();
    fireEvent.keyDown(videoButton, { key: 'Enter' });
    expect(videoButton).toHaveFocus();
  });

  it('disables Mobile mode without changing the selected base layout directly', () => {
    act(() => {
      useDockStore.setState({
        activeSavedLayoutId: FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
        overLayoutBaseId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      });
    });
    render(<WorkspaceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Mobile mode' }));

    expect(useDockStore.getState().setMobileLayoutOverride).toHaveBeenCalledWith(false);
    expect(useDockStore.getState().loadSavedLayout).not.toHaveBeenCalled();
  });

  it('opens the factory color workspace from the bottom bar', () => {
    render(<WorkspaceBar />);

    fireEvent.click(screen.getByTitle('Load Color'));

    expect(useDockStore.getState().loadSavedLayout).toHaveBeenCalledWith(FACTORY_COLOR_LAYOUT_ID);
  });

  it('keeps non-favorite layouts available from the layouts menu', () => {
    const customLayout = {
      ...getFactoryDockLayouts()[0],
      favorite: false,
      id: 'custom-review',
      name: 'Review',
    };
    act(() => {
      useDockStore.setState({
        savedLayouts: [...getFactoryDockLayouts(), customLayout],
      });
    });
    render(<WorkspaceBar />);

    expect(screen.queryByTitle('Load Review')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Layouts' }));
    expect(screen.queryByRole('menuitemradio', { name: 'Mobile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Medium' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Review' }));

    expect(useDockStore.getState().loadSavedLayout).toHaveBeenCalledWith('custom-review');
    expect(screen.queryByRole('menu', { name: 'All layouts' })).not.toBeInTheDocument();
  });

  it('presents a loaded Medium factory layout as Video plus the Medium overlay', () => {
    act(() => {
      useDockStore.setState({
        activeSavedLayoutId: FACTORY_MEDIUM_EDIT_LAYOUT_ID,
        overLayoutBaseId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      });
    });
    render(<WorkspaceBar />);

    expect(screen.getByRole('button', { name: 'Medium mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Load Video')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps Medium and Mobile pressed at the same time', () => {
    act(() => {
      useDockStore.setState({
        activeSavedLayoutId: FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
        mediumLayoutOverride: true,
        mobileLayoutOverride: true,
        overLayoutBaseId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      });
    });
    render(<WorkspaceBar />);

    expect(screen.getByRole('button', { name: 'Medium mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mobile mode' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Medium mode' }));
    expect(useDockStore.getState().setMediumLayoutOverride).toHaveBeenCalledWith(false);
    expect(useDockStore.getState().setMobileLayoutOverride).not.toHaveBeenCalled();
  });
});
