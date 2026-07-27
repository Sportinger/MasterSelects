import { createTimelineRuntimePolicyRegistry } from './runtimeCoordinatorContracts';
import type { useMediaStore } from '../../stores/mediaStore';
import type { MediaFile } from '../../stores/mediaStore/types';
import type { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip } from '../../types/timeline';

export const timelineRuntimeCoordinator = createTimelineRuntimePolicyRegistry();

type TimelineStoreHook = typeof useTimelineStore;
type MediaStoreHook = typeof useMediaStore;
type TimelineAnalysisStoreGlobal = typeof globalThis & {
  __timelineStoreModule?: { useTimelineStore: TimelineStoreHook };
  __mediaStoreModule?: { useMediaStore: MediaStoreHook };
};

function timelineStore(): TimelineStoreHook {
  const store = (globalThis as TimelineAnalysisStoreGlobal).__timelineStoreModule?.useTimelineStore;
  if (!store) throw new Error('Timeline analysis store is not initialized');
  return store;
}

function mediaStore(): MediaStoreHook {
  const store = (globalThis as TimelineAnalysisStoreGlobal).__mediaStoreModule?.useMediaStore;
  if (!store) throw new Error('Media analysis store is not initialized');
  return store;
}

/** Store boundary for source-analysis services. */
export function findTimelineAnalysisClip(clipId: string): TimelineClip | undefined {
  return timelineStore().getState().clips.find((clip) => clip.id === clipId);
}

export function readTimelineAnalysisClips(): readonly TimelineClip[] {
  return timelineStore().getState().clips;
}

export function readTimelineAnalysisMediaFiles(): readonly MediaFile[] {
  return mediaStore().getState().files;
}

export function readTimelineAnalysisSelectedMediaIds(): readonly string[] {
  return mediaStore().getState().selectedIds;
}

export function subscribeTimelineAnalysisRuntime(listener: () => void): () => void {
  const unsubscribeMedia = mediaStore().subscribe(listener);
  const unsubscribeTimeline = timelineStore().subscribe(listener);
  return () => {
    unsubscribeMedia();
    unsubscribeTimeline();
  };
}

export async function runTimelineSceneCutAnalysis(
  mediaFileId: string,
  options?: { force?: boolean },
): Promise<void> {
  await mediaStore().getState().analyzeSceneCuts(mediaFileId, options);
}

export function cancelTimelineSceneCutAnalysis(mediaFileId: string): void {
  mediaStore().getState().cancelProxyGeneration(mediaFileId);
}

export function updateTimelineAnalysisClips(
  update: (clips: TimelineClip[]) => TimelineClip[],
): void {
  timelineStore().setState((state) => ({ clips: update(state.clips) }));
}

export function findTimelineAnalysisMediaFile(mediaFileId: string): MediaFile | undefined {
  return mediaStore().getState().files.find((file) => file.id === mediaFileId);
}

export function updateTimelineAnalysisMediaFiles(
  update: (files: MediaFile[]) => MediaFile[],
): void {
  mediaStore().setState((state) => ({ files: update(state.files) }));
}
