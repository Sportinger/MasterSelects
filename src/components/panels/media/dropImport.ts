import { detectMediaType } from '../../../stores/timeline/helpers/mediaTypeHelpers';

export interface MediaFolderLike {
  id: string;
  name: string;
  parentId: string | null;
}

export interface DroppedMediaFileRecord {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
  folderSegments: string[];
}

export interface DroppedMediaImportBatch {
  parentId: string | null;
  files: File[];
  filesWithHandles: Array<{
    file: File;
    handle: FileSystemFileHandle;
    absolutePath?: string;
  }>;
}

type FolderCreator = (name: string, parentId: string | null) => MediaFolderLike;

type DataTransferItemWithHandle = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

interface FileSystemEntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath?: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file: (
    successCallback: (file: File) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader: () => FileSystemDirectoryReaderLike;
}

interface FileSystemDirectoryHandleIteratorLike {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

function isSupportedImportFile(file: File): boolean {
  return detectMediaType(file) !== 'unknown';
}

function buildDropRecordKey(record: DroppedMediaFileRecord): string {
  return [
    record.folderSegments.join('/'),
    record.file.name,
    record.file.size,
    record.file.lastModified,
  ].join('|');
}

function buildLooseFileKey(file: File): string {
  return [file.name, file.size, file.lastModified].join('|');
}

function getFolderCacheKey(parentId: string | null, name: string): string {
  return `${parentId ?? '__root__'}|${name}`;
}

async function getFileFromEntry(entry: FileSystemFileEntryLike): Promise<File> {
  return await new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readAllDirectoryEntries(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  const entries: FileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });

    if (batch.length === 0) {
      return entries;
    }

    entries.push(...batch);
  }
}

async function collectFromDirectoryEntry(
  entry: FileSystemDirectoryEntryLike,
  folderSegments: string[],
): Promise<DroppedMediaFileRecord[]> {
  const reader = entry.createReader();
  const entries = await readAllDirectoryEntries(reader);
  const files: DroppedMediaFileRecord[] = [];

  for (const child of entries) {
    if (child.isFile) {
      const file = await getFileFromEntry(child as FileSystemFileEntryLike);
      files.push({
        file,
        folderSegments,
      });
      continue;
    }

    if (child.isDirectory) {
      files.push(
        ...(await collectFromDirectoryEntry(
          child as FileSystemDirectoryEntryLike,
          [...folderSegments, child.name],
        )),
      );
    }
  }

  return files;
}

async function collectFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  folderSegments: string[],
): Promise<DroppedMediaFileRecord[]> {
  const files: DroppedMediaFileRecord[] = [];
  const iterableHandle = handle as FileSystemDirectoryHandle & FileSystemDirectoryHandleIteratorLike;

  const iterateChildren = async function* (): AsyncGenerator<FileSystemHandle> {
    if (typeof iterableHandle.values === 'function') {
      for await (const childHandle of iterableHandle.values()) {
        yield childHandle;
      }
      return;
    }

    if (typeof iterableHandle.entries === 'function') {
      for await (const [, childHandle] of iterableHandle.entries()) {
        yield childHandle;
      }
    }
  };

  for await (const childHandle of iterateChildren()) {
    if (childHandle.kind === 'file') {
      const fileHandle = childHandle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      files.push({
        file,
        handle: fileHandle,
        folderSegments,
      });
      continue;
    }

    files.push(
      ...(await collectFromDirectoryHandle(
        childHandle as FileSystemDirectoryHandle,
        [...folderSegments, childHandle.name],
      )),
    );
  }

  return files;
}

export async function collectDroppedMediaFiles(dataTransfer: DataTransfer): Promise<DroppedMediaFileRecord[]> {
  const records: DroppedMediaFileRecord[] = [];
  const seenRecordKeys = new Set<string>();
  const seenLooseFileKeys = new Set<string>();

  const pushRecord = (record: DroppedMediaFileRecord): void => {
    if (!isSupportedImportFile(record.file)) {
      return;
    }

    const key = buildDropRecordKey(record);
    if (seenRecordKeys.has(key)) {
      return;
    }

    seenRecordKeys.add(key);
    seenLooseFileKeys.add(buildLooseFileKey(record.file));
    records.push(record);
  };

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file') {
      continue;
    }

    const itemWithHandle = item as DataTransferItemWithHandle;

    if (typeof itemWithHandle.getAsFileSystemHandle === 'function') {
      try {
        const handle = await itemWithHandle.getAsFileSystemHandle();
        if (handle?.kind === 'file') {
          const fileHandle = handle as FileSystemFileHandle;
          pushRecord({
            file: await fileHandle.getFile(),
            handle: fileHandle,
            folderSegments: [],
          });
          continue;
        }

        if (handle?.kind === 'directory') {
          const directoryHandle = handle as FileSystemDirectoryHandle;
          for (const record of await collectFromDirectoryHandle(directoryHandle, [directoryHandle.name])) {
            pushRecord(record);
          }
          continue;
        }
      } catch {
        // Fall through to legacy entry/file extraction below.
      }
    }

    if (typeof itemWithHandle.webkitGetAsEntry === 'function') {
      const entry = itemWithHandle.webkitGetAsEntry();
      if (entry?.isFile) {
        pushRecord({
          file: await getFileFromEntry(entry as unknown as FileSystemFileEntryLike),
          folderSegments: [],
        });
        continue;
      }

      if (entry?.isDirectory) {
        for (const record of await collectFromDirectoryEntry(
          entry as unknown as FileSystemDirectoryEntryLike,
          [entry.name],
        )) {
          pushRecord(record);
        }
        continue;
      }
    }

    const file = item.getAsFile();
    if (file) {
      pushRecord({
        file,
        folderSegments: [],
      });
    }
  }

  for (const file of Array.from(dataTransfer.files ?? [])) {
    if (seenLooseFileKeys.has(buildLooseFileKey(file))) {
      continue;
    }

    pushRecord({
      file,
      folderSegments: [],
    });
  }

  return records;
}

export function planDroppedMediaImports(
  records: DroppedMediaFileRecord[],
  existingFolders: MediaFolderLike[],
  targetParentId: string | null,
  createFolder: FolderCreator,
): DroppedMediaImportBatch[] {
  const folderIds = new Map<string, string>();
  const batches = new Map<string, DroppedMediaImportBatch>();

  for (const folder of existingFolders) {
    folderIds.set(getFolderCacheKey(folder.parentId, folder.name), folder.id);
  }

  for (const record of records) {
    if (!isSupportedImportFile(record.file)) {
      continue;
    }

    let parentId = targetParentId;
    for (const segment of record.folderSegments) {
      const trimmedSegment = segment.trim();
      if (!trimmedSegment) {
        continue;
      }

      const cacheKey = getFolderCacheKey(parentId, trimmedSegment);
      let folderId = folderIds.get(cacheKey);

      if (!folderId) {
        const folder = createFolder(trimmedSegment, parentId);
        folderId = folder.id;
        folderIds.set(cacheKey, folderId);
      }

      parentId = folderId;
    }

    const batchKey = parentId ?? '__root__';
    let batch = batches.get(batchKey);
    if (!batch) {
      batch = {
        parentId,
        files: [],
        filesWithHandles: [],
      };
      batches.set(batchKey, batch);
    }

    if (record.handle) {
      batch.filesWithHandles.push({
        file: record.file,
        handle: record.handle,
        absolutePath: record.absolutePath,
      });
    } else {
      batch.files.push(record.file);
    }
  }

  return Array.from(batches.values());
}
