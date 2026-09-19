import type { TranscriptWord } from '../../types/clipMetadata';
import type { ClipTranscriptUpdate } from './artifactPersistence';

type TranscriptUpdater = (clipId: string, data: ClipTranscriptUpdate) => void;

export interface LocalWhisperWorkerSession {
  load: (
    language: string,
    onProgress?: (progress: number, message: string) => void,
  ) => Promise<void>;
  terminate: () => void;
  transcribe: (
    audioData: Float32Array,
    language: string,
    audioDuration: number,
    onProgress?: (progress: number, message: string) => void,
  ) => Promise<TranscriptWord[]>;
}

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../../workers/transcriptionWorker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return worker;
}

function createWorker(): Worker {
  return new Worker(
    new URL('../../workers/transcriptionWorker.ts', import.meta.url),
    { type: 'module' },
  );
}

/**
 * Creates an isolated, reusable Whisper worker for short interactive jobs.
 * The caller must serialize requests and terminate the session when finished.
 */
export function createLocalWhisperWorkerSession(): LocalWhisperWorkerSession {
  const sessionWorker = createWorker();
  let activeReject: ((reason?: unknown) => void) | null = null;
  let terminated = false;

  const run = <T>(
    message: Record<string, unknown>,
    transfer: Transferable[],
    completeType: 'complete' | 'ready',
    resolveValue: (event: MessageEvent) => T,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<T> => new Promise((resolve, reject) => {
    if (terminated) {
      reject(new DOMException('Whisper worker session was terminated.', 'AbortError'));
      return;
    }
    if (activeReject) {
      reject(new Error('Whisper worker session already has an active request.'));
      return;
    }

    const cleanup = () => {
      sessionWorker.removeEventListener('message', handleMessage);
      sessionWorker.removeEventListener('error', handleError);
      activeReject = null;
    };
    const handleMessage = (event: MessageEvent) => {
      const { type, progress, message: progressMessage, error } = event.data;
      if (type === 'progress') {
        onProgress?.(progress, progressMessage);
        return;
      }
      if (type === completeType) {
        cleanup();
        resolve(resolveValue(event));
        return;
      }
      if (type === 'error') {
        cleanup();
        reject(new Error(error));
      }
    };
    const handleError = (error: ErrorEvent) => {
      cleanup();
      reject(new Error(error.message || 'Whisper worker error'));
    };

    activeReject = reject;
    sessionWorker.addEventListener('message', handleMessage);
    sessionWorker.addEventListener('error', handleError);
    sessionWorker.postMessage(message, transfer);
  });

  return {
    load: (language, onProgress) => run(
      { type: 'load', language },
      [],
      'ready',
      () => undefined,
      onProgress,
    ),
    transcribe: (audioData, language, audioDuration, onProgress) => run(
      { type: 'transcribe', audioData, language, audioDuration },
      [audioData.buffer],
      'complete',
      (event) => event.data.words as TranscriptWord[],
      onProgress,
    ),
    terminate: () => {
      if (terminated) return;
      terminated = true;
      activeReject?.(new DOMException('Whisper worker session was terminated.', 'AbortError'));
      activeReject = null;
      sessionWorker.terminate();
    },
  };
}

/**
 * Run transcription in Web Worker.
 * @param inPointOffset Offset to add to word timestamps for trimmed clips.
 */
export function runWorkerTranscription(
  clipId: string,
  audioData: Float32Array,
  language: string,
  audioDuration: number,
  inPointOffset: number = 0,
  updateClipTranscript: TranscriptUpdater,
): Promise<TranscriptWord[]> {
  return new Promise((resolve, reject) => {
    const w = getWorker();

    const offsetWords = (words: TranscriptWord[]): TranscriptWord[] =>
      words.map(word => ({
        ...word,
        start: word.start + inPointOffset,
        end: word.end + inPointOffset,
      }));

    const cleanup = () => {
      w.removeEventListener('message', handleMessage);
      w.removeEventListener('error', handleError);
    };

    const handleMessage = (event: MessageEvent) => {
      const { type, progress, message, words, error } = event.data;

      switch (type) {
        case 'progress':
          updateClipTranscript(clipId, { progress, message });
          break;

        case 'words':
          updateClipTranscript(clipId, {
            words: offsetWords(words),
            message: `Transcribed ${words.length} words`,
          });
          break;

        case 'complete':
          cleanup();
          resolve(offsetWords(words));
          break;

        case 'error':
          cleanup();
          reject(new Error(error));
          break;
      }
    };

    const handleError = (error: ErrorEvent) => {
      cleanup();
      reject(new Error(error.message || 'Worker error'));
    };

    w.addEventListener('message', handleMessage);
    w.addEventListener('error', handleError);

    w.postMessage(
      { type: 'transcribe', audioData, language, audioDuration },
      [audioData.buffer],
    );
  });
}

export function terminateTranscriptionWorker(): boolean {
  if (!worker) return false;
  worker.terminate();
  worker = null;
  return true;
}
