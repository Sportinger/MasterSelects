import type { Composition, MediaFile } from '../../types';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../timeline';
import type { TimelineAudioCacheRefClip } from '../../../../services/timeline/timelineCacheInvalidation';
import {
  createMediaFileDeleteMatcher,
  type ClipWithMediaReference,
  type MediaFileDeleteMatcher,
} from './mediaReferenceMatcher';

export interface MediaFileCompositionUsage {
  compositionId: string;
  compositionName: string;
  clipCount: number;
}

export interface MediaFileUsageSummary {
  mediaFileId: string;
  mediaFileName: string;
  clipCount: number;
  compositions: MediaFileCompositionUsage[];
}

export function getCompositionClipsForUsage(
  composition: Composition,
  activeCompositionId: string | null,
  activeTimelineClips: TimelineClip[],
): ClipWithMediaReference[] {
  if (composition.id === activeCompositionId && activeTimelineClips.length > 0) {
    return activeTimelineClips;
  }
  return composition.timelineData?.clips ?? [];
}

export function collectMediaClipsByMatcherForCacheInvalidation(
  targetFiles: MediaFile[],
  compositions: Composition[],
  activeCompositionId: string | null,
  activeTimelineClips: TimelineClip[],
  matcher: MediaFileDeleteMatcher,
): Map<string, TimelineAudioCacheRefClip[]> {
  const targetIds = new Set(targetFiles.map(file => file.id));
  const clipsByMediaFileId = new Map(
    targetFiles.map(file => [file.id, [] as TimelineAudioCacheRefClip[]])
  );

  for (const composition of compositions) {
    const clips = getCompositionClipsForUsage(composition, activeCompositionId, activeTimelineClips);
    for (const clip of clips) {
      const mediaFileId = matcher.matchClip(clip);
      if (!mediaFileId || !targetIds.has(mediaFileId)) {
        continue;
      }
      clipsByMediaFileId.get(mediaFileId)?.push({
        id: clip.id,
        audioState: clip.audioState,
      });
    }
  }

  return clipsByMediaFileId;
}

export function collectMediaFileUsages(
  ids: string[],
  files: MediaFile[],
  compositions: Composition[],
  activeCompositionId: string | null,
  activeTimelineClips: TimelineClip[] = useTimelineStore.getState().clips,
): MediaFileUsageSummary[] {
  const targetIds = new Set(ids);
  const targetFiles = files.filter(file => targetIds.has(file.id));
  const matcher = createMediaFileDeleteMatcher(targetFiles, files);
  const summaries = new Map<string, MediaFileUsageSummary>();
  const mediaFileNames = new Map(files.map(file => [file.id, file.name]));

  for (const id of targetIds) {
    summaries.set(id, {
      mediaFileId: id,
      mediaFileName: mediaFileNames.get(id) ?? id,
      clipCount: 0,
      compositions: [],
    });
  }

  for (const composition of compositions) {
    const clips = getCompositionClipsForUsage(composition, activeCompositionId, activeTimelineClips);
    const counts = new Map<string, number>();

    for (const clip of clips) {
      const mediaFileId = matcher.matchClip(clip);
      if (!mediaFileId || !targetIds.has(mediaFileId)) {
        continue;
      }
      counts.set(mediaFileId, (counts.get(mediaFileId) ?? 0) + 1);
    }

    for (const [mediaFileId, clipCount] of counts) {
      const summary = summaries.get(mediaFileId);
      if (!summary) continue;
      summary.clipCount += clipCount;
      summary.compositions.push({
        compositionId: composition.id,
        compositionName: composition.name,
        clipCount,
      });
    }
  }

  return [...summaries.values()].filter(summary => summary.clipCount > 0);
}
