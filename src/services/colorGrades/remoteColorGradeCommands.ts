import { useMediaStore } from '../../stores/mediaStore';
import { captureSnapshot } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import {
  applyRemoteColorGrade,
  extractRemoteColorGrade,
  getColorGradeSourceId,
  remoteColorGradesEqual,
  synchronizeRemoteGradeClips,
  type ColorGradeMode,
  type RemoteColorGradeState,
} from '../../types/colorGradeOwnership';
import { cloneColorCorrectionState, ensureColorCorrectionState } from '../../types/colorCorrection';
import { createRemoteColorGradeMediaPatch } from './remoteColorGradeMediaState';

function commitRemoteGradeOwner(
  mediaFileId: string,
  grade: RemoteColorGradeState,
): boolean {
  let changed = false;
  useMediaStore.setState(state => {
    const patch = createRemoteColorGradeMediaPatch(state, mediaFileId, grade);
    if (!patch) return {};
    changed = true;
    return patch;
  });
  return changed;
}

function synchronizeActiveRemoteClips(
  mediaFileId: string,
  grade: RemoteColorGradeState,
): boolean {
  let changed = false;
  useTimelineStore.setState(state => {
    const clips = synchronizeRemoteGradeClips(state.clips, mediaFileId, grade);
    if (clips === state.clips) return {};
    changed = true;
    return { clips };
  });
  if (changed) useTimelineStore.getState().invalidateCache();
  return changed;
}

export function setClipColorGradeMode(clipId: string, mode: ColorGradeMode): boolean {
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find(candidate => candidate.id === clipId);
  if (!clip || (clip.colorGradeMode ?? 'local') === mode) return false;

  const mediaFileId = getColorGradeSourceId(clip);
  if (mode === 'remote' && !mediaFileId) return false;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId)
    : undefined;
  if (mode === 'remote' && !mediaFile) return false;

  const currentState = ensureColorCorrectionState(clip.colorCorrection);
  if (mode === 'remote') {
    const remoteGrade = mediaFile!.remoteColorGrade ?? extractRemoteColorGrade(currentState);
    commitRemoteGradeOwner(mediaFileId!, remoteGrade);
    useTimelineStore.setState(state => ({
      clips: state.clips.map(candidate => candidate.id === clipId
        ? {
            ...candidate,
            colorGradeMode: 'remote',
            localColorCorrection: cloneColorCorrectionState(currentState),
            colorCorrection: applyRemoteColorGrade(currentState, remoteGrade),
          }
        : candidate),
    }));
    synchronizeActiveRemoteClips(mediaFileId!, remoteGrade);
  } else {
    const restoredLocal = cloneColorCorrectionState(
      ensureColorCorrectionState(clip.localColorCorrection),
    );
    useTimelineStore.setState(state => ({
      clips: state.clips.map(candidate => candidate.id === clipId
        ? {
            ...candidate,
            colorGradeMode: 'local',
            colorCorrection: restoredLocal,
            localColorCorrection: undefined,
          }
        : candidate),
    }));
  }

  useTimelineStore.getState().invalidateCache();
  captureSnapshot(mode === 'remote' ? 'Use remote grades' : 'Use local grades');
  return true;
}

export function copyLocalColorGradeToRemote(clipId: string): boolean {
  const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
  const mediaFileId = clip ? getColorGradeSourceId(clip) : undefined;
  if (!clip || !mediaFileId || !useMediaStore.getState().files.some(file => file.id === mediaFileId)) {
    return false;
  }

  const localState = clip.colorGradeMode === 'remote'
    ? ensureColorCorrectionState(clip.localColorCorrection)
    : ensureColorCorrectionState(clip.colorCorrection);
  const remoteGrade = extractRemoteColorGrade(localState);
  const mediaChanged = commitRemoteGradeOwner(mediaFileId, remoteGrade);
  const timelineChanged = synchronizeActiveRemoteClips(mediaFileId, remoteGrade);
  if (!mediaChanged && !timelineChanged) return false;

  captureSnapshot('Copy local grade to remote');
  return true;
}

export function copyRemoteColorGradeToLocal(clipId: string): boolean {
  const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
  const mediaFileId = clip ? getColorGradeSourceId(clip) : undefined;
  const remoteGrade = mediaFileId
    ? useMediaStore.getState().files.find(file => file.id === mediaFileId)?.remoteColorGrade
    : undefined;
  if (!clip || !remoteGrade) return false;

  const localBase = clip.colorGradeMode === 'remote'
    ? clip.localColorCorrection
    : clip.colorCorrection;
  const copiedLocal = applyRemoteColorGrade(localBase, remoteGrade);
  const existingLocal = extractRemoteColorGrade(localBase);
  if (remoteColorGradesEqual(existingLocal, remoteGrade)) return false;

  useTimelineStore.setState(state => ({
    clips: state.clips.map(candidate => candidate.id === clipId
      ? candidate.colorGradeMode === 'remote'
        ? { ...candidate, localColorCorrection: copiedLocal }
        : { ...candidate, colorCorrection: copiedLocal }
      : candidate),
  }));
  useTimelineStore.getState().invalidateCache();
  captureSnapshot('Copy remote grade to local');
  return true;
}
