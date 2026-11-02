// A long export does not fit into one browser buffer: with an in-memory target the muxer keeps the
// whole file in memory and gives up at 4 GB, after the person waited for the full encode (production
// 3.3.0: three runs of about 30 minutes each ended in "ArrayBuffer exceeded maximum size").
//
// From EXPORT_DISK_MIN_BYTES on the file is written to the origin private file system while it is
// encoded and handed over as a file-backed Blob, so neither the encoded data nor the finished file has
// to fit into memory. Smaller exports keep the in-memory path and its fast-start layout.

import type { StreamTargetChunk } from 'mediabunny';
import { Logger } from '../../services/logger';
import { openPersistentBrowserRoot } from '../../services/project/core/browserStorageRoot';

const log = Logger.create('ExportDiskSpill');

/** Listed in INTERNAL_STORAGE_FOLDERS so the project chooser never shows it. */
export const EXPORT_SPILL_FOLDER = 'export-spill';
export const EXPORT_DISK_MIN_BYTES = 1024 ** 3;
/** Above this size the in-memory target cannot finish at all. */
export const EXPORT_MEMORY_MAX_BYTES = 4 * 1024 ** 3;
/** Real sizes stay below the target bitrate often enough that a slightly short disk must not block an export. */
const QUOTA_ESTIMATE_MARGIN = 0.8;
/** The browser reads the file while saving it, so a finished export must outlive its download. */
const STALE_SPILL_MS = 60 * 60 * 1000;

const DEFAULT_AUDIO_BITRATE = 192_000;

/**
 * The disk filled up during the export. A private window cannot be told apart beforehand: Chrome's
 * storage estimate says 10 GB while it allows about 1 GB. An export that fits into memory starts
 * over there (FrameExporter), so this path never takes away what the in-memory target could do.
 */
export class ExportDiskFullError extends Error {
  constructor(writtenBytes: number, options?: ErrorOptions) {
    super(`The browser ran out of storage after writing ${formatGb(writtenBytes)} of this export. A private window allows far less than a normal one. `
      + 'Use a normal window, lower the bitrate, export a shorter range or free some disk space, then export again.', options);
    this.name = 'ExportDiskFullError';
  }
}

type SpillDirectory = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

export interface ExportDiskSpill {
  readonly writable: WritableStream<StreamTargetChunk>;
  /** Closes the file and returns it as a Blob; the data stays on disk until the next export or app start. */
  finish(type: string): Promise<Blob>;
  discard(): Promise<void>;
}

export interface ExportSizeSettings {
  bitrate: number;
  audioBitrate?: number;
  includeAudio?: boolean;
  startTime: number;
  endTime: number;
}

const formatGb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export function estimateExportBytes(settings: ExportSizeSettings): number {
  const seconds = Math.max(0, settings.endTime - settings.startTime);
  const audio = settings.includeAudio ? settings.audioBitrate ?? DEFAULT_AUDIO_BITRATE : 0;
  return ((settings.bitrate + audio) / 8) * seconds;
}

/** Development override so a journey can exercise this path without encoding gigabytes. */
function diskMinBytes(): number {
  if (import.meta.env.DEV) {
    try {
      const override = Number(localStorage.getItem('ms.export.diskMinBytes'));
      if (override > 0) return override;
    } catch { /* Storage unavailable: use the normal threshold. */ }
  }
  return EXPORT_DISK_MIN_BYTES;
}

const finishedThisTab = new Set<string>();

async function removeOldSpills(folder: SpillDirectory, now: number, keep?: string): Promise<void> {
  for await (const entry of folder.values()) {
    if (entry.kind !== 'file' || entry.name === keep) continue;
    try {
      const file = await (entry as FileSystemFileHandle).getFile();
      if (!finishedThisTab.has(entry.name) && now - file.lastModified < STALE_SPILL_MS) continue;
      await folder.removeEntry(entry.name);
      finishedThisTab.delete(entry.name);
    } catch (error) {
      // Another tab may still be writing this file.
      log.debug('Could not remove an earlier export file', { name: entry.name, error });
    }
  }
}

/** Frees the disk space of earlier exports; runs at app start and before every disk export. */
export async function pruneExportSpills(now = Date.now()): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle(EXPORT_SPILL_FOLDER);
    await removeOldSpills(folder as SpillDirectory, now);
  } catch {
    // No folder yet, or a browser that refuses this storage: nothing to free.
  }
}

/** Free browser storage when the export will not fit, null when it fits or the browser does not say. */
async function missingStorageSpace(estimatedBytes: number): Promise<number | null> {
  if (typeof navigator.storage?.estimate !== 'function') return null;
  const { quota, usage } = await navigator.storage.estimate();
  if (quota === undefined) return null;
  const free = quota - (usage ?? 0);
  return estimatedBytes * QUOTA_ESTIMATE_MARGIN <= free ? null : free;
}

class ExportStorageRefusal extends Error {}

async function openSpillFile(estimatedBytes: number): Promise<ExportDiskSpill | null> {
  const root = await openPersistentBrowserRoot();
  const folder = await root.getDirectoryHandle(EXPORT_SPILL_FOLDER, { create: true }) as SpillDirectory;
  const name = `export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.tmp`;
  await removeOldSpills(folder, Date.now(), name);
  const free = await missingStorageSpace(estimatedBytes);
  if (free !== null) {
    if (estimatedBytes >= EXPORT_MEMORY_MAX_BYTES) {
      throw new ExportStorageRefusal(`This export needs about ${formatGb(estimatedBytes)} of browser storage, but only ${formatGb(free)} is free. `
        + 'Lower the bitrate, export a shorter range or free some disk space, then export again.');
    }
    log.warn(`Only ${formatGb(free)} of browser storage is free; keeping this export in memory`);
    return null;
  }

  const handle = await folder.getFileHandle(name, { create: true });
  if (typeof handle.createWritable !== 'function') {
    // Safari before 26 has OPFS without writable streams.
    await folder.removeEntry(name).catch(() => undefined);
    log.warn('This browser cannot stream a file into its private storage');
    return null;
  }
  const file = await handle.createWritable();
  let written = 0;
  let closed = false;
  let finished = false;
  const remove = () => folder.removeEntry(name).catch((error: unknown) => {
    log.debug('Could not remove the export file', { name, error });
  });

  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      try {
        await file.write({ type: 'write', position: chunk.position, data: chunk.data });
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name === 'QuotaExceededError') throw new ExportDiskFullError(written, { cause: error });
        throw error;
      }
      written = Math.max(written, chunk.position + chunk.data.byteLength);
    },
    async close() {
      closed = true;
      await file.close();
    },
  });

  return {
    writable,
    async finish(type) {
      if (!closed) {
        closed = true;
        await file.close();
      }
      finished = true;
      finishedThisTab.add(name);
      // A Blob around the file references it on disk; nothing is read into memory here.
      return new Blob([await handle.getFile()], { type });
    },
    async discard() {
      if (finished) return;
      if (!closed) {
        closed = true;
        await file.abort().catch(() => undefined);
      }
      await remove();
    },
  };
}

/**
 * Chooses where the export file is written. Null keeps the in-memory target. A file too large for
 * memory and without usable disk storage stops here, before the encode, not when it would finish.
 */
export async function openExportDiskSpill(estimatedBytes: number): Promise<ExportDiskSpill | null> {
  if (estimatedBytes < diskMinBytes()) return null;
  let spill: ExportDiskSpill | null = null;
  try {
    spill = await openSpillFile(estimatedBytes);
  } catch (error) {
    if (error instanceof ExportStorageRefusal) throw error;
    log.warn('Export cannot be written to browser storage; keeping it in memory', error);
  }
  if (spill) {
    log.info(`Export of about ${formatGb(estimatedBytes)} is written to browser storage while it encodes`);
    return spill;
  }
  if (estimatedBytes >= EXPORT_MEMORY_MAX_BYTES) {
    throw new Error(`This export would be about ${formatGb(estimatedBytes)}. This browser window cannot write it to disk `
      + 'and cannot keep more than 4 GB in memory. Use a current Chrome or Edge in a regular window, lower the bitrate or export a shorter range.');
  }
  return null;
}
