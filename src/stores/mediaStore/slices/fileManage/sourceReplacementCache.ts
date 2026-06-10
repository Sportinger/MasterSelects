import type { MediaFile } from '../../types';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../timeline';
import {
  collectTimelineAudioCacheRefsFromClips,
  invalidateTimelineMediaCaches,
  type TimelineAudioCacheRefClip,
} from '../../../../services/timeline/timelineCacheInvalidation';
import { getClipMediaFileId } from './mediaReferenceMatcher';

export function collectActiveTimelineClipsForMediaFileId(mediaFileId: string): TimelineAudioCacheRefClip[] {
  return useTimelineStore.getState().clips
    .filter(clip => getClipMediaFileId(clip) === mediaFileId)
    .map(clip => ({
      id: clip.id,
      audioState: clip.audioState,
    }));
}

export async function invalidateMediaSourceReplacementCaches(
  mediaFileId: string,
  mediaFile: Pick<MediaFile, 'fileHash' | 'audioAnalysisRefs'> | undefined,
  clips: readonly TimelineAudioCacheRefClip[],
): Promise<void> {
  await invalidateTimelineMediaCaches({
    reason: 'source-replace',
    mediaFileId,
    ...(mediaFile?.fileHash ? { fileHash: mediaFile.fileHash } : {}),
    clipIds: clips.map(clip => clip.id).filter((id): id is string => Boolean(id)),
    sourceAudioAnalysisRefs: mediaFile?.audioAnalysisRefs,
    explicitAudioRefs: collectTimelineAudioCacheRefsFromClips(clips),
  });
}

export function createSourceReplacementClipAudioPatch(clip: TimelineClip): Partial<Pick<TimelineClip, 'audioState'>> {
  if (
    !clip.audioState?.sourceAudioRevisionId
    && !clip.audioState?.sourceAnalysisRefs
    && !clip.audioState?.processedAnalysisRefs
  ) {
    return {};
  }

  return {
    audioState: {
      ...clip.audioState,
      sourceAudioRevisionId: undefined,
      sourceAnalysisRefs: undefined,
      processedAnalysisRefs: undefined,
    },
  };
}
