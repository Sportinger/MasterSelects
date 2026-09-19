import { useMediaStore } from '../../stores/mediaStore';
import { Logger } from '../logger';
import {
  ArtifactCaptureRecordingBlobStore,
  type CaptureRecoveryBlobStore,
  type CaptureRecoveryChunkRef,
} from '../capture/recording/recoveryPersistence';

const log = Logger.create('LocalStreamRecorder');
const RECORDING_TIMESLICE_MS = 4_000;
const DEFAULT_MIME_TYPE_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=h264,opus',
  'video/webm',
];

type MediaRecorderConstructor = {
  new(stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported(mimeType: string): boolean;
};

export interface LocalStreamRecordingHandle {
  stop(): Promise<{ importedMediaName: string | null }>;
  cancel(): Promise<void>;
}

export interface LocalStreamRecordingDeps {
  MediaRecorderImpl?: MediaRecorderConstructor;
  blobStore?: CaptureRecoveryBlobStore;
  importFile?: (file: File) => Promise<{ name: string }>;
}

function recordingFileName(startedAt: number, mimeType: string): string {
  const date = new Date(startedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const extension = mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
  return `Stream Recording ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${extension}`;
}

export function startLocalStreamRecording(
  stream: MediaStream,
  opts: { mimeTypeCandidates?: string[]; now?: () => number } = {},
  deps: LocalStreamRecordingDeps = {},
): LocalStreamRecordingHandle {
  const MediaRecorderImpl = deps.MediaRecorderImpl ?? globalThis.MediaRecorder;
  if (!MediaRecorderImpl) throw new Error('MediaRecorder is not available in this browser.');

  const candidates = opts.mimeTypeCandidates ?? DEFAULT_MIME_TYPE_CANDIDATES;
  const mimeType = candidates.find(candidate => MediaRecorderImpl.isTypeSupported(candidate));
  if (!mimeType) throw new Error('No supported local stream recording format is available.');

  const now = opts.now ?? Date.now;
  const startedAt = now();
  const sessionId = `stream-rec-${startedAt}`;
  const blobStore = deps.blobStore ?? new ArtifactCaptureRecordingBlobStore();
  const importFile = deps.importFile ?? (file => useMediaStore.getState().importFile(file));
  const recorder = new MediaRecorderImpl(stream, { mimeType });
  const chunkRefs: CaptureRecoveryChunkRef[] = [];
  let nextChunkIndex = 0;
  let pendingWrites: Promise<void> = Promise.resolve();
  let terminalMode: 'stop' | 'cancel' | null = null;
  let terminalPromise: Promise<{ importedMediaName: string | null }> | null = null;

  recorder.ondataavailable = (event: BlobEvent) => {
    if (!event.data || event.data.size === 0) return;
    const chunkIndex = nextChunkIndex++;
    const timeStart = Number.isFinite(event.timecode)
      ? Math.max(0, event.timecode) / 1_000
      : chunkIndex * RECORDING_TIMESLICE_MS / 1_000;
    pendingWrites = pendingWrites.then(async () => {
      const ref = await blobStore.putChunk({
        sessionId,
        chunkIndex,
        blob: event.data,
        mimeType: event.data.type || recorder.mimeType || mimeType,
        startedAt,
        timeStart,
      });
      chunkRefs.push(ref);
    });
  };

  recorder.start(RECORDING_TIMESLICE_MS);

  const stopRecorder = () => new Promise<void>((resolve, reject) => {
    if (recorder.state === 'inactive') {
      resolve();
      return;
    }
    recorder.onstop = () => resolve();
    recorder.onerror = event => reject(event.error);
    try {
      recorder.stop();
    } catch (error) {
      reject(error);
    }
  });

  const deletePersistedChunks = async () => {
    if (!blobStore.deleteRef) {
      log.error('Local stream recording chunks could not be deleted because the blob store has no delete operation.', {
        sessionId,
        artifactIds: chunkRefs.map(ref => ref.artifactId),
      });
      return;
    }
    const results = await Promise.allSettled(chunkRefs.map(ref => blobStore.deleteRef!(ref.artifactId)));
    const failedArtifactIds = results.flatMap((result, index) => result.status === 'rejected'
      ? [chunkRefs[index].artifactId]
      : []);
    if (failedArtifactIds.length > 0) {
      log.error('Some local stream recording chunks could not be deleted.', {
        sessionId,
        artifactIds: failedArtifactIds,
      });
    }
  };

  const finalize = (mode: 'stop' | 'cancel') => {
    if (terminalPromise) return terminalPromise;
    terminalMode = mode;
    terminalPromise = (async () => {
      await stopRecorder();
      await pendingWrites;

      if (terminalMode === 'cancel') {
        await deletePersistedChunks();
        return { importedMediaName: null };
      }

      const orderedRefs = chunkRefs.toSorted((a, b) => a.chunkIndex - b.chunkIndex);
      const artifactIds = orderedRefs.map(ref => ref.artifactId);
      try {
        const chunks: Blob[] = [];
        for (const ref of orderedRefs) {
          const chunk = await blobStore.getChunk(ref);
          if (!chunk) throw new Error(`Missing persisted recording chunk ${ref.artifactId}.`);
          chunks.push(chunk);
        }
        const outputType = recorder.mimeType || mimeType;
        const recording = new Blob(chunks, { type: outputType });
        const file = new File([recording], recordingFileName(startedAt, outputType), { type: outputType });
        const imported = await importFile(file);
        await deletePersistedChunks();
        return { importedMediaName: imported.name };
      } catch (error) {
        log.error('Local stream recording could not be imported. Persisted artifact ids follow before cleanup.', {
          error,
          sessionId,
          artifactIds,
        });
        await deletePersistedChunks();
        return { importedMediaName: null };
      }
    })();
    return terminalPromise;
  };

  return {
    stop: () => finalize('stop'),
    cancel: async () => { await finalize('cancel'); },
  };
}
