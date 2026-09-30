// MXF audio proxy worker: streams the PCM elements of a camera file into the
// 16-bit stereo WAV proxy off the main thread. A long clip is ~100k small reads;
// here they neither compete with the editor nor stall behind background-tab
// timer throttling. The finished WAV is posted back as a (disk-backed) Blob.

import { buildMxfPcmWavBlob, MxfAudioUnavailableError } from '../services/mediaRuntime/mxf/mxfPcmWav';

export type MxfAudioProxyWorkerRequest =
  | { type: 'build'; file: File }
  | { type: 'cancel' };

export type MxfAudioProxyWorkerResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; error: string; unavailable: boolean };

/** Reads kept in flight: the per-read cost of File slices is latency, not bandwidth. */
const WORKER_READ_CONCURRENCY = 48;
/** Progress messages are rate-limited; the UI only shows whole percent. */
const PROGRESS_STEP = 0.005;

let cancelled = false;

function post(message: MxfAudioProxyWorkerResponse): void {
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = async (event: MessageEvent<MxfAudioProxyWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelled = true;
    return;
  }
  let lastReported = -1;
  try {
    const blob = await buildMxfPcmWavBlob(request.file, {
      readConcurrency: WORKER_READ_CONCURRENCY,
      isCancelled: () => cancelled,
      onProgress: (fraction) => {
        if (fraction - lastReported < PROGRESS_STEP && fraction < 1) return;
        lastReported = fraction;
        post({ type: 'progress', fraction });
      },
    });
    post({ type: 'done', blob });
  } catch (error) {
    post({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
      unavailable: error instanceof MxfAudioUnavailableError,
    });
  }
};
