import { projectFileService } from './ProjectFileService';

/** Keep decoder, PCM, and waveform writes off the package save path until ready. */
export async function withProjectArtifactWriteBatch<T>(work: () => Promise<T>): Promise<T> {
  const session = projectFileService.getProjectPackageSession?.();
  return session ? session.batchWrites(work) : work();
}
