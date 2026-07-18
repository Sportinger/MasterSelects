// Relink matching — candidate maps, expected file names, and match resolution

import type { MediaFile } from '../../../stores/mediaStore';
import type {
  GaussianSplatSequenceFrame,
  ModelSequenceFrame,
} from '../../../types';

export interface RelinkCandidate {
  name: string;
  file?: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
  relativePath?: string;
}

export type RelinkCandidateMap = Map<string, RelinkCandidate[]>;

export type RelinkMatch =
  | {
      kind: 'single';
      candidate: RelinkCandidate;
    }
  | {
      kind: 'model-sequence';
      frames: Array<{ index: number; candidate: RelinkCandidate }>;
    }
  | {
      kind: 'gaussian-splat-sequence';
      frames: Array<{ index: number; candidate: RelinkCandidate }>;
    };

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function getNativeHandlePath(handle: FileSystemFileHandle | undefined): string | undefined {
  return (handle as (FileSystemFileHandle & { __nativePath?: string }) | undefined)?.__nativePath;
}

function getRelinkHandlePath(handle: FileSystemFileHandle | undefined): string | undefined {
  return (handle as (FileSystemFileHandle & { __relinkPath?: string }) | undefined)?.__relinkPath;
}

export function setRelinkHandlePath(handle: FileSystemFileHandle, path: string): void {
  (handle as FileSystemFileHandle & { __relinkPath?: string }).__relinkPath = normalizePath(path)
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

function getBaseName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizePath(value);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || undefined;
}

function normalizeKey(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function uniqueValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    const key = normalizeKey(normalizePath(normalized));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

function commonPathSuffixLength(left: string, right: string): number {
  const leftParts = normalizePath(left).toLowerCase().split('/').filter(Boolean);
  const rightParts = normalizePath(right).toLowerCase().split('/').filter(Boolean);
  let count = 0;
  while (
    count < leftParts.length &&
    count < rightParts.length &&
    leftParts[leftParts.length - 1 - count] === rightParts[rightParts.length - 1 - count]
  ) {
    count++;
  }
  return count;
}

function getCandidatePath(candidate: RelinkCandidate): string {
  return candidate.absolutePath ?? candidate.relativePath ?? candidate.name;
}

function findCandidate(values: string[], candidates: RelinkCandidateMap): RelinkCandidate | undefined {
  const matches = new Set<RelinkCandidate>();
  for (const value of values) {
    const name = getBaseName(value) ?? value;
    for (const candidate of candidates.get(name.toLowerCase()) ?? []) {
      matches.add(candidate);
    }
  }

  if (matches.size === 1) return matches.values().next().value;
  if (matches.size === 0) return undefined;

  let best: RelinkCandidate | undefined;
  let bestScore = 1;
  let tied = false;
  for (const candidate of matches) {
    const score = Math.max(...values.map((value) => commonPathSuffixLength(value, getCandidatePath(candidate))));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }

  return bestScore >= 2 && !tied ? best : undefined;
}

function getModelFrameExpectedNames(frame: ModelSequenceFrame): string[] {
  return uniqueValues([
    frame.name,
    frame.sourcePath,
    frame.absolutePath,
    frame.projectPath,
  ]);
}

function getGaussianFrameExpectedNames(frame: GaussianSplatSequenceFrame): string[] {
  return uniqueValues([
    frame.name,
    frame.sourcePath,
    frame.absolutePath,
    frame.projectPath,
  ]);
}

export function getRelinkExpectedFileNames(mediaFile: MediaFile): string[] {
  if (mediaFile.modelSequence?.frames.length) {
    return mediaFile.modelSequence.frames
      .flatMap(getModelFrameExpectedNames)
      .map((value) => getBaseName(value) ?? value);
  }

  if (mediaFile.gaussianSplatSequence?.frames.length) {
    return mediaFile.gaussianSplatSequence.frames
      .flatMap(getGaussianFrameExpectedNames)
      .map((value) => getBaseName(value) ?? value);
  }

  return uniqueValues([
    mediaFile.name,
    mediaFile.filePath,
    mediaFile.absolutePath,
    mediaFile.projectPath,
    mediaFile.file?.name,
  ]).map((value) => getBaseName(value) ?? value);
}

function getSingleExpectedValues(mediaFile: MediaFile): string[] {
  return uniqueValues([
    mediaFile.name,
    mediaFile.filePath,
    mediaFile.absolutePath,
    mediaFile.projectPath,
    mediaFile.file?.name,
  ]);
}

export function findRelinkMatch(
  mediaFile: MediaFile,
  candidates: RelinkCandidateMap,
  options?: { directCandidate?: RelinkCandidate },
): RelinkMatch | null {
  const modelSequence = mediaFile.modelSequence;
  if (modelSequence?.frames.length) {
    const frames: Array<{ index: number; candidate: RelinkCandidate }> = [];

    for (let index = 0; index < modelSequence.frames.length; index += 1) {
      const frame = modelSequence.frames[index];
      const candidate = frame ? findCandidate(getModelFrameExpectedNames(frame), candidates) : undefined;
      if (!candidate) return null;
      frames.push({ index, candidate });
    }

    return { kind: 'model-sequence', frames };
  }

  const gaussianSplatSequence = mediaFile.gaussianSplatSequence;
  if (gaussianSplatSequence?.frames.length) {
    const frames: Array<{ index: number; candidate: RelinkCandidate }> = [];

    for (let index = 0; index < gaussianSplatSequence.frames.length; index += 1) {
      const frame = gaussianSplatSequence.frames[index];
      const candidate = frame ? findCandidate(getGaussianFrameExpectedNames(frame), candidates) : undefined;
      if (!candidate) return null;
      frames.push({ index, candidate });
    }

    return { kind: 'gaussian-splat-sequence', frames };
  }

  const matched = findCandidate(getSingleExpectedValues(mediaFile), candidates)
    ?? options?.directCandidate;

  return matched ? { kind: 'single', candidate: matched } : null;
}

export async function createRelinkCandidateMapFromHandles(
  handles: Iterable<FileSystemFileHandle>,
): Promise<RelinkCandidateMap> {
  const candidates: RelinkCandidateMap = new Map();

  for (const handle of handles) {
    const candidate: RelinkCandidate = {
      name: handle.name,
      handle,
      absolutePath: getNativeHandlePath(handle),
      relativePath: getRelinkHandlePath(handle),
    };
    const key = candidate.name.toLowerCase();
    candidates.set(key, [...(candidates.get(key) ?? []), candidate]);
  }

  return candidates;
}
