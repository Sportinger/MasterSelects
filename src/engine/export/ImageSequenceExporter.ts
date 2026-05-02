import { zipSync } from 'fflate';

export interface ImageSequenceEntry {
  filename: string;
  data: Uint8Array;
}

export interface ImageSequenceDirectoryHandle {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ImageSequenceDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ImageSequenceFileHandle>;
}

interface ImageSequenceFileHandle {
  createWritable(): Promise<ImageSequenceWritableFileStream>;
}

interface ImageSequenceWritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface ImageSequenceDirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<ImageSequenceDirectoryHandle>;
}

function sanitizeSequencePathPart(value: string, fallback: string): string {
  const invalidCharacters = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  const pathSafeValue = [...value.trim()]
    .map(char => char.charCodeAt(0) < 32 || invalidCharacters.has(char) ? '_' : char)
    .join('');
  const sanitized = pathSafeValue
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);

  return sanitized || fallback;
}

export function getImageSequenceFolderName(baseName: string, extension: string): string {
  const normalizedBase = sanitizeSequencePathPart(baseName, 'export');
  const normalizedExtension = sanitizeSequencePathPart(extension.replace(/^\./, ''), 'frames');

  return `${normalizedBase}_${normalizedExtension}_sequence`;
}

export function getImageSequenceFrameName(
  baseName: string,
  frameIndex: number,
  totalFrames: number,
  extension: string,
): string {
  const normalizedBase = sanitizeSequencePathPart(baseName, 'export');
  const normalizedExtension = sanitizeSequencePathPart(extension.replace(/^\./, ''), 'png');
  const digits = Math.max(4, String(Math.max(1, totalFrames)).length);
  const frameNumber = String(frameIndex + 1).padStart(digits, '0');

  return `${normalizedBase}_${frameNumber}.${normalizedExtension}`;
}

export function isImageSequenceFolderExportSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as ImageSequenceDirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function pickImageSequenceOutputDirectory(folderName: string): Promise<ImageSequenceDirectoryHandle> {
  const picker = (window as ImageSequenceDirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new Error('Folder export is not supported in this browser');
  }

  const parentDirectory = await picker({
    id: 'masterselects-image-sequence-export',
    mode: 'readwrite',
  });

  return parentDirectory.getDirectoryHandle(folderName, { create: true });
}

export async function writeImageSequenceFrame(
  directory: ImageSequenceDirectoryHandle,
  filename: string,
  blob: Blob,
): Promise<void> {
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export function isImageSequenceFolderSelectionAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export function createImageSequenceZip(entries: ImageSequenceEntry[]): Blob {
  const zipEntries: Record<string, Uint8Array> = {};

  for (const entry of entries) {
    zipEntries[entry.filename] = Uint8Array.from(entry.data);
  }

  const zipped = zipSync(zipEntries, { level: 6 });
  const blobBytes = Uint8Array.from(zipped);
  return new Blob([blobBytes], { type: 'application/zip' });
}
