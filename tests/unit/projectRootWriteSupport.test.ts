import { afterEach, describe, expect, it, vi } from 'vitest';
// ProjectCoreService sits in an import cycle with the project service barrel; load the
// barrel first, as the app does, so the class is initialized before its singleton uses it.
import '../../src/services/project';
import { writeFsaProjectPackage } from '../../src/services/project/core/projectCorePersistence';
import type { ProjectPackageSession } from '../../src/services/project/core/projectPackage';
import type { ProjectFile } from '../../src/services/project/types';
import { ProjectCoreService } from '../../src/services/project/core/ProjectCoreService';
import { NativeProjectCoreService } from '../../src/services/project/core/NativeProjectCoreService';
import { NativeHelperClient } from '../../src/services/nativeHelper/NativeHelperClient';
import { fileStorageService } from '../../src/services/project/core/FileStorageService';
import { acquireProjectRoot, getProjectWriteSupportError, resolveProjectRootMode } from '../../src/services/project/core/projectRootAccess';

vi.mock('../../src/services/nativeHelper/NativeHelperClient', () => ({
  NativeHelperClient: {
    isConnected: vi.fn(() => false), getProjectRoot: vi.fn(async () => null),
    grantPath: vi.fn(async () => true), createDir: vi.fn(async () => false),
  },
}));

afterEach(() => vi.unstubAllGlobals());

it('reports native storage failures rather than treating them as dismissed pickers', async () => {
  const root = vi.spyOn(NativeHelperClient, 'getProjectRoot').mockResolvedValue(null);
  const grant = vi.spyOn(NativeHelperClient, 'grantPath').mockResolvedValue(true);
  const create = vi.spyOn(NativeHelperClient, 'createDir').mockResolvedValue(false);
  try {
    const core = new NativeProjectCoreService();
    await expect(core.createProject('Local test')).rejects.toMatchObject({ name: 'RepositoryError', code: 'io' });
    await expect(core.createProjectAtPath('/tmp/local-test', 'Local test')).rejects.toMatchObject({ name: 'RepositoryError', code: 'io' });
  } finally { root.mockRestore(); grant.mockRestore(); create.mockRestore(); }
});

it.each(['AbortError', 'UnknownError'])('recovers an OPFS root after transient %s without recreating projects', async name => {
  const root = { name: 'existing-storage' } as FileSystemDirectoryHandle;
  const getDirectory = vi.fn().mockRejectedValueOnce(new DOMException('Storage process resuming', name))
    .mockResolvedValueOnce(root);
  vi.stubGlobal('navigator', { storage: { getDirectory } });
  expect(await acquireProjectRoot('opfs', { throwOnFailure: true })).toBe(root);
  expect(getDirectory).toHaveBeenCalledTimes(2);
});

it('bounds OPFS recovery and preserves permission errors without retrying them', async () => {
  const unavailable = new DOMException('Unavailable', 'UnknownError');
  const getDirectory = vi.fn().mockRejectedValue(unavailable);
  vi.stubGlobal('navigator', { storage: { getDirectory } });
  await expect(acquireProjectRoot('opfs', { throwOnFailure: true })).rejects.toBe(unavailable);
  expect(getDirectory).toHaveBeenCalledTimes(2);
  getDirectory.mockClear().mockRejectedValue(new DOMException('Denied', 'SecurityError'));
  await expect(acquireProjectRoot('opfs', { throwOnFailure: true })).rejects.toMatchObject({ name: 'SecurityError' });
  expect(getDirectory).toHaveBeenCalledOnce();
});

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

it('propagates project picker failures through create/open while preserving true cancellation', async () => {
  const picker = vi.fn().mockRejectedValue(new DOMException('User dismissed picker', 'AbortError'));
  vi.stubGlobal('showDirectoryPicker', picker);
  vi.stubGlobal('showSaveFilePicker', vi.fn());
  const core = new ProjectCoreService(fileStorageService);
  await expect(core.createProject('Local test')).resolves.toBe(false);
  await expect(core.openProject()).resolves.toBe(false);
  const denied = new DOMException('Denied', 'NotAllowedError');
  picker.mockRejectedValue(denied);
  await expect(core.createProject('Local test')).rejects.toBe(denied);
  await expect(core.openProject()).rejects.toBe(denied);
});

it('propagates an inaccessible writable OPFS root instead of calling it a cancellation', async () => {
  vi.stubGlobal('showDirectoryPicker', undefined);
  vi.stubGlobal('showSaveFilePicker', undefined);
  vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
  const denied = new DOMException('Denied', 'SecurityError');
  vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn().mockRejectedValue(denied) } });
  const core = new ProjectCoreService(fileStorageService);
  await expect(core.createProject('Local test')).rejects.toBe(denied);
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
    await expect(core.createProject('Unsupported write audit')).rejects.toMatchObject({ name: 'RepositoryError', code: 'unsupported' });
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
    await expect(core.createProjectInFolder({ getDirectoryHandle } as unknown as FileSystemDirectoryHandle, 'Unsupported')).rejects.toMatchObject({ name: 'RepositoryError', code: 'unsupported' });
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
