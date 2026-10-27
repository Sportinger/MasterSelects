import { describe, expect, it } from 'vitest';
import type { MediaFile, MediaFolder } from '../../src/stores/mediaStore/types';
import {
  checkPhoneLibraryMove, describePhoneMediaInfo, describePhoneMediaUsage, formatPhoneDuration, listPhoneLibraryFolder,
  phoneLibraryFolderTargets, phoneLibraryPath, type PhoneLibrarySource,
} from '../../src/components/mobileSkin/library/phoneLibraryModel';
import { createSelectionSlice, findFolderMoveCycles } from '../../src/stores/mediaStore/slices/selectionSlice';
import type { MediaState } from '../../src/stores/mediaStore/types';

const folder = (id: string, name: string, parentId: string | null = null): MediaFolder => ({ id, name, parentId, isExpanded: true, createdAt: 0 });
const file = (id: string, name: string, parentId: string | null, extra: Partial<MediaFile> = {}): MediaFile => ({
  id, name, parentId, type: 'video', url: 'blob:x', createdAt: 0, file: new File(['x'], name), ...extra,
} as MediaFile);

const folders = [folder('a', 'Shots'), folder('b', 'Day 1', 'a'), folder('c', 'Day 2', 'a')];
function source(files: MediaFile[]): PhoneLibrarySource {
  return {
    files, compositions: [], folders, textItems: [], solidItems: [], meshItems: [], cameraItems: [], lightItems: [],
    splatEffectorItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [],
  } as unknown as PhoneLibrarySource;
}

describe('phone library model', () => {
  it('lists folders first, then items by name, and counts folder children', () => {
    const top = listPhoneLibraryFolder(source([file('f2', 'zebra.mp4', null), file('f1', 'alpha.mp4', null), file('f3', 'in.mp4', 'a')]), null);
    expect(top.map((entry) => entry.id)).toEqual(['a', 'f1', 'f2']);
    expect(top[0].childCount).toBe(3);
    expect(listPhoneLibraryFolder(source([file('f3', 'in.mp4', 'a')]), 'a').map((entry) => entry.id)).toEqual(['b', 'c', 'f3']);
  });

  it('shows an item whose folder is gone at the top level instead of hiding it', () => {
    expect(listPhoneLibraryFolder(source([file('orphan', 'o.mp4', 'deleted')]), null).map((entry) => entry.id)).toContain('orphan');
  });

  it('builds the folder path and refuses moving a folder into itself or its subfolder', () => {
    expect(phoneLibraryPath(folders, 'b').map((entry) => entry.name)).toEqual(['Shots', 'Day 1']);
    expect(checkPhoneLibraryMove(folders, ['a'], 'b')).toEqual({ ok: false, reason: expect.stringContaining('Shots') });
    expect(checkPhoneLibraryMove(folders, ['a'], 'a').ok).toBe(false);
    expect(checkPhoneLibraryMove(folders, ['b'], 'c').ok).toBe(true);
    expect(checkPhoneLibraryMove(folders, ['f1'], 'b').ok).toBe(true);
    expect(checkPhoneLibraryMove(folders, [], null).ok).toBe(false);
  });

  it('lists move targets as an indented tree', () => {
    expect(phoneLibraryFolderTargets(folders).map((target) => `${target.depth}:${target.label}`))
      .toEqual(['0:Library (top level)', '1:Shots', '2:Day 1', '2:Day 2']);
  });

  it('describes metadata and keeps a decode error visible', () => {
    const rows = Object.fromEntries(describePhoneMediaInfo(file('v', 'v.mp4', null, {
      duration: 4, width: 360, height: 640, fps: 30, codec: 'avc1', decodeError: 'unsupported codec',
    })));
    expect(rows).toMatchObject({ Type: 'Video', Duration: '0:04', Size: '360×640', 'Frame rate': '30 fps', 'Video codec': 'avc1' });
    expect(rows.Problem).toBe('Cannot decode: unsupported codec');
  });

  it('formats durations and usage lines', () => {
    expect(formatPhoneDuration(65.25)).toBe('1:05.3');
    expect(formatPhoneDuration(undefined)).toBe('');
    expect(describePhoneMediaUsage([{ mediaFileId: 'v', mediaFileName: 'v.mp4', clipCount: 3, compositions: [
      { compositionId: 'c1', compositionName: 'Main', clipCount: 2 }, { compositionId: 'c2', compositionName: 'Intro', clipCount: 1 },
    ] }])).toEqual(['v.mp4 – Main: 2 clips', 'v.mp4 – Intro: 1 clip']);
  });
});

describe('media store moveToFolder guard (editor root fix)', () => {
  it('finds folders that would move into themselves or a subfolder', () => {
    expect(findFolderMoveCycles(folders, ['a', 'f1'], 'b')).toEqual(['a']);
    expect(findFolderMoveCycles(folders, ['b'], 'b')).toEqual(['b']);
    expect(findFolderMoveCycles(folders, ['b'], 'c')).toEqual([]);
    expect(findFolderMoveCycles(folders, ['a'], null)).toEqual([]);
  });

  it('moveToFolder keeps the tree intact and still moves the other items', () => {
    let state = { folders: folders.map((entry) => ({ ...entry })), files: [file('f1', 'alpha.mp4', null)], compositions: [], textItems: [], solidItems: [] } as unknown as MediaState;
    const set = (update: Partial<MediaState> | ((current: MediaState) => Partial<MediaState>)) => {
      state = { ...state, ...(typeof update === 'function' ? update(state) : update) };
    };
    const slice = createSelectionSlice(set, () => state);
    slice.moveToFolder(['a', 'f1'], 'b');
    expect(state.folders.find((entry) => entry.id === 'a')?.parentId).toBeNull();
    expect(state.files.find((entry) => entry.id === 'f1')?.parentId).toBe('b');
  });
});
