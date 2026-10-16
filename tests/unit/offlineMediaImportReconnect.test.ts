import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore/types';

const applyRelinkMatch = vi.fn();
vi.mock('../../src/services/project/relinkMedia', async () => {
  const matching = await vi.importActual<typeof import('../../src/services/project/relink/relinkMatching')>(
    '../../src/services/project/relink/relinkMatching',
  );
  return {
    applyRelinkMatch: (...args: unknown[]) => applyRelinkMatch(...args),
    findRelinkMatch: matching.findRelinkMatch,
    isNativeProjectLinkedMedia: () => false,
  };
});
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  runEditorBatch: async <T>(_label: string, action: () => Promise<T>) => action(),
}));

const { reconnectOfflineMediaFromImport } = await import(
  '../../src/stores/mediaStore/slices/fileImport/offlineMediaImportReconnect'
);

function media(id: string, name: string, file?: File): MediaFile {
  return { id, name, type: 'video', ...(file ? { file } : {}) } as unknown as MediaFile;
}

describe('reconnectOfflineMediaFromImport', () => {
  let files: MediaFile[];
  beforeEach(() => {
    applyRelinkMatch.mockReset();
    files = [media('offline-4k', 'test4k_portrait.mp4'), media('online', 'other.mp4', new File(['x'], 'other.mp4'))];
  });

  it('reconnects the offline item instead of importing a duplicate', async () => {
    const imported = new File(['video'], 'test4k_portrait.mp4');
    applyRelinkMatch.mockImplementation(async (id: string) => {
      files = files.map((item) => item.id === id ? { ...item, file: imported } : item);
      return true;
    });

    const result = await reconnectOfflineMediaFromImport(
      [{ file: imported }, { file: new File(['n'], 'new.mp4') }],
      () => files,
    );

    expect(applyRelinkMatch).toHaveBeenCalledWith('offline-4k', expect.objectContaining({ kind: 'single' }));
    expect(result.reconnected.map((item) => item.id)).toEqual(['offline-4k']);
    expect(result.reconnected[0].file).toBe(imported);
    expect(result.remaining.map(({ file }) => file.name)).toEqual(['new.mp4']);
  });

  it('reconnects every offline duplicate of the imported source', async () => {
    files = [media('offline-a', 'test4k_portrait.mp4'), media('offline-b', 'test4k_portrait.mp4')];
    applyRelinkMatch.mockResolvedValue(true);

    const result = await reconnectOfflineMediaFromImport([{ file: new File(['v'], 'test4k_portrait.mp4') }], () => files);

    expect(applyRelinkMatch.mock.calls.map(([id]) => id)).toEqual(['offline-a', 'offline-b']);
    expect(result.remaining).toEqual([]);
  });

  it('imports the file normally when its bytes do not match the offline item', async () => {
    applyRelinkMatch.mockRejectedValue(new Error('size mismatch'));
    const imported = new File(['different'], 'test4k_portrait.mp4');

    const result = await reconnectOfflineMediaFromImport([{ file: imported }], () => files);

    expect(result.reconnected).toEqual([]);
    expect(result.remaining.map(({ file }) => file)).toEqual([imported]);
  });

  it('does nothing when no media is offline', async () => {
    files = [files[1]];
    const entries = [{ file: new File(['x'], 'test4k_portrait.mp4') }];
    const result = await reconnectOfflineMediaFromImport(entries, () => files);
    expect(result.remaining).toBe(entries);
    expect(applyRelinkMatch).not.toHaveBeenCalled();
  });
});
