import type { MediaFile } from '../../types';
import type { TimelineClip } from '../../../../types/timeline';

export type ClipWithMediaReference = {
  id: string;
  name?: string;
  mediaFileId?: string;
  file?: File;
  sourceType?: string;
  audioState?: TimelineClip['audioState'];
  source?: {
    mediaFileId?: string;
    file?: File;
    filePath?: string;
    runtimeSourceId?: string;
    modelUrl?: string;
    gaussianAvatarUrl?: string;
    gaussianSplatUrl?: string;
    gaussianSplatFileName?: string;
    gaussianSplatFileHash?: string;
    gaussianSplatRuntimeKey?: string;
    videoElement?: HTMLVideoElement;
    audioElement?: HTMLAudioElement;
    imageElement?: HTMLImageElement;
  } | null;
};

export function getClipMediaFileId(clip: ClipWithMediaReference): string | undefined {
  return clip.mediaFileId || clip.source?.mediaFileId;
}

function normalizeMediaReference(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
  return normalized || undefined;
}

function getBaseName(value: string | undefined): string | undefined {
  const normalized = normalizeMediaReference(value);
  if (!normalized) return undefined;
  return normalized.split('/').filter(Boolean).pop();
}

function addComparableString(target: Set<string>, value: string | undefined): void {
  const normalized = normalizeMediaReference(value);
  if (!normalized) return;
  target.add(normalized);
}

function pathReferencesMatch(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

interface MediaFileDeleteTarget {
  id: string;
  file?: File;
  fileHash?: string;
  references: Set<string>;
  uniqueNames: Set<string>;
}

export interface MediaFileDeleteMatcher {
  targetIds: Set<string>;
  matchClip: (clip: ClipWithMediaReference) => string | undefined;
}

export function createMediaFileDeleteMatcher(targetFiles: MediaFile[], allFiles: MediaFile[]): MediaFileDeleteMatcher {
  const targetIds = new Set(targetFiles.map(file => file.id));
  const fileNameCounts = new Map<string, number>();

  for (const file of allFiles) {
    const names = [
      normalizeMediaReference(file.name),
      getBaseName(file.projectPath),
      getBaseName(file.filePath),
      getBaseName(file.absolutePath),
    ].filter((value): value is string => Boolean(value));

    for (const name of new Set(names)) {
      fileNameCounts.set(name, (fileNameCounts.get(name) ?? 0) + 1);
    }
  }

  const targets: MediaFileDeleteTarget[] = targetFiles.map((file) => {
    const references = new Set<string>();
    const uniqueNames = new Set<string>();
    addComparableString(references, file.projectPath);
    addComparableString(references, file.filePath);
    addComparableString(references, file.absolutePath);
    addComparableString(references, file.url);
    addComparableString(references, file.thumbnailUrl);
    addComparableString(references, file.proxyVideoUrl);

    for (const name of [
      normalizeMediaReference(file.name),
      getBaseName(file.projectPath),
      getBaseName(file.filePath),
      getBaseName(file.absolutePath),
    ]) {
      if (name && fileNameCounts.get(name) === 1) {
        uniqueNames.add(name);
      }
    }

    return {
      id: file.id,
      file: file.file,
      fileHash: file.fileHash,
      references,
      uniqueNames,
    };
  });

  const matchClip = (clip: ClipWithMediaReference): string | undefined => {
    const directMediaFileId = getClipMediaFileId(clip);
    if (directMediaFileId && targetIds.has(directMediaFileId)) {
      return directMediaFileId;
    }

    const clipSource = clip.source;
    const clipFiles = [clip.file, clipSource?.file].filter((file): file is File => Boolean(file));
    const clipReferences = [
      clipSource?.filePath,
      clipSource?.runtimeSourceId,
      clipSource?.modelUrl,
      clipSource?.gaussianAvatarUrl,
      clipSource?.gaussianSplatUrl,
      clipSource?.gaussianSplatRuntimeKey,
      clipSource?.videoElement?.currentSrc || clipSource?.videoElement?.src,
      clipSource?.audioElement?.currentSrc || clipSource?.audioElement?.src,
      clipSource?.imageElement?.currentSrc || clipSource?.imageElement?.src,
    ]
      .map(normalizeMediaReference)
      .filter((value): value is string => Boolean(value));
    const clipNames = [
      clip.name,
      clip.file?.name,
      clipSource?.file?.name,
      clipSource?.gaussianSplatFileName,
      getBaseName(clipSource?.filePath),
      getBaseName(clipSource?.runtimeSourceId),
      getBaseName(clipSource?.gaussianSplatRuntimeKey),
    ]
      .map(normalizeMediaReference)
      .filter((value): value is string => Boolean(value));

    for (const target of targets) {
      if (target.file && clipFiles.some(file => file === target.file)) {
        return target.id;
      }

      if (target.fileHash && clipSource?.gaussianSplatFileHash === target.fileHash) {
        return target.id;
      }

      if (clipReferences.some(clipReference =>
        [...target.references].some(targetReference => pathReferencesMatch(clipReference, targetReference))
      )) {
        return target.id;
      }

      if (clipNames.some(name => target.uniqueNames.has(name))) {
        return target.id;
      }
    }

    return undefined;
  };

  return { targetIds, matchClip };
}
