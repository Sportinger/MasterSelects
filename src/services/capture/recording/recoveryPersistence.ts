import { artifactService } from '../../project/domains/ArtifactService';
import type { CaptureTier } from './sessionTypes';

export const CAPTURE_RECOVERY_STORAGE_KEY = 'masterselects.captureRecording.recovery.v1';
const CAPTURE_PRODUCER_ID = 'masterselects.capture.recording';

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface CaptureRecoveryChunkInput {
  sessionId: string;
  chunkIndex: number;
  blob: Blob;
  mimeType: string;
  startedAt: number;
  timeStart: number;
  duration?: number;
  position?: number;
}

export interface CaptureRecoveryChunkRef {
  artifactId: string;
  chunkIndex: number;
  mimeType: string;
  bytes: number;
  startedAt: number;
  timeStart: number;
  duration?: number;
  position?: number;
}

export interface CaptureRecoveryEntry {
  sessionId: string;
  status: 'active' | 'paused' | 'stopped' | 'error' | 'committed';
  tier: CaptureTier;
  startedAt: number;
  stoppedAt?: number;
  mimeType?: string;
  durationSeconds?: number;
  bytes?: number;
  chunks: CaptureRecoveryChunkRef[];
  committedMediaFileId?: string;
  committedAt?: number;
  message?: string;
  recoverable?: boolean;
}

export interface CaptureRecoveryBlobStore {
  putChunk(input: CaptureRecoveryChunkInput): Promise<CaptureRecoveryChunkRef>;
  getChunk(ref: CaptureRecoveryChunkRef): Promise<Blob | null>;
  deleteRef?(artifactId: string): Promise<void>;
}

interface CaptureArtifactAccess {
  put(blob: Blob, options: Parameters<typeof artifactService.putIndexedDBArtifact>[1]): Promise<string>;
  get(artifactId: string): Promise<Blob | null>;
  delete(artifactId: string): Promise<void>;
}

const defaultArtifactAccess: CaptureArtifactAccess = {
  async put(blob, options) {
    const result = await artifactService.putIndexedDBArtifact(blob, options);
    return result.manifest.artifactId;
  },
  async get(artifactId) {
    return (await artifactService.getIndexedDBArtifact(artifactId))?.blob ?? null;
  },
  async delete(artifactId) {
    await artifactService.createIndexedDBStore().deleteArtifact(artifactId);
  },
};

export class ArtifactCaptureRecordingBlobStore implements CaptureRecoveryBlobStore {
  private readonly artifacts: CaptureArtifactAccess;

  constructor(artifacts: CaptureArtifactAccess = defaultArtifactAccess) {
    this.artifacts = artifacts;
  }

  async putChunk(input: CaptureRecoveryChunkInput): Promise<CaptureRecoveryChunkRef> {
    const artifactId = await this.artifacts.put(input.blob, {
      mimeType: input.mimeType || input.blob.type || 'application/octet-stream',
      encoding: 'raw',
      producer: {
        providerId: CAPTURE_PRODUCER_ID,
        providerVersion: '1.0.0',
        jobId: input.sessionId,
      },
      sourceRefs: [`capture-recording:${input.sessionId}`, `capture-recording:${input.sessionId}:chunks`],
      metadata: {
        captureArtifactRole: input.position === undefined ? 'recording-recovery-chunk' : 'recording-recovery-positioned-run',
        captureRecordingSessionId: input.sessionId,
        captureRecordingChunkIndex: input.chunkIndex,
        timeStart: input.timeStart,
        duration: input.duration ?? 0,
        ...(input.position === undefined ? {} : { position: input.position }),
      },
      createdAt: new Date(input.startedAt + Math.max(0, input.timeStart) * 1000).toISOString(),
    });
    return {
      artifactId,
      chunkIndex: input.chunkIndex,
      mimeType: input.mimeType,
      bytes: input.blob.size,
      startedAt: input.startedAt,
      timeStart: input.timeStart,
      duration: input.duration,
      position: input.position,
    };
  }

  getChunk(ref: CaptureRecoveryChunkRef): Promise<Blob | null> {
    return this.artifacts.get(ref.artifactId);
  }

  deleteRef(artifactId: string): Promise<void> {
    return this.artifacts.delete(artifactId);
  }
}

export async function reassembleCaptureRecoveryRecording(
  entry: CaptureRecoveryEntry,
  blobStore: CaptureRecoveryBlobStore,
): Promise<Blob> {
  const refs = entry.chunks.toSorted((a, b) => a.chunkIndex - b.chunkIndex);
  if (refs.length === 0) throw new Error('The screen recording has no persisted recovery data.');
  const positioned = refs.some(ref => ref.position !== undefined);
  if (positioned && refs.some(ref => ref.position === undefined)) {
    throw new Error('The screen recording recovery data mixes positioned and sequential chunks.');
  }

  if (!positioned) {
    const parts: Blob[] = [];
    for (const ref of refs) {
      const blob = await blobStore.getChunk(ref);
      if (!blob) throw new Error('One or more screen recording recovery chunks are missing.');
      parts.push(blob);
    }
    return new Blob(parts, { type: entry.mimeType ?? refs[0]?.mimeType ?? 'application/octet-stream' });
  }

  let segments: { start: number; end: number; blob: Blob }[] = [];
  for (const ref of refs) {
    const blob = await blobStore.getChunk(ref);
    if (!blob) throw new Error('One or more screen recording recovery runs are missing.');
    if (blob.size !== ref.bytes) throw new Error('A screen recording recovery run has an invalid size.');
    const start = ref.position!;
    const end = start + blob.size;
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('A screen recording recovery run has an invalid position.');
    const next: typeof segments = [];
    for (const segment of segments) {
      if (segment.end <= start || segment.start >= end) {
        next.push(segment);
        continue;
      }
      if (segment.start < start) next.push({
        start: segment.start,
        end: start,
        blob: segment.blob.slice(0, start - segment.start),
      });
      if (segment.end > end) next.push({
        start: end,
        end: segment.end,
        blob: segment.blob.slice(end - segment.start),
      });
    }
    next.push({ start, end, blob });
    segments = next.toSorted((a, b) => a.start - b.start);
  }
  const parts: BlobPart[] = [];
  const zeroes = new Uint8Array(64 * 1024);
  let position = 0;
  for (const segment of segments) {
    for (let gap = segment.start - position; gap > 0; gap -= zeroes.byteLength) {
      parts.push(zeroes.subarray(0, Math.min(gap, zeroes.byteLength)));
    }
    parts.push(segment.blob);
    position = segment.end;
  }
  return new Blob(parts, { type: entry.mimeType ?? 'video/mp4' });
}

let fallbackValues = new Map<string, string>();
if (import.meta.hot?.data?.captureRecoveryFallback instanceof Map) {
  fallbackValues = import.meta.hot.data.captureRecoveryFallback as Map<string, string>;
}
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(data => { data.captureRecoveryFallback = fallbackValues; });
}
const fallbackStorage: RecoveryStorage = {
  getItem: key => fallbackValues.get(key) ?? null,
  setItem: (key, value) => { fallbackValues.set(key, value); },
  removeItem: key => { fallbackValues.delete(key); },
};

export function getCaptureRecoveryStorage(): RecoveryStorage {
  try {
    return globalThis.localStorage ?? fallbackStorage;
  } catch {
    return fallbackStorage;
  }
}

export function parseCaptureRecoveryEntries(raw: string | null): CaptureRecoveryEntry[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry): entry is CaptureRecoveryEntry => (
      typeof entry === 'object' && entry !== null
      && typeof (entry as CaptureRecoveryEntry).sessionId === 'string'
      && typeof (entry as CaptureRecoveryEntry).startedAt === 'number'
      && ['active', 'paused', 'stopped', 'error', 'committed'].includes((entry as CaptureRecoveryEntry).status)
      && ['media-recorder', 'webcodecs'].includes((entry as CaptureRecoveryEntry).tier)
      && Array.isArray((entry as CaptureRecoveryEntry).chunks)
    )) : [];
  } catch {
    return [];
  }
}

export function readCaptureRecoveryEntries(storage: RecoveryStorage | undefined): CaptureRecoveryEntry[] {
  if (!storage) return [];
  try {
    return parseCaptureRecoveryEntries(storage.getItem(CAPTURE_RECOVERY_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeCaptureRecoveryEntries(
  storage: RecoveryStorage | undefined,
  entries: readonly CaptureRecoveryEntry[],
): void {
  if (!storage) return;
  if (entries.length === 0) storage.removeItem(CAPTURE_RECOVERY_STORAGE_KEY);
  else storage.setItem(CAPTURE_RECOVERY_STORAGE_KEY, JSON.stringify(entries));
}

export function upsertCaptureRecoveryEntry(
  storage: RecoveryStorage | undefined,
  entry: CaptureRecoveryEntry,
): void {
  const entries = readCaptureRecoveryEntries(storage);
  const previous = entries.find(candidate => candidate.sessionId === entry.sessionId);
  writeCaptureRecoveryEntries(storage, [
    ...entries.filter(candidate => candidate.sessionId !== entry.sessionId),
    { ...previous, ...entry, chunks: entry.chunks ?? previous?.chunks ?? [] },
  ]);
}

export function appendCaptureRecoveryChunk(
  storage: RecoveryStorage | undefined,
  sessionId: string,
  chunk: CaptureRecoveryChunkRef,
): void {
  writeCaptureRecoveryEntries(storage, readCaptureRecoveryEntries(storage).map(entry => entry.sessionId !== sessionId
    ? entry
    : {
        ...entry,
        chunks: [...entry.chunks.filter(candidate => candidate.chunkIndex !== chunk.chunkIndex), chunk]
          .toSorted((a, b) => a.chunkIndex - b.chunkIndex),
      }));
}

export async function deleteCaptureRecoveryEntry(
  storage: RecoveryStorage | undefined,
  blobStore: CaptureRecoveryBlobStore,
  sessionId: string,
): Promise<void> {
  const entries = readCaptureRecoveryEntries(storage);
  const entry = entries.find(candidate => candidate.sessionId === sessionId);
  writeCaptureRecoveryEntries(storage, entries.filter(candidate => candidate.sessionId !== sessionId));
  if (entry && blobStore.deleteRef) {
    await Promise.allSettled(entry.chunks.map(chunk => blobStore.deleteRef!(chunk.artifactId)));
  }
}
