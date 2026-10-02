// Main-thread side of the audio-sync matching worker. One matcher per sync
// job keeps the master signal in the worker and correlates targets one at a
// time. Falls back to the calling thread where workers are unavailable.

import { findAudioSyncOffset, type AudioSyncOffsetResult } from '../audioSyncOffset';
import type {
  AudioSyncMatchWorkerRequest,
  AudioSyncMatchWorkerResponse,
} from '../../workers/audioSyncMatchWorker';

export interface AudioSyncMatcher {
  match(target: Float32Array, options?: { minPeakRatio?: number }): Promise<AudioSyncOffsetResult | null>;
  dispose(): void;
}

function createInlineMatcher(master: Float32Array, sampleRate: number): AudioSyncMatcher {
  return {
    match: async (target, options = {}) => findAudioSyncOffset(master, target, sampleRate, options),
    dispose: () => undefined,
  };
}

export function createAudioSyncMatcher(master: Float32Array, sampleRate: number): AudioSyncMatcher {
  if (typeof Worker === 'undefined') return createInlineMatcher(master, sampleRate);

  const worker = new Worker(new URL('../../workers/audioSyncMatchWorker.ts', import.meta.url), {
    type: 'module',
    name: 'audio-sync-match',
  });
  const pending = new Map<number, { resolve: (result: AudioSyncOffsetResult | null) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  const failAll = (error: Error) => {
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent<AudioSyncMatchWorkerResponse>) => {
    const message = event.data;
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.type === 'result') waiting.resolve(message.result);
    else waiting.reject(new Error(message.error));
  };
  worker.onerror = (event) => failAll(new Error(`Audio sync worker failed: ${event.message}`));
  // A copy: the caller keeps its master for later jobs and reports.
  worker.postMessage({ type: 'master', samples: master.slice(), sampleRate } satisfies AudioSyncMatchWorkerRequest);

  return {
    match: (target, options = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'match', id, samples: target.slice(), minPeakRatio: options.minPeakRatio } satisfies AudioSyncMatchWorkerRequest);
    }),
    dispose: () => {
      failAll(new Error('Audio sync matcher was disposed.'));
      worker.terminate();
    },
  };
}
