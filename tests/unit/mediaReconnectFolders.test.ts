import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  roots: [] as unknown[],
  fileAccess: [] as unknown[],
}));

vi.mock('../../src/services/project/mediaSourceRoots', () => ({
  getProjectMediaSourceRootStates: async () => mocks.roots,
  normalizeProjectSourceRelativePath: (value: string | undefined) => value ? value.split('/').filter(Boolean).join('/') || null : null,
}));
vi.mock('../../src/services/project/mediaReconnect', () => ({
  mediaFilesNeedingAccess: async () => mocks.fileAccess,
  offlineMediaFiles: () => [],
}));

import { folderPickerId, offlineMediaFolders } from '../../src/services/project/mediaReconnectFolders';
import type { MediaFile } from '../../src/stores/mediaStore';

const media = (id: string, fields: Partial<MediaFile>) => ({ id, name: id, ...fields }) as MediaFile;

describe('offlineMediaFolders', () => {
  it('groups offline media by remembered folder with its shared subfolder and access state', async () => {
    const stemsHandle = { kind: 'directory', name: 'Ute_Marlene' };
    const fileHandle = { kind: 'file', name: 'Logo.png' };
    mocks.roots = [
      { id: 'root-stems', name: 'Ute_Marlene', handle: stemsHandle, permission: 'prompt' },
      { id: 'root-cams', name: 'Originale', handle: null, permission: 'missing' },
      { id: 'root-ok', name: 'MS UTE 22', handle: { kind: 'directory' }, permission: 'granted' },
    ];
    mocks.fileAccess = [{ mediaId: 'Logo.png', name: 'Logo.png', handle: fileHandle }];

    const folders = await offlineMediaFolders([
      media('T1_MIX_LR.wav', { sourceRootId: 'root-stems', sourceRelativePath: 'Audio_Stems/T1_MIX_LR.wav' }),
      media('T2_UTE_1.wav', { sourceRootId: 'root-stems', sourceRelativePath: 'Audio_Stems/T2_UTE_1.wav' }),
      media('A001.mp4', { sourceRootId: 'root-cams', sourceRelativePath: 'A001.mp4' }),
      media('Gone.mov', { sourceRootId: 'root-ok', sourceRelativePath: 'Media/Gone.mov' }),
      media('Logo.png', { filePath: 'Grafik/Logos/Logo.png' }),
    ]);

    expect(folders.map(({ key, name, subPath, files, access, startIn }) => ({ key, name, subPath, files, access, startIn }))).toEqual([
      { key: 'root-stems', name: 'Ute_Marlene', subPath: 'Audio_Stems', files: ['T1_MIX_LR.wav', 'T2_UTE_1.wav'], access: 'prompt', startIn: stemsHandle },
      { key: 'files:Grafik/Logos', name: 'Logos', subPath: 'Grafik', files: ['Logo.png'], access: 'prompt', startIn: fileHandle },
      { key: 'root-cams', name: 'Originale', subPath: undefined, files: ['A001.mp4'], access: 'missing', startIn: null },
      { key: 'root-ok', name: 'MS UTE 22', subPath: 'Media', files: ['Gone.mov'], access: 'granted', startIn: { kind: 'directory' } },
    ]);
  });

  it('keeps only the subfolder all files of a folder share', async () => {
    mocks.roots = [{ id: 'root', name: 'UTE_SHOW', handle: null, permission: 'missing' }];
    mocks.fileAccess = [];
    const [folder] = await offlineMediaFolders([
      media('a.wav', { sourceRootId: 'root', sourceRelativePath: 'Ute_Marlene/Audio_Stems/a.wav' }),
      media('b.mp4', { sourceRootId: 'root', sourceRelativePath: 'Ute_Marlene/Video/b.mp4' }),
    ]);
    expect(folder!.subPath).toBe('Ute_Marlene');
  });

  it('gives each folder its own valid picker id', () => {
    const id = folderPickerId({ key: 'source-root:5fab3865-fcef-4b3a-ad87-977909b3ec63' });
    expect(id).toBe('ms-media-4b3aad87977909b3ec63');
    expect(id.length).toBeLessThanOrEqual(32);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
