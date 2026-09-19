import {
  cloneColorCorrectionState,
  ensureColorCorrectionState,
  type ColorCorrectionState,
  type ColorGradeVersion,
} from './colorCorrection';

export type ColorGradeMode = 'local' | 'remote';

/** Durable, source-owned grade data. Clip-local editor UI state is intentionally excluded. */
export interface RemoteColorGradeState {
  version: 1;
  enabled: boolean;
  activeVersionId: string;
  versions: ColorGradeVersion[];
}

export interface RemoteColorGradeClipLike {
  mediaFileId?: string;
  source?: { mediaFileId?: string } | null;
  colorGradeMode?: ColorGradeMode;
  colorCorrection?: ColorCorrectionState;
  localColorCorrection?: ColorCorrectionState;
}

export function getColorGradeSourceId(clip: RemoteColorGradeClipLike): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

export function extractRemoteColorGrade(
  correction: ColorCorrectionState | undefined,
): RemoteColorGradeState {
  const normalized = cloneColorCorrectionState(ensureColorCorrectionState(correction));
  return {
    version: 1,
    enabled: normalized.enabled,
    activeVersionId: normalized.activeVersionId,
    versions: normalized.versions,
  };
}

export function applyRemoteColorGrade(
  current: ColorCorrectionState | undefined,
  remote: RemoteColorGradeState,
): ColorCorrectionState {
  const currentState = ensureColorCorrectionState(current);
  const normalizedRemote = cloneColorCorrectionState(ensureColorCorrectionState({
    ...remote,
    ui: currentState.ui,
  }));
  return {
    ...normalizedRemote,
    ui: structuredClone(currentState.ui),
  };
}

export function remoteColorGradeFingerprint(grade: RemoteColorGradeState): string {
  return JSON.stringify({
    version: grade.version,
    enabled: grade.enabled,
    activeVersionId: grade.activeVersionId,
    versions: grade.versions,
  });
}

export function remoteColorGradesEqual(
  left: RemoteColorGradeState | undefined,
  right: RemoteColorGradeState | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return remoteColorGradeFingerprint(left) === remoteColorGradeFingerprint(right);
}

export function synchronizeRemoteGradeClips<T extends RemoteColorGradeClipLike>(
  clips: T[],
  mediaFileId: string,
  grade: RemoteColorGradeState,
): T[] {
  let changed = false;
  const nextClips = clips.map(clip => {
    if (clip.colorGradeMode !== 'remote' || getColorGradeSourceId(clip) !== mediaFileId) {
      return clip;
    }
    const currentGrade = extractRemoteColorGrade(clip.colorCorrection);
    if (remoteColorGradesEqual(currentGrade, grade)) {
      return clip;
    }
    changed = true;
    return {
      ...clip,
      colorCorrection: applyRemoteColorGrade(clip.colorCorrection, grade),
    };
  });
  return changed ? nextClips : clips;
}

export function updateClipColorCorrectionWithRemoteSync<
  T extends RemoteColorGradeClipLike & { id: string },
>(
  clips: T[],
  clipId: string,
  updater: (current: ColorCorrectionState | undefined) => ColorCorrectionState,
): T[] {
  const target = clips.find(clip => clip.id === clipId);
  if (!target) return clips;
  const colorCorrection = updater(target.colorCorrection);
  const updatedClips = clips.map(clip => clip.id === clipId
    ? { ...clip, colorCorrection }
    : clip);
  const mediaFileId = target.colorGradeMode === 'remote'
    ? getColorGradeSourceId(target)
    : undefined;
  return mediaFileId
    ? synchronizeRemoteGradeClips(updatedClips, mediaFileId, extractRemoteColorGrade(colorCorrection))
    : updatedClips;
}
