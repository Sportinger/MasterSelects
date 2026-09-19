import { zipSync } from 'fflate';
import { projectFileService } from '../project';
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
  version: 1;
  id: string;
  createdAt: number;
  datasetName: string;
  registeredSourceIndices: number[];
  source: CameraSolveSourceContext | null;
}

async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
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

export async function persistLatestCameraSolve(dataset: CameraSolveDataset): Promise<boolean> {
  if (!projectFileService.isProjectOpen()) return false;
  const entries = await Promise.all(dataset.files.map(async (file) => [
    virtualFilePath(file),
    await fileBytes(file),
  ] as const));
  // JPEG frames are already compressed. Store mode keeps project persistence fast
  // and avoids a long main-thread recompression pass after solving finishes.
  const archive = zipSync(Object.fromEntries(entries), { level: 0 });
  const manifest: StoredCameraSolveManifest = {
    version: 1,
    id: dataset.id,
    createdAt: dataset.createdAt,
    datasetName: dataset.model.datasetName,
    registeredSourceIndices: dataset.model.registeredSourceIndices,
    source: dataset.source,
  };
  const archiveBuffer = new ArrayBuffer(archive.byteLength);
  new Uint8Array(archiveBuffer).set(archive);
  const archiveSaved = await projectFileService.writeFile(
    'CACHE_ARTIFACTS',
    ARCHIVE_FILE,
    new Blob([archiveBuffer], { type: 'application/zip' }),
  );
  if (!archiveSaved) return false;
  return projectFileService.writeFile(
    'CACHE_ARTIFACTS',
    MANIFEST_FILE,
    JSON.stringify(manifest, null, 2),
  );
}

export async function loadLatestCameraSolve(): Promise<CameraSolveDataset | null> {
  if (!projectFileService.isProjectOpen()) return null;
  const [manifestFile, archiveFile] = await Promise.all([
    projectFileService.readFile('CACHE_ARTIFACTS', MANIFEST_FILE),
    projectFileService.readFile('CACHE_ARTIFACTS', ARCHIVE_FILE),
  ]);
  if (!manifestFile || !archiveFile) return null;
  const manifest = JSON.parse(await manifestFile.text()) as StoredCameraSolveManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.registeredSourceIndices)) return null;
  const archive = new File([archiveFile], ARCHIVE_FILE, { type: 'application/zip' });
  const files = await extractColmapDatasetArchive(archive);
  const model = await reconstructModel(files, manifest);
  return model ? {
    id: manifest.id,
    createdAt: manifest.createdAt,
    files,
    model,
    source: manifest.source,
  } : null;
}
