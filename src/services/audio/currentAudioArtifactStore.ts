import { projectFileService } from '../projectFileService';
import { artifactService } from '../project/domains/ArtifactService';
import { AudioArtifactStore } from './AudioArtifactStore';

export function createCurrentAudioArtifactStore(): AudioArtifactStore {
  const projectHandle = projectFileService.getProjectHandle?.() ?? null;
  const packageSession = projectFileService.getProjectPackageSession();
  return new AudioArtifactStore(
    packageSession
      ? artifactService.createPackageStore(packageSession)
      : projectHandle
      ? artifactService.createStore(projectHandle)
      : artifactService.createIndexedDBStore(),
  );
}
