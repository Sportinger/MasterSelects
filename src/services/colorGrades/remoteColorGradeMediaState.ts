import type { Composition, MediaFile, MediaState } from '../../stores/mediaStore/types';
import {
  remoteColorGradesEqual,
  synchronizeRemoteGradeClips,
  type RemoteColorGradeState,
} from '../../types/colorGradeOwnership';

function synchronizeCompositionRemoteGrade(
  composition: Composition,
  mediaFileId: string,
  grade: RemoteColorGradeState,
): Composition {
  const timelineData = composition.timelineData;
  if (!timelineData) return composition;
  const clips = timelineData.clips;
  const synchronizedClips = synchronizeRemoteGradeClips(clips, mediaFileId, grade);
  if (synchronizedClips === clips) return composition;
  return {
    ...composition,
    timelineData: {
      ...timelineData,
      clips: synchronizedClips,
    },
  };
}

export function createRemoteColorGradeMediaPatch(
  state: Pick<MediaState, 'files' | 'compositions'>,
  mediaFileId: string,
  grade: RemoteColorGradeState,
): Pick<MediaState, 'files' | 'compositions'> | null {
  let filesChanged = false;
  const files = state.files.map((file): MediaFile => {
    if (file.id !== mediaFileId || remoteColorGradesEqual(file.remoteColorGrade, grade)) {
      return file;
    }
    filesChanged = true;
    return {
      ...file,
      remoteColorGrade: structuredClone(grade),
    };
  });

  let compositionsChanged = false;
  const compositions = state.compositions.map(composition => {
    const synchronized = synchronizeCompositionRemoteGrade(composition, mediaFileId, grade);
    if (synchronized !== composition) compositionsChanged = true;
    return synchronized;
  });

  return filesChanged || compositionsChanged ? { files, compositions } : null;
}
