// Byte-verified copy of a project folder between two directory handle trees
// (the IndexedDB fallback and the origin private file system both expose them).
// The copy is only reported as complete after every file was read back from the
// target and matched the source size and SHA-256; the caller removes the source
// only after that.

import { StreamHash } from '../repository/segments/streamHash';

type IterableDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

const HASH_SLICE_BYTES = 1024 * 1024;

export interface DirectoryCopyResult { files: number; bytes: number }

export class DirectoryCopyVerificationError extends Error {
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`The copy of ${path} could not be verified: ${reason}`);
    this.name = 'DirectoryCopyVerificationError';
    this.path = path;
  }
}

async function hashFile(file: Blob): Promise<string> {
  const hash = new StreamHash();
  for (let offset = 0; offset < file.size; offset += HASH_SLICE_BYTES) {
    hash.update(new Uint8Array(await file.slice(offset, offset + HASH_SLICE_BYTES).arrayBuffer()));
  }
  return hash.digest();
}

async function copyFile(source: FileSystemFileHandle, target: FileSystemDirectoryHandle, path: string): Promise<number> {
  const file = await source.getFile();
  const handle = await target.getFileHandle(source.name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(file);
    await writable.close();
  } catch (error) {
    await writable.abort(error).catch(() => {});
    throw error;
  }
  const written = await handle.getFile();
  if (written.size !== file.size) throw new DirectoryCopyVerificationError(path, `expected ${file.size} bytes, found ${written.size}`);
  if (await hashFile(written) !== await hashFile(file)) throw new DirectoryCopyVerificationError(path, 'content differs');
  return file.size;
}

/** Copies every file below `source` into `target` (created as needed) and verifies each one. */
export async function copyDirectoryVerified(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
  onFile?: (path: string) => void,
  prefix = '',
): Promise<DirectoryCopyResult> {
  const result: DirectoryCopyResult = { files: 0, bytes: 0 };
  for await (const entry of (source as IterableDirectory).values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      const child = await target.getDirectoryHandle(entry.name, { create: true });
      const nested = await copyDirectoryVerified(entry as FileSystemDirectoryHandle, child, onFile, path);
      result.files += nested.files; result.bytes += nested.bytes;
    } else {
      result.bytes += await copyFile(entry as FileSystemFileHandle, target, path);
      result.files += 1;
      onFile?.(path);
    }
  }
  return result;
}

async function exists(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await parent.getDirectoryHandle(name); return true; } catch (error) {
    if (error instanceof DOMException && error.name === 'TypeMismatchError') return true;
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
}

/** `name`, or `name (2)`, `name (3)`, ... whichever does not exist yet in `parent`. */
export async function freeFolderName(parent: FileSystemDirectoryHandle, name: string): Promise<string> {
  const base = name.trim().replace(/[\\/:*?"<>|]/g, '-') || 'Untitled Project';
  if (!await exists(parent, base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} (${index})`;
    if (!await exists(parent, candidate)) return candidate;
  }
  return `${base} ${crypto.randomUUID().slice(0, 8)}`;
}
