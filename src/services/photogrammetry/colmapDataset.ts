export type ColmapDatasetStatus = 'valid' | 'invalid';

export interface ColmapDatasetInspection {
  status: ColmapDatasetStatus;
  name: string;
  imageCount: number;
  modelFormat: 'binary' | 'text' | null;
  message: string;
  handle: FileSystemDirectoryHandle;
}

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

async function getDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function hasFile(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await parent.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function countImages(directory: FileSystemDirectoryHandle): Promise<number> {
  let count = 0;
  for await (const entry of (directory as IterableDirectoryHandle).values()) {
    if (entry.kind !== 'file') continue;
    const extension = entry.name.split('.').pop()?.toLowerCase() ?? '';
    if (['avif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'webp'].includes(extension)) count += 1;
  }
  return count;
}

export async function inspectColmapDataset(
  handle: FileSystemDirectoryHandle,
): Promise<ColmapDatasetInspection> {
  const images = await getDirectory(handle, 'images');
  const sparseRoot = await getDirectory(handle, 'sparse');
  const sparseZero = sparseRoot ? await getDirectory(sparseRoot, '0') : null;
  const modelDirectory = sparseZero ?? sparseRoot;
  const imageCount = images ? await countImages(images) : 0;

  const binaryModel = modelDirectory
    ? await Promise.all(['cameras.bin', 'images.bin', 'points3D.bin'].map((name) => hasFile(modelDirectory, name)))
    : [false, false, false];
  const textModel = modelDirectory
    ? await Promise.all(['cameras.txt', 'images.txt', 'points3D.txt'].map((name) => hasFile(modelDirectory, name)))
    : [false, false, false];
  const modelFormat = binaryModel.every(Boolean)
    ? 'binary'
    : textModel.every(Boolean) ? 'text' : null;

  if (!images || imageCount === 0) {
    return {
      status: 'invalid',
      name: handle.name,
      imageCount,
      modelFormat,
      message: 'No supported images were found in an images/ folder.',
      handle,
    };
  }
  if (!modelFormat) {
    return {
      status: 'invalid',
      name: handle.name,
      imageCount,
      modelFormat,
      message: 'No complete COLMAP model was found in sparse/ or sparse/0/.',
      handle,
    };
  }
  return {
    status: 'valid',
    name: handle.name,
    imageCount,
    modelFormat,
    message: `${imageCount} registered views · ${modelFormat} COLMAP model`,
    handle,
  };
}

export async function pickColmapDataset(): Promise<ColmapDatasetInspection | null> {
  const picker = (window as Window & {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) throw new Error('Folder access is unavailable in this browser. Use desktop Chrome or Edge.');
  try {
    const handle = await picker.call(window, { mode: 'read' });
    return await inspectColmapDataset(handle);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}
