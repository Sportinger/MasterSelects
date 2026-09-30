// Long-WAV peaks worker: streams an hour-long PCM stem block by block and
// decimates it to a peak-preserving 3 kHz waveform source off the main thread.
// Progress messages carry a coarse preview so the waveform grows while it reads.

import { decimatePcmWavPeaks, type PcmWavInfo } from '../services/audio/longPcmWav';

export type LongWavPeaksWorkerRequest =
  | { type: 'decimate'; file: Blob; info: PcmWavInfo }
  | { type: 'cancel' };

export type LongWavPeaksWorkerResponse =
  | { type: 'progress'; fraction: number; preview: number[] }
  | { type: 'done'; channels: Float32Array<ArrayBuffer>[]; sampleRate: number }
  | { type: 'error'; error: string; aborted: boolean };

let cancelled = false;

function post(message: LongWavPeaksWorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

self.onmessage = async (event: MessageEvent<LongWavPeaksWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelled = true;
    return;
  }
  try {
    const peaks = await decimatePcmWavPeaks(request.file, request.info, {
      isCancelled: () => cancelled,
      onProgress: (fraction, preview) => post({ type: 'progress', fraction, preview }),
    });
    post({ type: 'done', channels: peaks.channels, sampleRate: peaks.sampleRate }, peaks.channels.map((data) => data.buffer));
  } catch (error) {
    post({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
      aborted: error instanceof DOMException && error.name === 'AbortError',
    });
  }
};
