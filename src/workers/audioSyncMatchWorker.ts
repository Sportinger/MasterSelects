// Audio-sync matching worker: holds the master signal of one sync job and
// correlates target excerpts against it, so the large FFTs of hour-long
// masters never block the editor.

import { findAudioSyncOffset, type AudioSyncOffsetResult } from '../services/audioSyncOffset';

export type AudioSyncMatchWorkerRequest =
  | { type: 'master'; samples: Float32Array; sampleRate: number }
  | { type: 'match'; id: number; samples: Float32Array; minPeakRatio?: number };

export type AudioSyncMatchWorkerResponse =
  | { type: 'result'; id: number; result: AudioSyncOffsetResult | null }
  | { type: 'error'; id: number; error: string };

let master: Float32Array | null = null;
let masterRate = 0;

self.onmessage = (event: MessageEvent<AudioSyncMatchWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'master') {
    master = request.samples;
    masterRate = request.sampleRate;
    return;
  }
  let response: AudioSyncMatchWorkerResponse;
  try {
    if (!master) throw new Error('Audio sync worker has no master signal.');
    response = {
      type: 'result',
      id: request.id,
      result: findAudioSyncOffset(master, request.samples, masterRate, { minPeakRatio: request.minPeakRatio }),
    };
  } catch (error) {
    response = { type: 'error', id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
  (self as unknown as Worker).postMessage(response);
};
