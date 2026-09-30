// Main-thread side of the long-WAV peaks worker. Falls back to decimating on
// the calling thread where workers are unavailable (tests, old runtimes).

import type {
  LongWavPeaksWorkerRequest,
  LongWavPeaksWorkerResponse,
} from '../../workers/longWavPeaksWorker';
import {
  decimatePcmWavPeaks,
  peakDecimationToAudioBuffer,
  type PcmWavInfo,
  type PeakDecimationOptions,
} from './longPcmWav';

export async function buildPeakDecimatedAudioBuffer(
  file: Blob,
  info: PcmWavInfo,
  options: { signal?: AbortSignal; onProgress?: PeakDecimationOptions['onProgress'] } = {},
): Promise<AudioBuffer> {
  const { signal, onProgress } = options;
  if (typeof Worker === 'undefined') {
    const peaks = await decimatePcmWavPeaks(file, info, { onProgress, isCancelled: () => signal?.aborted === true });
    return peakDecimationToAudioBuffer(peaks);
  }

  const worker = new Worker(new URL('../../workers/longWavPeaksWorker.ts', import.meta.url), {
    type: 'module',
    name: 'long-wav-peaks',
  });
  const cancel = () => worker.postMessage({ type: 'cancel' } satisfies LongWavPeaksWorkerRequest);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const peaks = await new Promise<{ channels: Float32Array<ArrayBuffer>[]; sampleRate: number }>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<LongWavPeaksWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'progress') onProgress?.(message.fraction, message.preview);
        else if (message.type === 'done') resolve(message);
        else reject(message.aborted ? new DOMException(message.error, 'AbortError') : new Error(message.error));
      };
      worker.onerror = (event) => reject(new Error(`Long WAV peaks worker failed: ${event.message}`));
      worker.postMessage({ type: 'decimate', file, info } satisfies LongWavPeaksWorkerRequest);
    });
    return peakDecimationToAudioBuffer(peaks);
  } finally {
    signal?.removeEventListener('abort', cancel);
    worker.terminate();
  }
}
