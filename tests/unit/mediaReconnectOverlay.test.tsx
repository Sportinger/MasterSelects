import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  files: [{ id: 'totale', name: 'Totale.MXF' }, { id: 'jonas', name: 'Jonas1.MXF' }],
  reconnectMedia: vi.fn(),
  session: { opening: { writable: true } },
  external: null as null | { phase: string; done: number; total: number },
  takeOverEditing: vi.fn(async () => true),
  folders: [] as unknown[],
  foldersNeedingAccess: [] as unknown[],
  projectHandle: { kind: 'directory', name: 'MS UTE 22' } as unknown,
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: Object.assign(
    (selector: (state: { files: typeof mocks.files }) => unknown) => selector({ files: mocks.files }),
    // Files of the listed folders stay offline after every reconnect in these tests.
    { getState: () => ({ files: (mocks.folders as Array<{ files: string[] }>).flatMap(folder => folder.files.map(name => ({ id: name, name }))) }) },
  ),
}));
vi.mock('../../src/services/project/relinkMedia', () => ({ mediaNeedsRelink: () => true }));
vi.mock('../../src/services/project/relinkDialogRuntime', () => ({ requestRelinkDialog: vi.fn() }));
vi.mock('../../src/services/project/mediaReconnect', () => ({
  MAX_FILE_ACCESS_PROMPTS: 8,
  mediaFoldersNeedingAccess: async () => mocks.foldersNeedingAccess,
  reconnectMedia: mocks.reconnectMedia,
  getMediaReconnectProgress: () => mocks.external,
  subscribeMediaReconnect: () => () => {},
}));
vi.mock('../../src/services/project/mediaReconnectFolders', () => ({
  offlineMediaFolders: async () => mocks.folders,
  folderPickerId: (folder: { key: string }) => `ms-media-${folder.key.replace(/[^A-Za-z0-9]/g, '').slice(-20)}`,
}));
vi.mock('../../src/services/projectFileService', () => ({ projectFileService: { getProjectHandle: () => mocks.projectHandle } }));
const installState = { dismissed: true, canInstall: false };
vi.mock('../../src/services/pwa/appInstallPrompt', () => ({
  dismissAppInstallHint: vi.fn(), getAppInstallState: () => installState,
  promptAppInstall: vi.fn(), subscribeAppInstallState: () => () => {},
}));
vi.mock('../../src/services/project/repository/transaction/editorLinkedMediaConnection', () => ({
  isLinkedMediaConnectionRunning: () => false,
  subscribeLinkedMediaConnection: () => () => {},
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => mocks.session,
  subscribeEditorRepositorySession: () => () => {},
}));

vi.mock('../../src/services/project/repository/lifecycle/editorWriterHandover', () => ({ takeOverEditing: mocks.takeOverEditing }));

import { MediaReconnectHost } from '../../src/components/common/toolbar/MediaReconnectOverlay';

afterEach(() => {
  mocks.reconnectMedia.mockReset();
  mocks.folders = [];
  mocks.foldersNeedingAccess = [];
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe('MediaReconnectHost', () => {
  it('lists each missing folder with where it was and opens its picker there', async () => {
    const remembered = { kind: 'directory', name: 'Originale' };
    mocks.folders = [
      { key: 'source-root:aaaa-1111', rootId: 'source-root:aaaa-1111', name: 'Ute_Marlene', subPath: 'Audio_Stems', files: ['T1_MIX_LR.wav', 'T1_UTE_1.wav', 'T2_UTE_1.wav'], access: 'missing', startIn: null },
      { key: 'source-root:bbbb-2222', rootId: 'source-root:bbbb-2222', name: 'Originale', files: ['Totale.MXF'], access: 'granted', startIn: remembered },
    ];
    const chosen = { kind: 'directory', name: 'Ute_Marlene' };
    const picker = vi.fn(async () => chosen);
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = picker;
    mocks.reconnectMedia.mockResolvedValue({ connected: 0, relinked: 0, missing: 2, deniedFolders: [] });
    render(<MediaReconnectHost />);

    // Allowed folders are searched once without a prompt before the dialog asks for anything.
    await waitFor(() => expect(mocks.reconnectMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const [stems, originals] = screen.getAllByRole('listitem');
    expect(stems!.textContent).toContain('Ute_Marlene / Audio_Stems');
    expect(stems!.textContent).toContain('3 files · T1_MIX_LR.wav, T1_UTE_1.wav +1');
    expect(originals!.textContent).toContain('Not in this folder any more');
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['×', 'Choose…', 'Choose…', 'Other folder or drive…']);

    // A folder this browser forgot opens next to the project; a remembered one opens at itself.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose Ute_Marlene' })); });
    expect(picker).toHaveBeenLastCalledWith({ id: 'ms-media-sourcerootaaaa1111', mode: 'read', startIn: mocks.projectHandle });
    await waitFor(() => expect(mocks.reconnectMedia).toHaveBeenCalledTimes(2));
    expect(mocks.reconnectMedia.mock.calls[1]![1]).toBe(chosen);
    expect(mocks.reconnectMedia.mock.calls[1]![2]).toEqual({ forRootId: 'source-root:aaaa-1111' });
    // Its files are still offline in this mock, so the row says the chosen folder did not hold them.
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]!.textContent).toContain('Not in “Ute_Marlene”'));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose Originale' })); });
    expect(picker).toHaveBeenLastCalledWith({ id: 'ms-media-sourcerootbbbb2222', mode: 'read', startIn: remembered });

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect later' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('re-allows one remembered folder with one click and offers Allow all for several', async () => {
    mocks.folders = [
      { key: 'source-root:a', rootId: 'source-root:a', name: 'Originale', files: ['Totale.MXF'], access: 'prompt', startIn: null },
      { key: 'source-root:b', rootId: 'source-root:b', name: 'Ute_Marlene', subPath: 'Audio_Stems', files: ['Jonas1.MXF'], access: 'prompt', startIn: null },
    ];
    mocks.foldersNeedingAccess = [{ id: 'source-root:a' }, { id: 'source-root:b' }];
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = vi.fn();
    mocks.reconnectMedia.mockResolvedValue({ connected: 1, relinked: 0, missing: 1, deniedFolders: [] });
    render(<MediaReconnectHost />);

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    // Remembered folders need the browser prompt only, so nothing searches before the click.
    expect(mocks.reconnectMedia).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['×', 'Allow', 'Allow', 'Other folder or drive…', 'Allow all']);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Allow Ute_Marlene' })); });
    expect(mocks.reconnectMedia.mock.calls[0]![1]).toBeUndefined();
    expect(mocks.reconnectMedia.mock.calls[0]![2]).toEqual({ rootIds: ['source-root:b'] });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Allow all' })); });
    expect(mocks.reconnectMedia.mock.calls[1]![2]).toEqual({ requestFileAccess: true });
  });

  it('lets a read-only tab take over editing instead of reloading or failing', async () => {
    mocks.session = { opening: { writable: false } };
    try {
      render(<MediaReconnectHost />);
      await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('open for editing in another tab'));
      expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['×', 'Take over editing']);
      expect(mocks.reconnectMedia).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Take over editing' }));
      expect(mocks.takeOverEditing).toHaveBeenCalledOnce();
    } finally { mocks.session = { opening: { writable: true } }; }
  });

  it('shows one large working status with found and missing counts and no button while it searches', async () => {
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = vi.fn();
    let finish!: (result: unknown) => void;
    mocks.reconnectMedia.mockImplementation((onProgress: (progress: unknown) => void) => {
      onProgress({ phase: 'relink', done: 1, total: 2 });
      return new Promise(resolve => { finish = resolve; });
    });
    render(<MediaReconnectHost />);

    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('Reconnecting media…'));
    expect(screen.getByRole('dialog').textContent).toContain('0 found');
    expect(screen.getByRole('dialog').textContent).toContain('2 missing');
    expect(screen.getByRole('dialog').textContent).toContain('Relinking media 1 / 2');
    expect(screen.queryByRole('button', { name: /folder/ })).toBeNull();

    await act(async () => { finish({ connected: 0, relinked: 0, missing: 2, deniedFolders: [] }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Other folder or drive…' })).toBeTruthy());
  });

  it('shows the working view while a reconnect started elsewhere runs', async () => {
    mocks.external = { phase: 'relink', done: 3, total: 8 };
    mocks.reconnectMedia.mockReturnValue(new Promise(() => {}));
    try {
      render(<MediaReconnectHost />);
      await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('Reconnecting media…'));
      expect(screen.getByRole('dialog').textContent).toContain('Relinking media 3 / 8');
      expect(screen.queryByRole('button', { name: /folder/ })).toBeNull();
    } finally { mocks.external = null; }
  });
});
