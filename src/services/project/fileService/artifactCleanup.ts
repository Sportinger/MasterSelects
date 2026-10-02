import { captureRepositoryDomainPublication } from '../repository/artifacts/RepositoryDomainPublication';
import { getHashFromArtifactId, normalizeArtifactId } from '../../../artifacts/ids';
import { Logger } from '../../logger';
import { artifactService } from '../domains/ArtifactService';

const log = Logger.create('ProjectFileService');

type ProjectFileStorageBackend = 'fsa' | 'native';

export interface DeleteMediaFileArtifactsOptions {
  mediaId: string;
  projectPath?: string;
  fileHash?: string;
  proxyStorageKeys?: string[];
  audioArtifactRefs?: string[];
}

export interface DeleteMediaFileArtifactsResult {
  deleted: string[];
  failed: string[];
}

export interface MediaArtifactCleanupContext {
  activeBackend: ProjectFileStorageBackend;
  /** Repository history owns result retention; removing a media row is not GC. */
  repositoryMode?: boolean;
  getProjectHandle: () => FileSystemDirectoryHandle | null;
  deleteEntry: (subFolder: string, entryName: string, options?: { recursive?: boolean }) => Promise<boolean>;
  deleteRawFile: (relativePath: string | undefined) => Promise<boolean>;
  deleteThumbnail: (fileHash: string) => Promise<boolean>;
  listFiles: (subFolder: string) => Promise<string[]>;
  deleteFile: (subFolder: string, fileName: string) => Promise<boolean>;
  deleteAnalysis: (mediaId: string) => Promise<boolean>;
  deleteTranscript: (mediaId: string) => Promise<boolean>;
  deleteWaveform: (mediaId: string) => Promise<boolean>;
  deleteProxy: (mediaId: string) => Promise<boolean>;
}

export async function deleteAudioArtifact(context: MediaArtifactCleanupContext, ref: string): Promise<boolean> {
  if (context.repositoryMode || captureRepositoryDomainPublication()) return false;
  const artifactId = normalizeArtifactId(ref);
  const hash = getHashFromArtifactId(artifactId);
  let deleted = false;

  if (context.activeBackend === 'native' && hash) {
    deleted = await context.deleteEntry(
      'CACHE_ARTIFACTS',
      `sha256/${hash.slice(0, 2)}/${hash}`,
      { recursive: true },
    ) || deleted;
  } else {
    const handle = context.getProjectHandle();
    if (handle) {
      deleted = await artifactService.deleteArtifact(handle, artifactId) || deleted;
    }
  }

  // Origin-global artifact caches are shared across repositories, branches and
  // scratch sessions. A project-local removal is not a global ownership proof.

  return deleted;
}

export async function deleteMediaFileArtifacts(
  context: MediaArtifactCleanupContext,
  options: DeleteMediaFileArtifactsOptions,
): Promise<DeleteMediaFileArtifactsResult> {
  if (context.repositoryMode || captureRepositoryDomainPublication()) return { deleted: [], failed: [] };
  const deleted: string[] = [];
  const failed: string[] = [];
  const uniqueProxyKeys = [...new Set([
    ...(options.proxyStorageKeys ?? []),
    options.fileHash,
    options.mediaId,
  ].filter((key): key is string => Boolean(key)))];
  const uniqueAudioRefs = [...new Set(options.audioArtifactRefs ?? [])];

  const attempt = async (label: string, task: () => Promise<boolean>) => {
    try {
      const ok = await task();
      if (ok) {
        deleted.push(label);
      }
    } catch (error) {
      failed.push(label);
      log.warn('Failed to delete media artifact', { label, error });
    }
  };

  if (options.projectPath) {
    await attempt(`raw:${options.projectPath}`, () => context.deleteRawFile(options.projectPath));
  }

  if (options.fileHash) {
    await attempt(`thumbnail:${options.fileHash}`, () => context.deleteThumbnail(options.fileHash!));

    const splatRuntimeFiles = await context.listFiles('CACHE_SPLATS');
    for (const fileName of splatRuntimeFiles.filter((name) => name.startsWith(`${options.fileHash}.`) && name.endsWith('.rtgs'))) {
      await attempt(`splat-runtime:${fileName}`, () => context.deleteFile('CACHE_SPLATS', fileName));
    }
  }

  await attempt(`analysis:${options.mediaId}`, () => context.deleteAnalysis(options.mediaId));
  await attempt(`transcript:${options.mediaId}`, () => context.deleteTranscript(options.mediaId));
  await attempt(`waveform:${options.mediaId}`, () => context.deleteWaveform(options.mediaId));

  for (const proxyKey of uniqueProxyKeys) {
    await attempt(`proxy:${proxyKey}`, () => context.deleteProxy(proxyKey));
  }

  for (const ref of uniqueAudioRefs) {
    await attempt(`audio-artifact:${ref}`, () => deleteAudioArtifact(context, ref));
  }

  return { deleted, failed };
}
