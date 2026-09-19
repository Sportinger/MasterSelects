import { useTimelineStore } from '../../stores/timeline';
import { updateDerivedTimelineClips } from '../../stores/timeline/revisionMiddleware';
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
import {
  readMediaRuntimeState,
  readTimelineRuntimeState,
} from '../timeline/timelineRuntimeCoordinator';
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

export type TranscriptWordCorrectionResult =
  | { ok: false; error: string }
  | { ok: true; persistence?: Promise<boolean>; word: TranscriptWord };

const manualTranscriptSaveQueue = new Map<string, Promise<boolean>>();

function enqueueManualTranscriptSave(
  mediaFileId: string,
  words: TranscriptWord[],
  artifact: TranscriptFusionArtifact | undefined,
  ranges: [number, number][] | undefined,
): Promise<boolean> {
  const previous = manualTranscriptSaveQueue.get(mediaFileId) ?? Promise.resolve(true);
  const pending = previous
    .catch(() => false)
    .then(() => projectFileService.saveTranscript(mediaFileId, { words, artifact }, ranges))
    .catch(error => {
      log.warn('Failed to save manual transcript correction', { mediaFileId, error });
      return false;
    });
  manualTranscriptSaveQueue.set(mediaFileId, pending);
  void pending.finally(() => {
    if (manualTranscriptSaveQueue.get(mediaFileId) === pending) {
      manualTranscriptSaveQueue.delete(mediaFileId);
    }
  });
  return pending;
}

function resolveCorrectionSource(sourceClipId: string): {
  clip: ReturnType<typeof useTimelineStore.getState>['clips'][number];
  file: MediaFile | undefined;
  mediaFileId: string | undefined;
  words: TranscriptWord[];
} | null {
  const clip = readTimelineRuntimeState(useTimelineStore).clips.find(candidate => candidate.id === sourceClipId);
  if (!clip) return null;
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  const file = mediaFileId
    ? readMediaRuntimeState(useMediaStore).files.find(candidate => candidate.id === mediaFileId)
    : undefined;
  const words = file?.transcript?.length ? file.transcript : clip.transcript ?? [];
  return { clip, file, mediaFileId, words };
}

export function getTranscriptWordForCaptionEdit(
  sourceClipId: string,
  wordId: string,
): TranscriptWord | undefined {
  return resolveCorrectionSource(sourceClipId)?.words.find(word => word.id === wordId);
}

/** Replace one transcript word while preserving its word-level timing slot. */
export function correctTranscriptWordFromCaption(input: {
  sourceClipId: string;
  wordId: string;
  text: string;
}): TranscriptWordCorrectionResult {
  const text = input.text.trim();
  if (!text) return { ok: false, error: 'Das Wort darf nicht leer sein.' };
  if (/\s/u.test(text)) {
    return { ok: false, error: 'Bitte nur ein Wort pro Timing-Slot eingeben.' };
  }

  const source = resolveCorrectionSource(input.sourceClipId);
  if (!source) return { ok: false, error: 'Die Caption-Quelle wurde nicht gefunden.' };
  const previousWord = source.words.find(word => word.id === input.wordId);
  if (!previousWord) return { ok: false, error: 'Das Transcript-Wort wurde nicht gefunden.' };
  if (previousWord.text === text) return { ok: true, word: previousWord };

  const correctedWord = { ...previousWord, text };
  const words = source.words.map(word => word.id === input.wordId ? correctedWord : word);
  const artifact = source.file?.transcriptArtifact
    ? {
        ...source.file.transcriptArtifact,
        words: source.file.transcriptArtifact.words.map(word => (
          word.id === input.wordId ? { ...word, text } : word
        )),
        patches: [
          ...source.file.transcriptArtifact.patches,
          {
            id: `manual-caption:${Date.now()}:${input.wordId}`,
            conflictId: `manual:${input.wordId}`,
            source: 'manual' as const,
            operation: 'choose-text' as const,
            wordIds: [input.wordId],
            before: previousWord.text,
            after: text,
            confidence: 1,
            reason: 'Caption word corrected directly in preview',
            createdAt: Date.now(),
          },
        ],
      }
    : undefined;

  if (source.mediaFileId) {
    useMediaStore.setState(state => ({
      files: state.files.map(file => file.id === source.mediaFileId
        ? { ...file, transcript: words, transcriptArtifact: artifact }
        : file),
    }));
  }

  updateDerivedTimelineClips(clips => clips.map(clip => {
    const clipMediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
    const sharesSource = source.mediaFileId
      ? clipMediaFileId === source.mediaFileId
      : clip.id === source.clip.id || clip.linkedClipId === source.clip.id;
    return sharesSource ? { ...clip, transcript: words } : clip;
  }));

  const persistence = source.mediaFileId
    ? enqueueManualTranscriptSave(
        source.mediaFileId,
        words,
        artifact,
        source.file?.transcribedRanges,
      )
    : undefined;
  return { ok: true, persistence, word: correctedWord };
}

/**
 * Update clip transcript data in the timeline store.
 */
export function updateClipTranscript(clipId: string, data: ClipTranscriptUpdate): void {
  const store = readTimelineRuntimeState(useTimelineStore);
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

  updateDerivedTimelineClips(() => clips);
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
    const mediaState = readMediaRuntimeState(useMediaStore);
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

  updateDerivedTimelineClips(clips => clips.map(clip => {
    const clipMediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
    if (clipMediaFileId !== mediaFileId) return clip;
    return {
      ...clip,
      transcript: applied.words,
      transcriptMessage: undefined,
      transcriptProgress: 100,
      transcriptStatus: 'ready' as const,
    };
  }));

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
