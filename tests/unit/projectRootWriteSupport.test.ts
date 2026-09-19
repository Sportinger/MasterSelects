import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFsaProjectPackage } from '../../src/services/project/core/projectCorePersistence';
import type { ProjectPackageSession } from '../../src/services/project/core/projectPackage';
import type { ProjectFile } from '../../src/services/project/types';
import { ProjectCoreService } from '../../src/services/project/core/ProjectCoreService';
import { fileStorageService } from '../../src/services/project/core/FileStorageService';
import { acquireProjectRoot, getProjectWriteSupportError, resolveProjectRootMode } from '../../src/services/project/core/projectRootAccess';

afterEach(() => vi.unstubAllGlobals());

it('does not report an inaccessible browser project root as an empty project list', async () => {
  vi.stubGlobal('showDirectoryPicker', undefined);
  vi.stubGlobal('showSaveFilePicker', undefined);
  const denial = new DOMException('Storage access denied', 'SecurityError');
  const getDirectory = vi.fn().mockRejectedValue(denial);
  vi.stubGlobal('navigator', { storage: { getDirectory } });
  const core = new ProjectCoreService(fileStorageService);
  await expect(core.listStoredProjects()).rejects.toBe(denial);
  getDirectory.mockResolvedValue({ values: async function* () {} });
  await expect(core.listStoredProjects()).resolves.toEqual([]);
  getDirectory.mockResolvedValue({ values: async function* () {
    yield { kind: 'directory', name: 'Partial listing' };
    throw denial;
  } });
  await expect(core.listStoredProjects()).rejects.toBe(denial);
});

it('keeps picker cancellation distinct from a denied project listing', async () => {
  const picker = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  vi.stubGlobal('showDirectoryPicker', picker);
  await expect(acquireProjectRoot('fsa', { throwOnFailure: true })).resolves.toBeNull();
  const denied = new DOMException('Denied', 'NotAllowedError');
  picker.mockRejectedValue(denied);
  await expect(acquireProjectRoot('fsa', { throwOnFailure: true })).rejects.toBe(denied);
});

describe('read-only OPFS project creation', () => {
  it('rejects creation before accessing storage or creating a project directory', async () => {
    vi.stubGlobal('showDirectoryPicker', undefined);
    vi.stubGlobal('showSaveFilePicker', undefined);
    vi.stubGlobal('FileSystemFileHandle', class {});
    const getDirectoryHandle = vi.fn();
    const getDirectory = vi.fn(async () => ({ getDirectoryHandle }));
    vi.stubGlobal('navigator', { storage: { getDirectory } });
    const core = new ProjectCoreService(fileStorageService);
    expect(await core.createProject('Unsupported write audit')).toBe(false);
    expect(getDirectory).not.toHaveBeenCalled();
    expect(getDirectoryHandle).not.toHaveBeenCalled();
    expect(resolveProjectRootMode()).toBe('opfs');
  });

  it('does not create folders when an existing root is passed on read-only OPFS', async () => {
    vi.stubGlobal('showDirectoryPicker', undefined);
    vi.stubGlobal('showSaveFilePicker', undefined);
    vi.stubGlobal('FileSystemFileHandle', class {});
    vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn() } });
    const getDirectoryHandle = vi.fn();
    const core = new ProjectCoreService(fileStorageService);
    expect(await core.createProjectInFolder({ getDirectoryHandle } as unknown as FileSystemDirectoryHandle, 'Unsupported')).toBe(false);
    expect(getDirectoryHandle).not.toHaveBeenCalled();
  });
});


it('accepts writable OPFS without excluding read-only OPFS from discovery', () => {
  vi.stubGlobal('showDirectoryPicker', undefined);
  vi.stubGlobal('showSaveFilePicker', undefined);
  vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn() } });
  vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
  expect(resolveProjectRootMode()).toBe('opfs');
  expect(getProjectWriteSupportError()).toBeNull();
});


it('rejects direct package migration before creating an empty package file', async () => {
  vi.stubGlobal('showDirectoryPicker', undefined);
  vi.stubGlobal('showSaveFilePicker', undefined);
  vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn() } });
  vi.stubGlobal('FileSystemFileHandle', class {});
  const getFileHandle = vi.fn();
  await expect(writeFsaProjectPackage(
    { getFileHandle } as unknown as FileSystemDirectoryHandle,
    {} as ProjectPackageSession,
    {} as ProjectFile,
  )).rejects.toMatchObject({ name: 'NotSupportedError' });
  expect(getFileHandle).not.toHaveBeenCalled();
});
