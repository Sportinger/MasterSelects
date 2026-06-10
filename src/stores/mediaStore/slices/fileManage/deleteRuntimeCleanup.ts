import type { MediaFile, MediaState } from '../../types';
import type { CompositionTimelineData, SerializableClip, TimelineClip } from '../../../../types/timeline';
import { engine } from '../../../../engine/WebGPUEngine';
import { projectDB } from '../../../../services/projectDB';
import { compositionRenderer } from '../../../../services/compositionRenderer';
import { clearAINodeRuntimeCacheForClip } from '../../../../services/nodeGraph';
import { revokeMediaFileObjectUrls } from '../../../../services/project/mediaObjectUrlManager';
import { releaseCompositionMixdownClipRuntime } from '../../../../services/timeline/compositionAudioMixdownRuntimeResources';
import { vectorAnimationRuntimeManager } from '../../../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType } from '../../../../types/vectorAnimation';
import { useTimelineStore } from '../../../timeline';
import { blobUrlManager } from '../../../timeline/helpers/blobUrlManager';
import type { MediaFileDeleteMatcher } from './mediaReferenceMatcher';

export function revokeMediaFileUrls(file: MediaFile): void {
  revokeMediaFileObjectUrls(file);
}

function cleanupTimelineClipResources(clip: TimelineClip): void {
  if (clip.source?.type === 'video' && clip.source.videoElement) {
    const video = clip.source.videoElement;
    video.pause();
    video.src = '';
    video.load();
    engine.cleanupVideo(video);
  }

  if (clip.source?.type === 'audio' && clip.source.audioElement) {
    const audio = clip.source.audioElement;
    audio.pause();
    audio.src = '';
    audio.load();
  }

  if (clip.mixdownAudio) {
    clip.mixdownAudio.pause();
    clip.mixdownAudio.src = '';
    clip.mixdownAudio.load();
  }
  releaseCompositionMixdownClipRuntime(clip);

  if (isVectorAnimationSourceType(clip.source?.type)) {
    vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, clip.source.type);
  }

  clearAINodeRuntimeCacheForClip(clip.id);
  blobUrlManager.revokeAll(clip.id);
}

function clearRemovedClipLinks<T extends { linkedClipId?: string }>(clip: T, removedClipIds: Set<string>): T {
  if (clip.linkedClipId && removedClipIds.has(clip.linkedClipId)) {
    return { ...clip, linkedClipId: undefined };
  }
  return clip;
}

function removeActiveTimelineClipsByMediaMatcher(matcher: MediaFileDeleteMatcher): Set<string> {
  const timelineStore = useTimelineStore.getState();
  const clipsToRemove = timelineStore.clips.filter(clip => Boolean(matcher.matchClip(clip)));
  const removedClipIds = new Set(clipsToRemove.map(clip => clip.id));

  if (removedClipIds.size === 0) {
    return removedClipIds;
  }

  for (const clip of clipsToRemove) {
    cleanupTimelineClipResources(clip);
  }

  const removedKeyframeIds = new Set<string>();
  const nextClipKeyframes = new Map(timelineStore.clipKeyframes);
  for (const clipId of removedClipIds) {
    for (const keyframe of nextClipKeyframes.get(clipId) ?? []) {
      removedKeyframeIds.add(keyframe.id);
    }
    nextClipKeyframes.delete(clipId);
  }

  useTimelineStore.setState({
    clips: timelineStore.clips
      .filter(clip => !removedClipIds.has(clip.id))
      .map(clip => clearRemovedClipLinks(clip, removedClipIds)),
    layers: timelineStore.layers.filter(layer => !layer || !removedClipIds.has(layer.id)),
    selectedLayerId: timelineStore.selectedLayerId && removedClipIds.has(timelineStore.selectedLayerId)
      ? null
      : timelineStore.selectedLayerId,
    selectedClipIds: new Set([...timelineStore.selectedClipIds].filter(id => !removedClipIds.has(id))),
    primarySelectedClipId: timelineStore.primarySelectedClipId && removedClipIds.has(timelineStore.primarySelectedClipId)
      ? null
      : timelineStore.primarySelectedClipId,
    clipKeyframes: nextClipKeyframes,
    selectedKeyframeIds: new Set([...timelineStore.selectedKeyframeIds].filter(id => !removedKeyframeIds.has(id))),
    keyframeRecordingEnabled: new Set(
      [...timelineStore.keyframeRecordingEnabled].filter(key =>
        ![...removedClipIds].some(clipId => key.startsWith(`${clipId}:`))
      )
    ),
  });

  const nextTimelineStore = useTimelineStore.getState();
  nextTimelineStore.updateDuration();
  nextTimelineStore.invalidateCache();

  return removedClipIds;
}

function removeMediaClipsFromTimelineData(
  timelineData: CompositionTimelineData | undefined,
  matcher: MediaFileDeleteMatcher,
): { timelineData: CompositionTimelineData | undefined; removedClipIds: Set<string> } {
  const removedClipIds = new Set<string>();
  if (!timelineData) {
    return { timelineData, removedClipIds };
  }

  for (const clip of timelineData.clips) {
    if (matcher.matchClip(clip)) {
      removedClipIds.add(clip.id);
    }
  }

  if (removedClipIds.size === 0) {
    return { timelineData, removedClipIds };
  }

  const clips = timelineData.clips
    .filter(clip => !removedClipIds.has(clip.id))
    .map(clip => clearRemovedClipLinks(clip, removedClipIds)) as SerializableClip[];

  return {
    timelineData: { ...timelineData, clips },
    removedClipIds,
  };
}

export function removeMediaClipsFromAllCompositions(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  get: () => MediaState,
  matcher: MediaFileDeleteMatcher,
): { removedClipIds: Set<string>; changedCompositionIds: Set<string> } {
  const removedClipIds = removeActiveTimelineClipsByMediaMatcher(matcher);
  const changedCompositionIds = new Set<string>();
  const activeCompositionId = get().activeCompositionId;
  const activeTimelineData = activeCompositionId && removedClipIds.size > 0
    ? useTimelineStore.getState().getSerializableState()
    : null;

  set((state) => ({
    compositions: state.compositions.map((composition) => {
      if (composition.id === activeCompositionId && activeTimelineData) {
        changedCompositionIds.add(composition.id);
        return {
          ...composition,
          duration: activeTimelineData.duration,
          timelineData: activeTimelineData,
        };
      }

      const result = removeMediaClipsFromTimelineData(composition.timelineData, matcher);
      if (result.removedClipIds.size === 0) {
        return composition;
      }

      for (const clipId of result.removedClipIds) {
        removedClipIds.add(clipId);
      }
      changedCompositionIds.add(composition.id);
      return {
        ...composition,
        timelineData: result.timelineData,
      };
    }),
  }));

  for (const compositionId of changedCompositionIds) {
    compositionRenderer.invalidateCompositionAndParents(compositionId);
  }

  return { removedClipIds, changedCompositionIds };
}

export async function cleanupIndexedDbMediaArtifacts(
  file: MediaFile,
  options?: { deleteHashArtifacts?: boolean },
): Promise<void> {
  const proxyKeys = [...new Set([
    file.id,
    options?.deleteHashArtifacts === false ? undefined : file.fileHash,
  ].filter((key): key is string => Boolean(key)))];
  const cleanupTasks: Promise<unknown>[] = [
    projectDB.deleteMediaFile(file.id),
    projectDB.deleteAnalysis(file.id),
    projectDB.deleteSourceThumbnails(file.id),
    projectDB.deleteHandle(`media_${file.id}`),
    ...proxyKeys.map(key => projectDB.deleteProxyFrames(key)),
  ];

  if (file.fileHash && options?.deleteHashArtifacts !== false) {
    cleanupTasks.push(projectDB.deleteThumbnail(file.fileHash));
  }

  await Promise.allSettled(cleanupTasks);
}
