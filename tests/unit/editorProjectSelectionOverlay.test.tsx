import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProjectSelectionOverlay } from '../../src/components/common/EditorProjectSelectionOverlay';
import { installAppInstallPromptCapture, resetAppInstallPromptForTests } from '../../src/services/pwa/appInstallPrompt';

const mocks = vi.hoisted(() => ({
  createBlankProject: vi.fn(),
  resolveProjectRootMode: vi.fn(),
  getProjectWriteSupportError: vi.fn(),
  getRecentProjects: vi.fn(),
  hasUnsavedChanges: vi.fn(),
  listStoredProjects: vi.fn(),
  loadProjectToStores: vi.fn(),
  openExistingProject: vi.fn(),
  openRecentProject: vi.fn(),
  openStoredProject: vi.fn(),
  needsPermission: vi.fn(),
  getPendingProjectName: vi.fn(),
  resumePendingProject: vi.fn(),
}));

vi.mock('../../src/services/project/core/projectRootAccess', () => ({
  resolveProjectRootMode: mocks.resolveProjectRootMode,
  getProjectWriteSupportError: mocks.getProjectWriteSupportError,
}));

vi.mock('../../src/services/projectFileService', () => ({
  RECENT_PROJECTS_CHANGED_EVENT: 'masterselects-recent-projects-changed',
  projectFileService: {
    getRecentProjects: mocks.getRecentProjects,
    hasUnsavedChanges: mocks.hasUnsavedChanges,
    listStoredProjects: mocks.listStoredProjects,
    openRecentProject: mocks.openRecentProject,
    needsPermission: mocks.needsPermission,
    getPendingProjectName: mocks.getPendingProjectName,
  },
}));

vi.mock('../../src/services/project/pendingProjectResume', () => ({
  resumePendingProject: mocks.resumePendingProject,
}));

vi.mock('../../src/services/projectSync', () => ({
  createBlankProject: mocks.createBlankProject,
  loadProjectToStores: mocks.loadProjectToStores,
  openExistingProject: mocks.openExistingProject,
  openStoredProject: mocks.openStoredProject,
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.resolveProjectRootMode.mockReturnValue('fsa');
  mocks.getProjectWriteSupportError.mockReturnValue(null);
  mocks.createBlankProject.mockResolvedValue('created');
  mocks.getRecentProjects.mockReturnValue([{
    backend: 'fsa',
    id: 'recent-1',
    lastOpenedAt: new Date('2026-08-01T12:00:00Z').getTime(),
    name: 'Interview Cut',
  }]);
  mocks.hasUnsavedChanges.mockReturnValue(false);
  mocks.listStoredProjects.mockResolvedValue([]);
  mocks.loadProjectToStores.mockResolvedValue(undefined);
  mocks.openExistingProject.mockResolvedValue(true);
  mocks.openRecentProject.mockResolvedValue(true);
  mocks.openStoredProject.mockResolvedValue(true);
  mocks.needsPermission.mockReturnValue(false);
  mocks.getPendingProjectName.mockReturnValue(null);
  mocks.resumePendingProject.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('Editor project selection overlay', () => {
  it('offers one-click resume for the last project whose folder access lapsed', async () => {
    mocks.needsPermission.mockReturnValue(true);
    mocks.getPendingProjectName.mockReturnValue('Opera Night');
    const onProjectSelected = vi.fn();
    render(<EditorProjectSelectionOverlay onProjectSelected={onProjectSelected} />);

    const resume = screen.getByRole('button', { name: /Resume “Opera Night”/ });
    expect(screen.getAllByRole('button')[0]).toBe(resume);
    mocks.needsPermission.mockReturnValue(false);
    await act(async () => { fireEvent.click(resume); });
    expect(mocks.resumePendingProject).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(onProjectSelected).toHaveBeenCalledOnce();
  });

  it('keeps the resume action when the browser prompt is declined', async () => {
    mocks.needsPermission.mockReturnValue(true);
    mocks.getPendingProjectName.mockReturnValue('Opera Night');
    mocks.resumePendingProject.mockResolvedValue(false);
    const onProjectSelected = vi.fn();
    render(<EditorProjectSelectionOverlay onProjectSelected={onProjectSelected} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Resume/ })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder access was not allowed');
    expect(screen.getByRole('button', { name: /Resume “Opera Night”/ })).not.toBeDisabled();
    expect(onProjectSelected).not.toHaveBeenCalled();
  });

  it('offers installing the app next to Resume while the browser allows it', () => {
    mocks.needsPermission.mockReturnValue(true);
    mocks.getPendingProjectName.mockReturnValue('Opera Night');
    resetAppInstallPromptForTests();
    installAppInstallPromptCapture();
    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    window.dispatchEvent(offer);
    render(<EditorProjectSelectionOverlay onProjectSelected={() => undefined} />);
    expect(screen.getByText('Install MasterSelects to keep folder access')).toBeInTheDocument();
    resetAppInstallPromptForTests();
  });

  it('shows a storage listing failure instead of claiming no projects exist', async () => {
    mocks.resolveProjectRootMode.mockReturnValue('opfs');
    mocks.listStoredProjects.mockRejectedValue(new DOMException('Storage access denied', 'SecurityError'));
    render(<EditorProjectSelectionOverlay onProjectSelected={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Open existing/i }));
    expect(await screen.findByText('The project could not be opened.')).toBeInTheDocument();
    expect(screen.queryByText('No projects are stored on this device yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open existing/i })).not.toBeDisabled();
  });

  it('uses a simple editor-style chooser with new, existing, and recent projects', () => {
    render(<EditorProjectSelectionOverlay onProjectSelected={() => undefined} />);

    expect(screen.getByRole('dialog', { name: 'Choose project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open existing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Interview Cut/i })).toBeInTheDocument();
    expect(screen.queryByText('Start with AI')).not.toBeInTheDocument();
  });

  it('tells a folder project and its kept temporary copy apart and lists the folder project first', () => {
    mocks.getRecentProjects.mockReturnValue([
      { backend: 'opfs', id: 'temporary', path: 'Show', store: 'indexeddb', lastOpenedAt: new Date('2026-10-21T12:00:00Z').getTime(), name: 'Show' },
      { backend: 'fsa', id: 'folder', handleKey: 'recentProject:folder', lastOpenedAt: new Date('2026-10-21T11:00:00Z').getTime(), name: 'Show' },
      { backend: 'opfs', id: 'browser', path: 'Other', store: 'opfs', lastOpenedAt: new Date('2026-10-20T11:00:00Z').getTime(), name: 'Other' },
    ]);
    render(<EditorProjectSelectionOverlay onProjectSelected={() => undefined} />);

    const recents = screen.getAllByRole('button').filter(button => button.dataset.location);
    expect(recents.map(button => [button.querySelector('strong')?.textContent, button.dataset.location])).toEqual([
      ['Show', 'Folder'], ['Show', 'Temporary'], ['Other', 'Browser local'],
    ]);
    expect(recents[1]).toHaveTextContent(/Temporary · /);
  });

  it('creates a named project and closes only after creation succeeds', async () => {
    const onProjectSelected = vi.fn();
    render(<EditorProjectSelectionOverlay onProjectSelected={onProjectSelected} />);

    fireEvent.click(screen.getByRole('button', { name: /New project/i }));
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Documentary Assembly' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    await waitFor(() => {
      expect(mocks.createBlankProject).toHaveBeenCalledWith('Documentary Assembly');
    });
    expect(onProjectSelected).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(200));
    expect(onProjectSelected).toHaveBeenCalledOnce();
  });

  it('opens a recent project and hydrates the editor before closing', async () => {
    const onProjectSelected = vi.fn();
    render(<EditorProjectSelectionOverlay onProjectSelected={onProjectSelected} />);

    fireEvent.click(screen.getByRole('button', { name: /Interview Cut/i }));

    await waitFor(() => {
      expect(mocks.openRecentProject).toHaveBeenCalledWith('recent-1');
      expect(mocks.loadProjectToStores).toHaveBeenCalledOnce();
    });
    act(() => vi.advanceTimersByTime(200));
    expect(onProjectSelected).toHaveBeenCalledOnce();
  });

  it('opens an existing project folder before revealing the editor', async () => {
    const onProjectSelected = vi.fn();
    render(<EditorProjectSelectionOverlay onProjectSelected={onProjectSelected} />);

    fireEvent.click(screen.getByRole('button', { name: /Open existing/i }));

    await waitFor(() => {
      expect(mocks.openExistingProject).toHaveBeenCalledOnce();
    });
    act(() => vi.advanceTimersByTime(200));
    expect(onProjectSelected).toHaveBeenCalledOnce();
  });

  // Production: the Qualle project failed with only "The project could not be opened." and no log.
  it('names the reason when opening a project folder fails', async () => {
    mocks.resolveProjectRootMode.mockReturnValue('fsa');
    mocks.openExistingProject.mockRejectedValue(new Error('Unknown composition input: sample-energy-value.'));
    render(<EditorProjectSelectionOverlay onProjectSelected={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Open existing/i }));
    expect(await screen.findByText('The project could not be opened. Unknown composition input: sample-energy-value.')).toBeInTheDocument();
  });

  it('shows the recovery reason without hiding the recent project', async () => {
    mocks.openRecentProject.mockRejectedValue(new Error('Saved folder access unavailable. Use Open existing.'));
    render(<EditorProjectSelectionOverlay onProjectSelected={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Interview Cut/i }));
    await waitFor(() => expect(screen.getByText('Saved folder access unavailable. Use Open existing.')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Interview Cut/i })).toBeTruthy();
    expect(mocks.loadProjectToStores).not.toHaveBeenCalled();
  });
});


it('explains missing write support while leaving existing-project access available', async () => {
  mocks.resolveProjectRootMode.mockReturnValue('opfs');
  mocks.getProjectWriteSupportError.mockReturnValue('This browser is missing project-file writing support.');
  mocks.createBlankProject.mockResolvedValue('not-created');
  render(<EditorProjectSelectionOverlay onProjectSelected={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: /New project/i }));
  fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Test project' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('missing project-file writing support'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: /Open existing/i })).toBeEnabled();
});
