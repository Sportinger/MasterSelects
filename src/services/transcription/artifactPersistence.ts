import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import type { MediaFile } from '../../stores/mediaStore/types';
import type {
  TranscriptFusionArtifact,
  TranscriptFusionProgress,
  TranscriptStatus,
  TranscriptWord,
} from '../../types/clipMetadata';
import { projectFileService } from '../project/ProjectFileService';
import { Logger } from '../logger';
import { calcCoverage, mergeRanges, mergeTranscriptWords } from './resultMapping';

const log = Logger.create('ClipTranscriber');

export type ClipTranscriptUpdate = {
  status?: TranscriptStatus;
  progress?: number;
  words?: TranscriptWord[];
  message?: string;
};

export interface TranscriptFusionPreviewUpdate {
  artifact?: TranscriptFusionArtifact | null;
  progress: TranscriptFusionProgress;
  words?: TranscriptWord[];
}

interface AppliedTranscript {
  artifact?: TranscriptFusionArtifact;
  ranges: [number, number][];
  words: TranscriptWord[];
}

/**
 * Update clip transcript data in the timeline store.
 */
export function updateClipTranscript(clipId: string, data: ClipTranscriptUpdate): void {
  const store = useTimelineStore.getState();
  const targetClip = store.clips.find(clip => clip.id === clipId);
  const affectedClipIds = new Set([clipId]);
  if (targetClip?.linkedClipId) affectedClipIds.add(targetClip.linkedClipId);
  for (const clip of store.clips) {
    if (clip.linkedClipId === clipId) affectedClipIds.add(clip.id);
  }

  const hasWords = Object.prototype.hasOwnProperty.call(data, 'words');
  const clips = store.clips.map(clip => {
    if (!affectedClipIds.has(clip.id)) return clip;

    return {
      ...clip,
      transcriptStatus: data.status ?? clip.transcriptStatus,
      transcriptProgress: data.progress ?? clip.transcriptProgress,
      transcript: hasWords ? data.words : clip.transcript,
      transcriptMessage: data.message,
    };
  });

  useTimelineStore.setState({ clips });
}

/**
 * Publish transient hybrid-fusion state without writing a project artifact.
 * The final result is persisted only by propagateTranscriptToMediaFile().
 */
export function updateTranscriptFusionPreview(
  mediaFileId: string,
  update: TranscriptFusionPreviewUpdate,
): void {
  const hasArtifact = Object.prototype.hasOwnProperty.call(update, 'artifact');
  const hasWords = Object.prototype.hasOwnProperty.call(update, 'words');
  useMediaStore.setState(state => ({
    files: state.files.map(file => file.id === mediaFileId
      ? {
          ...file,
          transcriptStatus: 'transcribing' as TranscriptStatus,
          transcript: hasWords ? update.words : file.transcript,
          transcriptArtifact: hasArtifact
            ? update.artifact ?? undefined
            : file.transcriptArtifact,
          transcriptFusionProgress: update.progress,
        }
      : file),
  }));
}

function applyTranscriptToMediaFile(
  mediaFileId: string,
  words: TranscriptWord[],
  newRanges: [number, number][],
  artifact?: TranscriptFusionArtifact,
  options?: {
    progress?: TranscriptFusionProgress;
    status?: TranscriptStatus;
  },
): AppliedTranscript | null {
  try {
    const mediaState = useMediaStore.getState();
    const file = mediaState.files.find((f: MediaFile) => f.id === mediaFileId);
    if (!file) return null;

    const existingWords = file.transcript ?? [];
    const retainedWords = newRanges.length
      ? existingWords.filter(word => !newRanges.some(
          ([rangeStart, rangeEnd]) => word.start < rangeEnd && rangeStart < word.end,
        ))
      : existingWords;
    const mergedWords = (
      newRanges.length
        ? [...retainedWords, ...words]
        : mergeTranscriptWords(retainedWords, words)
    ).toSorted((left, right) => left.start - right.start);

    let transcriptCoverage = 0;
    if (file.duration && file.duration > 0) {
      const existingRanges = file.transcribedRanges || [];
      const allRanges = [...existingRanges, ...newRanges];
      transcriptCoverage = allRanges.length > 0 ? calcCoverage(allRanges, file.duration) : 0;
    }

    const existingRanges: [number, number][] = file.transcribedRanges || [];
    const mergedRanges = mergeRanges([...existingRanges, ...newRanges]);
    const persistedArtifact = artifact
      ? { ...artifact, words: mergedWords }
      : undefined;
    const status = options?.status ?? 'ready';
    const finalProgress = persistedArtifact
      ? {
          stage: 'complete' as const,
          range: [
            mergedRanges[0]?.[0] ?? 0,
            mergedRanges.at(-1)?.[1] ?? mergedWords.at(-1)?.end ?? 0,
          ] as [number, number],
          providers: file.transcriptFusionProgress?.providers
            ?? persistedArtifact.providerStatuses
            ?? { deepgram: 'complete' as const, openai: 'complete' as const },
          providerProgress: file.transcriptFusionProgress?.providerProgress,
          mergeProgress: 100,
          conflictCount: persistedArtifact.conflicts.length,
          resolvedCount: persistedArtifact.conflicts.filter(
            conflict => conflict.status !== 'needs-review',
          ).length,
          updatedAt: Date.now(),
        }
      : undefined;

    useMediaStore.setState({
      files: mediaState.files.map((f: MediaFile) =>
        f.id === mediaFileId
          ? {
              ...f,
              transcriptStatus: status,
              transcript: mergedWords,
              transcriptArtifact: persistedArtifact,
              transcriptFusionProgress: options?.progress ?? finalProgress,
              transcriptCoverage,
              transcribedRanges: mergedRanges,
            }
          : f,
      ),
    });

    log.debug('Propagated transcript to MediaFile', {
      mediaFileId,
      wordCount: mergedWords.length,
      coverage: transcriptCoverage.toFixed(2),
      status,
    });
    return {
      artifact: persistedArtifact,
      ranges: mergedRanges,
      words: mergedWords,
    };
  } catch (e) {
    log.warn('Failed to propagate transcript to MediaFile', e);
    return null;
  }
}

/**
 * Persist a completed transcription chunk while the larger run keeps going.
 * The stored ranges are the resume boundary after a reload.
 */
export async function persistTranscriptCheckpoint(
  mediaFileId: string,
  words: TranscriptWord[],
  newRanges: [number, number][],
  artifact: TranscriptFusionArtifact,
  progress: TranscriptFusionProgress,
): Promise<boolean> {
  const applied = applyTranscriptToMediaFile(
    mediaFileId,
    words,
    newRanges,
    artifact,
    { progress, status: 'transcribing' },
  );
  if (!applied) return false;

  try {
    const saved = await projectFileService.saveTranscript(mediaFileId, {
      words: applied.words,
      artifact: applied.artifact,
    }, applied.ranges);
    if (saved) {
      log.debug('Transcript checkpoint saved to project folder', {
        mediaFileId,
        rangeCount: applied.ranges.length,
      });
    }
    return saved;
  } catch (error) {
    log.warn('Failed to save transcript checkpoint', error);
    return false;
  }
}

/**
 * Propagate transcript to MediaFile for badge display and carry-over to new clips.
 * When source ranges are supplied, the incoming words are authoritative for
 * those ranges; words outside them remain intact.
 */
export async function propagateTranscriptToMediaFile(
  mediaFileId: string,
  words: TranscriptWord[],
  newRanges?: [number, number][],
  artifact?: TranscriptFusionArtifact,
): Promise<boolean> {
  const applied = applyTranscriptToMediaFile(mediaFileId, words, newRanges ?? [], artifact);
  if (!applied) return false;

  try {
    const saved = await projectFileService.saveTranscript(mediaFileId, {
      words: applied.words,
      artifact: applied.artifact,
    }, applied.ranges);
    if (saved) log.debug('Transcript saved to project folder', { mediaFileId });
    else log.warn('Transcript remained in memory but was not saved to the project folder', { mediaFileId });
    return saved;
  } catch (error) {
    log.warn('Failed to save transcript to the project folder', { mediaFileId, error });
    return false;
  }
}
