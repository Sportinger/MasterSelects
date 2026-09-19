import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handles: new Map<string, FileSystemHandle>(),
  projectData: {
    mediaSourceFolders: undefined as string[] | undefined,
    mediaSourceRoots: undefined as Array<{ id: string; name: string }> | undefined,
  },
  updateProjectData: vi.fn(),
}));

vi.mock('../../src/services/projectDB', () => ({
  projectDB: {
    getStoredHandle: vi.fn(async (key: string) => mocks.handles.get(key)),
    storeHandle: vi.fn(async (key: string, handle: FileSystemHandle) => {
      mocks.handles.set(key, handle);
    }),
  },
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    getProjectData: () => mocks.projectData,
    updateProjectData: (updates: typeof mocks.projectData) => {
      Object.assign(mocks.projectData, updates);
      mocks.updateProjectData(updates);
    },
  },
}));

import {
  normalizeProjectSourceRelativePath,
  readProjectMediaSourceFile,
  registerProjectMediaSourceRoot,
  registerProjectMediaSourceRootDescriptor,
  resolveProjectMediaSourceLocation,
} from '../../src/services/project/mediaSourceRoots';

function fileHandle(name: string, contents = 'media'): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: vi.fn(async () => new File([contents], name)),
    isSameEntry: vi.fn(async (other: FileSystemHandle) => other.name === name),
  } as unknown as FileSystemFileHandle;
}

function directoryHandle(
  name: string,
  options: {
    directories?: Record<string, FileSystemDirectoryHandle>;
    files?: Record<string, FileSystemFileHandle>;
    resolvedPath?: string[] | null;
  } = {},
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: vi.fn(async (childName: string) => {
      const child = options.directories?.[childName];
      if (!child) throw new DOMException('Missing directory', 'NotFoundError');
      return child;
    }),
    getFileHandle: vi.fn(async (childName: string) => {
      const child = options.files?.[childName];
      if (!child) throw new DOMException('Missing file', 'NotFoundError');
      return child;
    }),
    isSameEntry: vi.fn(async (other: FileSystemHandle) => other === root),
    queryPermission: vi.fn(async () => 'granted' as PermissionState),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
    resolve: vi.fn(async () => options.resolvedPath ?? null),
  } as unknown as FileSystemDirectoryHandle;
}

let root: FileSystemDirectoryHandle;

describe('media source roots', () => {
  beforeEach(() => {
    mocks.handles.clear();
    mocks.projectData.mediaSourceFolders = undefined;
    mocks.projectData.mediaSourceRoots = undefined;
    mocks.updateProjectData.mockClear();
    root = directoryHandle('Rushes');
  });

  it('keeps safe relative paths and rejects traversal', () => {
    expect(normalizeProjectSourceRelativePath('Day 1\\Camera A\\clip.mp4')).toBe('Day 1/Camera A/clip.mp4');
    expect(normalizeProjectSourceRelativePath('../private/clip.mp4')).toBeNull();
    expect(normalizeProjectSourceRelativePath('')).toBeNull();
  });

  it('stores a source-root descriptor in the project and its handle in IndexedDB', async () => {
    const registered = await registerProjectMediaSourceRoot(root);

    expect(registered.name).toBe('Rushes');
    expect(registered.id).toMatch(/^source-root:/);
    expect(mocks.handles.get(`media_source_root:${registered.id}`)).toBe(root);
    expect(mocks.projectData.mediaSourceFolders).toEqual(['Rushes']);
    expect(mocks.projectData.mediaSourceRoots).toEqual([registered]);
  });

  it('reuses the project root id after browser storage was cleared', async () => {
    mocks.projectData.mediaSourceRoots = [{ id: 'source-root:known', name: 'Rushes' }];

    const registered = await registerProjectMediaSourceRoot(root);

    expect(registered.id).toBe('source-root:known');
    expect(mocks.handles.get('media_source_root:source-root:known')).toBe(root);
  });

  it('stores a path-only source root for the iPhone and iPad Files picker', () => {
    const registered = registerProjectMediaSourceRootDescriptor('Rushes');

    expect(registered.name).toBe('Rushes');
    expect(mocks.projectData.mediaSourceRoots).toEqual([registered]);
    expect(mocks.handles.size).toBe(0);
  });

  it('resolves an imported file relative to a connected root', async () => {
    const clipHandle = fileHandle('clip.mp4');
    root = directoryHandle('Rushes', { resolvedPath: ['Day 1', 'Camera A', 'clip.mp4'] });
    const registered = await registerProjectMediaSourceRoot(root);

    await expect(resolveProjectMediaSourceLocation(clipHandle)).resolves.toEqual({
      sourceRootId: registered.id,
      sourceRelativePath: 'Day 1/Camera A/clip.mp4',
    });
  });

  it('reopens a saved relative path through the stored root handle', async () => {
    const clipHandle = fileHandle('clip.mp4', 'frames');
    const camera = directoryHandle('Camera A', { files: { 'clip.mp4': clipHandle } });
    const day = directoryHandle('Day 1', { directories: { 'Camera A': camera } });
    root = directoryHandle('Rushes', { directories: { 'Day 1': day } });
    const registered = await registerProjectMediaSourceRoot(root);

    const restored = await readProjectMediaSourceFile(
      registered.id,
      'Day 1/Camera A/clip.mp4',
    );

    expect(restored?.handle).toBe(clipHandle);
    expect(restored?.file.name).toBe('clip.mp4');
    expect(restored?.file.size).toBe(6);
  });
});
