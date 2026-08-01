// Clip Transcriber Service
// Handles transcription of individual clips using Whisper (local) or cloud APIs

import { Logger } from './logger';
import { triggerTimelineSave, useMediaStore } from '../stores/mediaStore';
import type {
  TranscriptFusionArtifact,
  TranscriptFusionProgress,
  TranscriptFusionProviderStatus,
  TranscriptProviderProgress,
  TranscriptProviderId,
  TranscriptWord,
} from '../types/clipMetadata';
import { projectFileService } from './project/ProjectFileService';
import { useSettingsStore } from '../stores/settingsStore';
import { useAccountStore } from '../stores/accountStore';
import {
  audioBufferToWav,
  extractAudioBuffer,
  isAudioBearingFile,
  resampleAudio,
  splitAudioBuffer,
} from './transcription/audioPrep';
import {
  persistTranscriptCheckpoint,
  propagateTranscriptToMediaFile,
  updateClipTranscript,
  updateTranscriptFusionPreview,
} from './transcription/artifactPersistence';
import { resolveClipTranscriptWords } from './transcription/clipTranscriptResolver';
import { findGaps, mergeTranscriptWords } from './transcription/resultMapping';
import {
  HOSTED_TRANSCRIPTION_MAX_BYTES,
  transcribeWithHostedProvider,
} from './transcription/cloudProviders';
import {
  createTranscriptProviderRun,
  fuseTranscriptProviderRuns,
  replaceTranscriptFusionRanges,
} from './transcription/fusion/transcriptFusion';
import { runWorkerTranscription } from './transcription/workerClient';
import {
  beginTranscriptionRun,
  cancelTranscriptionRun,
  commitTranscriptionRunCheckpoint,
  finishTranscriptionRun,
  hasActiveTranscriptionRun,
  isActiveTranscriptionRun,
  isTranscriptionAbort,
  publishTranscriptionRunUpdate,
  restoreActiveTranscriptionRun,
} from './transcription/transcriptionRunController';
import {
  findTimelineAnalysisClip,
  findTimelineAnalysisMediaFile,
  readTimelineAnalysisClips,
} from './timeline/timelineRuntimeCoordinator';

const log = Logger.create('ClipTranscriber');
const WAV_HEADER_BYTES = 44;
const WAV_MONO_BYTES_PER_SAMPLE = 2;

function estimateHybridChunkCount(
  ranges: readonly [number, number][],
  sampleRate: number,
): number {
  const maxSamples = Math.floor(
    (HOSTED_TRANSCRIPTION_MAX_BYTES - WAV_HEADER_BYTES) / WAV_MONO_BYTES_PER_SAMPLE,
  );
  const maxChunkSeconds = maxSamples / sampleRate;
  return ranges.reduce((total, [start, end]) => (
    total + Math.max(1, Math.ceil(Math.max(0, end - start) / maxChunkSeconds))
  ), 0);
}

function boundedPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

export const SIGNED_OUT_HOSTED_TRANSCRIPTION_MESSAGE =
  'Sign in to use hosted transcription, or explicitly select Local Whisper. Personal provider API keys are not supported.';

async function transcribeHybridProvider(
  provider: TranscriptProviderId,
  options: {
    audioBlob: Blob;
    clipId: string;
    inPointOffset: number;
    language: string;
    signal: AbortSignal;
  },
): Promise<TranscriptWord[]> {
  const ignoreProviderProgress = () => undefined;
  return transcribeWithHostedProvider(
    provider,
    options.clipId,
    options.audioBlob,
    options.language,
    options.inPointOffset,
    ignoreProviderProgress,
    {
      ...(provider === 'openai' ? { openAIVariant: 'diarized-speakers' as const } : {}),
      signal: options.signal,
    },
  );
}

async function transcribeHybridRange(options: {
  audioBlob: Blob;
  clipId: string;
  language: string;
  onArtifactUpdate?: (
    artifact: TranscriptFusionArtifact,
    stage: TranscriptFusionProgress['stage'],
  ) => void;
  onProviderUpdate?: (
    provider: TranscriptProviderId,
    status: TranscriptFusionProviderStatus,
    words?: TranscriptWord[],
  ) => void;
  range: [number, number];
  signal: AbortSignal;
}): Promise<TranscriptFusionArtifact> {
  const providerOptions = {
    audioBlob: options.audioBlob,
    clipId: options.clipId,
    inPointOffset: options.range[0],
    language: options.language,
    signal: options.signal,
  };
  const runProvider = async (provider: TranscriptProviderId): Promise<TranscriptWord[]> => {
    try {
      options.signal.throwIfAborted();
      const words = await transcribeHybridProvider(provider, providerOptions);
      options.signal.throwIfAborted();
      options.onProviderUpdate?.(provider, 'complete', words);
      return words;
    } catch (error) {
      if (options.signal.aborted) throw error;
      options.onProviderUpdate?.(provider, 'error');
      throw error;
    }
  };
  const [deepgramResult, openaiResult] = await Promise.allSettled([
    runProvider('deepgram'),
    runProvider('openai'),
  ]);
  if (deepgramResult.status === 'rejected') {
    throw deepgramResult.reason;
  }

  const createdAt = Date.now();
  const deepgramRun = createTranscriptProviderRun({
    createdAt,
    language: options.language,
    provider: 'deepgram',
    range: options.range,
    words: deepgramResult.value,
  });
  const openaiRun = createTranscriptProviderRun({
    createdAt,
    language: options.language,
    provider: 'openai',
    range: options.range,
    words: openaiResult.status === 'fulfilled' ? openaiResult.value : [],
  });
  if (openaiResult.status === 'rejected') {
    log.warn('OpenAI speaker separation failed; keeping Deepgram speaker labels', openaiResult.reason);
  }

  const artifact = {
    ...fuseTranscriptProviderRuns(deepgramRun, openaiRun),
    providerStatuses: {
      deepgram: 'complete' as const,
      openai: openaiResult.status === 'fulfilled' ? 'complete' as const : 'error' as const,
    },
  };
  options.onArtifactUpdate?.(artifact, 'finalizing');
  return artifact;
}

/**
 * Extract audio from a clip's file and transcribe it.
 * Signed-in accounts use the selected hosted transcription provider. Signed-out
 * accounts may only use explicitly selected local transcription; browser-supplied
 * provider credentials are never a fallback.
 * When continueMode is true, only transcribes uncovered time ranges.
 */
export async function transcribeClip(
  clipId: string,
  language: string = 'auto',
  options?: { continueMode?: boolean },
): Promise<void> {
  if (hasActiveTranscriptionRun()) {
    log.warn('Already transcribing');
    return;
  }

  const clips = readTimelineAnalysisClips();
  const clip = clips.find(c => c.id === clipId);

  if (!clip || !clip.file) {
    log.warn('Clip not found or has no file', { clipId });
    return;
  }

  if (!isAudioBearingFile(clip.file)) {
    log.warn('File does not contain audio', { type: clip.file.type || '', name: clip.file.name || '' });
    return;
  }

  const { transcriptionProvider } = useSettingsStore.getState();
  const useHostedTranscription = Boolean(useAccountStore.getState().session?.authenticated);
  const useHybridTranscription = transcriptionProvider === 'hybrid';
  const hostedProvider = transcriptionProvider === 'deepgram' ? 'deepgram' : 'openai';
  const effectiveProvider = useHybridTranscription
    ? 'hybrid'
    : useHostedTranscription
      ? hostedProvider
      : transcriptionProvider;
  if (!useHostedTranscription && effectiveProvider !== 'local') {
    log.warn('Blocked signed-out hosted transcription; sign-in is required', {
      provider: effectiveProvider,
    });
    updateClipTranscript(clipId, {
      status: 'error',
      progress: 0,
      message: SIGNED_OUT_HOSTED_TRANSCRIPTION_MESSAGE,
    });
    return;
  }

  const continueMode = options?.continueMode ?? false;
  const linkedClip = clip.linkedClipId
    ? clips.find(c => c.id === clip.linkedClipId)
    : clips.find(c => c.linkedClipId === clip.id);
  const existingTranscript = resolveClipTranscriptWords(clip)
    ?? (linkedClip ? resolveClipTranscriptWords(linkedClip) : undefined);
  const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
  const mediaFile = mediaFileId
    ? findTimelineAnalysisMediaFile(mediaFileId)
    : undefined;
  const existingFusionArtifact = mediaFile?.transcriptArtifact;
  const inPoint = clip.inPoint || 0;
  const outPoint = clip.outPoint || clip.duration;
  let transcriptionGaps: [number, number][] | null = null;

  if (continueMode && mediaFileId && projectFileService.isProjectOpen()) {
    try {
      const transcribedRanges = await projectFileService.getTranscribedRanges(mediaFileId);
      transcriptionGaps = findGaps(transcribedRanges, inPoint, outPoint);
      if (transcriptionGaps.length === 0) {
        log.info('No gaps to transcribe, clip is fully covered');
        return;
      }
      log.info(`Continue mode: ${transcriptionGaps.length} gaps to transcribe`, { gaps: transcriptionGaps });
    } catch (err) {
      log.warn('Failed to get transcribed ranges for continue mode', err);
      transcriptionGaps = null;
    }
  }

  const run = beginTranscriptionRun({
    clipId,
    clipSnapshot: {
      message: clip.transcriptMessage,
      progress: clip.transcriptProgress ?? 0,
      status: clip.transcriptStatus ?? (existingTranscript?.length ? 'ready' : 'none'),
      words: existingTranscript,
    },
    mediaFileId,
    mediaSnapshot: mediaFile
      ? {
          artifact: mediaFile.transcriptArtifact,
          progress: mediaFile.transcriptFusionProgress,
          status: mediaFile.transcriptStatus,
          words: mediaFile.transcript,
        }
      : undefined,
  });
  const { signal } = run.controller;
  const publishClipUpdate = (data: Parameters<typeof updateClipTranscript>[1]): void =>
    publishTranscriptionRunUpdate(run, data);
  const publishProviderUpdate: typeof updateClipTranscript = (_targetClipId, data) =>
    publishClipUpdate(data);

  const providerName = useHostedTranscription
    ? useHybridTranscription
      ? 'Best Quality: Deepgram Text + OpenAI Speakers'
      : hostedProvider === 'deepgram' ? 'Deepgram Cloud' : 'OpenAI Cloud'
    : useHybridTranscription
      ? 'Best Quality: Deepgram Text + OpenAI Speakers'
    : effectiveProvider === 'local'
      ? 'Local Whisper'
      : effectiveProvider.toUpperCase();
  log.info(`Starting transcription for ${clip.name} using ${providerName}${continueMode ? ' (continue mode)' : ''}`);

  publishClipUpdate({
    status: 'transcribing',
    progress: 0,
    message: 'Extracting audio...',
  });
  if (useHybridTranscription && mediaFileId) {
    updateTranscriptFusionPreview(mediaFileId, {
      ...(!continueMode ? { artifact: null } : {}),
      progress: {
        stage: 'transcribing',
        range: [inPoint, outPoint],
        providers: {
          deepgram: 'running',
          openai: 'running',
        },
        providerProgress: {
          deepgram: { completedChunks: 0, totalChunks: 1, percent: 0 },
          openai: { completedChunks: 0, totalChunks: 1, percent: 0 },
        },
        mergeProgress: 0,
        conflictCount: 0,
        resolvedCount: 0,
        updatedAt: Date.now(),
      },
    });
  }

  try {
    const ranges = transcriptionGaps || [[inPoint, outPoint] as [number, number]];
    const allNewWords: TranscriptWord[] = [];
    const fusionArtifacts: TranscriptFusionArtifact[] = [];
    const totalDuration = ranges.reduce((sum, [s, e]) => sum + (e - s), 0);
    let processedDuration = 0;
    const completedHybridRanges: [number, number][] = [];
    const providerCompletedDuration: Record<TranscriptProviderId, number> = {
      deepgram: 0,
      openai: 0,
    };
    const providerCompletedChunks: Record<TranscriptProviderId, number> = {
      deepgram: 0,
      openai: 0,
    };
    const providerHadError: Record<TranscriptProviderId, boolean> = {
      deepgram: false,
      openai: false,
    };
    let hybridTotalChunks = 0;
    let hybridChunkIndex = 0;

    const getProviderProgress = (): Record<TranscriptProviderId, TranscriptProviderProgress> => ({
      deepgram: {
        completedChunks: providerCompletedChunks.deepgram,
        totalChunks: Math.max(1, hybridTotalChunks),
        percent: boundedPercent(providerCompletedDuration.deepgram, totalDuration),
      },
      openai: {
        completedChunks: providerCompletedChunks.openai,
        totalChunks: Math.max(1, hybridTotalChunks),
        percent: boundedPercent(providerCompletedDuration.openai, totalDuration),
      },
    });
    const getProviderStatuses = (
      providerProgress: Record<TranscriptProviderId, TranscriptProviderProgress>,
    ): Record<TranscriptProviderId, TranscriptFusionProviderStatus> => ({
      deepgram: providerHadError.deepgram
        ? 'error'
        : providerProgress.deepgram.percent >= 100 ? 'complete' : 'running',
      openai: providerHadError.openai
        ? 'error'
        : providerProgress.openai.percent >= 100 ? 'complete' : 'running',
    });
    const buildHybridProgress = (
      stage: TranscriptFusionProgress['stage'],
      range: [number, number],
      mergeProgress: number = 0,
    ): TranscriptFusionProgress => {
      const providerProgress = getProviderProgress();
      return {
        stage,
        range,
        providers: getProviderStatuses(providerProgress),
        providerProgress,
        mergeProgress,
        conflictCount: 0,
        resolvedCount: 0,
        updatedAt: Date.now(),
      };
    };
    const publishHybridProgress = ({
      currentWords,
      mergeProgress = 0,
      message,
      range,
      stage,
    }: {
      currentWords?: TranscriptWord[];
      mergeProgress?: number;
      message?: string;
      range: [number, number];
      stage: TranscriptFusionProgress['stage'];
    }): TranscriptFusionProgress => {
      const progress = buildHybridProgress(stage, range, mergeProgress);
      if (!isActiveTranscriptionRun(run)) return progress;
      const stagedNewWords = currentWords?.length
        ? mergeTranscriptWords(allNewWords, currentWords)
        : allNewWords;
      const stagedWords = continueMode && existingTranscript?.length
        ? mergeTranscriptWords(existingTranscript, stagedNewWords)
        : stagedNewWords;
      const stagedArtifact = fusionArtifacts.length > 0
        ? replaceTranscriptFusionRanges(
            existingFusionArtifact,
            fusionArtifacts,
            completedHybridRanges,
            stagedWords,
          )
        : undefined;
      const providerAverage = (
        progress.providerProgress!.deepgram.percent
        + progress.providerProgress!.openai.percent
      ) / 2;
      const overallProgress = stage === 'transcribing'
        ? Math.round(providerAverage * 0.9)
        : stage === 'aligning' || stage === 'finalizing'
          ? 90 + Math.round(Math.max(0, Math.min(100, mergeProgress)) * 0.1)
          : stage === 'complete'
            ? 100
            : Math.round(providerAverage * 0.9);
      const liveMessage = message ?? (
        stage === 'transcribing'
          ? `Deepgram ${progress.providerProgress!.deepgram.percent}% · OpenAI ${progress.providerProgress!.openai.percent}%`
          : stage === 'aligning'
            ? 'Merging provider chunks...'
            : stage === 'finalizing'
              ? 'Applying speaker separation...'
              : stage === 'error'
                ? 'Best Quality transcription stopped.'
                : 'Best Quality transcription complete.'
      );

      publishClipUpdate({
        ...(stagedWords.length > 0 ? { words: stagedWords } : {}),
        progress: overallProgress,
        message: liveMessage,
      });
      if (mediaFileId) {
        updateTranscriptFusionPreview(mediaFileId, {
          ...(stagedArtifact ? { artifact: stagedArtifact } : {}),
          progress,
        });
      }
      return progress;
    };

    for (let ri = 0; ri < ranges.length; ri++) {
      signal.throwIfAborted();
      const [rangeStart, rangeEnd] = ranges[ri];
      const rangeDuration = rangeEnd - rangeStart;

      log.debug(`Extracting audio from ${rangeStart.toFixed(1)}s to ${rangeEnd.toFixed(1)}s (${rangeDuration.toFixed(1)}s)`);

      const audioBuffer = await extractAudioBuffer(clip.file, rangeStart, rangeEnd);
      signal.throwIfAborted();
      const audioDuration = audioBuffer.duration;

      log.debug(`Audio extracted: ${audioDuration.toFixed(1)}s`);

      const progressBase = Math.round((processedDuration / totalDuration) * 100);
      const progressScale = rangeDuration / totalDuration;
      let words: TranscriptWord[];

      if (useHybridTranscription) {
        const audioChunks = splitAudioBuffer(audioBuffer, HOSTED_TRANSCRIPTION_MAX_BYTES);
        if (hybridTotalChunks === 0) {
          hybridTotalChunks = estimateHybridChunkCount(ranges, audioBuffer.sampleRate);
        }
        let sampleOffset = 0;

        for (const audioChunk of audioChunks) {
          signal.throwIfAborted();
          const chunkStart = rangeStart + sampleOffset / audioBuffer.sampleRate;
          const chunkEnd = Math.min(
            rangeEnd,
            chunkStart + audioChunk.length / audioBuffer.sampleRate,
          );
          const chunkRange: [number, number] = [chunkStart, chunkEnd];
          const chunkDuration = Math.max(0, chunkEnd - chunkStart);
          const chunkNumber = hybridChunkIndex + 1;
          const terminalProviders = new Set<TranscriptProviderId>();
          let liveDeepgramWords: TranscriptWord[] | undefined;

          publishHybridProgress({
            range: chunkRange,
            stage: 'transcribing',
            message: `Chunk ${chunkNumber}/${hybridTotalChunks} · Deepgram and OpenAI running in parallel...`,
          });
          const audioBlob = await audioBufferToWav(audioChunk);
          const artifact = await transcribeHybridRange({
            audioBlob,
            clipId,
            language,
            onProviderUpdate: (provider, status, providerWords) => {
              if (
                (status === 'complete' || status === 'error')
                && !terminalProviders.has(provider)
              ) {
                terminalProviders.add(provider);
                providerCompletedChunks[provider] += 1;
                providerCompletedDuration[provider] += chunkDuration;
                if (status === 'error') providerHadError[provider] = true;
              }
              if (provider === 'deepgram' && providerWords) {
                liveDeepgramWords = providerWords;
              }
              publishHybridProgress({
                currentWords: liveDeepgramWords,
                range: chunkRange,
                stage: 'transcribing',
              });
            },
            range: chunkRange,
            signal,
          });

          words = artifact.words;
          allNewWords.push(...words);
          fusionArtifacts.push(artifact);
          completedHybridRanges.push(chunkRange);
          hybridChunkIndex += 1;
          sampleOffset += audioChunk.length;

          const checkpointWords = continueMode && existingTranscript?.length
            ? mergeTranscriptWords(existingTranscript, allNewWords)
            : [...allNewWords];
          const checkpointArtifact = replaceTranscriptFusionRanges(
            existingFusionArtifact,
            fusionArtifacts,
            completedHybridRanges,
            checkpointWords,
          );
          const checkpointProgress = publishHybridProgress({
            range: chunkRange,
            stage: 'transcribing',
            message: `Saved chunk ${hybridChunkIndex}/${hybridTotalChunks} · Deepgram ${getProviderProgress().deepgram.percent}% · OpenAI ${getProviderProgress().openai.percent}%`,
          });

          if (mediaFileId && checkpointArtifact) {
            await persistTranscriptCheckpoint(
              mediaFileId,
              allNewWords,
              completedHybridRanges,
              checkpointArtifact,
              checkpointProgress,
            );
            const checkpointMedia = findTimelineAnalysisMediaFile(mediaFileId);
            commitTranscriptionRunCheckpoint(run, {
              artifact: checkpointArtifact,
              clipWords: checkpointWords,
              mediaWords: checkpointMedia?.transcript,
            });
            triggerTimelineSave();
          }
        }

        processedDuration += rangeDuration;
        continue;
      } else if (effectiveProvider === 'local' && !useHostedTranscription) {
        const audioData = await resampleAudio(audioBuffer, 16000);
        publishClipUpdate({
          progress: progressBase + Math.round(5 * progressScale),
          message: ranges.length > 1 ? `Transcribing range ${ri + 1}/${ranges.length}...` : 'Starting local transcription...',
        });
        words = await runWorkerTranscription(
          clipId,
          audioData,
          language,
          audioDuration,
          rangeStart,
          publishProviderUpdate,
        );
      } else {
        publishClipUpdate({
          progress: progressBase + Math.round(10 * progressScale),
          message: ranges.length > 1 ? `Uploading range ${ri + 1}/${ranges.length} to ${providerName}...` : `Uploading to ${providerName}...`,
        });

        const audioBlob = await audioBufferToWav(audioBuffer);
        if (!useHostedTranscription) {
          throw new Error(SIGNED_OUT_HOSTED_TRANSCRIPTION_MESSAGE);
        }
        words = await transcribeWithHostedProvider(
          hostedProvider,
          clipId,
          audioBlob,
          language,
          rangeStart,
          publishProviderUpdate,
          { signal },
        );
      }

      allNewWords.push(...words);
      processedDuration += rangeDuration;
    }

    const finalWords = continueMode && existingTranscript?.length
      ? mergeTranscriptWords(existingTranscript, allNewWords)
      : allNewWords;
    if (useHybridTranscription) {
      publishHybridProgress({
        currentWords: finalWords,
        mergeProgress: 35,
        range: [inPoint, outPoint],
        stage: 'aligning',
      });
    }
    const fusionArtifact = useHybridTranscription
      ? replaceTranscriptFusionRanges(
          existingFusionArtifact,
          fusionArtifacts,
          completedHybridRanges,
          finalWords,
        )
      : undefined;
    if (useHybridTranscription) {
      publishHybridProgress({
        currentWords: finalWords,
        mergeProgress: 90,
        range: [inPoint, outPoint],
        stage: 'finalizing',
      });
    }

    signal.throwIfAborted();
    publishClipUpdate({
      status: 'ready',
      progress: 100,
      words: finalWords,
      message: undefined,
    });
    triggerTimelineSave();

    if (isActiveTranscriptionRun(run) && mediaFileId) {
      const newRanges: [number, number][] = (
        useHybridTranscription ? completedHybridRanges : ranges
      ).map(([s, e]) => [s, e]);
      const saved = await propagateTranscriptToMediaFile(
        mediaFileId,
        allNewWords,
        newRanges,
        fusionArtifact,
      );
      if (!saved && projectFileService.isProjectOpen()) {
        throw new Error('Transcript completed but could not be saved to the project.');
      }
    }

    log.info(`Complete: ${finalWords.length} words for ${clip.name}`);
  } catch (error) {
    if (isTranscriptionAbort(error, signal) || !isActiveTranscriptionRun(run)) {
      restoreActiveTranscriptionRun(run);
      log.info('Transcription cancelled', { clipId });
      return;
    }
    log.error('Transcription failed', error);
    if (useHybridTranscription && mediaFileId) {
      const activeProgress = findTimelineAnalysisMediaFile(mediaFileId)?.transcriptFusionProgress;
      updateTranscriptFusionPreview(mediaFileId, {
        progress: {
          stage: 'error',
          range: activeProgress?.range ?? [inPoint, outPoint],
          providers: activeProgress?.providers ?? {
            deepgram: 'error',
            openai: 'error',
          },
          providerProgress: activeProgress?.providerProgress,
          mergeProgress: activeProgress?.mergeProgress,
          conflictCount: activeProgress?.conflictCount ?? 0,
          resolvedCount: activeProgress?.resolvedCount ?? 0,
          updatedAt: Date.now(),
        },
      });
    }
    publishClipUpdate({
      status: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    finishTranscriptionRun(run);
  }
}

/**
 * Clear transcript from a clip.
 */
export function clearClipTranscript(clipId: string): void {
  const clip = findTimelineAnalysisClip(clipId);
  const mediaFileId = clip?.source?.mediaFileId || clip?.mediaFileId;
  updateClipTranscript(clipId, {
    status: 'none',
    progress: 0,
    words: undefined,
    message: undefined,
  });
  if (mediaFileId) {
    useMediaStore.setState(state => ({
      files: state.files.map(file => file.id === mediaFileId
        ? {
            ...file,
            transcriptStatus: 'none',
            transcript: undefined,
            transcriptArtifact: undefined,
            transcriptFusionProgress: undefined,
            transcriptCoverage: 0,
            transcribedRanges: undefined,
          }
        : file),
    }));
    projectFileService.deleteTranscript(mediaFileId).catch(error => {
      log.warn('Failed to delete transcript artifact', error);
    });
  }
  triggerTimelineSave();
}

/**
 * Cancel ongoing transcription.
 */
export function cancelTranscription(clipId?: string): void {
  cancelTranscriptionRun(clipId);
}
