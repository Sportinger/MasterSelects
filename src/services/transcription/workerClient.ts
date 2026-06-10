import type { TranscriptWord } from '../../types/clipMetadata';
import type { ClipTranscriptUpdate } from './artifactPersistence';

type TranscriptUpdater = (clipId: string, data: ClipTranscriptUpdate) => void;

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
