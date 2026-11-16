import { useMediaStore } from '../../stores/mediaStore';
import type { TimelineClip } from '../../types';
import { compileRuntimeColorGrade, type RuntimeColorGrade } from '../../types/colorCorrection';
import { applyRemoteColorGrade, getColorGradeSourceId, type RemoteColorGradeState } from '../../types/colorGradeOwnership';

/** Read-only camera grade lookups (see cameraColorGrade.ts); free of the timeline store so its slices can use them. */
export interface CameraGradeStatus {
  mediaFileId: string;
  /** Clips of this source in the open composition. */
  total: number;
  /** Of those, the clips that follow the shared camera grade. */
  following: number;
}

export function getCameraGradeStatus(clip: Pick<TimelineClip, 'mediaFileId' | 'source'>, clips: readonly TimelineClip[]): CameraGradeStatus | null {
  const mediaFileId = getColorGradeSourceId(clip);
  if (!mediaFileId) return null;
  const sameSource = clips.filter(candidate => getColorGradeSourceId(candidate) === mediaFileId && candidate.source?.type === 'video');
  return { mediaFileId, total: sameSource.length, following: sameSource.filter(candidate => candidate.colorGradeMode === 'remote').length };
}

/** The camera grade for a new clip of this source, when the camera is graded as a whole. */
export function cameraGradeForNewClip(
  mediaFileId: string,
  clips: readonly TimelineClip[],
): Pick<TimelineClip, 'colorGradeMode' | 'colorCorrection'> | null {
  const grade = useMediaStore.getState().files.find(file => file.id === mediaFileId)?.remoteColorGrade as RemoteColorGradeState | undefined;
  if (!grade || !clips.some(clip => getColorGradeSourceId(clip) === mediaFileId && clip.colorGradeMode === 'remote')) return null;
  return { colorGradeMode: 'remote', colorCorrection: applyRemoteColorGrade(undefined, grade) };
}

/** The camera grade as it renders, for views that show a camera outside the program (Multi Preview). */
export function cameraRuntimeGrade(mediaFileId: string, clips: readonly TimelineClip[]): RuntimeColorGrade | undefined {
  const grade = cameraGradeForNewClip(mediaFileId, clips);
  return grade ? compileRuntimeColorGrade(grade.colorCorrection) : undefined;
}
