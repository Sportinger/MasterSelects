import type { ScanSourceStorage } from './scanSourceProjectStorage';
import type { BrushTrainingPreset } from './brushTrainingContract';
import type { SolvedCameraPath } from './cameraSolvePoses';
import { packScanDataset } from './scanDatasetArchive';
import { extractColmapDatasetArchive } from './colmapDatasetArchive';

export const BRUSH_CHECKPOINT_MANIFEST = 'scan-training/latest.json';
export interface BrushCheckpointManifest {
  version: 1;
  jobId: string;
  datasetName: string;
  datasetPath: string;
  plyPath: string;
  plyBytes: number;
  preset: BrushTrainingPreset;
  iteration: number;
  totalIterations: number;
  splatCount: number;
  trainViews: number;
  completed: boolean;
  savedAt: number;
  sourceVersion: number;
  cameraPath: SolvedCameraPath | null;
}
export interface BrushCheckpoint {
  manifest: BrushCheckpointManifest;
  bytes: Uint8Array<ArrayBuffer>;
}
const safePath = (value: unknown): value is string => typeof value === 'string'
  && /^scan-training\/[a-zA-Z0-9-]+\/(dataset\.zip|[a-zA-Z0-9-]+\.ply)$/.test(value);

export async function readBrushCheckpoint(storage: ScanSourceStorage, sourceVersion: number): Promise<BrushCheckpoint | null> {
  const file = await storage.readFile('RAW', BRUSH_CHECKPOINT_MANIFEST);
  if (!file) return null;
  const manifest = JSON.parse(await file.text()) as BrushCheckpointManifest;
  if (manifest.version !== 1 || !safePath(manifest.datasetPath) || !safePath(manifest.plyPath)
    || !['preview', 'mobile', 'balanced', 'quality'].includes(manifest.preset)
    || !Number.isSafeInteger(manifest.iteration) || manifest.iteration < 1
    || !Number.isSafeInteger(manifest.totalIterations) || manifest.totalIterations < manifest.iteration
    || !Number.isSafeInteger(manifest.plyBytes) || manifest.plyBytes < 1 || manifest.plyBytes > 64 * 1024 * 1024
    || !Number.isFinite(manifest.sourceVersion) || typeof manifest.datasetName !== 'string') {
    throw new Error('The saved training checkpoint is invalid.');
  }
  // A changed photo set must never silently resume a reconstruction of an older set.
  if (manifest.sourceVersion !== sourceVersion) return null;
  const [ply, dataset] = await Promise.all([
    storage.readFile('RAW', manifest.plyPath), storage.readFile('RAW', manifest.datasetPath),
  ]);
  if (!ply || ply.size !== manifest.plyBytes || !dataset) throw new Error('The saved training checkpoint is incomplete.');
  return { manifest, bytes: new Uint8Array(await ply.arrayBuffer()) };
}

export async function readCheckpointDataset(storage: ScanSourceStorage, manifest: BrushCheckpointManifest): Promise<File[]> {
  const archive = await storage.readFile('RAW', manifest.datasetPath);
  if (!archive) throw new Error('The saved training dataset is missing.');
  return extractColmapDatasetArchive(new File([archive], 'training-dataset.zip', { type: 'application/zip' }));
}

/** Captured storage pins every write to its original project. Manifest publication is last. */
export class BrushCheckpointWriter {
  private storage: ScanSourceStorage;
  private dataset: Promise<void> | null;
  private prepare: () => Promise<void>;
  private previous: string | null;
  readonly base: Omit<BrushCheckpointManifest, 'plyPath' | 'plyBytes' | 'iteration' | 'splatCount' | 'trainViews' | 'completed' | 'savedAt'>;
  constructor(storage: ScanSourceStorage, files: File[], base: BrushCheckpointWriter['base'], existing = false) {
    this.storage = storage; this.base = base; this.previous = null;
    this.prepare = () => existing ? Promise.resolve() : packScanDataset(files).then(async archive => {
      if (!await storage.writeFile('RAW', base.datasetPath, archive)) throw new Error('Could not save the training dataset.');
    });
    // Surface failures through save(), without an unhandled rejection during GPU startup.
    this.dataset = this.prepare();
    void this.dataset.catch(() => {});
  }
  async save(bytes: Uint8Array<ArrayBuffer>, state: Pick<BrushCheckpointManifest, 'iteration' | 'splatCount' | 'trainViews' | 'completed'>): Promise<BrushCheckpointManifest> {
    try { await (this.dataset ??= this.prepare()); }
    catch (error) { this.dataset = null; throw error; }
    const plyPath = `scan-training/${this.base.jobId}/${crypto.randomUUID()}.ply`;
    const manifest: BrushCheckpointManifest = { ...this.base, ...state, plyPath, plyBytes: bytes.byteLength, savedAt: Date.now() };
    if (!await this.storage.writeFile('RAW', plyPath, new Blob([bytes]))) throw new Error('Could not save the trained splats.');
    if (!await this.storage.writeFile('RAW', BRUSH_CHECKPOINT_MANIFEST, JSON.stringify(manifest))) {
      throw new Error('Could not publish the training checkpoint.');
    }
    const previous = this.previous; this.previous = plyPath;
    // Cleanup is best effort; an old unused copy must not invalidate a durable checkpoint.
    if (previous) await this.storage.deleteFile('RAW', previous).catch(() => false);
    return manifest;
  }
}
