// Reads `archive-manifest.json` straight from a .msproj file's ZIP central directory, without
// extracting or copying the archive. Importers use it to name a project before restoring it.

import { inflateSync } from 'fflate';
import { readBlobAsArrayBuffer } from '../../../../importers/fileIdentity';
import type { RepositoryArchiveManifest } from './archiveManifest';

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const MAX_DIRECTORY_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MANIFEST_PATH = 'archive-manifest.json';

export type ArchiveManifestProbe =
  | { kind: 'repository-archive'; manifest: RepositoryArchiveManifest }
  /** Not a repository archive (an old-format package), or no readable manifest: the reason says which. */
  | { kind: 'none'; reason: string };

async function bytesOf(file: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await readBlobAsArrayBuffer(file.slice(start, end)));
}

function findEndOfDirectory(tail: DataView): number {
  for (let offset = tail.byteLength - END_RECORD_BYTES; offset >= 0; offset -= 1) {
    if (tail.getUint32(offset, true) === END_OF_DIRECTORY) return offset;
  }
  return -1;
}

async function readEntry(file: Blob, method: number, compressedSize: number, size: number, localOffset: number): Promise<Uint8Array | string> {
  if (size > MAX_MANIFEST_BYTES || compressedSize > MAX_MANIFEST_BYTES) return 'manifest exceeds its size budget';
  if (localOffset + 30 > file.size) return 'manifest entry lies outside the file';
  const local = await bytesOf(file, localOffset, localOffset + 30);
  if (local.getUint32(0, true) !== LOCAL_HEADER) return 'manifest entry has no local header';
  const dataStart = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  if (dataStart + compressedSize > file.size) return 'manifest data lies outside the file';
  const data = new Uint8Array(await readBlobAsArrayBuffer(file.slice(dataStart, dataStart + compressedSize)));
  if (method === 0) return data;
  if (method === 8) return inflateSync(data, { out: new Uint8Array(size) });
  return `manifest uses unsupported ZIP method ${method}`;
}

/** Finds and parses the repository archive manifest; never throws for malformed or foreign files. */
export async function probeRepositoryArchiveManifest(file: Blob): Promise<ArchiveManifestProbe> {
  try {
    if (file.size < END_RECORD_BYTES) return { kind: 'none', reason: 'file is too small to be a ZIP archive' };
    const tailStart = Math.max(0, file.size - END_RECORD_BYTES - MAX_COMMENT_BYTES);
    const tail = await bytesOf(file, tailStart, file.size);
    const end = findEndOfDirectory(tail);
    if (end < 0) return { kind: 'none', reason: 'no ZIP directory found' };
    const entries = tail.getUint16(end + 10, true);
    const directoryBytes = tail.getUint32(end + 12, true);
    const directoryOffset = tail.getUint32(end + 16, true);
    if (directoryBytes > MAX_DIRECTORY_BYTES || directoryOffset + directoryBytes > file.size) return { kind: 'none', reason: 'ZIP directory is out of bounds' };
    const directory = await bytesOf(file, directoryOffset, directoryOffset + directoryBytes);
    const decoder = new TextDecoder();
    for (let offset = 0, index = 0; index < entries && offset + 46 <= directory.byteLength; index += 1) {
      if (directory.getUint32(offset, true) !== DIRECTORY_ENTRY) return { kind: 'none', reason: 'ZIP directory is damaged' };
      const nameLength = directory.getUint16(offset + 28, true);
      const next = offset + 46 + nameLength + directory.getUint16(offset + 30, true) + directory.getUint16(offset + 32, true);
      const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + offset + 46, nameLength));
      if (name === MANIFEST_PATH) {
        const bytes = await readEntry(file, directory.getUint16(offset + 10, true), directory.getUint32(offset + 20, true),
          directory.getUint32(offset + 24, true), directory.getUint32(offset + 42, true));
        if (typeof bytes === 'string') return { kind: 'none', reason: bytes };
        const manifest = JSON.parse(decoder.decode(bytes)) as RepositoryArchiveManifest;
        if (manifest?.format !== 'masterselects-repository-archive') return { kind: 'none', reason: 'manifest has an unknown format' };
        return { kind: 'repository-archive', manifest };
      }
      offset = next;
    }
    return { kind: 'none', reason: 'archive has no repository manifest' };
  } catch (error) {
    return { kind: 'none', reason: `manifest could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The project name an archive records, or null when it predates the field or is not a repository archive. */
export function archiveManifestProjectName(probe: ArchiveManifestProbe): string | null {
  if (probe.kind !== 'repository-archive') return null;
  const name = probe.manifest.projectName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}
