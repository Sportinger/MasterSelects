import { describe, expect, it, vi } from 'vitest';
import { ProjectCoreService } from '../../src/services/project/core/ProjectCoreService';
import type { ProjectFile } from '../../src/services/project/types';

type TestProjectCoreService = ProjectCoreService & {
  projectHandle: FileSystemDirectoryHandle;
  projectData: ProjectFile;
  saveKeysFile: () => Promise<void>;
};

function createProjectData(): ProjectFile {
  return {
    version: 1,
    name: 'Save Queue Test',
    createdAt: '2026-04-27T00:00:00.000Z',
    updatedAt: '2026-04-27T00:00:00.000Z',
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
    },
    media: [],
    compositions: [],
    folders: [],
    activeCompositionId: null,
    openCompositionIds: [],
    expandedFolderIds: [],
  };
}

function createService(createWritable: FileSystemFileHandle['createWritable']): ProjectCoreService {
  const service = new ProjectCoreService({} as never) as TestProjectCoreService;
  const fileHandle = { createWritable } as FileSystemFileHandle;
  service.projectHandle = {
    getFileHandle: vi.fn(async () => fileHandle),
  } as unknown as FileSystemDirectoryHandle;
  service.projectData = createProjectData();
  service.saveKeysFile = vi.fn(async () => undefined);
  return service;
}

describe('ProjectCoreService save queue', () => {
  it('serializes concurrent project.json writes', async () => {
    let activeWriters = 0;
    let maxActiveWriters = 0;

    const createWritable = vi.fn(async () => {
      activeWriters += 1;
      maxActiveWriters = Math.max(maxActiveWriters, activeWriters);
      if (activeWriters > 1) {
        throw new Error('concurrent writer');
      }

      return {
        write: vi.fn(async () => undefined),
        close: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeWriters -= 1;
        }),
      } as unknown as FileSystemWritableFileStream;
    });

    const service = createService(createWritable);
    service.markDirty();

    const [firstSaved, secondSaved] = await Promise.all([
      service.saveProject(),
      service.saveProject(),
    ]);

    expect(firstSaved).toBe(true);
    expect(secondSaved).toBe(true);
    expect(maxActiveWriters).toBe(1);
    expect(createWritable).toHaveBeenCalledTimes(2);
  });

  it('keeps the project dirty when a change lands during an active save', async () => {
    let markedDirtyDuringSave = false;

    const createWritable = vi.fn(async () => ({
      write: vi.fn(async () => {
        if (!markedDirtyDuringSave) {
          markedDirtyDuringSave = true;
          service.markDirty();
        }
      }),
      close: vi.fn(async () => undefined),
    } as unknown as FileSystemWritableFileStream));

    const service = createService(createWritable);
    service.markDirty();

    const saved = await service.saveProject();

    expect(saved).toBe(true);
    expect(service.hasUnsavedChanges()).toBe(true);
  });

  it('falls back to project.autosave.json when project.json swap creation fails', async () => {
    const projectWritable = {
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as FileSystemWritableFileStream;
    const autosaveWritable = {
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as FileSystemWritableFileStream;
    const projectFileHandle = {
      createWritable: vi.fn(async () => {
        throw new DOMException(
          "Failed to execute 'createWritable' on 'FileSystemFileHandle': Failed to create swap file.",
          'AbortError',
        );
      }),
    } as unknown as FileSystemFileHandle;
    const autosaveFileHandle = {
      createWritable: vi.fn(async () => autosaveWritable),
    } as unknown as FileSystemFileHandle;
    const service = new ProjectCoreService({} as never) as TestProjectCoreService;
    service.projectHandle = {
      getFileHandle: vi.fn(async (name: string) => (
        name === 'project.autosave.json' ? autosaveFileHandle : projectFileHandle
      )),
    } as unknown as FileSystemDirectoryHandle;
    service.projectData = createProjectData();
    service.saveKeysFile = vi.fn(async () => undefined);

    service.markDirty();
    const saved = await service.saveProject();

    expect(saved).toBe(true);
    expect(projectFileHandle.createWritable).toHaveBeenCalledTimes(3);
    expect(autosaveFileHandle.createWritable).toHaveBeenCalledTimes(1);
    expect(projectWritable.write).not.toHaveBeenCalled();
    expect(autosaveWritable.write).toHaveBeenCalledTimes(1);
  });
});
