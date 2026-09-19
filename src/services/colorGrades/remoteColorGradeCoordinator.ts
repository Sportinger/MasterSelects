import type { TimelineClip } from '../../types/timeline';
import {
  extractRemoteColorGrade,
  getColorGradeSourceId,
  remoteColorGradesEqual,
  synchronizeRemoteGradeClips,
  type RemoteColorGradeState,
} from '../../types/colorGradeOwnership';

export interface RemoteColorGradeTimelineAdapter {
  getClips: () => TimelineClip[];
  setClips: (clips: TimelineClip[]) => void;
  subscribeClips: (
    listener: (clips: TimelineClip[], previousClips: TimelineClip[]) => void,
  ) => () => void;
  invalidateCache: () => void;
}

export interface RemoteColorGradeMediaAdapter {
  getGrade: (mediaFileId: string) => RemoteColorGradeState | undefined;
  commitGrade: (mediaFileId: string, grade: RemoteColorGradeState) => void;
}

function isRemoteClip(clip: TimelineClip | undefined): clip is TimelineClip {
  return clip?.colorGradeMode === 'remote' && Boolean(getColorGradeSourceId(clip));
}

export function initializeRemoteColorGradeCoordinator(
  timeline: RemoteColorGradeTimelineAdapter,
  media: RemoteColorGradeMediaAdapter,
): () => void {
  let synchronizing = false;

  const setSynchronizedClips = (clips: TimelineClip[]) => {
    if (clips === timeline.getClips()) return;
    synchronizing = true;
    try {
      timeline.setClips(clips);
      timeline.invalidateCache();
    } finally {
      synchronizing = false;
    }
  };

  const handleClipsChanged = (clips: TimelineClip[], previousClips: TimelineClip[]) => {
    if (synchronizing) return;
    const previousById = new Map(previousClips.map(clip => [clip.id, clip] as const));

    // Existing remote clips are authoritative for user edits. UI-only changes
    // do not alter the extracted source grade and therefore stop here.
    for (const clip of clips) {
      if (!isRemoteClip(clip) || !clip.colorCorrection) continue;
      const previous = previousById.get(clip.id);
      if (!isRemoteClip(previous) || getColorGradeSourceId(previous) !== getColorGradeSourceId(clip)) {
        continue;
      }
      const previousGrade = extractRemoteColorGrade(previous.colorCorrection);
      const nextGrade = extractRemoteColorGrade(clip.colorCorrection);
      if (remoteColorGradesEqual(previousGrade, nextGrade)) continue;

      const mediaFileId = getColorGradeSourceId(clip)!;
      media.commitGrade(mediaFileId, nextGrade);
      setSynchronizedClips(synchronizeRemoteGradeClips(clips, mediaFileId, nextGrade));
      return;
    }

    // Newly loaded or newly switched remote clips hydrate from their media
    // owner. A legacy remote clip with no owner seeds the owner once.
    let synchronizedClips = clips;
    const handledMediaIds = new Set<string>();
    for (const clip of clips) {
      if (!isRemoteClip(clip)) continue;
      const previous = previousById.get(clip.id);
      if (isRemoteClip(previous) && getColorGradeSourceId(previous) === getColorGradeSourceId(clip)) {
        continue;
      }
      const mediaFileId = getColorGradeSourceId(clip)!;
      if (handledMediaIds.has(mediaFileId)) continue;
      handledMediaIds.add(mediaFileId);

      const ownedGrade = media.getGrade(mediaFileId);
      if (ownedGrade) {
        synchronizedClips = synchronizeRemoteGradeClips(synchronizedClips, mediaFileId, ownedGrade);
      } else if (clip.colorCorrection) {
        const legacyGrade = extractRemoteColorGrade(clip.colorCorrection);
        media.commitGrade(mediaFileId, legacyGrade);
        synchronizedClips = synchronizeRemoteGradeClips(synchronizedClips, mediaFileId, legacyGrade);
      }
    }
    setSynchronizedClips(synchronizedClips);
  };

  const unsubscribe = timeline.subscribeClips(handleClipsChanged);
  handleClipsChanged(timeline.getClips(), []);
  return unsubscribe;
}
