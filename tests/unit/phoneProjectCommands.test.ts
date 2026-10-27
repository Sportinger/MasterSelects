import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBlankProject: vi.fn(),
  openStoredProject: vi.fn(),
  openProjectArchive: vi.fn(),
  saveCurrentProject: vi.fn(),
  listStoredProjects: vi.fn(),
  getRecentProjects: vi.fn(),
  getProjectData: vi.fn(),
  renameProject: vi.fn(),
  resolveProjectRootMode: vi.fn(),
  getProjectWriteSupportError: vi.fn(),
  updateComposition: vi.fn(),
  media: {
    activeCompositionId: 'old-comp' as string | null,
    compositions: [] as Array<{ id: string; width: number; height: number; frameRate: number }>,
  },
}));

vi.mock('../../src/services/projectSync', () => ({
  createBlankProject: mocks.createBlankProject,
  openStoredProject: mocks.openStoredProject,
  openProjectArchive: mocks.openProjectArchive,
  saveCurrentProject: mocks.saveCurrentProject,
}));

vi.mock('../../src/services/projectFileService', () => ({
  RECENT_PROJECTS_CHANGED_EVENT: 'masterselects-recent-projects-changed',
  projectFileService: {
    listStoredProjects: mocks.listStoredProjects,
    getRecentProjects: mocks.getRecentProjects,
    getProjectData: mocks.getProjectData,
    renameProject: mocks.renameProject,
  },
}));

vi.mock('../../src/services/project/core/projectRootAccess', () => ({
  resolveProjectRootMode: mocks.resolveProjectRootMode,
  getProjectWriteSupportError: mocks.getProjectWriteSupportError,
}));

vi.mock('../../src/services/project/core/browserStorageRoot', () => ({
  isBrowserStorageFallbackActive: () => false,
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => ({
      activeCompositionId: mocks.media.activeCompositionId,
      compositions: mocks.media.compositions,
      updateComposition: mocks.updateComposition,
    }),
  },
}));

import {
  createPhoneProject,
  importPhoneProjectArchive,
  listPhoneProjects,
  openPhoneProject,
  renamePhoneProject,
} from '../../src/components/mobileSkin/project/usePhoneProjectCommands';

beforeEach(() => {
  mocks.media.activeCompositionId = 'old-comp';
  mocks.resolveProjectRootMode.mockReturnValue('opfs');
  mocks.getProjectWriteSupportError.mockReturnValue(null);
  mocks.saveCurrentProject.mockResolvedValue(true);
  mocks.createBlankProject.mockImplementation(async (_name: string, options?: { composition?: { width: number; height: number; frameRate: number } }) => {
    // The new project activates its own composition, created with the requested canvas.
    mocks.media.activeCompositionId = 'new-comp';
    mocks.media.compositions = [{ id: 'new-comp', ...(options?.composition ?? { width: 1920, height: 1080, frameRate: 30 }) }];
    return 'created';
  });
  mocks.getRecentProjects.mockReturnValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('phone project commands', () => {
  it('creates the project with the portrait canvas in its first revision, not as an undoable edit', async () => {
    const result = await createPhoneProject('  Rehearsal ', '9:16');

    expect(result).toEqual({ ok: true });
    expect(mocks.createBlankProject).toHaveBeenCalledWith('Rehearsal', { composition: { width: 1080, height: 1920, frameRate: 30 } });
    expect(mocks.updateComposition).not.toHaveBeenCalled();
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled();
  });

  it('passes the other formats too', async () => {
    await createPhoneProject('Square', '1:1');
    expect(mocks.createBlankProject).toHaveBeenCalledWith('Square', { composition: { width: 1080, height: 1080, frameRate: 30 } });
  });

  it('falls back to an edit and saves when a storage path ignored the initial canvas', async () => {
    mocks.createBlankProject.mockImplementation(async () => {
      mocks.media.activeCompositionId = 'new-comp';
      mocks.media.compositions = [{ id: 'new-comp', width: 1920, height: 1080, frameRate: 30 }];
      return 'created';
    });
    expect(await createPhoneProject('Rehearsal', '9:16')).toEqual({ ok: true });
    expect(mocks.updateComposition).toHaveBeenCalledWith('new-comp', { width: 1080, height: 1920, frameRate: 30 });
    expect(mocks.saveCurrentProject).toHaveBeenCalledWith({ source: 'manual' });
  });

  it('leaves the open project untouched when nothing was created', async () => {
    mocks.createBlankProject.mockResolvedValue('not-created');
    mocks.getProjectWriteSupportError.mockReturnValue('This browser cannot write projects.');

    const result = await createPhoneProject('Rehearsal', '9:16');

    expect(result).toEqual({ ok: false, message: 'This browser cannot write projects.' });
    expect(mocks.updateComposition).not.toHaveBeenCalled();
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled();
  });

  it('says that no folder was picked on the folder backend', async () => {
    mocks.createBlankProject.mockResolvedValue('not-created');
    mocks.resolveProjectRootMode.mockReturnValue('fsa');
    expect(await createPhoneProject('Rehearsal', '9:16')).toEqual({ ok: false, message: 'No project folder was selected.' });
  });

  it('maps save-failed to a failure without changing the format', async () => {
    mocks.createBlankProject.mockResolvedValue('save-failed');
    const result = await createPhoneProject('Rehearsal', '9:16');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not be saved/);
    expect(mocks.updateComposition).not.toHaveBeenCalled();
  });

  it('turns a thrown creation error into a message', async () => {
    mocks.createBlankProject.mockRejectedValue(new Error('disk gone'));
    expect(await createPhoneProject('Rehearsal', '9:16')).toEqual({ ok: false, message: 'The project could not be created. disk gone' });
  });

  it('rejects invalid names before touching storage', async () => {
    const result = await createPhoneProject('a/b', '9:16');
    expect(result.ok).toBe(false);
    expect(mocks.createBlankProject).not.toHaveBeenCalled();
  });

  it('keeps the project open but warns when the fallback format could not be saved', async () => {
    mocks.createBlankProject.mockImplementation(async () => {
      mocks.media.activeCompositionId = 'new-comp';
      mocks.media.compositions = [{ id: 'new-comp', width: 1920, height: 1080, frameRate: 30 }];
      return 'created';
    });
    mocks.saveCurrentProject.mockResolvedValue(false);
    const result = await createPhoneProject('Rehearsal', '9:16');
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/not saved yet/);
  });

  it('never changes the format when opening an existing project', async () => {
    mocks.openStoredProject.mockResolvedValue(true);
    expect(await openPhoneProject('Old')).toEqual({ ok: true });
    mocks.openStoredProject.mockResolvedValue(false);
    expect(await openPhoneProject('Old')).toEqual({ ok: false, message: '"Old" could not be opened.' });
    expect(mocks.updateComposition).not.toHaveBeenCalled();
  });

  it('renames through the project service with name validation', async () => {
    mocks.getProjectData.mockReturnValue({ name: 'Old' });
    mocks.renameProject.mockResolvedValue(true);
    expect((await renamePhoneProject('New')).ok).toBe(true);
    expect(mocks.renameProject).toHaveBeenCalledWith('New');
    expect((await renamePhoneProject('Old')).ok).toBe(true);
    expect(mocks.renameProject).toHaveBeenCalledTimes(1);
    expect((await renamePhoneProject('')).ok).toBe(false);
    mocks.renameProject.mockResolvedValue(false);
    expect((await renamePhoneProject('Taken')).ok).toBe(false);
  });

  it('only imports .msproj archives', async () => {
    const result = await importPhoneProjectArchive(new File(['x'], 'clip.mp4'));
    expect(result.ok).toBe(false);
    expect(mocks.openProjectArchive).not.toHaveBeenCalled();
    mocks.openProjectArchive.mockResolvedValue(true);
    expect(await importPhoneProjectArchive(new File(['x'], 'Show.msproj'))).toEqual({ ok: true });
  });

  it('lists stored projects with recents first', async () => {
    mocks.listStoredProjects.mockResolvedValue(['B', 'A', 'C']);
    mocks.getRecentProjects.mockReturnValue([
      { id: '1', backend: 'opfs', path: 'C', name: 'C', lastOpenedAt: 200, store: 'opfs' },
      { id: '2', backend: 'opfs', path: 'B', name: 'B', lastOpenedAt: 100, store: 'opfs' },
    ]);
    const projects = await listPhoneProjects();
    expect(projects.map((project) => project.name)).toEqual(['C', 'B', 'A']);
    expect(projects[0]).toEqual({ name: 'C', lastOpened: 200, location: 'Browser local' });
  });
});
