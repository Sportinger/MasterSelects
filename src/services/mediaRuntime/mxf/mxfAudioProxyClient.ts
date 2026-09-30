// Main-thread side of the MXF audio proxy worker. Falls back to extracting on
// the calling thread where workers are unavailable (tests, old runtimes).

import type {
  MxfAudioProxyWorkerRequest,
  MxfAudioProxyWorkerResponse,
} from '../../../workers/mxfAudioProxyWorker';
import { buildMxfPcmWavBlob, MxfAudioUnavailableError, type MxfPcmWavOptions } from './mxfPcmWav';

export async function buildMxfAudioProxyWav(
  file: File,
  options: Pick<MxfPcmWavOptions, 'onProgress' | 'isCancelled'> = {},
): Promise<Blob> {
  if (typeof Worker === 'undefined') return buildMxfPcmWavBlob(file, options);

  const worker = new Worker(new URL('../../../workers/mxfAudioProxyWorker.ts', import.meta.url), {
    type: 'module',
    name: 'mxf-audio-proxy',
  });
  const cancelPoll = options.isCancelled
    ? setInterval(() => {
      if (options.isCancelled?.()) worker.postMessage({ type: 'cancel' } satisfies MxfAudioProxyWorkerRequest);
    }, 250)
    : undefined;
  try {
    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<MxfAudioProxyWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'progress') options.onProgress?.(message.fraction);
        else if (message.type === 'done') resolve(message.blob);
        else reject(message.unavailable ? new MxfAudioUnavailableError(message.error) : new Error(message.error));
      };
      worker.onerror = (event) => reject(new Error(`MXF audio proxy worker failed: ${event.message}`));
      worker.postMessage({ type: 'build', file } satisfies MxfAudioProxyWorkerRequest);
    });
  } finally {
    if (cancelPoll !== undefined) clearInterval(cancelPoll);
    worker.terminate();
  }
}
