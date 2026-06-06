import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDeleteMediaItem, handleImportLocalFiles } from '../../src/services/aiTools/handlers/media';
import { addAllowedRoot, clearAllowedRoots } from '../../src/services/security/fileAccessBroker';

type MediaStoreArg = Parameters<typeof handleDeleteMediaItem>[1];
type ImportMediaStoreArg = Parameters<typeof handleImportLocalFiles>[1];

describe('AI tool media handlers', () => {
  afterEach(() => {
    clearAllowedRoots();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses deep media deletion for media files so timeline clips and caches are cleaned up', async () => {
    const deleteMediaFilesEverywhere = vi.fn(async () => ({
      deletedMediaFileIds: ['media-1'],
      removedClipCount: 3,
      usages: [],
      artifactFailures: ['artifact-missing'],
    }));
    const removeFile = vi.fn();
    const mediaStore = {
      files: [{ id: 'media-1', name: 'Clip.mp4', type: 'video', url: '' }],
      compositions: [],
      folders: [],
      deleteMediaFilesEverywhere,
      removeFile,
    } as unknown as MediaStoreArg;

    const result = await handleDeleteMediaItem({ itemId: 'media-1' }, mediaStore);

    expect(deleteMediaFilesEverywhere).toHaveBeenCalledWith(['media-1']);
    expect(removeFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: {
        itemId: 'media-1',
        deletedName: 'Clip.mp4',
        type: 'file',
        removedClipCount: 3,
        artifactFailures: ['artifact-missing'],
      },
    });
  });

  it('retries dev-bridge local file imports with byte ranges when full blob consumption fails', async () => {
    vi.stubGlobal('__DEV_BRIDGE_TOKEN__', 'dev-token');
    addAllowedRoot('C:/Users/admin/Documents');

    let importedFile: File | null = null;
    const importFile = vi.fn(async (file: File) => {
      importedFile = file;
      return {
        id: 'media-large',
        name: file.name,
        type: 'video',
        duration: 12,
      };
    });
    const mediaStore = {
      importFile,
    } as unknown as ImportMediaStoreArg;

    const fullResponse = new Response(null, {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    });
    vi.spyOn(fullResponse, 'blob').mockRejectedValue(new TypeError('Failed to fetch'));

    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    let callIndex = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      callIndex += 1;
      if (callIndex === 1) return fullResponse;

      const range = new Headers(init?.headers).get('Range');
      const match = range?.match(/^bytes=(\d+)-(\d+)$/);
      if (!match) {
        return new Response(JSON.stringify({ error: 'missing range' }), { status: 400 });
      }

      const start = Number(match[1]);
      const end = Number(match[2]);
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleImportLocalFiles(
      {
        paths: ['C:/Users/admin/Documents/Big Clip.mp4'],
        addToTimeline: false,
      },
      mediaStore,
      'devBridge',
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      totalImported: 1,
      totalFailed: 0,
      imported: [{
        id: 'media-large',
        name: 'Big Clip.mp4',
        type: 'video',
        duration: 12,
        path: 'C:/Users/admin/Documents/Big Clip.mp4',
        blobSize: 5,
      }],
    });
    expect(importFile).toHaveBeenCalledTimes(1);
    expect(importedFile?.name).toBe('Big Clip.mp4');
    expect(importedFile?.type).toBe('video/mp4');
    expect(importedFile?.size).toBe(5);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/local-file?path=C%3A%2FUsers%2Fadmin%2FDocuments%2FBig%20Clip.mp4');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer dev-token');

    const rangeRequests = fetchMock.mock.calls
      .slice(1)
      .map(([, init]) => new Headers(init?.headers).get('Range'))
      .filter((range): range is string => Boolean(range));
    expect(rangeRequests).toEqual(['bytes=0-0', 'bytes=1-4']);
  });
});
