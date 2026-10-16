import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestMedia = { id: string; name: string; file?: File };
const state = vi.hoisted(() => ({
  files: [] as TestMedia[],
  handles: new Map<string, unknown>(),
  connected: [] as string[],
}));

vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ files: state.files }) } }));
vi.mock('../../src/services/project/relinkMedia', () => ({
  applyRelinkMatch: vi.fn(),
  mediaNeedsRelink: (media: TestMedia) => !media.file,
}));
vi.mock('../../src/services/project/relink/relinkMatching', () => ({
  createRelinkCandidateMapFromHandles: vi.fn(async () => new Map()),
  findRelinkMatch: vi.fn(() => null),
  setRelinkHandleSource: vi.fn(),
}));
vi.mock('../../src/services/project/mediaSourceRoots', () => ({
  getProjectMediaSourceRootStates: vi.fn(async () => []),
  requestProjectMediaSourceRootAccess: vi.fn(),
  registerProjectMediaSourceRoot: vi.fn(),
}));
vi.mock('../../src/services/project/repository/transaction/editorLinkedMediaConnection', () => ({
  // Connecting succeeds for every media whose saved file handle is now allowed.
  connectOfflineLinkedMedia: vi.fn(async () => {
    let connected = 0;
    state.files = state.files.map((media) => {
      const handle = state.handles.get(`media_${media.id}`) as { granted: boolean } | undefined;
      if (media.file || !handle?.granted) return media;
      connected++;
      state.connected.push(media.id);
      return { ...media, file: new File(['x'], media.name) };
    });
    return connected;
  }),
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  runEditorBatch: async <T>(_label: string, action: () => Promise<T>) => action(),
}));
vi.mock('../../src/services/fileSystemService', () => ({ fileSystemService: { getFileHandle: () => undefined } }));
vi.mock('../../src/services/projectDB', () => ({
  projectDB: { getStoredHandle: async (key: string) => state.handles.get(key) ?? null },
}));

const { mediaFilesNeedingAccess, reconnectMedia } = await import('../../src/services/project/mediaReconnect');

function fileHandle(initial: PermissionState) {
  const handle = {
    kind: 'file' as const,
    granted: initial === 'granted',
    queryPermission: vi.fn(async () => (handle.granted ? 'granted' : initial)),
    requestPermission: vi.fn(async () => { handle.granted = true; return 'granted' as const; }),
  };
  return handle;
}

describe('reconnecting media from saved file locations', () => {
  beforeEach(() => {
    state.files = [{ id: 'pxl', name: 'PXL_4k.mp4' }, { id: 'lost', name: 'lost.mp4' }];
    state.handles = new Map();
    state.connected = [];
  });

  it('lists offline media whose saved file handle only needs the browser prompt', async () => {
    state.handles.set('media_pxl', fileHandle('prompt'));
    state.handles.set('media_lost', fileHandle('denied'));

    const access = await mediaFilesNeedingAccess();

    expect(access.map((entry) => entry.name)).toEqual(['PXL_4k.mp4']);
  });

  it('re-allows saved file locations in the reconnect click instead of requiring a folder', async () => {
    const handle = fileHandle('prompt');
    state.handles.set('media_pxl', handle);

    const result = await reconnectMedia(() => {}, undefined, { requestFileAccess: true });

    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
    expect(state.connected).toEqual(['pxl']);
    expect(result).toMatchObject({ connected: 1, missing: 1 });
  });

  it('never prompts for files outside an explicit click or when a folder was chosen', async () => {
    const handle = fileHandle('prompt');
    state.handles.set('media_pxl', handle);

    await reconnectMedia(() => {});
    await reconnectMedia(() => {}, {} as FileSystemDirectoryHandle, { requestFileAccess: true });

    expect(handle.requestPermission).not.toHaveBeenCalled();
  });
});
