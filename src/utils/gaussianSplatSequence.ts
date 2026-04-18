import type {
  GaussianSplatSequenceData,
  GaussianSplatSequenceFrame,
  ModelSequencePlaybackMode,
} from '../types';

const DEFAULT_GAUSSIAN_SPLAT_SEQUENCE_FPS = 30;
const NUMBERED_SPLAT_SEQUENCE_RE = /^(.*?)(\d+)(\.(?:ply|splat))$/i;

export interface GaussianSplatSequenceImportEntry {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
}

export interface GroupedGaussianSplatSequence<T extends GaussianSplatSequenceImportEntry = GaussianSplatSequenceImportEntry> {
  displayName: string;
  entries: T[];
  extension: '.ply' | '.splat';
  frameCount: number;
  prefix: string;
  sequenceName: string;
}

interface ParsedGaussianSplatSequenceName {
  extension: '.ply' | '.splat';
  frameNumber: number;
  prefix: string;
}

function parseSequenceName(fileName: string): ParsedGaussianSplatSequenceName | null {
  const match = fileName.match(NUMBERED_SPLAT_SEQUENCE_RE);
  if (!match) {
    return null;
  }

  const extension = (match[3] ?? '').toLowerCase();
  if (extension !== '.ply' && extension !== '.splat') {
    return null;
  }

  return {
    prefix: match[1] ?? '',
    frameNumber: Number.parseInt(match[2] ?? '', 10),
    extension,
  };
}

function normalizeSequencePrefix(prefix: string): string {
  const trimmed = prefix.replace(/[_\-. ]+$/g, '').trim();
  return trimmed || 'Gaussian Splat Sequence';
}

export function buildGaussianSplatSequenceDisplayName(prefix: string, frameCount: number): string {
  const normalized = normalizeSequencePrefix(prefix);
  return `${normalized} (${frameCount}f)`;
}

export function groupGaussianSplatSequenceEntries<T extends GaussianSplatSequenceImportEntry>(
  entries: T[],
): { sequences: GroupedGaussianSplatSequence<T>[]; singles: T[] } {
  const grouped = new Map<string, Array<{ entry: T; parsed: ParsedGaussianSplatSequenceName }>>();

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
  const sequences: GroupedGaussianSplatSequence<T>[] = [];

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
    const extension = bucket[0]?.parsed.extension ?? '.ply';
    const entriesForSequence = bucket.map(({ entry }) => entry);
    entriesForSequence.forEach((entry) => sequenceEntries.add(entry));

    sequences.push({
      entries: entriesForSequence,
      extension,
      frameCount: entriesForSequence.length,
      prefix,
      sequenceName: normalizeSequencePrefix(prefix),
      displayName: buildGaussianSplatSequenceDisplayName(prefix, entriesForSequence.length),
    });
  }

  const singles = entries.filter((entry) => !sequenceEntries.has(entry));
  return { sequences, singles };
}

export function buildGaussianSplatSequenceData(
  frames: GaussianSplatSequenceFrame[],
  options?: {
    fps?: number;
    playbackMode?: ModelSequencePlaybackMode;
    sequenceName?: string;
  },
): GaussianSplatSequenceData {
  return {
    fps: options?.fps ?? DEFAULT_GAUSSIAN_SPLAT_SEQUENCE_FPS,
    frameCount: frames.length,
    playbackMode: options?.playbackMode ?? 'clamp',
    sequenceName: options?.sequenceName,
    frames,
  };
}

export function getGaussianSplatSequenceDuration(
  sequence: Pick<GaussianSplatSequenceData, 'fps' | 'frameCount'>,
): number {
  const fps = Number.isFinite(sequence.fps) && sequence.fps > 0
    ? sequence.fps
    : DEFAULT_GAUSSIAN_SPLAT_SEQUENCE_FPS;
  return sequence.frameCount > 0 ? sequence.frameCount / fps : 0;
}

export function getGaussianSplatSequenceFrameIndex(
  sequence: Pick<GaussianSplatSequenceData, 'fps' | 'frameCount' | 'playbackMode'>,
  sourceTime: number,
): number {
  const frameCount = sequence.frameCount;
  if (frameCount <= 1) {
    return 0;
  }

  const fps = Number.isFinite(sequence.fps) && sequence.fps > 0
    ? sequence.fps
    : DEFAULT_GAUSSIAN_SPLAT_SEQUENCE_FPS;
  const rawFrame = Math.floor(Math.max(0, sourceTime) * fps);

  if (sequence.playbackMode === 'loop') {
    return ((rawFrame % frameCount) + frameCount) % frameCount;
  }

  return Math.max(0, Math.min(frameCount - 1, rawFrame));
}

export function getGaussianSplatSequenceFrame(
  sequence: GaussianSplatSequenceData | undefined,
  sourceTime: number,
): GaussianSplatSequenceFrame | undefined {
  if (!sequence || sequence.frames.length === 0) {
    return undefined;
  }

  const frameIndex = getGaussianSplatSequenceFrameIndex(sequence, sourceTime);
  return sequence.frames[frameIndex];
}

export function getGaussianSplatSequenceFrameUrl(
  sequence: GaussianSplatSequenceData | undefined,
  sourceTime: number,
  fallbackUrl?: string,
): string | undefined {
  if (!sequence || sequence.frames.length === 0) {
    return fallbackUrl;
  }

  const frameIndex = getGaussianSplatSequenceFrameIndex(sequence, sourceTime);
  const direct = sequence.frames[frameIndex]?.splatUrl;
  if (direct) {
    return direct;
  }

  for (let offset = 1; offset < sequence.frames.length; offset += 1) {
    const previous = sequence.frames[frameIndex - offset]?.splatUrl;
    if (previous) {
      return previous;
    }
    const next = sequence.frames[frameIndex + offset]?.splatUrl;
    if (next) {
      return next;
    }
  }

  return fallbackUrl;
}

export function getGaussianSplatSequenceFrameRuntimeKey(
  sequence: GaussianSplatSequenceData | undefined,
  sourceTime: number,
  fallbackKey?: string,
): string | undefined {
  const frame = getGaussianSplatSequenceFrame(sequence, sourceTime);
  if (!frame) {
    return fallbackKey;
  }

  return (
    frame.projectPath ||
    frame.absolutePath ||
    frame.sourcePath ||
    frame.name ||
    fallbackKey
  );
}

function isRenderableSequenceFile(file: GaussianSplatSequenceFrame['file']): file is File {
  return typeof File !== 'undefined' && file instanceof File;
}

function getRenderableSequenceUrl(
  url: GaussianSplatSequenceFrame['splatUrl'],
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

function getGaussianSplatSequenceFrameIdentity(frame: GaussianSplatSequenceFrame, index: number): string {
  return (
    frame.projectPath ||
    frame.absolutePath ||
    frame.sourcePath ||
    frame.name ||
    `frame-${index}`
  );
}

export function hasRenderableGaussianSplatSequenceFrames(
  sequence: GaussianSplatSequenceData | undefined,
): boolean {
  return !!sequence?.frames.some((frame) => !!frame.file || !!frame.splatUrl);
}

export function resolveGaussianSplatSequenceData(
  primary: GaussianSplatSequenceData | undefined,
  fallback: GaussianSplatSequenceData | undefined,
): GaussianSplatSequenceData | undefined {
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
    fallback.frames.map((frame, index) => [getGaussianSplatSequenceFrameIdentity(frame, index), frame]),
  );

  return {
    ...fallback,
    ...primary,
    frames: primary.frames.map((frame, index) => {
      const fallbackFrame =
        fallbackFrames.get(getGaussianSplatSequenceFrameIdentity(frame, index)) ??
        fallback.frames[index];
      if (!fallbackFrame) {
        const file = isRenderableSequenceFile(frame.file) ? frame.file : undefined;
        return {
          ...frame,
          file,
          splatUrl: getRenderableSequenceUrl(frame.splatUrl, file),
        };
      }

      const primaryFile = isRenderableSequenceFile(frame.file) ? frame.file : undefined;
      const fallbackFile = isRenderableSequenceFile(fallbackFrame.file) ? fallbackFrame.file : undefined;

      return {
        ...fallbackFrame,
        ...frame,
        file: primaryFile ?? fallbackFile,
        splatUrl:
          getRenderableSequenceUrl(frame.splatUrl, primaryFile) ??
          getRenderableSequenceUrl(fallbackFrame.splatUrl, fallbackFile),
      };
    }),
  };
}
