import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/stores/timeline/types';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { loadClipFileData, loadClipFileDataCached, resolveClipExportFile } from '../../src/engine/export/clipPreparation/sourceResolution';

const mocks = vi.hoisted(() => ({
  projectHandle: vi.fn(), mediaHandle: vi.fn(), projectOpen: vi.fn(), rawFile: vi.fn(),
  paths: vi.fn(), warn: vi.fn(), fetch: vi.fn(),
}));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ warn: mocks.warn }) } }));
vi.mock('../../src/services/fileSystemService', () => ({ fileSystemService: { getFileHandle: mocks.mediaHandle } }));
vi.mock('../../src/services/project/ProjectFileService', () => ({
  projectFileService: { isProjectOpen: mocks.projectOpen, getFileFromRaw: mocks.rawFile },
}));
vi.mock('../../src/services/project/mediaSourceResolver', () => ({
  getStoredProjectFileHandle: mocks.projectHandle, getProjectRawPathCandidates: mocks.paths,
}));

function file(bytes: number[] = [1, 2, 3], error?: Error) {
  const value = new File([new Uint8Array(bytes)], 'clip.mp4', { type: 'video/mp4' });
  const read = vi.fn(async () => {
    if (error) throw error;
    return new Uint8Array(bytes).buffer;
  });
  Object.defineProperty(value, 'arrayBuffer', { value: read });
  return { value, read };
}
function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return { id: 'clip', name: 'clip.mp4', mediaFileId: 'media', ...overrides } as TimelineClip;
}
function media(overrides: Partial<MediaFile> = {}): MediaFile {
  return { id: 'media', name: 'clip.mp4', ...overrides } as MediaFile;
}
const unreadable = () => new DOMException('The requested file could not be read', 'NotReadableError');

beforeEach(() => {
  vi.resetAllMocks();
  mocks.projectHandle.mockResolvedValue(null);
  mocks.mediaHandle.mockReturnValue(null);
  mocks.projectOpen.mockReturnValue(false);
  mocks.rawFile.mockResolvedValue(null);
  mocks.paths.mockReturnValue(['Raw/clip.mp4', 'Raw/backup.mp4']);
  mocks.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('export source recovery', () => {
  it('reads the original media handle after a project File becomes unreadable', async () => {
    const stale = file([0], unreadable()), original = file([4, 5, 6]);
    mocks.projectHandle.mockResolvedValue({ getFile: vi.fn().mockResolvedValue(stale.value) });
    mocks.mediaHandle.mockReturnValue({ getFile: vi.fn().mockResolvedValue(original.value) });
    const data = await loadClipFileData(clip(), media({ hasFileHandle: true, url: 'blob:expired' }));
    expect(new Uint8Array(data!)).toEqual(new Uint8Array([4, 5, 6]));
    expect(stale.read).toHaveBeenCalledOnce();
    expect(original.read).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('project handle'), expect.objectContaining({ name: 'NotReadableError' }));
  });

  it('continues through unreadable RAW paths before using a readable RAW copy', async () => {
    const stale = file([0], unreadable()), good = file([9]);
    mocks.projectOpen.mockReturnValue(true);
    mocks.rawFile.mockResolvedValueOnce({ file: stale.value }).mockResolvedValueOnce({ file: good.value });
    expect(await loadClipFileData(clip())).toEqual(new Uint8Array([9]).buffer);
    expect(mocks.rawFile.mock.calls.map(args => args[0])).toEqual(['Raw/clip.mp4', 'Raw/backup.mp4']);
  });

  it('uses clip-owned bytes when the media File is unreadable and URLs have expired', async () => {
    const stale = file([0], unreadable()), good = file([7]);
    expect(await loadClipFileData(clip({ file: good.value }), media({ file: stale.value, url: 'blob:expired' })))
      .toEqual(new Uint8Array([7]).buffer);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('skips duplicate File instances and empty placeholders', async () => {
    const empty = file([]), good = file([8]);
    mocks.projectHandle.mockResolvedValue({ getFile: async () => empty.value });
    expect(await loadClipFileData(clip({ file: good.value }), media({ file: empty.value }))).toEqual(new Uint8Array([8]).buffer);
    expect(empty.read).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('Empty export file'));
  });

  it('keeps source priority and never resolves later files after a successful read', async () => {
    const first = file([1]);
    mocks.projectHandle.mockResolvedValue({ getFile: async () => first.value });
    await loadClipFileData(clip(), media({ hasFileHandle: true }));
    expect(mocks.projectOpen).not.toHaveBeenCalled();
    expect(mocks.mediaHandle).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('continues after handle access itself fails', async () => {
    const good = file([2]);
    mocks.projectHandle.mockResolvedValue({ getFile: async () => { throw unreadable(); } });
    expect(await loadClipFileData(clip({ file: good.value }))).toEqual(new Uint8Array([2]).buffer);
  });

  it('rejects HTTP error bodies and tries the actual video currentSrc', async () => {
    const errorBody = vi.fn(async () => new TextEncoder().encode('<html>Not found</html>').buffer);
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: errorBody })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([3]).buffer });
    const video = { currentSrc: 'blob:current', src: '' } as HTMLVideoElement;
    expect(await loadClipFileData(clip({ source: { type: 'video', videoElement: video } }), media({ url: 'https://example.invalid/missing' })))
      .toEqual(new Uint8Array([3]).buffer);
    expect(errorBody).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.map(args => args[0])).toEqual(['https://example.invalid/missing', 'blob:current']);
  });

  it('continues after an empty URL response and never fetches the same URL twice', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([4]).buffer });
    const video = { currentSrc: 'blob:empty', src: 'blob:original' } as HTMLVideoElement;
    expect(await loadClipFileData(clip({ source: { type: 'video', videoElement: video } }), media({ url: 'blob:empty' })))
      .toEqual(new Uint8Array([4]).buffer);
    expect(mocks.fetch.mock.calls.map(args => args[0])).toEqual(['blob:empty', 'blob:original']);
  });

  it('returns no bytes when every source fails rather than passing an HTTP error to the decoder', async () => {
    const stale = file([0], unreadable());
    mocks.fetch.mockResolvedValue({ ok: false, status: 403 });
    expect(await loadClipFileData(clip({ file: stale.value }), media({ url: 'https://example.invalid/denied' }))).toBeNull();
  });

  it('shares concurrent recovery reads for clips with the same media identity', async () => {
    const stale = file([0], unreadable()), good = file([6]);
    mocks.projectHandle.mockResolvedValue({ getFile: async () => stale.value });
    const cache = new Map();
    const source = media({ file: good.value });
    const [first, second] = await Promise.all([
      loadClipFileDataCached(clip(), source, cache), loadClipFileDataCached(clip({ id: 'second' }), source, cache),
    ]);
    expect(first).toBe(second);
    expect(good.read).toHaveBeenCalledOnce();
    expect(stale.read).toHaveBeenCalledOnce();
  });

  it('keeps HTMLVideo file resolution lazy without reading the full file', async () => {
    const first = file([1]);
    mocks.projectHandle.mockResolvedValue({ getFile: async () => first.value });
    expect(await resolveClipExportFile(clip())).toBe(first.value);
    expect(first.read).not.toHaveBeenCalled();
    expect(mocks.projectOpen).not.toHaveBeenCalled();
  });
});
