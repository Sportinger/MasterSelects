import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import type { MediaFile } from '../../stores/mediaStore/types';
import type { TranscriptStatus, TranscriptWord } from '../../types/clipMetadata';
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

/**
 * Update clip transcript data in the timeline store.
 */
export function updateClipTranscript(clipId: string, data: ClipTranscriptUpdate): void {
  const store = useTimelineStore.getState();
  const clips = store.clips.map(clip => {
    if (clip.id !== clipId) return clip;

    return {
      ...clip,
      transcriptStatus: data.status ?? clip.transcriptStatus,
      transcriptProgress: data.progress ?? clip.transcriptProgress,
      transcript: data.words ?? clip.transcript,
      transcriptMessage: data.message,
    };
  });

  useTimelineStore.setState({ clips });
}

/**
 * Propagate transcript to MediaFile for badge display and carry-over to new clips.
 * Merges with existing transcript if the MediaFile already has words from a different region.
 * Also tracks transcribed ranges for continue mode and project transcript artifacts.
 */
export function propagateTranscriptToMediaFile(
  mediaFileId: string,
  words: TranscriptWord[],
  newRanges?: [number, number][],
): void {
  try {
    const mediaState = useMediaStore.getState();
    const file = mediaState.files.find((f: MediaFile) => f.id === mediaFileId);
    if (!file) return;

    const mergedWords = file.transcript?.length
      ? mergeTranscriptWords(file.transcript, words)
      : words;

    let transcriptCoverage = 0;
    if (file.duration && file.duration > 0) {
      const existingRanges = file.transcribedRanges || [];
      const allRanges = [...existingRanges, ...(newRanges || [])];
      transcriptCoverage = allRanges.length > 0 ? calcCoverage(allRanges, file.duration) : 0;
    }

    const existingRanges: [number, number][] = file.transcribedRanges || [];
    const mergedRanges = mergeRanges([...existingRanges, ...(newRanges || [])]);

    useMediaStore.setState({
      files: mediaState.files.map((f: MediaFile) =>
        f.id === mediaFileId
          ? {
              ...f,
              transcriptStatus: 'ready' as TranscriptStatus,
              transcript: mergedWords,
              transcriptCoverage,
              transcribedRanges: mergedRanges,
            }
          : f,
      ),
    });

    projectFileService.saveTranscript(mediaFileId, mergedWords, mergedRanges).then(saved => {
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
