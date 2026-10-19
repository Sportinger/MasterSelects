import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  files: [{ id: 'totale', name: 'Totale.MXF' }, { id: 'jonas', name: 'Jonas1.MXF' }],
  reconnectMedia: vi.fn(),
  session: { opening: { writable: true } },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: (selector: (state: { files: typeof mocks.files }) => unknown) => selector({ files: mocks.files }),
}));
vi.mock('../../src/services/project/relinkMedia', () => ({ mediaNeedsRelink: () => true }));
vi.mock('../../src/services/project/relinkDialogRuntime', () => ({ requestRelinkDialog: vi.fn() }));
vi.mock('../../src/services/project/mediaReconnect', () => ({
  MAX_FILE_ACCESS_PROMPTS: 8,
  mediaFilesNeedingAccess: async () => [],
  mediaFoldersNeedingAccess: async () => [],
  reconnectMedia: mocks.reconnectMedia,
}));
vi.mock('../../src/services/project/repository/transaction/editorLinkedMediaConnection', () => ({
  isLinkedMediaConnectionRunning: () => false,
  subscribeLinkedMediaConnection: () => () => {},
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => mocks.session,
  subscribeEditorRepositorySession: () => () => {},
}));

import { MediaReconnectHost } from '../../src/components/common/toolbar/MediaReconnectOverlay';

afterEach(() => {
  mocks.reconnectMedia.mockReset();
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe('MediaReconnectHost', () => {
  it('offers exactly one action and keeps it to one after a folder leaves files missing', async () => {
    const folder = { kind: 'directory', name: 'UTE_SHOW' };
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = vi.fn(async () => folder);
    mocks.reconnectMedia.mockResolvedValue({ connected: 0, relinked: 0, missing: 2, deniedFolders: [] });
    render(<MediaReconnectHost />);

    // Allowed folders are searched once without a prompt before the dialog asks for anything.
    await waitFor(() => expect(mocks.reconnectMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2 media files are still missing: “Totale.MXF”, “Jonas1.MXF”.'));
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['×', 'Choose folder…']);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' })); });
    await waitFor(() => expect(mocks.reconnectMedia).toHaveBeenCalledTimes(2));
    expect(mocks.reconnectMedia.mock.calls[1]![1]).toBe(folder);
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['×', 'Choose another folder…']);

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect later' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tells a read-only tab to reconnect in the writing tab instead of failing', async () => {
    mocks.session = { opening: { writable: false } };
    try {
      render(<MediaReconnectHost />);
      await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('open for editing in another tab'));
      expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['×', 'Reload this tab']);
      expect(mocks.reconnectMedia).not.toHaveBeenCalled();
    } finally { mocks.session = { opening: { writable: true } }; }
  });
});
