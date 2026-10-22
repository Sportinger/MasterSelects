import type { TimelineClip } from '../../../types';
import type {
  AudioAnalysisArtifactKind,
  ClipAudioAnalysisJobKind,
  ClipAudioAnalysisJobPhase,
} from '../../../types/audio';
import {
  createClipAudioAnalysisJobState,
  updateClipAudioAnalysisJobState,
} from '../../../services/audio/clipAudioAnalysisJobs';
import { isClipAudioAnalysisJobCancelledError } from '../../../services/audio/ClipAudioAnalysisJobService';
import { updateClipById } from '../helpers/clipStateHelpers';
import { classifyClipMediaGap, type ClipMediaGap } from '../../../services/compositionRender/clipMediaGapClassification';

export function createAudioAnalysisJobUpdate(input: {
  kind: ClipAudioAnalysisJobKind;
  label: string;
  artifactKinds: AudioAnalysisArtifactKind[];
  processed: boolean;
}): Pick<TimelineClip, 'audioAnalysisJob' | 'waveformGenerating' | 'waveformProgress'> {
  return {
    waveformGenerating: true,
    waveformProgress: 0,
    audioAnalysisJob: createClipAudioAnalysisJobState(input),
  };
}

export function updateAudioAnalysisJobProgress(
  clips: TimelineClip[],
  clipId: string,
  progress: number,
  phase: ClipAudioAnalysisJobPhase,
  message?: string,
): TimelineClip[] {
  const clip = clips.find(c => c.id === clipId);
  if (!clip?.audioAnalysisJob) {
    return updateClipById(clips, clipId, { waveformProgress: progress });
  }

  return updateClipById(clips, clipId, {
    waveformProgress: progress,
    audioAnalysisJob: updateClipAudioAnalysisJobState(clip.audioAnalysisJob, {
      progress,
      phase,
      message,
    }),
  });
}

export function clearAudioAnalysisJobUpdate(): Pick<
  TimelineClip,
  'audioAnalysisJob' | 'waveformGenerating'
> {
  return {
    audioAnalysisJob: undefined,
    waveformGenerating: false,
  };
}

export function isAudioAnalysisCancellation(error: unknown): boolean {
  if (isClipAudioAnalysisJobCancelledError(error)) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybe = error as { name?: unknown; code?: unknown };
  return maybe.name === 'AbortError'
    || maybe.code === 'cancelled'
    || (typeof maybe.name === 'string' && maybe.name.includes('Cancelled'));
}

/**
 * The clip's readable source File, or why there is none. `gap === 'loading'` means the media
 * entry exists and its runtime File is still being restored (project open, reopen, read-only
 * tab, linked media opening on demand): callers wait via `watchLoaded` instead of reporting it.
 */
export interface ClipSourceFileResolution {
  file?: File;
  mediaFileId?: string;
  gap?: ClipMediaGap;
  /** Calls `onLoaded` once the media entry has a runtime File (immediately if it already has one). */
  watchLoaded?: (onLoaded: () => void) => () => void;
}

export async function resolveClipSource(clip: TimelineClip): Promise<ClipSourceFileResolution> {
  if (clip.file instanceof File) {
    const sourceFile = await readAccessibleFile(clip.file);
    if (sourceFile) return { file: sourceFile };
  }

  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (!mediaFileId) return { gap: 'missing' };

  try {
    const { useMediaStore } = await import('../../mediaStore');
    const mediaState = useMediaStore.getState();
    const mediaFile = mediaState.files.find(file => file.id === mediaFileId);
    const file = mediaFile?.file ? await readAccessibleFile(mediaFile.file) : undefined;
    if (file) return { file, mediaFileId };
    return {
      mediaFileId,
      gap: classifyClipMediaGap(mediaFileId, mediaFile, mediaState.projectLoadProgress?.active === true),
      watchLoaded: onLoaded => useMediaStore.subscribe(
        state => Boolean(state.files.find(candidate => candidate.id === mediaFileId)?.file),
        loaded => { if (loaded) onLoaded(); },
        { fireImmediately: true },
      ),
    };
  } catch {
    return { mediaFileId, gap: 'unavailable' };
  }
}

export async function resolveClipSourceFile(clip: TimelineClip): Promise<File | undefined> {
  return (await resolveClipSource(clip)).file;
}

export { isUndecodableAudioSourceError } from '../../../services/audio/decode/errors';

export function isUnreadableClipSourceError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === 'object'
    && (error as { name?: unknown }).name === 'NotReadableError';
}

async function readAccessibleFile(file: File): Promise<File | undefined> {
  // Restored clips can temporarily carry empty placeholder Files.
  if (file.size === 0) return undefined;
  try {
    await file.slice(0, Math.min(1, file.size)).arrayBuffer();
    return file;
  } catch {
    return undefined;
  }
}
