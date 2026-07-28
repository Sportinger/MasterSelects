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

/**
 * Propagate transcript to MediaFile for badge display and carry-over to new clips.
 * When source ranges are supplied, the incoming words are authoritative for
 * those ranges; words outside them remain intact.
 */
export function propagateTranscriptToMediaFile(
  mediaFileId: string,
  words: TranscriptWord[],
  newRanges?: [number, number][],
  artifact?: TranscriptFusionArtifact,
): void {
  try {
    const mediaState = useMediaStore.getState();
    const file = mediaState.files.find((f: MediaFile) => f.id === mediaFileId);
    if (!file) return;

    const existingWords = file.transcript ?? [];
    const retainedWords = newRanges?.length
      ? existingWords.filter(word => !newRanges.some(
          ([rangeStart, rangeEnd]) => word.start < rangeEnd && rangeStart < word.end,
        ))
      : existingWords;
    const mergedWords = (
      newRanges?.length
        ? [...retainedWords, ...words]
        : mergeTranscriptWords(retainedWords, words)
    ).toSorted((left, right) => left.start - right.start);

    let transcriptCoverage = 0;
    if (file.duration && file.duration > 0) {
      const existingRanges = file.transcribedRanges || [];
      const allRanges = [...existingRanges, ...(newRanges || [])];
      transcriptCoverage = allRanges.length > 0 ? calcCoverage(allRanges, file.duration) : 0;
    }

    const existingRanges: [number, number][] = file.transcribedRanges || [];
    const mergedRanges = mergeRanges([...existingRanges, ...(newRanges || [])]);
    const persistedArtifact = artifact
      ? { ...artifact, words: mergedWords }
      : undefined;

    useMediaStore.setState({
      files: mediaState.files.map((f: MediaFile) =>
        f.id === mediaFileId
          ? {
              ...f,
              transcriptStatus: 'ready' as TranscriptStatus,
              transcript: mergedWords,
              transcriptArtifact: persistedArtifact,
              transcriptFusionProgress: persistedArtifact
                ? {
                    stage: 'complete',
                    range: [
                      mergedRanges[0]?.[0] ?? 0,
                      mergedRanges.at(-1)?.[1] ?? mergedWords.at(-1)?.end ?? 0,
                    ],
                    providers: file.transcriptFusionProgress?.providers
                      ?? { deepgram: 'complete', openai: 'complete' },
                    conflictCount: persistedArtifact.conflicts.length,
                    resolvedCount: persistedArtifact.conflicts.filter(
                      conflict => conflict.status !== 'needs-review',
                    ).length,
                    updatedAt: Date.now(),
                  }
                : undefined,
              transcriptCoverage,
              transcribedRanges: mergedRanges,
            }
          : f,
      ),
    });

    projectFileService.saveTranscript(mediaFileId, {
      words: mergedWords,
      artifact: persistedArtifact,
    }, mergedRanges).then(saved => {
      if (saved) log.debug('Transcript saved to project folder', { mediaFileId });
    }).catch(() => { /* no project open */ });

    log.debug('Propagated transcript to MediaFile', {
      mediaFileId,
      wordCount: mergedWords.length,
      coverage: transcriptCoverage.toFixed(2),
    });
  } catch (e) {
    log.warn('Failed to propagate transcript to MediaFile', e);
  }
}
