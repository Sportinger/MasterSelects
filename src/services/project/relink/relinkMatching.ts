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
}

export type RelinkCandidateMap = Map<string, RelinkCandidate>;

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

function getBaseName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizePath(value);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || undefined;
}

function normalizeKey(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function uniqueNames(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const value of values) {
    const name = getBaseName(value) ?? value;
    if (!name) continue;
    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

function findCandidate(names: string[], candidates: RelinkCandidateMap): RelinkCandidate | undefined {
  for (const name of names) {
    const candidate = candidates.get(name.toLowerCase());
    if (candidate) return candidate;
  }
  return undefined;
}

function getModelFrameExpectedNames(frame: ModelSequenceFrame): string[] {
  return uniqueNames([
    frame.name,
    frame.sourcePath,
    frame.absolutePath,
    frame.projectPath,
  ]);
}

function getGaussianFrameExpectedNames(frame: GaussianSplatSequenceFrame): string[] {
  return uniqueNames([
    frame.name,
    frame.sourcePath,
    frame.absolutePath,
    frame.projectPath,
  ]);
}

export function getRelinkExpectedFileNames(mediaFile: MediaFile): string[] {
  if (mediaFile.modelSequence?.frames.length) {
    return mediaFile.modelSequence.frames.flatMap(getModelFrameExpectedNames);
  }

  if (mediaFile.gaussianSplatSequence?.frames.length) {
    return mediaFile.gaussianSplatSequence.frames.flatMap(getGaussianFrameExpectedNames);
  }

  return uniqueNames([
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

  const matched = findCandidate(getRelinkExpectedFileNames(mediaFile), candidates)
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
    };
    candidates.set(candidate.name.toLowerCase(), candidate);
  }

  return candidates;
}
