import { useMediaStore } from '../../stores/mediaStore';
import { captureSnapshot } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import { cloneColorCorrectionState, ensureColorCorrectionState } from '../../types/colorCorrection';
import { applyRemoteColorGrade, extractRemoteColorGrade, getColorGradeSourceId } from '../../types/colorGradeOwnership';
import { commitRemoteGradeOwner, synchronizeActiveRemoteClips } from './remoteColorGradeCommands';

/**
 * Camera grade: one shared color grade for every clip of the same source file, e.g. every program
 * piece of the Totale camera in a multicam cut. It is the source-owned (remote) grade, so its versions
 * are the camera's looks, new multicam pieces of that camera take it over, and the Multi Preview slot
 * shows it. A single clip can still leave it (local grade) and keeps its own color.
 */
/** Makes this clip's current look the camera grade and lets every clip of the camera follow it. */
export function gradeWholeCamera(clipId: string): boolean {
  const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
  const mediaFileId = clip ? getColorGradeSourceId(clip) : undefined;
  if (!clip || !mediaFileId || !useMediaStore.getState().files.some(file => file.id === mediaFileId)) return false;
  const grade = extractRemoteColorGrade(clip.colorCorrection);
  commitRemoteGradeOwner(mediaFileId, grade);
  useTimelineStore.setState(state => ({
    clips: state.clips.map(candidate => {
      if (getColorGradeSourceId(candidate) !== mediaFileId || candidate.colorGradeMode === 'remote') return candidate;
      const local = ensureColorCorrectionState(candidate.colorCorrection);
      return {
        ...candidate,
        colorGradeMode: 'remote' as const,
        localColorCorrection: cloneColorCorrectionState(local),
        colorCorrection: applyRemoteColorGrade(local, grade),
      };
    }),
  }));
  synchronizeActiveRemoteClips(mediaFileId, grade);
  useTimelineStore.getState().invalidateCache();
  captureSnapshot('Grade whole camera');
  return true;
}

/** Every clip of the camera keeps the current look as its own grade and stops following the camera. */
export function releaseCameraGrade(clipId: string): boolean {
  const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
  const mediaFileId = clip ? getColorGradeSourceId(clip) : undefined;
  if (!mediaFileId) return false;
  let changed = false;
  useTimelineStore.setState(state => ({
    clips: state.clips.map(candidate => {
      if (getColorGradeSourceId(candidate) !== mediaFileId || candidate.colorGradeMode !== 'remote') return candidate;
      changed = true;
      return {
        ...candidate,
        colorGradeMode: 'local' as const,
        colorCorrection: cloneColorCorrectionState(ensureColorCorrectionState(candidate.colorCorrection)),
        localColorCorrection: undefined,
      };
    }),
  }));
  if (!changed) return false;
  useTimelineStore.getState().invalidateCache();
  captureSnapshot('Grade clips separately');
  return true;
}

export { getCameraGradeStatus, cameraGradeForNewClip, cameraRuntimeGrade, type CameraGradeStatus } from './cameraColorGradeQueries';
