import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openPhoneEditor = vi.hoisted(() => vi.fn());
const phoneDevice = vi.hoisted(() => ({ value: false }));
vi.mock('../../src/components/common/openPhoneEditor', () => ({ openPhoneEditor }));
vi.mock('../../src/routing/phoneEntry', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/routing/phoneEntry')>(),
  readPhoneEntryEnvironment: () => phoneDevice.value
    ? { coarsePointer: true, screenWidth: 412, screenHeight: 915, prefersFullEditor: true, installedApp: false }
    : { coarsePointer: false, screenWidth: 1920, screenHeight: 1080, prefersFullEditor: false, installedApp: false },
}));

import { WorkspaceBar } from '../../src/components/common/WorkspaceBar';
import {
  FACTORY_COLOR_LAYOUT_ID,
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';

const originalDockState = useDockStore.getState();

beforeEach(() => {
  openPhoneEditor.mockReset();
  openPhoneEditor.mockResolvedValue({ ok: true });
  phoneDevice.value = false;
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
    expect(screen.getByRole('button', { name: 'Mobile mode' })).not.toHaveAttribute('aria-pressed');
    expect(screen.getByTitle('Load Color')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTitle('Load Video')).not.toHaveAttribute('aria-current');
  });

  it('opens the phone editor from Mobile on a desktop', () => {
    render(<WorkspaceBar />);
    const mobile = screen.getByRole('button', { name: 'Mobile mode' });

    expect(mobile).toHaveAttribute('title', 'Open the phone editor');
    expect(mobile).not.toHaveAttribute('aria-pressed');
    fireEvent.click(mobile);

    expect(openPhoneEditor).toHaveBeenCalledTimes(1);
    expect(useDockStore.getState().setMobileLayoutOverride).not.toHaveBeenCalled();
  });

  it('disables Mobile while the phone editor opens', async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    openPhoneEditor.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<WorkspaceBar />);
    const mobile = screen.getByRole('button', { name: 'Mobile mode' });

    fireEvent.click(mobile);
    expect(mobile).toBeDisabled();
    fireEvent.click(mobile);
    expect(openPhoneEditor).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
  });

  it('shows why Mobile did not open the phone editor', async () => {
    openPhoneEditor.mockResolvedValue({ ok: false, message: 'The project could not be saved, so the phone editor did not open.' });
    render(<WorkspaceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Mobile mode' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('button', { name: 'Mobile mode' })).toHaveAttribute(
      'title',
      'The project could not be saved, so the phone editor did not open.',
    );
  });

  it('opens the phone editor from the Layouts menu', () => {
    render(<WorkspaceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Layouts' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Phone editor' }));

    expect(openPhoneEditor).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('on a phone, Mobile opens the phone editor too', () => {
    phoneDevice.value = true;
    act(() => {
      useDockStore.setState({ activeSavedLayoutId: FACTORY_VERTICAL_MOBILE_LAYOUT_ID, overLayoutBaseId: FACTORY_VIDEO_EDIT_LAYOUT_ID });
    });
    render(<WorkspaceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Mobile mode' }));

    expect(openPhoneEditor).toHaveBeenCalledTimes(1);
    expect(useDockStore.getState().setMobileLayoutOverride).not.toHaveBeenCalled();
  });

  it('says why the phone editor did not open and keeps the desktop editor', async () => {
    openPhoneEditor.mockResolvedValue({ ok: false, message: 'An export is running. Let it finish or cancel it, then switch editors.' });
    render(<WorkspaceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Layouts' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Phone editor' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An export is running');
  });

  it('enables Medium beside Mobile while keeping Video selected underneath', () => {
    render(<WorkspaceBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Medium mode' }));

    expect(useDockStore.getState().setMediumLayoutOverride).toHaveBeenCalledWith(true);
    expect(screen.getByTitle('Load Video')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTitle('Load Medium')).not.toBeInTheDocument();
  });

  it('keeps Mobile available from an unsaved desktop layout and the Start page', () => {
    act(() => {
      useDockStore.setState({ activeSavedLayoutId: null });
    });
    const { unmount } = render(<WorkspaceBar />);
    expect(screen.getByRole('button', { name: 'Mobile mode' })).not.toBeDisabled();
    unmount();

    act(() => {
      useDockStore.setState({ activeSavedLayoutId: FACTORY_START_LAYOUT_ID });
    });
    render(<WorkspaceBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Mobile mode' }));
    expect(openPhoneEditor).toHaveBeenCalledTimes(1);
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

  it('toggles Medium without touching the Mobile layout override', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Medium mode' }));
    expect(useDockStore.getState().setMediumLayoutOverride).toHaveBeenCalledWith(false);
    expect(useDockStore.getState().setMobileLayoutOverride).not.toHaveBeenCalled();
  });
});
