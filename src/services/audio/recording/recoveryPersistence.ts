import { captureRepositoryDomainPublication } from '../../project/repository/artifacts/RepositoryDomainPublication';
import { artifactService } from '../../project/domains/ArtifactService';
import type {
  AudioRecordedAsset,
  AudioRecordingRecoveryBlobStore,
  AudioRecordingRecoveryChunkInput,
  AudioRecordingService,
  AudioRecordingStorageManager,
} from '../AudioRecordingService';

type AudioRecordingRecoveryEntry = ReturnType<AudioRecordingService['listRecoveryEntries']>[number];
type AudioRecordingRecoveryAssetRef = Awaited<ReturnType<AudioRecordingRecoveryBlobStore['putAsset']>>;
type AudioRecordingRecoveryChunkRef = Awaited<ReturnType<AudioRecordingRecoveryBlobStore['putChunk']>>;

export const RECOVERY_STORAGE_KEY = 'masterselects.audioRecording.recovery.v1';

export class ArtifactAudioRecordingRecoveryBlobStore implements AudioRecordingRecoveryBlobStore {
  private readonly store = artifactService.createIndexedDBStore();
  private readonly repository = captureRepositoryDomainPublication();
  async putAsset(asset: AudioRecordedAsset): Promise<AudioRecordingRecoveryAssetRef> {
    const result = await this.store.putArtifact(asset.blob, {
      mimeType: asset.mimeType || asset.blob.type || 'audio/wav',
      encoding: 'raw',
      producer: {
        providerId: 'masterselects.audio.recording',
        providerVersion: '1.0.0',
        jobId: asset.sessionId,
      },
      sourceRefs: [
        `audio-recording:${asset.sessionId}`,
        ...asset.trackIds.map(trackId => `timeline-track:${trackId}`),
      ],
      metadata: {
        audioArtifactRole: 'recording-recovery',
        audioRecordingSessionId: asset.sessionId,
        inputDeviceId: asset.inputDeviceId ?? 'default',
        trackIds: asset.trackIds.join(','),
      },
      createdAt: new Date(asset.stoppedAt).toISOString(),
    });

    return {
      id: asset.id,
      artifactId: result.manifest.artifactId,
      inputDeviceId: asset.inputDeviceId,
      trackIds: asset.trackIds,
      fileName: asset.file.name,
      mimeType: asset.mimeType,
      sourceMimeType: asset.sourceMimeType,
      duration: asset.duration,
      startTime: asset.startTime,
      startedAt: asset.startedAt,
      stoppedAt: asset.stoppedAt,
      sampleRate: asset.sampleRate,
      channelCount: asset.channelCount,
      chunkCount: asset.chunkCount,
    };
  }

  async getAsset(assetRef: Parameters<AudioRecordingRecoveryBlobStore['getAsset']>[0]): Promise<Blob | null> {
    const stored = await this.store.getArtifact(assetRef.artifactId);
    return stored?.blob ?? null;
  }

  async putChunk(chunk: AudioRecordingRecoveryChunkInput): Promise<AudioRecordingRecoveryChunkRef> {
    const result = await this.store.putArtifact(chunk.blob, {
      mimeType: chunk.mimeType || chunk.blob.type || 'application/octet-stream',
      encoding: 'raw',
      producer: {
        providerId: 'masterselects.audio.recording',
        providerVersion: '1.0.0',
        jobId: chunk.sessionId,
      },
      sourceRefs: [
        `audio-recording:${chunk.sessionId}`,
        `audio-recording:${chunk.sessionId}:chunks`,
        ...chunk.trackIds.map(trackId => `timeline-track:${trackId}`),
      ],
      metadata: {
        audioArtifactRole: 'recording-recovery-chunk',
        audioRecordingSessionId: chunk.sessionId,
        audioRecordingChunkIndex: chunk.chunkIndex,
        inputDeviceId: chunk.inputDeviceId ?? 'default',
        trackIds: chunk.trackIds.join(','),
        kind: chunk.kind,
        timeStart: chunk.timeStart,
        duration: chunk.duration ?? 0,
        sampleRate: chunk.sampleRate ?? 0,
        channelCount: chunk.channelCount ?? 0,
        frameCount: chunk.frameCount ?? 0,
      },
      createdAt: new Date(chunk.startedAt + Math.max(0, chunk.timeStart) * 1000).toISOString(),
    });

    return {
      artifactId: result.manifest.artifactId,
      inputDeviceId: chunk.inputDeviceId,
      trackIds: chunk.trackIds,
      chunkIndex: chunk.chunkIndex,
      kind: chunk.kind,
      mimeType: chunk.mimeType,
      startedAt: chunk.startedAt,
      startTime: chunk.startTime,
      timeStart: chunk.timeStart,
      duration: chunk.duration,
      sampleRate: chunk.sampleRate,
      channelCount: chunk.channelCount,
      frameCount: chunk.frameCount,
    };
  }

  async getChunk(chunkRef: Parameters<AudioRecordingRecoveryBlobStore['getChunk']>[0]): Promise<Blob | null> {
    const stored = await this.store.getArtifact(chunkRef.artifactId);
    return stored?.blob ?? null;
  }

  async deleteRef(artifactId: string): Promise<void> {
    if (this.repository) return;
    await this.store.deleteArtifact(artifactId);
  }
}

export function getStorageFromGlobal(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function getRecordingStorageManagerFromGlobal(): AudioRecordingStorageManager | undefined {
  const navigatorLike = globalThis.navigator as { storage?: AudioRecordingStorageManager } | undefined;
  return navigatorLike?.storage;
}

export function readRecoveryEntries(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
): AudioRecordingRecoveryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECOVERY_STORAGE_KEY);
    return parseRecoveryEntriesRaw(raw);
  } catch {
    return [];
  }
}

export function parseRecoveryEntriesRaw(raw: string | null): AudioRecordingRecoveryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is AudioRecordingRecoveryEntry => (
      entry &&
      typeof entry.sessionId === 'string' &&
      Array.isArray(entry.targetTrackIds) &&
      typeof entry.startedAt === 'number' &&
      typeof entry.startTime === 'number'
    )) : [];
  } catch {
    return [];
  }
}

export function writeRecoveryEntries(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
  entries: AudioRecordingRecoveryEntry[],
): void {
  const repository = captureRepositoryDomainPublication();
  if (repository) {
    void repository.appendJournal('audio-recording:recovery', JSON.parse(JSON.stringify(entries)))
      .catch(error => console.error('Recording recovery journal publication failed', error));
  }
  if (!storage) return;
  if (entries.length === 0) {
    storage.removeItem(RECOVERY_STORAGE_KEY);
    return;
  }
  storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(entries));
}

export function appendRecoveryChunk(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
  sessionId: string,
  chunkRef: AudioRecordingRecoveryChunkRef,
): void {
  const entries = readRecoveryEntries(storage);
  const nextEntries = entries.map(entry => {
    if (entry.sessionId !== sessionId) return entry;

    const chunks = entry.chunks ?? [];
    if (chunks.some(candidate => candidate.artifactId === chunkRef.artifactId)) {
      return entry;
    }
    return {
      ...entry,
      chunks: [...chunks, chunkRef].toSorted((a, b) => a.chunkIndex - b.chunkIndex),
    };
  });

  writeRecoveryEntries(storage, nextEntries);
}

export async function deleteRecoveryArtifacts(
  entry: AudioRecordingRecoveryEntry,
  recoveryBlobStore: AudioRecordingRecoveryBlobStore,
): Promise<void> {
  const artifactIds = [
    ...(entry.assets?.map(asset => asset.artifactId) ?? []),
    ...(entry.chunks?.map(chunk => chunk.artifactId) ?? []),
  ];
  if (!recoveryBlobStore.deleteRef || artifactIds.length === 0) return;

  await Promise.allSettled(artifactIds.map(artifactId => recoveryBlobStore.deleteRef!(artifactId)));
}
