import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePermanentSaveDestinations, resolvePermanentSaveHint, shouldOfferPermanentSave } from '../../src/services/project/permanentSave/permanentSaveOptions';

const state = vi.hoisted(() => ({
  environment: { checking: false, folderPicker: false, nativeHelper: false, persistentBrowserStorage: false, persistence: false as boolean | 'unsupported' | null, appleMobile: false, homeScreen: 'none' as 'none' | 'browser-tab' | 'home-screen-app' },
  moveActive: vi.fn(),
  moveOne: vi.fn(),
  saveToFolder: vi.fn(),
  download: vi.fn(),
  persistGranted: true,
}));
vi.mock('../../src/components/common/toolbar/useSavePermanentlyEnvironment', () => ({
  useSavePermanentlyEnvironment: () => ({ ...state.environment, requestPersistence: vi.fn(async () => state.persistGranted), recheck: vi.fn() }),
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
// Visible action titles in document order: the primary action, then (when expanded) More options.
const optionTitles = () => Array.from(document.querySelectorAll('.save-permanently-option-title')).map(node => node.textContent);
const stepLabels = () => Array.from(document.querySelectorAll('.save-permanently-step-text strong')).map(node => node.textContent?.trim());
const openMore = () => fireEvent.click(screen.getByRole('button', { name: /More options/ }));

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
    state.persistGranted = true;
  });
  afterEach(cleanup);
  const renderDialog = (overrides = {}, props: Partial<Parameters<typeof SavePermanentlyDialog>[0]> = {}) => render(
    <SavePermanentlyDialog status={status(overrides)} projectName="Stage Show" onClose={vi.fn()} createProject={vi.fn()}
      createBrowserStorageCopy={vi.fn()} onProjectChanged={vi.fn()} {...props} />,
  );

  it('shows the Home Screen steps first on iPad Private Browsing, the rest under More options', () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'browser-tab' };
    renderDialog();
    expect(screen.getByRole('heading').textContent).toBe('This project is only temporary');
    expect(screen.getByText('Safari can delete it when this tab closes.')).toBeTruthy();
    expect(stepLabels()).toEqual(['Download this project', 'Tap Share', 'Tap Add to Home Screen', 'Open the new  icon', 'Open Project → Import']);
    expect(screen.getByText(/Open as Web App/)).toBeTruthy();
    // Collapsed by default: no secondary option is rendered.
    expect(optionTitles()).toEqual([]);
    const toggle = screen.getByRole('button', { name: /More options/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    openMore();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(optionTitles()).toEqual(['Download a backup', 'Ask to keep it']);
    expect(screen.getByText(/Files → Downloads/)).toBeTruthy();
  });

  it('downloads the project as step 1 in an iPad Safari tab and marks the step done', async () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'browser-tab', persistentBrowserStorage: true };
    state.download.mockResolvedValue('Stage Show.msproj');
    renderDialog();
    const download = screen.getByRole('button', { name: 'Download project' });
    // The download is the recommended action and comes before More options.
    expect(download.compareDocumentPosition(screen.getByRole('button', { name: /More options/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(download));
    openMore();
    expect(optionTitles()).toEqual(['Keep in this browser', 'Download a backup', 'Ask to keep it']);
    fireEvent.click(download);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('✓ Downloaded "Stage Show.msproj" to Files → Downloads. Now do step 2.'));
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('success');
    expect(document.querySelector('.save-permanently-step')?.getAttribute('data-done')).toBe('true');
    expect(screen.getByRole('button', { name: 'Download again' })).toBeTruthy();
    expect(state.download).toHaveBeenCalledWith('Stage Show');
  });

  it('does not call a Safari-tab browser copy safe', async () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'browser-tab', persistentBrowserStorage: true };
    state.moveActive.mockResolvedValue({ from: 'Stage Show', to: 'Stage Show', removedTemporary: true, persisted: false });
    renderDialog();
    openMore();
    expect(screen.getByText('Safari can still delete it after 7 days.')).toBeTruthy();
    fireEvent.click(screen.getByText('Keep in this browser'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Kept in this browser\. Safari can still delete it/));
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('warning');
  });

  it('keeps a browser-local project safe from an iPad Safari tab', () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'browser-tab', persistentBrowserStorage: true };
    renderDialog({ activeTemporary: false });
    expect(screen.getByRole('heading').textContent).toBe('This project can get lost');
    expect(screen.getByText('Safari deletes website data after 7 days without a visit.')).toBeTruthy();
    expect(screen.getByText('Fix: use the Home Screen app. It keeps your data.')).toBeTruthy();
    // No name field: the iPad keyboard must not pop up, and nothing gets renamed here.
    expect(screen.queryByRole('textbox')).toBeNull();
    openMore();
    expect(optionTitles()).toEqual(['Download a backup', 'Ask to keep it']);
  });

  it('treats browser storage as permanent in the Home Screen app, archive as backup', () => {
    state.environment = { ...state.environment, appleMobile: true, homeScreen: 'home-screen-app', persistentBrowserStorage: true };
    renderDialog();
    expect(optionTitles()).toEqual(['Keep in this browser']);
    expect(screen.queryByText('Download project')).toBeNull();
    openMore();
    expect(optionTitles()).toEqual(['Keep in this browser', 'Download a backup', 'Ask to keep it']);
    expect(screen.getByText(/Home Screen app: Safari keeps this app’s data/)).toBeTruthy();
  });

  it('makes Save to a folder the one big action on desktop Chrome and saves there', async () => {
    state.environment = { ...state.environment, folderPicker: true, persistentBrowserStorage: true };
    state.saveToFolder.mockResolvedValue({ status: 'saved', removedTemporary: true });
    const onProjectChanged = vi.fn();
    renderDialog({}, { onProjectChanged });
    expect(screen.getByRole('heading').textContent).toBe('This project is only temporary');
    expect(optionTitles()).toEqual(['Save to a folder']);
    expect(document.querySelector('.save-permanently-primary')?.textContent).toMatch(/^Save to a folder/);
    expect(screen.queryByText(/Home Screen/)).toBeNull();
    openMore();
    expect(optionTitles()).toEqual(['Save to a folder', 'Keep in this browser', 'Download a backup', 'Ask to keep it']);
    fireEvent.click(document.querySelector('.save-permanently-primary')!);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('✓ Saved. "Stage Show" is safe in the chosen folder.'));
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(state.saveToFolder).toHaveBeenCalledWith('Stage Show', expect.any(Function));
    expect(onProjectChanged).toHaveBeenCalledOnce();
  });

  it('says nothing was removed when the folder save did not happen (cancelled or failed after picking)', async () => {
    state.environment = { ...state.environment, folderPicker: true };
    state.saveToFolder.mockResolvedValue({ status: 'cancelled' });
    renderDialog();
    fireEvent.click(document.querySelector('.save-permanently-primary')!);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not saved to a folder. Nothing was removed.'));
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('advises only offered destinations when the browser refuses to keep data', async () => {
    state.persistGranted = false;
    // Desktop Firefox/Safari: no folder picker, so no folder advice.
    renderDialog();
    openMore();
    fireEvent.click(screen.getByText('Ask to keep it'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The browser said no. Download a backup.'));
    cleanup();
    state.environment = { ...state.environment, folderPicker: true };
    renderDialog();
    openMore();
    fireEvent.click(screen.getByText('Ask to keep it'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The browser said no. Save to a folder or download a backup.'));
    cleanup();
    state.environment = { ...state.environment, folderPicker: false, appleMobile: true, homeScreen: 'browser-tab' };
    renderDialog();
    openMore();
    fireEvent.click(screen.getByText('Ask to keep it'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The browser said no. Use the Home Screen app or download a backup.'));
  });

  it('does not advise a backup button the safe state no longer shows after a non-persisted browser save', async () => {
    state.environment.persistentBrowserStorage = true;
    state.moveActive.mockResolvedValue({ from: 'Stage Show', to: 'Stage Show', removedTemporary: true, persisted: false });
    renderDialog();
    fireEvent.click(screen.getByText('Keep in this browser'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('✓ Saved in this browser.'));
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
    expect(optionTitles()).toEqual(['Download project file']);
    fireEvent.click(screen.getByText('Download project file'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Downloaded "Stage Show\.msproj"\. Open it via Open Project → Import/));
    expect(state.download).toHaveBeenCalledWith('Stage Show');
  });

  it('moves projects left in temporary storage when this tab can store permanently', async () => {
    state.environment.persistentBrowserStorage = true;
    state.moveOne.mockImplementation(async (name: string) => ({ from: name, to: name, removedTemporary: true }));
    const { rerender } = renderDialog({ activeTemporary: false, temporaryProjects: ['A', 'B'] });
    expect(screen.getByRole('heading').textContent).toBe('Some projects are still temporary');
    expect(optionTitles()).toEqual(['Move 2 projects to permanent storage']);
    fireEvent.click(screen.getByText('Move 2 projects to permanent storage'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Moved 2 projects/));
    expect(state.moveOne.mock.calls).toEqual([['A'], ['B']]);
    // Once the status refreshed, nothing is at risk any more.
    rerender(<SavePermanentlyDialog status={status({ activeTemporary: false, temporaryProjects: [] })} projectName="Stage Show" onClose={vi.fn()}
      createProject={vi.fn()} createBrowserStorageCopy={vi.fn()} onProjectChanged={vi.fn()} />);
    expect(screen.getByRole('heading').textContent).toBe('Your project is safe');
  });

  it('moves the open project through the project core copy', async () => {
    state.environment.persistentBrowserStorage = true;
    state.moveActive.mockResolvedValue({ from: 'Stage Show', to: 'Stage Show', removedTemporary: true, persisted: true });
    const createBrowserStorageCopy = vi.fn();
    renderDialog({}, { createBrowserStorageCopy });
    fireEvent.click(screen.getByText('Keep in this browser'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('✓ Saved. Your project is safe in this browser.'));
    expect(state.moveActive).toHaveBeenCalledWith(createBrowserStorageCopy);
  });

  it('lists leftovers without offering their move while this tab still uses the temporary store', () => {
    state.environment.persistentBrowserStorage = true;
    renderDialog({ temporaryProjects: ['A', 'B'] });
    openMore();
    expect(screen.queryByText(/^Move 2/)).toBeNull();
    expect(screen.getByText(/Also temporary: A, B\..*once this project is in the browser/)).toBeTruthy();
  });

  it('keeps the disclosure keyboard accessible and focus inside the dialog', () => {
    state.environment = { ...state.environment, folderPicker: true };
    renderDialog();
    const toggle = screen.getByRole('button', { name: /More options/ });
    expect(toggle.tagName).toBe('BUTTON');
    toggle.focus();
    fireEvent.click(toggle);
    const group = screen.getByRole('group', { name: 'More options' });
    expect(toggle.getAttribute('aria-controls')).toBe(group.id);
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    // A pointer activation blurs the control; Tab from <body> still lands inside the dialog.
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it('closes on Escape even when a pointer activation left focus on the page', () => {
    const onClose = vi.fn();
    renderDialog({}, { onClose });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
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
