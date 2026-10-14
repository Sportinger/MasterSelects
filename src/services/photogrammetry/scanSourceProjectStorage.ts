import type { RepositoryDomainPublication } from '../project/repository/artifacts/RepositoryDomainPublication';
import type { CameraSolveSourceContext } from './cameraSolvingContract';

export const SCAN_SOURCE_MANIFEST = 'scan-sources/manifest.json';
const framePath = (id: string) => `scan-sources/${id}`;

export interface StoredScanPhoto {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export interface ScanSourceManifest {
  version: 1;
  updatedAt: number;
  photos: StoredScanPhoto[];
  source: CameraSolveSourceContext | null;
}

export interface ScanSourceFile { id: string; file: File }
export type ScanSourceStorage = Pick<RepositoryDomainPublication, 'readFile' | 'writeFile' | 'deleteFile'>;

/** Required project data, not reproducible cache. The captured host pins all IO
 * to one project even if the user switches projects while a write is pending. */
export async function readScanSources(storage: ScanSourceStorage): Promise<{
  files: ScanSourceFile[]; source: CameraSolveSourceContext | null; updatedAt: number;
}> {
  const file = await storage.readFile('RAW', SCAN_SOURCE_MANIFEST);
  if (!file) return { files: [], source: null, updatedAt: 0 };
  const manifest = JSON.parse(await file.text()) as ScanSourceManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.photos)
    || !Number.isFinite(manifest.updatedAt)) throw new Error('Invalid saved scan source list.');
  const ids = new Set<string>();
  const files: ScanSourceFile[] = [];
  for (const photo of manifest.photos) {
    if (!photo || typeof photo.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(photo.id) || ids.has(photo.id)
      || typeof photo.name !== 'string' || typeof photo.type !== 'string'
      || !Number.isSafeInteger(photo.size) || photo.size < 0 || !Number.isFinite(photo.lastModified)) {
      throw new Error('Invalid saved scan photo metadata.');
    }
    ids.add(photo.id);
    const stored = await storage.readFile('RAW', framePath(photo.id));
    if (!stored || stored.size !== photo.size) throw new Error(`Saved scan photo is missing or incomplete: ${photo.name}`);
    files.push({ id: photo.id, file: new File([stored], photo.name, {
      type: photo.type, lastModified: photo.lastModified,
    }) });
  }
  return { files, source: manifest.source ?? null, updatedAt: manifest.updatedAt };
}

export async function writeScanPhoto(storage: ScanSourceStorage, photo: ScanSourceFile): Promise<void> {
  if (!await storage.writeFile('RAW', framePath(photo.id), photo.file)) {
    throw new Error(`Could not save scan photo: ${photo.file.name}`);
  }
}

/** Publish the list only after its image bytes are durable. */
export async function writeScanSourceManifest(
  storage: ScanSourceStorage, files: ScanSourceFile[], source: CameraSolveSourceContext | null, updatedAt: number,
): Promise<void> {
  const manifest: ScanSourceManifest = { version: 1, updatedAt, source,
    photos: files.map(({ id, file }) => ({ id, name: file.name, size: file.size,
      type: file.type, lastModified: file.lastModified })) };
  if (!await storage.writeFile('RAW', SCAN_SOURCE_MANIFEST, JSON.stringify(manifest))) {
    throw new Error('Could not save the scan source list. Retry saving before reloading.');
  }
}

export async function deleteScanPhoto(storage: ScanSourceStorage, id: string): Promise<void> {
  if (!await storage.deleteFile('RAW', framePath(id))) throw new Error('Could not remove an unused scan photo.');
}
