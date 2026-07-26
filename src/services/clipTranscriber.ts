// Clip Transcriber Service
// Handles transcription of individual clips using Whisper (local) or cloud APIs

import { Logger } from './logger';
import { useTimelineStore } from '../stores/timeline';
import { triggerTimelineSave, useMediaStore } from '../stores/mediaStore';
import type { APIKeys } from '../stores/settingsStore';
import type {
  TranscriptFusionArtifact,
  TranscriptFusionProgress,
  TranscriptFusionProviderStatus,
  TranscriptProviderId,
  TranscriptWord,
} from '../types/clipMetadata';
import { projectFileService } from './project/ProjectFileService';
import { useSettingsStore } from '../stores/settingsStore';
import { useAccountStore } from '../stores/accountStore';
import { extractAudioBuffer, isAudioBearingFile, resampleAudio, audioBufferToWav } from './transcription/audioPrep';
import {
  propagateTranscriptToMediaFile,
  updateClipTranscript,
  updateTranscriptFusionPreview,
} from './transcription/artifactPersistence';
import { findGaps, mergeTranscriptWords } from './transcription/resultMapping';
import { transcribeWithCloudProvider, transcribeWithHostedProvider } from './transcription/cloudProviders';
import {
  createTranscriptProviderRun,
  fuseTranscriptProviderRuns,
  replaceTranscriptFusionRanges,
} from './transcription/fusion/transcriptFusion';
import { runWorkerTranscription } from './transcription/workerClient';
import {
  beginTranscriptionRun,
  cancelTranscriptionRun,
  finishTranscriptionRun,
  hasActiveTranscriptionRun,
  isActiveTranscriptionRun,
  isTranscriptionAbort,
  publishTranscriptionRunUpdate,
  restoreActiveTranscriptionRun,
} from './transcription/transcriptionRunController';

const log = Logger.create('ClipTranscriber');

function isLocalHostedApiUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('Hosted API route /api/ai/audio')
    && (error.message.includes('not available') || error.message.includes('did not respond'));
}

async function transcribeHybridProvider(
  provider: TranscriptProviderId,
  options: {
    apiKeys: APIKeys;
    audioBlob: Blob;
    clipId: string;
    inPointOffset: number;
    language: string;
    signal: AbortSignal;
    useHostedTranscription: boolean;
  },
): Promise<TranscriptWord[]> {
  const ignoreProviderProgress = () => undefined;
  if (options.useHostedTranscription) {
    try {
      return await transcribeWithHostedProvider(
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
    } catch (error) {
      if (!isLocalHostedApiUnavailable(error) || !options.apiKeys[provider]?.trim()) {
        throw error;
      }
      log.warn(`Hosted ${provider} transcription unavailable; using configured API key`, error);
    }
  }

  return transcribeWithCloudProvider(
    provider,
    options.clipId,
    options.audioBlob,
    options.language,
    options.apiKeys[provider],
    options.inPointOffset,
    ignoreProviderProgress,
    {
      ...(provider === 'openai' ? { openAIVariant: 'diarized-speakers' as const } : {}),
      signal: options.signal,
    },
  );
}

async function transcribeHybridRange(options: {
  apiKeys: APIKeys;
  audioBlob: Blob;
  clipId: string;
  isSignedIn: boolean;
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
    apiKeys: options.apiKeys,
    audioBlob: options.audioBlob,
    clipId: options.clipId,
    inPointOffset: options.range[0],
    language: options.language,
    signal: options.signal,
    useHostedTranscription: options.isSignedIn,
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

  const artifact = fuseTranscriptProviderRuns(deepgramRun, openaiRun);
  options.onArtifactUpdate?.(artifact, 'finalizing');
  return artifact;
}

/**
 * Extract audio from a clip's file and transcribe it.
 * Signed-in accounts use the selected hosted transcription provider; signed-out users use the configured provider.
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

  const store = useTimelineStore.getState();
  const clip = store.clips.find(c => c.id === clipId);

  if (!clip || !clip.file) {
    log.warn('Clip not found or has no file', { clipId });
    return;
  }

  if (!isAudioBearingFile(clip.file)) {
    log.warn('File does not contain audio', { type: clip.file.type || '', name: clip.file.name || '' });
    return;
  }

  const { transcriptionProvider, apiKeys } = useSettingsStore.getState();
  const useHostedTranscription = Boolean(useAccountStore.getState().session?.authenticated);
  const useHybridTranscription = transcriptionProvider === 'hybrid';
  const hostedProvider = transcriptionProvider === 'deepgram' ? 'deepgram' : 'openai';
  const effectiveProvider = useHybridTranscription
    ? 'hybrid'
    : useHostedTranscription
      ? hostedProvider
      : transcriptionProvider;
  const fallbackApiKey = transcriptionProvider !== 'local' && transcriptionProvider !== 'hybrid'
    ? apiKeys[transcriptionProvider]
    : null;
  const apiKey = !useHostedTranscription && effectiveProvider !== 'local' ? fallbackApiKey : null;

  if (
    useHybridTranscription
    && !useHostedTranscription
    && (!apiKeys.deepgram?.trim() || !apiKeys.openai?.trim())
  ) {
    log.error('Hybrid transcription requires both Deepgram and OpenAI API keys');
    updateClipTranscript(clipId, {
      status: 'error',
      progress: 0,
      message: 'Hybrid transcription requires both a Deepgram key and an OpenAI key.',
    });
    return;
  }

  if (!useHybridTranscription && !useHostedTranscription && effectiveProvider !== 'local' && !apiKey) {
    log.error(`No API key configured for ${effectiveProvider}`);
    updateClipTranscript(clipId, {
      status: 'error',
      progress: 0,
      message: `No API key configured for ${effectiveProvider}. Go to Settings to add one.`,
    });
    return;
  }

  const continueMode = options?.continueMode ?? false;
  const linkedClip = clip.linkedClipId
    ? store.clips.find(c => c.id === clip.linkedClipId)
    : store.clips.find(c => c.linkedClipId === clip.id);
  const existingTranscript = clip.transcript?.length
    ? clip.transcript
    : linkedClip?.transcript;
  const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find(file => file.id === mediaFileId)
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
        let liveDeepgramWords: TranscriptWord[] | undefined;
        let liveProviderStatuses: TranscriptFusionProgress['providers'] = {
          deepgram: 'running',
          openai: 'running',
        };
        const buildLiveWords = (currentWords: TranscriptWord[]): TranscriptWord[] => {
          const newWords = mergeTranscriptWords(allNewWords, currentWords);
          return continueMode && existingTranscript?.length
            ? mergeTranscriptWords(existingTranscript, newWords)
            : newWords;
        };
        const publishLiveFusion = (
          stage: TranscriptFusionProgress['stage'],
          currentWords?: TranscriptWord[],
          currentArtifact?: TranscriptFusionArtifact,
        ): void => {
          if (!isActiveTranscriptionRun(run)) return;
          const stagedWords = currentWords ? buildLiveWords(currentWords) : undefined;
          const stagedArtifact = currentArtifact && stagedWords
            ? replaceTranscriptFusionRanges(
                existingFusionArtifact,
                [...fusionArtifacts, currentArtifact],
                ranges.slice(0, ri + 1),
                stagedWords,
              )
            : undefined;
          const progress: TranscriptFusionProgress = {
            stage,
            range: [rangeStart, rangeEnd],
            providers: { ...liveProviderStatuses },
            conflictCount: 0,
            resolvedCount: 0,
            updatedAt: Date.now(),
          };
          const finishedProviderCount = Object.values(liveProviderStatuses)
            .filter(status => status === 'complete' || status === 'error').length;
          const stagePercent = stage === 'transcribing'
            ? 12 + finishedProviderCount * 24
            : stage === 'aligning'
              ? 68
              : stage === 'finalizing'
                ? 95
                : stage === 'complete'
                  ? 100
                  : 0;
          const readyProviders = (Object.entries(liveProviderStatuses) as Array<
            [TranscriptProviderId, TranscriptFusionProviderStatus]
          >)
            .filter(([, status]) => status === 'complete')
            .map(([provider]) => provider === 'deepgram' ? 'Deepgram' : 'OpenAI');
          const liveMessage = stage === 'transcribing'
            ? readyProviders.length > 0
              ? `${readyProviders.join(' + ')} ready; waiting for the other transcript...`
              : 'Deepgram and OpenAI are transcribing in parallel...'
            : stage === 'aligning'
              ? 'Mapping OpenAI speaker turns onto Deepgram words...'
              : stage === 'finalizing'
                ? 'Applying OpenAI speaker separation...'
                : stage === 'error'
                  ? 'Best Quality transcription stopped.'
                  : 'Best Quality transcription complete.';

          publishClipUpdate({
            ...(stagedWords ? { words: stagedWords } : {}),
            progress: progressBase + Math.round(stagePercent * progressScale),
            message: liveMessage,
          });
          if (mediaFileId) {
            updateTranscriptFusionPreview(mediaFileId, {
              ...(ri === 0 && !continueMode && !currentArtifact ? { artifact: null } : {}),
              ...(stagedArtifact ? { artifact: stagedArtifact } : {}),
              ...(stagedWords ? { words: stagedWords } : {}),
              progress,
            });
          }
        };

        publishLiveFusion('transcribing');
        publishClipUpdate({
          progress: progressBase + Math.round(12 * progressScale),
          message: ranges.length > 1
            ? `Cross-checking range ${ri + 1}/${ranges.length} with Deepgram and OpenAI...`
            : 'Cross-checking with Deepgram and OpenAI...',
        });
        const audioBlob = await audioBufferToWav(audioBuffer);
        const artifact = await transcribeHybridRange({
          apiKeys,
          audioBlob,
          clipId,
          isSignedIn: useHostedTranscription,
          language,
          onArtifactUpdate: (liveArtifact, stage) => {
            publishLiveFusion(stage, liveArtifact.words, liveArtifact);
          },
          onProviderUpdate: (provider, status, providerWords) => {
            liveProviderStatuses = {
              ...liveProviderStatuses,
              [provider]: status,
            };
            if (provider === 'deepgram' && providerWords) {
              liveDeepgramWords = providerWords;
            }
            const providersFinished = Object.values(liveProviderStatuses)
              .every(providerStatus => providerStatus === 'complete' || providerStatus === 'error');
            publishLiveFusion(
              providersFinished ? 'aligning' : 'transcribing',
              liveDeepgramWords,
            );
          },
          range: [rangeStart, rangeEnd],
          signal,
        });
        words = artifact.words;
        publishLiveFusion('finalizing', artifact.words, artifact);
        fusionArtifacts.push(artifact);
        publishClipUpdate({
          progress: progressBase + Math.round(88 * progressScale),
          message: 'Applied OpenAI speaker separation...',
        });
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
        if (useHostedTranscription) {
          try {
            words = await transcribeWithHostedProvider(
              hostedProvider,
              clipId,
              audioBlob,
              language,
              rangeStart,
              publishProviderUpdate,
              { signal },
            );
          } catch (error) {
            if (!isLocalHostedApiUnavailable(error)) {
              throw error;
            }

            log.warn('Hosted transcription unavailable, falling back to configured provider', error);
            if (transcriptionProvider !== 'local' && fallbackApiKey) {
              words = await transcribeWithCloudProvider(
                transcriptionProvider,
                clipId,
                audioBlob,
                language,
                fallbackApiKey,
                rangeStart,
                publishProviderUpdate,
                { signal },
              );
            } else {
              const audioData = await resampleAudio(audioBuffer, 16000);
              signal.throwIfAborted();
              publishClipUpdate({
                progress: progressBase + Math.round(5 * progressScale),
                message: 'Hosted API unavailable; using local transcription...',
              });
              words = await runWorkerTranscription(
                clipId,
                audioData,
                language,
                audioDuration,
                rangeStart,
                publishProviderUpdate,
              );
            }
          }
        } else {
          words = await transcribeWithCloudProvider(
            effectiveProvider,
            clipId,
            audioBlob,
            language,
            apiKey!,
            rangeStart,
            publishProviderUpdate,
            { signal },
          );
        }
      }

      allNewWords.push(...words);
      processedDuration += rangeDuration;
    }

    const finalWords = continueMode && existingTranscript?.length
      ? mergeTranscriptWords(existingTranscript, allNewWords)
      : allNewWords;
    const fusionArtifact = useHybridTranscription
      ? replaceTranscriptFusionRanges(
          existingFusionArtifact,
          fusionArtifacts,
          ranges,
          finalWords,
        )
      : undefined;

    signal.throwIfAborted();
    publishClipUpdate({
      status: 'ready',
      progress: 100,
      words: finalWords,
      message: undefined,
    });
    triggerTimelineSave();

    if (isActiveTranscriptionRun(run) && mediaFileId && finalWords.length > 0) {
      const newRanges: [number, number][] = ranges.map(([s, e]) => [s, e]);
      propagateTranscriptToMediaFile(mediaFileId, finalWords, newRanges, fusionArtifact);
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
      const activeProgress = useMediaStore.getState().files
        .find(file => file.id === mediaFileId)?.transcriptFusionProgress;
      updateTranscriptFusionPreview(mediaFileId, {
        progress: {
          stage: 'error',
          range: activeProgress?.range ?? [inPoint, outPoint],
          providers: activeProgress?.providers ?? {
            deepgram: 'error',
            openai: 'error',
          },
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
  const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
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
