import { describe, expect, it, vi } from 'vitest';

import {
  planDroppedMediaImports,
  type DroppedMediaFileRecord,
  type MediaFolderLike,
} from '../../src/components/panels/media/dropImport';

function createFile(name: string): File {
  return new File(['data'], name, { type: 'video/mp4', lastModified: 1 });
}

describe('planDroppedMediaImports', () => {
  it('creates one media folder per dropped directory and imports all files into it', () => {
    const createFolder = vi.fn((name: string, parentId: string | null): MediaFolderLike => ({
      id: `${parentId ?? 'root'}:${name}`,
      name,
      parentId,
    }));

    const records: DroppedMediaFileRecord[] = [
      { file: createFile('a.mp4'), folderSegments: ['Shoot'] },
      { file: createFile('b.mp4'), folderSegments: ['Shoot'] },
      { file: createFile('root.mp4'), folderSegments: [] },
    ];

    const batches = planDroppedMediaImports(records, [], null, createFolder);

    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(createFolder).toHaveBeenCalledWith('Shoot', null);
    expect(batches).toEqual([
      {
        parentId: 'root:Shoot',
        files: [records[0].file, records[1].file],
        filesWithHandles: [],
      },
      {
        parentId: null,
        files: [records[2].file],
        filesWithHandles: [],
      },
    ]);
  });

  it('reuses existing parent folders and only creates missing nested folders once', () => {
    const createFolder = vi.fn((name: string, parentId: string | null): MediaFolderLike => ({
      id: `${parentId ?? 'root'}:${name}`,
      name,
      parentId,
    }));

    const existingFolders: MediaFolderLike[] = [
      { id: 'folder-clients', name: 'Clients', parentId: null },
    ];

    const records: DroppedMediaFileRecord[] = [
      { file: createFile('day1-a.mp4'), folderSegments: ['Clients', 'Day 1'] },
      { file: createFile('day1-b.mp4'), folderSegments: ['Clients', 'Day 1'] },
    ];

    const batches = planDroppedMediaImports(records, existingFolders, null, createFolder);

    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(createFolder).toHaveBeenCalledWith('Day 1', 'folder-clients');
    expect(batches).toEqual([
      {
        parentId: 'folder-clients:Day 1',
        files: [records[0].file, records[1].file],
        filesWithHandles: [],
      },
    ]);
  });
});
