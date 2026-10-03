import { beforeEach, describe, expect, it, vi } from 'vitest';

// Saving no longer writes project.json/.msproj packages from ProjectCoreService: domain
// transactions are journaled by the repository writer, and an explicit save waits for the
// repository flush receipt. Journal queueing, coalescing and retry are covered by the
// repository tests (repositoryCoordinator, repositoryJournalCoalescing, repositoryPersistence).
const repo = vi.hoisted(() => ({
  session: null as null | { opening: { writable: boolean } },
  scratch: false,
  dirty: false,
  flushEditorRepository: vi.fn(),
  updateEditorRepositoryProjectFields: vi.fn(),
}));
vi.mock('../../src/services/project/repository/lifecycle/repositoryProjectOperations', () => ({
  createRepositoryAt: vi.fn(async () => undefined),
  openRepositoryProject: vi.fn(async () => undefined),
  renameRepositoryProject: vi.fn(async () => true),
  createIndependentProjectBackup: vi.fn(async () => true),
  repositoryHasUnsavedChanges: () => repo.dirty,
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  closeEditorRepository: vi.fn(async () => undefined),
  flushEditorRepository: repo.flushEditorRepository,
  getActiveRepositorySession: () => repo.session,
  readEditorRepositoryProject: () => null,
  isScratchRepository: () => repo.scratch,
}));
vi.mock('../../src/services/project/repository/lifecycle/repositoryLocations', () => ({
  directoryForOpfs: vi.fn(),
  isLegacyProjectLocation: vi.fn(async () => false),
}));
vi.mock('../../src/services/project/repository/transaction/editorRepositorySession', () => ({
  updateEditorRepositoryProjectFields: repo.updateEditorRepositoryProjectFields,
}));
vi.mock('../../src/services/project/legacyImportTarget', () => ({ requestLegacyImportTarget: vi.fn() }));
vi.mock('../../src/services/project/androidProjectAutoRestore', () => ({ isAndroidAutoRestoreProjectHandle: () => false }));
vi.mock('../../src/services/project/mediaSourceRootAccess', () => ({ requestMediaSourceRootAccess: vi.fn() }));

import { ProjectCoreService } from '../../src/services/project/core/ProjectCoreService';
import { fileStorageService } from '../../src/services/project/core/FileStorageService';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import type { ProjectMediaFile } from '../../src/services/project/types';

function createService(): ProjectCoreService {
  return new ProjectCoreService(fileStorageService);
}

describe('ProjectCoreService repository save contract', () => {
  beforeEach(() => {
    repo.session = { opening: { writable: true } };
    repo.scratch = false;
    repo.dirty = false;
    repo.flushEditorRepository.mockReset().mockResolvedValue(true);
    repo.updateEditorRepositoryProjectFields.mockReset();
  });

  it('reports a save only after the repository flush receipt and then clears unsaved changes', async () => {
    const service = createService();
    repo.dirty = true;
    let confirm!: (saved: boolean) => void;
    repo.flushEditorRepository.mockReturnValueOnce(new Promise<boolean>(resolve => { confirm = resolve; }));

    const saving = service.saveProject();
    expect(repo.flushEditorRepository).toHaveBeenCalledTimes(1);
    expect(service.hasUnsavedChanges()).toBe(true);

    // The writer confirms the journal; the repository no longer reports pending records.
    repo.dirty = false;
    confirm(true);
    await expect(saving).resolves.toBe(true);
    expect(service.hasUnsavedChanges()).toBe(false);
  });

  it('does not report a denied or failed repository flush as saved', async () => {
    const service = createService();
    repo.dirty = true;
    repo.flushEditorRepository.mockRejectedValueOnce(new RepositoryError('ownership', 'Read-only project cannot publish a save'));

    await expect(service.saveProject()).rejects.toMatchObject({ code: 'ownership' });
    expect(service.hasUnsavedChanges()).toBe(true);

    // A later retry succeeds once the writer recovers.
    repo.dirty = false;
    await expect(service.saveProject()).resolves.toBe(true);
    expect(service.hasUnsavedChanges()).toBe(false);
  });

  it('keeps the project dirty when a change lands during an active save', async () => {
    const service = createService();
    repo.dirty = true;
    repo.flushEditorRepository.mockImplementationOnce(async () => {
      // An edit is journaled after the flush captured its sequence.
      repo.dirty = true;
      return true;
    });

    await expect(service.saveProject()).resolves.toBe(true);
    expect(service.hasUnsavedChanges()).toBe(true);
  });

  it('never writes in response to dirty marks', () => {
    const service = createService();
    service.markDirty();
    service.markDirty();
    expect(repo.flushEditorRepository).not.toHaveBeenCalled();
  });

  it('treats only a non-scratch repository session as an open project', () => {
    const service = createService();
    expect(service.isProjectOpen()).toBe(true);
    repo.scratch = true;
    expect(service.isProjectOpen()).toBe(false);
    repo.scratch = false;
    repo.session = null;
    expect(service.isProjectOpen()).toBe(false);
  });

  it('routes project field updates into the active repository session only', () => {
    const service = createService();
    const media = [{ id: 'media-1', name: 'clip.mp4' }] as ProjectMediaFile[];
    service.updateMedia(media);
    expect(repo.updateEditorRepositoryProjectFields).toHaveBeenCalledWith(repo.session, { media });

    repo.session = null;
    service.updateFolders([]);
    expect(repo.updateEditorRepositoryProjectFields).toHaveBeenCalledTimes(1);
  });
});
