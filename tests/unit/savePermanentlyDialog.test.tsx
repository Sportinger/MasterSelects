import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePermanentSaveDestinations, shouldOfferPermanentSave } from '../../src/services/project/permanentSave/permanentSaveOptions';

const state = vi.hoisted(() => ({
  environment: { checking: false, folderPicker: false, nativeHelper: false, persistentBrowserStorage: false, persistence: false as boolean | 'unsupported' | null, appleMobile: false },
  moveActive: vi.fn(),
  moveOne: vi.fn(),
  saveToFolder: vi.fn(),
  download: vi.fn(),
}));
vi.mock('../../src/components/common/toolbar/useSavePermanentlyEnvironment', () => ({
  useSavePermanentlyEnvironment: () => ({ ...state.environment, requestPersistence: vi.fn(async () => true), recheck: vi.fn() }),
}));
vi.mock('../../src/services/project/permanentSave/browserStorageMigration', () => ({
  moveActiveProjectToPersistentBrowserStorage: () => state.moveActive(),
  moveTemporaryProject: (name: string) => state.moveOne(name),
}));
vi.mock('../../src/services/project/permanentSave/permanentSaveActions', () => ({
  saveActiveProjectToFolder: (name: string, create: unknown) => state.saveToFolder(name, create),
  downloadActiveProjectArchive: (name: string) => state.download(name),
}));
import { SavePermanentlyDialog } from '../../src/components/common/toolbar/SavePermanentlyDialog';
import { ToolbarSavePermanently } from '../../src/components/common/toolbar/ToolbarSavePermanently';

const status = (overrides: Partial<{ activeTemporary: boolean; scratch: boolean; persistentBrowserStorage: boolean; temporaryProjects: string[] }> = {}) => ({
  activeTemporary: true, scratch: false, persistentBrowserStorage: false, temporaryProjects: [] as string[], refresh: vi.fn(), ...overrides,
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

  it('shows the toolbar action for a temporary project or movable leftovers only', () => {
    expect(shouldOfferPermanentSave({ activeTemporary: true, persistentBrowserStorage: false, temporaryProjects: [] })).toBe(true);
    expect(shouldOfferPermanentSave({ activeTemporary: false, persistentBrowserStorage: false, temporaryProjects: ['A'] })).toBe(false);
    expect(shouldOfferPermanentSave({ activeTemporary: false, persistentBrowserStorage: true, temporaryProjects: ['A'] })).toBe(true);
    expect(shouldOfferPermanentSave({ activeTemporary: false, persistentBrowserStorage: true, temporaryProjects: [] })).toBe(false);
  });
});

describe('SavePermanentlyDialog', () => {
  beforeEach(() => {
    state.environment = { checking: false, folderPicker: false, nativeHelper: false, persistentBrowserStorage: false, persistence: false, appleMobile: false };
    for (const mock of [state.moveActive, state.moveOne, state.saveToFolder, state.download]) mock.mockReset();
  });
  afterEach(cleanup);
  const renderDialog = (overrides = {}, props: Partial<Parameters<typeof SavePermanentlyDialog>[0]> = {}) => render(
    <SavePermanentlyDialog status={status(overrides)} projectName="Stage Show" onClose={vi.fn()} createProject={vi.fn()} onProjectChanged={vi.fn()} {...props} />,
  );

  it('offers only the archive on iPad Private Browsing, with the Home Screen note', () => {
    state.environment.appleMobile = true;
    renderDialog();
    expect(screen.getByRole('heading').textContent).toBe('Save this project permanently');
    expect(optionTitles()).toEqual(['Download .msproj archive']);
    expect(screen.getByText(/lands in the Files app/)).toBeTruthy();
    expect(screen.getByText(/opened from the Home Screen/)).toBeTruthy();
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
});
