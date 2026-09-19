import type { MediaFile } from '../../stores/mediaStore';
import { useMediaStore } from '../../stores/mediaStore';
import { hydrateMediaSourceArtifacts } from '../mediaArtifacts/mediaSourceArtifacts';

export interface SeedanceTranscriptPreflightResult {
  mediaCount: number;
  transcriptCount: number;
}

export interface SeedanceTranscriptPreflightDependencies {
  hydrate(mediaFileId: string): Promise<unknown>;
  queue(mediaFileId: string): Promise<unknown>;
  readFiles(): readonly MediaFile[];
  subscribe(listener: () => void): () => void;
}

function needsTranscript(file: MediaFile): boolean {
  if (file.type === 'audio') return true;
  if (file.type !== 'video') return false;
  return !(file.hasAudio === false && !file.audioCodec);
}

function defaultDependencies(): SeedanceTranscriptPreflightDependencies {
  return {
    hydrate: hydrateMediaSourceArtifacts,
    queue: async (mediaFileId) => {
      const { queueMediaFileTranscription } = await import('../clipTranscriber');
      return queueMediaFileTranscription(mediaFileId, 'auto', { provider: 'hybrid' });
    },
    readFiles: () => useMediaStore.getState().files,
    subscribe: (listener) => useMediaStore.subscribe(listener),
  };
}

function abortError(): DOMException {
  return new DOMException('Story source preparation stopped.', 'AbortError');
}

export async function ensureSeedanceSourceTranscripts(
  signal?: AbortSignal,
  dependencies: SeedanceTranscriptPreflightDependencies = defaultDependencies(),
  sourceMediaFileIds?: ReadonlySet<string>,
): Promise<SeedanceTranscriptPreflightResult> {
  signal?.throwIfAborted();
  const selectedFiles = () => dependencies.readFiles().filter((file) => (
    sourceMediaFileIds === undefined || sourceMediaFileIds.has(file.id)
  ));
  await Promise.allSettled(selectedFiles().map((file) => dependencies.hydrate(file.id)));
  signal?.throwIfAborted();
  const candidates = selectedFiles().filter(needsTranscript);
  const unavailable = candidates.filter((file) => file.transcriptStatus !== 'ready' && !file.file);
  if (unavailable.length > 0) {
    throw new Error(`Transcription requires the original source file: ${unavailable.map((file) => file.name).join(', ')}`);
  }
  const existingErrors = candidates.filter((file) => file.transcriptStatus === 'error');
  if (existingErrors.length > 0) {
    throw new Error(`Source transcription must succeed before visual ideation: ${existingErrors.map((file) => file.name).join(', ')}`);
  }
  const missing = candidates.filter((file) => file.transcriptStatus !== 'ready');
  if (missing.length === 0) {
    return { mediaCount: candidates.length, transcriptCount: candidates.length };
  }

  await Promise.all(missing.map((file) => dependencies.queue(file.id)));
  return new Promise<SeedanceTranscriptPreflightResult>((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const inspect = (): void => {
      const currentById = new Map(dependencies.readFiles().map((file) => [file.id, file]));
      const current = candidates.map((file) => currentById.get(file.id)).filter((file): file is MediaFile => file !== undefined);
      const failed = current.filter((file) => file.transcriptStatus === 'error');
      if (failed.length > 0) {
        finish(() => reject(new Error(`Source transcription failed before visual ideation: ${failed.map((file) => file.name).join(', ')}`)));
        return;
      }
      if (current.length === candidates.length && current.every((file) => file.transcriptStatus === 'ready')) {
        finish(() => resolve({ mediaCount: candidates.length, transcriptCount: current.length }));
      }
    };
    unsubscribe = dependencies.subscribe(inspect);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else inspect();
  });
}

export const seedanceTranscriptPreflightInternals = { needsTranscript };
