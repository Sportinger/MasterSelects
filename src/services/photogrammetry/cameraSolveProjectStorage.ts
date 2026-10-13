import { captureRepositoryDomainPublication } from '../project/repository/artifacts/RepositoryDomainPublication';
import type { ScanSourceStorage } from './scanSourceProjectStorage';
import { packScanDataset } from './scanDatasetArchive';
import { extractColmapDatasetArchive } from './colmapDatasetArchive';
import type {
  CameraSolveDataset,
  CameraSolveSourceContext,
  SolvedCameraModel,
} from './cameraSolvingContract';
import { virtualFilePath } from './virtualDirectoryHandle';

const ARCHIVE_FILE = 'camera-solve-latest.zip';
const MANIFEST_FILE = 'camera-solve-latest.json';

interface StoredCameraSolveManifest {
  version: 1 | 2;
  archivePath?: string;
  id: string;
  createdAt: number;
  datasetName: string;
  registeredSourceIndices: number[];
  source: CameraSolveSourceContext | null;
}

function findDatasetFile(files: File[], fileName: string): File | undefined {
  return files.find((file) => virtualFilePath(file).replace(/\\/g, '/').endsWith(`/sparse/0/${fileName}`));
}

async function reconstructModel(
  files: File[],
  manifest: StoredCameraSolveManifest,
): Promise<SolvedCameraModel | null> {
  const cameras = findDatasetFile(files, 'cameras.txt');
  const images = findDatasetFile(files, 'images.txt');
  const points = findDatasetFile(files, 'points3D.txt');
  if (!cameras || !images || !points) return null;
  return {
    datasetName: manifest.datasetName,
    registeredSourceIndices: manifest.registeredSourceIndices,
    camerasText: await cameras.text(),
    imagesText: await images.text(),
    pointsText: await points.text(),
  };
}

export async function persistLatestCameraSolve(dataset: CameraSolveDataset,
  storage: ScanSourceStorage | null = captureRepositoryDomainPublication()): Promise<boolean> {
  if (!storage) return false;
  const archivePath = `scan-solves/${crypto.randomUUID()}/dataset.zip`;
  const archive = await packScanDataset(dataset.files);
  const manifest: StoredCameraSolveManifest = {
    version: 2, archivePath, id: dataset.id, createdAt: dataset.createdAt,
    datasetName: dataset.model.datasetName, registeredSourceIndices: dataset.model.registeredSourceIndices,
    source: dataset.source,
  };
  if (!await storage.writeFile('RAW', archivePath, archive)) throw new Error('Could not save the camera-solve dataset.');
  if (!await storage.writeFile('RAW', MANIFEST_FILE, JSON.stringify(manifest))) throw new Error('Could not save the camera-solve manifest.');
  return true;
}

export async function loadLatestCameraSolve(storage: ScanSourceStorage | null = captureRepositoryDomainPublication()): Promise<CameraSolveDataset | null> {
  if (!storage) return null;
  const current = await storage.readFile('RAW', MANIFEST_FILE);
  const manifestFile = current ?? await storage.readFile('CACHE_ARTIFACTS', MANIFEST_FILE);
  if (!manifestFile) return null;
  const manifest = JSON.parse(await manifestFile.text()) as StoredCameraSolveManifest;
  if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.registeredSourceIndices)
    || !manifest.registeredSourceIndices.every(value => Number.isSafeInteger(value) && value >= 0)
    || !Number.isFinite(manifest.createdAt)) throw new Error('Invalid saved camera solve.');
  if (current && (manifest.version !== 2 || !/^scan-solves\/[a-zA-Z0-9-]+\/dataset\.zip$/.test(manifest.archivePath ?? ''))) {
    throw new Error('Invalid saved camera-solve archive path.');
  }
  const archiveFile = await storage.readFile(current ? 'RAW' : 'CACHE_ARTIFACTS', current ? manifest.archivePath! : ARCHIVE_FILE);
  if (!archiveFile) throw new Error('The saved camera-solve dataset is missing.');
  const files = await extractColmapDatasetArchive(new File([archiveFile], ARCHIVE_FILE, { type: 'application/zip' }));
  const model = await reconstructModel(files, manifest);
  if (!model) throw new Error('The saved camera model is incomplete.');
  const result: CameraSolveDataset = { id: manifest.id, createdAt: manifest.createdAt, files, model, source: manifest.source };
  // Upgrade legacy cache-only solves on first successful read.
  if (!current) await persistLatestCameraSolve(result, storage);
  return result;
}
