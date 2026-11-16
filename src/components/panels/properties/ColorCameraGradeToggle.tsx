import type { PointerEvent } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { getCameraGradeStatus, gradeWholeCamera, releaseCameraGrade } from '../../../services/colorGrades/cameraColorGrade';

const blurAfterPointer = (event: PointerEvent<HTMLElement>) => (event.currentTarget as HTMLElement).blur();

/**
 * One switch for grading a whole camera (all clips of the same source file) instead of one clip.
 * The camera's looks are the grade's versions; new multicam pieces and the Multi Preview slot follow.
 */
export function ColorCameraGradeToggle({ clipId }: { clipId: string }) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const clips = useTimelineStore(state => state.clips);
  const isMulticam = useMediaStore(state => Boolean(state.compositions.find(comp => comp.id === state.activeCompositionId)?.multicam));
  if (!clip || clip.source?.type !== 'video') return null;
  const status = getCameraGradeStatus(clip, clips);
  if (!status || status.total < 2) return null;
  const following = clip.colorGradeMode === 'remote';
  const scope = isMulticam ? 'Whole camera' : 'All clips of this file';
  const id = `properties-camera-grade-${clipId}`;
  return (
    <div className="properties-color-node-picker properties-camera-grade" title={following
      ? `${status.following} of ${status.total} clips share this look; its versions are the camera's looks. Turn off to grade clips separately.`
      : `Grade all ${status.total} clips of this source together, using this clip's current look.`}>
      <label htmlFor={id}>{scope}</label>
      <span className="properties-camera-grade-control">
        <input
          id={id}
          type="checkbox"
          checked={following}
          onPointerUp={blurAfterPointer}
          onChange={event => { if (event.currentTarget.checked) gradeWholeCamera(clipId); else releaseCameraGrade(clipId); }}
        />
        <span>{following ? `${status.following} of ${status.total} clips` : `${status.total} clips`}</span>
      </span>
    </div>
  );
}
