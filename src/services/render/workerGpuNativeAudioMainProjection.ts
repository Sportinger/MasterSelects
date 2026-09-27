import { resolveFlockAudioInput } from '../../engine/flock/runtime/flockAudioSampler';
import type { TimelineClip } from '../../types';
import type { WorkerGpuNativeAudioInput } from './workerGpuNativeAudioContract';
import { WorkerFlockAudioUrlCache } from './WorkerFlockAudioUrlCache';

const audioUrls: WorkerFlockAudioUrlCache = import.meta.hot?.data?.flockAudioUrls ?? new WorkerFlockAudioUrlCache();
Object.setPrototypeOf(audioUrls, WorkerFlockAudioUrlCache.prototype);
if (import.meta.hot) import.meta.hot.dispose(data => { data.flockAudioUrls = audioUrls; });

export function projectWorkerFlockAudio(clipId: string, audioClipIds: readonly string[], expireAfterMs: number,
  clips?: TimelineClip[]): readonly WorkerGpuNativeAudioInput[] {
  audioUrls.prune();
  return [...new Set(audioClipIds)].toSorted().map(audioClipId => {
    const input = resolveFlockAudioInput(clipId, audioClipId, clips);
    return { clipId: audioClipId, sourceOffset: input.sourceOffset,
      curve: input.curve ? audioUrls.reference(input.curve, expireAfterMs) : null };
  });
}
