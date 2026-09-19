import { unzipSync } from 'fflate';

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;

export function isColmapDatasetArchive(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip';
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the dataset ZIP.'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

export async function extractColmapDatasetArchive(file: File): Promise<File[]> {
  if (!isColmapDatasetArchive(file)) throw new Error('Choose a COLMAP dataset ZIP.');
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('The dataset ZIP exceeds the 512 MB browser limit.');
  const archive = unzipSync(new Uint8Array(await readFileBytes(file)));
  const entries = Object.entries(archive).filter(([path]) => !path.endsWith('/'));
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('The dataset ZIP contains too many files.');
  return entries.map(([path, bytes]) => {
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const name = normalizedPath.split('/').at(-1) ?? 'dataset-file';
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const extracted = new File([buffer], name, { type: 'application/octet-stream' });
    Object.defineProperty(extracted, 'webkitRelativePath', { value: normalizedPath });
    return extracted;
  });
}
