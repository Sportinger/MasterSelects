import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_DISK_MIN_BYTES, EXPORT_MEMORY_MAX_BYTES, estimateExportBytes, openExportDiskSpill, pruneExportSpills } from '../../src/engine/export/exportDiskSpill';

// Production 3.3.0: "ArrayBuffer exceeded maximum size of 4294967296 bytes" after a full encode of about
// 30 minutes, three runs in a row. Above 1 GB the file now goes to disk while it encodes.
interface FakeFile { bytes: Map<number, number>; closed: boolean; aborted: boolean; lastModified: number }

function fakeStorage({ quota = 500e9, usage = 0, writable = true, refuse = null as Error | null } = {}) {
  const files = new Map<string, FakeFile>();
  const handle = (name: string) => {
    const file = files.get(name)!;
    return {
      kind: 'file', name,
      getFile: async () => new File([new Uint8Array(file.bytes.size)], name, { lastModified: file.lastModified }),
      ...(writable ? { createWritable: async () => ({
        write: async ({ position, data }: { position: number; data: Uint8Array }) => { file.bytes.set(position, data.byteLength); },
        close: async () => { file.closed = true; },
        abort: async () => { file.aborted = true; },
      }) } : {}),
    };
  };
  const folder = {
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name) && options?.create) files.set(name, { bytes: new Map(), closed: false, aborted: false, lastModified: Date.now() });
      if (!files.has(name)) throw new DOMException('missing', 'NotFoundError');
      return handle(name);
    },
    removeEntry: async (name: string) => { files.delete(name); },
    values: async function* () { for (const name of files.keys()) yield handle(name); },
  };
  const root = { getDirectoryHandle: async () => folder };
  vi.stubGlobal('navigator', { storage: {
    getDirectory: async () => { if (refuse) throw refuse; return root; },
    estimate: async () => ({ quota, usage }),
  } });
  return files;
}

afterEach(() => vi.unstubAllGlobals());

const chunk = (position: number, size: number) => ({ type: 'write' as const, position, data: new Uint8Array(size) });

describe('export disk spill', () => {
  it('estimates the file from video and audio bitrate', () => {
    expect(estimateExportBytes({ bitrate: 8_000_000, startTime: 10, endTime: 20 })).toBe(10_000_000);
    expect(estimateExportBytes({ bitrate: 8_000_000, audioBitrate: 192_000, includeAudio: true, startTime: 0, endTime: 10 })).toBe(10_240_000);
  });

  it('keeps small exports in memory and does not touch the storage', async () => {
    const getDirectory = vi.fn();
    vi.stubGlobal('navigator', { storage: { getDirectory } });
    await expect(openExportDiskSpill(EXPORT_DISK_MIN_BYTES - 1)).resolves.toBeNull();
    expect(getDirectory).not.toHaveBeenCalled();
  });

  it('writes at the given positions and hands over the finished file', async () => {
    const files = fakeStorage();
    const spill = await openExportDiskSpill(EXPORT_DISK_MIN_BYTES);
    expect(spill).not.toBeNull();
    const writer = spill!.writable.getWriter();
    await writer.write(chunk(0, 8));
    await writer.write(chunk(4 * 1024 ** 3, 16));
    await writer.close();
    const file = [...files.values()][0];
    expect(file.closed).toBe(true);
    expect(file.bytes.get(4 * 1024 ** 3)).toBe(16);
    const blob = await spill!.finish('video/mp4');
    expect(blob.type).toBe('video/mp4');
    // Still needed: the browser reads this file while it saves the download.
    await spill!.discard();
    expect(files.size).toBe(1);
  });

  it('removes the file of an export that did not finish', async () => {
    const files = fakeStorage();
    const spill = await openExportDiskSpill(EXPORT_DISK_MIN_BYTES);
    await spill!.discard();
    expect(files.size).toBe(0);
  });

  it('frees the previous finished export before the next one, and old leftovers at app start', async () => {
    const files = fakeStorage();
    const first = await openExportDiskSpill(EXPORT_DISK_MIN_BYTES);
    await first!.finish('video/mp4');
    await openExportDiskSpill(EXPORT_DISK_MIN_BYTES);
    expect(files.size).toBe(1);
    await pruneExportSpills(Date.now() + 2 * 60 * 60 * 1000);
    expect(files.size).toBe(0);
  });

  it('stops before encoding when an export fits neither on disk nor in memory', async () => {
    fakeStorage({ quota: 10 * 1024 ** 3, usage: 8 * 1024 ** 3 });
    await expect(openExportDiskSpill(6 * 1024 ** 3)).rejects.toThrow('only 2.0 GB is free');
  });

  it('keeps an export in memory when it fits there but not on disk', async () => {
    fakeStorage({ quota: 1024 ** 3 });
    await expect(openExportDiskSpill(2 * 1024 ** 3)).resolves.toBeNull();
  });


  it.each([
    ['refuses the storage', { refuse: new DOMException('Security error when calling GetDirectory', 'SecurityError') }],
    ['has no writable file streams', { writable: false }],
  ])('keeps a mid-size export in memory when the browser %s, and stops a huge one up front', async (_case, options) => {
    fakeStorage(options);
    await expect(openExportDiskSpill(2 * 1024 ** 3)).resolves.toBeNull();
    await expect(openExportDiskSpill(EXPORT_MEMORY_MAX_BYTES)).rejects.toThrow('cannot keep more than 4 GB in memory');
  });
});
