import type { GaussianSplatSequenceData } from '../../../types';
import type { GaussianSplatSettings } from '../../gaussian/types';
import {
  waitForBasePreparedSplatRuntime,
  waitForTargetPreparedSplatRuntime,
} from './SharedSplatRuntimeCache';

export interface SharedSplatRuntimeRequest {
  clipId: string;
  sceneKey: string;
  cacheKey: string;
  url?: string;
  file?: File;
  fileName: string;
  fileHash?: string;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  requestedMaxSplats: number;
  preferBaseRuntime: boolean;
  useNativeRenderer: boolean;
}

interface BuildSharedSplatRuntimeRequestOptions {
  clipId: string;
  runtimeKey?: string;
  url?: string;
  file?: File;
  fileName: string;
  fileHash?: string;
  mediaFileId?: string;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  gaussianSplatSettings?: GaussianSplatSettings;
  requestedMaxSplats?: number;
}

function buildPreparedSplatFallbackKey(
  options: Pick<BuildSharedSplatRuntimeRequestOptions, 'clipId' | 'fileName' | 'url' | 'runtimeKey'>,
): string {
  if (options.runtimeKey) {
    return options.runtimeKey;
  }
  return `${options.fileName || options.url || options.clipId}|${options.url || options.clipId}`;
}

export function getUsableSplatFile(...files: Array<File | null | undefined>): File | undefined {
  for (const file of files) {
    if (file && (typeof file.size !== 'number' || file.size > 0)) {
      return file;
    }
  }
  return undefined;
}

export function resolveSharedSplatUseNativeRenderer(
  _settings: GaussianSplatSettings | undefined,
): boolean {
  return true;
}

export function resolveSharedSplatSceneKey(options: {
  clipId: string;
  runtimeKey?: string;
}): string {
  return options.runtimeKey ?? options.clipId;
}

export function buildSharedSplatRuntimeRequest(
  options: BuildSharedSplatRuntimeRequestOptions,
): SharedSplatRuntimeRequest {
  const preferBaseRuntime = !!options.gaussianSplatSequence;
  const sceneKey = resolveSharedSplatSceneKey({
    clipId: options.clipId,
    runtimeKey: options.runtimeKey,
  });
  const preparedRuntimeKey = buildPreparedSplatFallbackKey(options);
  const cacheKey = preferBaseRuntime
    ? preparedRuntimeKey
    : (options.fileHash ?? options.mediaFileId ?? preparedRuntimeKey);

  return {
    clipId: options.clipId,
    sceneKey,
    cacheKey,
    url: options.url,
    file: options.file,
    fileName: options.fileName,
    fileHash: options.fileHash,
    gaussianSplatSequence: options.gaussianSplatSequence,
    requestedMaxSplats: options.requestedMaxSplats ?? 0,
    preferBaseRuntime,
    useNativeRenderer: resolveSharedSplatUseNativeRenderer(options.gaussianSplatSettings),
  };
}

export function getSharedSplatRuntimeVariant(
  request: Pick<SharedSplatRuntimeRequest, 'preferBaseRuntime'>,
): 'base' | 'target' {
  return request.preferBaseRuntime ? 'base' : 'target';
}

export async function waitForPreparedSharedSplatRuntime(
  request: SharedSplatRuntimeRequest,
): Promise<void> {
  await (request.preferBaseRuntime
    ? waitForBasePreparedSplatRuntime
    : waitForTargetPreparedSplatRuntime)({
    cacheKey: request.cacheKey,
    fileHash: request.fileHash,
    file: request.file,
    url: request.url,
    fileName: request.fileName,
    gaussianSplatSequence: request.gaussianSplatSequence,
    requestedMaxSplats: request.requestedMaxSplats,
  });
}
