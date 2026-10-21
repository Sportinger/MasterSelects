import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePermanentSaveDestinations, resolvePermanentSaveHint, shouldOfferPermanentSave } from '../../src/services/project/permanentSave/permanentSaveOptions';

const state = vi.hoisted(() => ({
  environment: { checking: false, folderPicker: false, nativeHelper: false, persistentBrowserStorage: false, persistence: false as boolean | 'unsupported' | null, appleMobile: false, homeScreen: 'none' as 'none' | 'browser-tab' | 'home-screen-app' },
  moveActive: vi.fn(),
  moveOne: vi.fn(),
  saveToFolder: vi.fn(),
  download: vi.fn(),
}));
vi.mock('../../src/components/common/toolbar/useSavePermanentlyEnvironment', () => ({
  useSavePermanentlyEnvironment: () => ({ ...state.environment, requestPersistence: vi.fn(async () => true), recheck: vi.fn() }),
}));
vi.mock('../../src/services/project/permanentSave/browserStorageMigration', () => ({
  moveActiveProjectToPersistentBrowserStorage: (openCopy: unknown) => state.moveActive(openCopy),
  moveTemporaryProject: (name: string) => state.moveOne(name),
}));
vi.mock('../../src/services/project/permanentSave/permanentSaveActions', () => ({
  saveActiveProjectToFolder: (name: string, create: unknown) => state.saveToFolder(name, create),
  downloadActiveProjectArchive: (name: string) => state.download(name),
}));
import { SavePermanentlyDialog } from '../../src/components/common/toolbar/SavePermanentlyDialog';
import { ToolbarSavePermanently } from '../../src/components/common/toolbar/ToolbarSavePermanently';

type StatusOverrides = Partial<{
  activeTemporary: boolean; scratch: boolean; persistentBrowserStorage: boolean; tabOnPersistentStorage: boolean; temporaryProjects: string[];
  activeBrowserLocal: boolean; homeScreen: 'none' | 'browser-tab' | 'home-screen-app'; persistence: boolean | 'unsupported' | null;
}>;
// A tab whose open project is temporary runs on the fallback; otherwise it uses OPFS.
const status = (overrides: StatusOverrides = {}) => ({
  activeTemporary: true, scratch: false, persistentBrowserStorage: false, tabOnPersistentStorage: overrides.activeTemporary === false,
  temporaryProjects: [] as string[], activeBrowserLocal: overrides.activeTemporary === false, homeScreen: 'none' as const, persistence: null,
  refresh: vi.fn(), ...overrides,
});
const optionTitles = () => Array.from(document.querySelectorAll('.save-permanently-option-title')).map(node => node.firstChild?.textContent);

describe('save permanently destinations', () => {
  it('offers only the destinations the device supports, best first', () => {
    const base = { activeTemporary: true, folderPicker: false, nativeHelper: false, persistentBrowserStorage: false };
    expect(resolvePermanentSaveDestinations(base)).toEqual(['archive']);
    expect(resolvePermanentSaveDestinations({ ...base, persistentBrowserStorage: true })).toEqual(['browser', 'archive']);
    expect(resolvePermanentSaveDestinations({ ...base, nativeHelper: true })).toEqual(['folder', 'archive']);
    expect(resolvePermanentSaveDestinations({ ...base, folderPicker: true, persistentBrowserStorage: true })).toEqual(['folder', 'browser', 'archive']);
    expect(resolvePermanentSaveDestinations({ ...base, activeTemporary: false, folderPicker: true })).toEqual([]);
  });

  it('puts the Home Screen step first in an iPhone/iPad tab only', () => {
    const base = { activeTemporary: true, folderPicker: false, nativeHelper: false, persistentBrowserStorage: true };
    expect(resolvePermanentSaveDestinations({ ...base, homeScreen: 'browser-tab' })).toEqual(['home-screen', 'browser', 'archive']);
    // A browser-local project: no move, the archive stays as the backup outside Safari.
    expect(resolvePermanentSaveDestinations({ ...base, activeTemporary: false, activeBrowserLocal: true, homeScreen: 'browser-tab' })).toEqual(['home-screen', 'archive']);
    expect(resolvePermanentSaveDestinations({ ...base, homeScreen: 'home-screen-app' })).toEqual(['browser', 'archive']);
    expect(resolvePermanentSaveDestinations({ ...base, activeTemporary: false, activeBrowserLocal: true, homeScreen: 'home-screen-app' })).toEqual([]);
    expect(resolvePermanentSaveDestinations({ ...base, activeTemporary: false, activeBrowserLocal: true, homeScreen: 'none' })).toEqual([]);
  });

  it('marks browser-local projects as not safe in an iPhone/iPad tab until storage is persisted', () => {
    const base = { activeTemporary: false, activeBrowserLocal: true, persistentBrowserStorage: true, tabOnPersistentStorage: true, temporaryProjects: [] };
    expect(resolvePermanentSaveHint({ ...base, homeScreen: 'browser-tab', persistence: false })).toBe('not-safe');
    expect(resolvePermanentSaveHint({ ...base, homeScreen: 'browser-tab', persistence: 'unsupported' })).toBe('not-safe');
    expect(resolvePermanentSaveHint({ ...base, homeScreen: 'browser-tab', persistence: true })).toBeNull();
    // Still checking: no flicker.
    expect(resolvePermanentSaveHint({ ...base, homeScreen: 'browser-tab', persistence: null })).toBeNull();
    expect(resolvePermanentSaveHint({ ...base, homeScreen: 'home-screen-app', persistence: false })).toBeNull();
    expect(resolvePermanentSaveHint({ ...base, homeScreen: 'none', persistence: false })).toBeNull();
    expect(resolvePermanentSaveHint({ ...base, activeTemporary: true, activeBrowserLocal: false, homeScreen: 'browser-tab', persistence: false })).toBe('temporary');
  });

  it('shows the toolbar action for a temporary project or movable leftovers only', () => {
    const base = { activeTemporary: false, persistentBrowserStorage: true, tabOnPersistentStorage: true, temporaryProjects: ['A'] };
    expect(shouldOfferPermanentSave({ ...base, activeTemporary: true, persistentBrowserStorage: false, tabOnPersistentStorage: false, temporaryProjects: [] })).toBe(true);
    expect(shouldOfferPermanentSave({ ...base, persistentBrowserStorage: false })).toBe(false);
    expect(shouldOfferPermanentSave(base)).toBe(true);
    expect(shouldOfferPermanentSave({ ...base, temporaryProjects: [] })).toBe(false);
    // OPFS works again, but this tab still opens browser projects from the fallback.
    expect(shouldOfferPermanentSave({ ...base, tabOnPersistentStorage: false })).toBe(false);
  });
});

describe('SavePermanentlyDialog', () => {
  beforeEach(() => {
    state.environment = { checking: false, folderPicker: false, nativeHelper: false, persistentBrowserStorage: false, persistence: false, appleMobile: false, homeScreen: 'none' };
    for (const mock of [state.moveActive, state.moveOne, state.saveToFolder, state.download]) mock.mockReset();
  });
  afterEach(cleanup);
  const renderDialog = (overrides = {}, props: Partial<Parameters<typeof SavePermanentlyDialog>[0]> = {}) => render(
    <SavePermanentlyDialog status={status(overrides)} projectName="Stage Show" onClose={vi.fn()} createProject={vi.fn()}
      createBrowserStorageCopy={vi.fn()} onProjectChanged={vi.fn()} {...props} />,
  );

  it('recommends the Home Screen first on iPad Private Browsing, then the archive', () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'browser-tab' };
    renderDialog();
    expect(screen.getByRole('heading').textContent).toBe('Save this project permanently');
    expect(optionTitles()).toEqual(['Add MasterSelects to the Home Screen', 'Download .msproj archive']);
    expect(document.querySelector('.save-permanently-home-screen')?.getAttribute('data-recommended')).toBe('true');
    expect(screen.getByText(/lands in the Files app/)).toBeTruthy();
    expect(screen.getByText(/Open as Web App/)).toBeTruthy();
  });

  it('orders Home Screen, Keep in this browser, Download and Ask to keep it in an iPad Safari tab', async () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'browser-tab', persistentBrowserStorage: true };
    state.download.mockResolvedValue('Stage Show.msproj');
    renderDialog();
    expect(optionTitles()).toEqual(['Add MasterSelects to the Home Screen', 'Keep in this browser', 'Download .msproj archive']);
    expect(screen.getByText('Ask to keep it')).toBeTruthy();
    const takeAlong = screen.getByText('Download .msproj to take along');
    // The Home Screen step comes before every other control except the name.
    expect(takeAlong.compareDocumentPosition(screen.getByText('Keep in this browser')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(takeAlong);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Downloaded Stage Show\.msproj.*Home Screen app use Open Project > Import \.msproj archive/));
    expect(state.download).toHaveBeenCalledWith('Stage Show');
  });

  it('does not call a Safari-tab browser copy permanent', async () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'browser-tab', persistentBrowserStorage: true };
    state.moveActive.mockResolvedValue({ from: 'Stage Show', to: 'Stage Show', removedTemporary: true, persisted: false });
    renderDialog();
    fireEvent.click(screen.getByText('Keep in this browser'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Kept in this browser.*seven days.*Home Screen/));
  });

  it('keeps a browser-local project safe from an iPad Safari tab', () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'browser-tab', persistentBrowserStorage: true };
    renderDialog({ activeTemporary: false });
    expect(screen.getByRole('heading').textContent).toBe('Keep this project safe');
    expect(screen.getByText(/Not safe yet\./)).toBeTruthy();
    expect(optionTitles()).toEqual(['Add MasterSelects to the Home Screen', 'Download .msproj archive']);
    expect(screen.getByText(/backup outside Safari/)).toBeTruthy();
  });

  it('renders above the workspace bar with a scrolling body and a footer that keeps Close/Done visible', () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'browser-tab', persistentBrowserStorage: true };
    const { container } = renderDialog({ activeTemporary: false });
    const dialog = screen.getByRole('dialog');
    // Portaled to the body: the toolbar's stacking context sits below the workspace bar.
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.closest('.project-name-dialog-backdrop')?.parentElement).toBe(document.body);
    const body = dialog.querySelector('.save-permanently-body');
    const footer = dialog.querySelector('.save-permanently-footer');
    expect(body?.querySelector('.save-permanently-options')).toBeTruthy();
    expect(footer?.parentElement).toBe(dialog);
    expect(body?.contains(footer!)).toBe(false);
    expect(footer?.textContent).toBe('Close');
  });

  it('treats browser storage as permanent in the Home Screen app, archive as backup', () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'home-screen-app', persistentBrowserStorage: true };
    renderDialog();
    expect(optionTitles()).toEqual(['Keep in this browser', 'Download .msproj archive']);
    expect(screen.queryByText('Download .msproj to take along')).toBeNull();
    expect(screen.getByText(/Opened from the Home Screen/)).toBeTruthy();
  });

  it('lists folder, browser and archive on desktop Chrome and saves to a folder', async () => {
    state.environment = { ...state.environment, folderPicker: true, persistentBrowserStorage: true };
    state.saveToFolder.mockResolvedValue({ status: 'saved', removedTemporary: true });
    const onProjectChanged = vi.fn();
    renderDialog({}, { onProjectChanged });
    expect(optionTitles()).toEqual(['Save to a folder…', 'Keep in this browser', 'Download .msproj archive']);
    expect(screen.queryByText(/Home Screen/)).toBeNull();
    fireEvent.click(screen.getByText('Save to a folder…'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved permanently.*temporary copy was removed/));
    expect(state.saveToFolder).toHaveBeenCalledWith('Stage Show', expect.any(Function));
    expect(onProjectChanged).toHaveBeenCalledOnce();
  });

  it('explains a failed move and says that nothing was removed', async () => {
    state.environment.persistentBrowserStorage = true;
    state.moveActive.mockRejectedValue(new Error('The permanent copy could not be verified.'));
    renderDialog();
    fireEvent.click(screen.getByText('Keep in this browser'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be verified.*Nothing was removed/));
  });

  it('downloads the archive under the project name', async () => {
    state.download.mockResolvedValue('Stage Show.msproj');
    renderDialog();
    fireEvent.click(screen.getByText('Download .msproj archive'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Downloaded Stage Show\.msproj.*Import \.msproj archive/));
    expect(state.download).toHaveBeenCalledWith('Stage Show');
  });

  it('moves projects left in temporary storage when this tab can store permanently', async () => {
    state.environment.persistentBrowserStorage = true;
    state.moveOne.mockImplementation(async (name: string) => ({ from: name, to: name, removedTemporary: true }));
    renderDialog({ activeTemporary: false, temporaryProjects: ['A', 'B'] });
    expect(screen.getByRole('heading').textContent).toBe('Move temporary projects');
    expect(optionTitles()).toEqual([]);
    fireEvent.click(screen.getByText('Move 2 to this browser’s permanent storage'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Moved 2 projects/));
    expect(state.moveOne.mock.calls).toEqual([['A'], ['B']]);
  });

  it('moves the open project through the project core copy', async () => {
    state.environment.persistentBrowserStorage = true;
    state.moveActive.mockResolvedValue({ from: 'Stage Show', to: 'Stage Show', removedTemporary: true, persisted: true });
    const createBrowserStorageCopy = vi.fn();
    renderDialog({}, { createBrowserStorageCopy });
    fireEvent.click(screen.getByText('Keep in this browser'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved permanently in this browser/));
    expect(state.moveActive).toHaveBeenCalledWith(createBrowserStorageCopy);
  });

  it('lists leftovers without offering their move while this tab still uses the temporary store', () => {
    state.environment.persistentBrowserStorage = true;
    renderDialog({ temporaryProjects: ['A', 'B'] });
    expect(screen.queryByText(/^Move 2 to/)).toBeNull();
    expect(screen.getByText(/Also in temporary storage: A, B\..*after this project was kept in this browser/)).toBeTruthy();
  });
});

describe('ToolbarSavePermanently', () => {
  afterEach(cleanup);
  it('is a clearly marked button while the open project is temporary', () => {
    const onOpen = vi.fn();
    render(<ToolbarSavePermanently status={status()} onOpen={onOpen} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('TemporarySave permanentlySave');
    expect(button.getAttribute('aria-label')).toMatch(/^Save permanently: /);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('stays hidden for permanent projects', () => {
    const { container } = render(<ToolbarSavePermanently status={status({ activeTemporary: false })} onOpen={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('marks a browser-local project in an iPad Safari tab until storage is persisted', () => {
    const onOpen = vi.fn();
    const { rerender, container } = render(<ToolbarSavePermanently status={status({ activeTemporary: false, homeScreen: 'browser-tab', persistence: false })} onOpen={onOpen} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('Not safe yetKeep safeKeep safe');
    expect(button.getAttribute('data-hint')).toBe('not-safe');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
    rerender(<ToolbarSavePermanently status={status({ activeTemporary: false, homeScreen: 'browser-tab', persistence: true })} onOpen={onOpen} />);
    expect(container.textContent).toBe('');
    rerender(<ToolbarSavePermanently status={status({ activeTemporary: false, homeScreen: 'home-screen-app', persistence: false })} onOpen={onOpen} />);
    expect(container.textContent).toBe('');
  });
});
