import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  files: [] as Array<Record<string, unknown>>,
  handles: new Map<string, FileSystemHandle>(),
  projectData: {
    mediaSourceFolders: undefined as string[] | undefined,
    mediaSourceRoots: undefined as Array<{ id: string; name: string }> | undefined,
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => ({ files: mocks.files }),
    setState: (update: (state: { files: Array<Record<string, unknown>> }) => {
      files: Array<Record<string, unknown>>;
    }) => {
      mocks.files = update({ files: mocks.files }).files;
    },
  },
}));

vi.mock('../../src/services/fileSystemService', () => ({
  fileSystemService: { getFileHandle: vi.fn(() => null) },
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
    updateProjectData: (updates: typeof mocks.projectData) => Object.assign(mocks.projectData, updates),
  },
}));

import { connectCurrentProjectMediaSourceFiles } from '../../src/services/project/mediaSourceRootConnection';

describe('mobile media source root connection', () => {
  beforeEach(() => {
    mocks.files = [{
      id: 'media-1',
      name: 'Clip A.mov',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: 'blob:current',
    }];
    mocks.handles.clear();
    mocks.projectData.mediaSourceFolders = undefined;
    mocks.projectData.mediaSourceRoots = undefined;
  });

  it('indexes iPhone and iPad Files selections without a persistent handle', () => {
    const file = new File(['video'], 'Clip A.mov', { type: 'video/quicktime' });
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: 'Rushes/Day 1/Clip A.mov',
    });

    const result = connectCurrentProjectMediaSourceFiles([file]);

    expect(result).toMatchObject({ linkedMediaCount: 1, rootName: 'Rushes' });
    expect(mocks.files[0]).toMatchObject({
      filePath: 'Day 1/Clip A.mov',
      sourceRelativePath: 'Day 1/Clip A.mov',
      sourceRootId: result?.rootId,
    });
    expect(mocks.projectData.mediaSourceRoots).toEqual([{ id: result?.rootId, name: 'Rushes' }]);
    expect(mocks.handles.size).toBe(0);
  });

  it('rejects ordinary file selections that do not expose a folder path', () => {
    const file = new File(['video'], 'Clip A.mov', { type: 'video/quicktime' });

    expect(connectCurrentProjectMediaSourceFiles([file])).toBeNull();
    expect(mocks.projectData.mediaSourceRoots).toBeUndefined();
  });
});
