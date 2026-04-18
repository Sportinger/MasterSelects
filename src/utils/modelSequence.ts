import type {
  ModelSequenceData,
  ModelSequenceFrame,
  ModelSequencePlaybackMode,
} from '../types';

const DEFAULT_MODEL_SEQUENCE_FPS = 30;
const NUMBERED_GLB_SEQUENCE_RE = /^(.*?)(\d+)(\.glb)$/i;

export interface ModelSequenceImportEntry {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
}

export interface GroupedModelSequence<T extends ModelSequenceImportEntry = ModelSequenceImportEntry> {
  displayName: string;
  entries: T[];
  extension: string;
  frameCount: number;
  prefix: string;
  sequenceName: string;
}

interface ParsedSequenceName {
  extension: string;
  frameNumber: number;
  prefix: string;
}

function parseSequenceName(fileName: string): ParsedSequenceName | null {
  const match = fileName.match(NUMBERED_GLB_SEQUENCE_RE);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1] ?? '',
    frameNumber: Number.parseInt(match[2] ?? '', 10),
    extension: (match[3] ?? '').toLowerCase(),
  };
}

function normalizeSequencePrefix(prefix: string): string {
  const trimmed = prefix.replace(/[_\-. ]+$/g, '').trim();
  return trimmed || 'GLB Sequence';
}

export function buildModelSequenceDisplayName(prefix: string, frameCount: number): string {
  const normalized = normalizeSequencePrefix(prefix);
  return `${normalized} (${frameCount}f)`;
}

export function groupModelSequenceEntries<T extends ModelSequenceImportEntry>(
  entries: T[],
): { sequences: GroupedModelSequence<T>[]; singles: T[] } {
  const grouped = new Map<string, Array<{ entry: T; parsed: ParsedSequenceName }>>();

  for (const entry of entries) {
    const parsed = parseSequenceName(entry.file.name);
    if (!parsed) {
      continue;
    }

    const key = `${parsed.prefix.toLowerCase()}|${parsed.extension}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push({ entry, parsed });
    grouped.set(key, bucket);
  }

  const sequenceEntries = new Set<T>();
  const sequences: GroupedModelSequence<T>[] = [];

  for (const bucket of grouped.values()) {
    if (bucket.length < 2) {
      continue;
    }

    bucket.sort((a, b) => {
      if (a.parsed.frameNumber !== b.parsed.frameNumber) {
        return a.parsed.frameNumber - b.parsed.frameNumber;
      }
      return a.entry.file.name.localeCompare(b.entry.file.name);
    });

    const prefix = bucket[0]?.parsed.prefix ?? '';
    const extension = bucket[0]?.parsed.extension ?? '.glb';
    const entriesForSequence = bucket.map(({ entry }) => entry);
    entriesForSequence.forEach((entry) => sequenceEntries.add(entry));

    sequences.push({
      entries: entriesForSequence,
      extension,
      frameCount: entriesForSequence.length,
      prefix,
      sequenceName: normalizeSequencePrefix(prefix),
      displayName: buildModelSequenceDisplayName(prefix, entriesForSequence.length),
    });
  }

  const singles = entries.filter((entry) => !sequenceEntries.has(entry));
  return { sequences, singles };
}

export function buildModelSequenceData(
  frames: ModelSequenceFrame[],
  options?: {
    fps?: number;
    playbackMode?: ModelSequencePlaybackMode;
    sequenceName?: string;
  },
): ModelSequenceData {
  return {
    fps: options?.fps ?? DEFAULT_MODEL_SEQUENCE_FPS,
    frameCount: frames.length,
    playbackMode: options?.playbackMode ?? 'clamp',
    sequenceName: options?.sequenceName,
    frames,
  };
}

export function getModelSequenceDuration(sequence: Pick<ModelSequenceData, 'fps' | 'frameCount'>): number {
  const fps = Number.isFinite(sequence.fps) && sequence.fps > 0
    ? sequence.fps
    : DEFAULT_MODEL_SEQUENCE_FPS;
  return sequence.frameCount > 0 ? sequence.frameCount / fps : 0;
}

export function getModelSequenceFrameIndex(
  sequence: Pick<ModelSequenceData, 'fps' | 'frameCount' | 'playbackMode'>,
  sourceTime: number,
): number {
  const frameCount = sequence.frameCount;
  if (frameCount <= 1) {
    return 0;
  }

  const fps = Number.isFinite(sequence.fps) && sequence.fps > 0
    ? sequence.fps
    : DEFAULT_MODEL_SEQUENCE_FPS;
  const rawFrame = Math.floor(Math.max(0, sourceTime) * fps);

  if (sequence.playbackMode === 'loop') {
    return ((rawFrame % frameCount) + frameCount) % frameCount;
  }

  return Math.max(0, Math.min(frameCount - 1, rawFrame));
}

export function getModelSequenceFrame(
  sequence: ModelSequenceData | undefined,
  sourceTime: number,
): ModelSequenceFrame | undefined {
  if (!sequence || sequence.frames.length === 0) {
    return undefined;
  }

  const frameIndex = getModelSequenceFrameIndex(sequence, sourceTime);
  return sequence.frames[frameIndex];
}

export function getModelSequenceFrameUrl(
  sequence: ModelSequenceData | undefined,
  sourceTime: number,
  fallbackUrl?: string,
): string | undefined {
  if (!sequence || sequence.frames.length === 0) {
    return fallbackUrl;
  }

  const frameIndex = getModelSequenceFrameIndex(sequence, sourceTime);
  const direct = sequence.frames[frameIndex]?.modelUrl;
  if (direct) {
    return direct;
  }

  for (let offset = 1; offset < sequence.frames.length; offset += 1) {
    const previous = sequence.frames[frameIndex - offset]?.modelUrl;
    if (previous) {
      return previous;
    }
    const next = sequence.frames[frameIndex + offset]?.modelUrl;
    if (next) {
      return next;
    }
  }

  return fallbackUrl;
}

function isRenderableSequenceFile(file: ModelSequenceFrame['file']): file is File {
  return typeof File !== 'undefined' && file instanceof File;
}

function getRenderableSequenceUrl(
  url: ModelSequenceFrame['modelUrl'],
  file: File | undefined,
): string | undefined {
  if (typeof url !== 'string' || url.length === 0) {
    return undefined;
  }
  if (url.startsWith('blob:') && !file) {
    return undefined;
  }
  return url;
}

function getModelSequenceFrameIdentity(frame: ModelSequenceFrame, index: number): string {
  return (
    frame.projectPath ||
    frame.absolutePath ||
    frame.sourcePath ||
    frame.name ||
    `frame-${index}`
  );
}

export function hasRenderableModelSequenceFrames(sequence: ModelSequenceData | undefined): boolean {
  return !!sequence?.frames.some((frame) => !!frame.file || !!frame.modelUrl);
}

export function resolveModelSequenceData(
  primary: ModelSequenceData | undefined,
  fallback: ModelSequenceData | undefined,
): ModelSequenceData | undefined {
  if (!primary) {
    return fallback;
  }
  if (!fallback) {
    return primary;
  }
  if (primary.frames.length === 0) {
    return fallback;
  }

  const fallbackFrames = new Map(
    fallback.frames.map((frame, index) => [getModelSequenceFrameIdentity(frame, index), frame]),
  );

  return {
    ...fallback,
    ...primary,
    frames: primary.frames.map((frame, index) => {
      const fallbackFrame =
        fallbackFrames.get(getModelSequenceFrameIdentity(frame, index)) ??
        fallback.frames[index];
      if (!fallbackFrame) {
        const file = isRenderableSequenceFile(frame.file) ? frame.file : undefined;
        return {
          ...frame,
          file,
          modelUrl: getRenderableSequenceUrl(frame.modelUrl, file),
        };
      }

      const primaryFile = isRenderableSequenceFile(frame.file) ? frame.file : undefined;
      const fallbackFile = isRenderableSequenceFile(fallbackFrame.file) ? fallbackFrame.file : undefined;

      return {
        ...fallbackFrame,
        ...frame,
        file: primaryFile ?? fallbackFile,
        modelUrl:
          getRenderableSequenceUrl(frame.modelUrl, primaryFile) ??
          getRenderableSequenceUrl(fallbackFrame.modelUrl, fallbackFile),
      };
    }),
  };
}
