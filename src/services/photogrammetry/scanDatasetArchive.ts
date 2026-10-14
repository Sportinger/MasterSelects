import { zipSync } from 'fflate';
import { virtualFilePath } from './virtualDirectoryHandle';

/** Source images are already compressed; ZIP store mode avoids re-encoding them. */
export async function packScanDataset(files: File[]): Promise<Blob> {
  const entries = await Promise.all(files.map(async file => [
    virtualFilePath(file), new Uint8Array(await file.arrayBuffer()),
  ] as const));
  const bytes = zipSync(Object.fromEntries(entries), { level: 0 });
  return new Blob([bytes.slice().buffer], { type: 'application/zip' });
}
