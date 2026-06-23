// Clip Transcriber Service
// Handles transcription of individual clips using Whisper (local) or cloud APIs

import { Logger } from './logger';
import { useTimelineStore } from '../stores/timeline';
import { triggerTimelineSave } from '../stores/mediaStore';
import type { TranscriptWord } from '../types/clipMetadata';
import { projectFileService } from './project/ProjectFileService';
import { useSettingsStore } from '../stores/settingsStore';
import { useAccountStore } from '../stores/accountStore';
import { extractAudioBuffer, isAudioBearingFile, resampleAudio, audioBufferToWav } from './transcription/audioPrep';
import { propagateTranscriptToMediaFile, updateClipTranscript } from './transcription/artifactPersistence';
import { findGaps, mergeTranscriptWords } from './transcription/resultMapping';
import { transcribeWithCloudProvider, transcribeWithHostedOpenAI } from './transcription/cloudProviders';
import { runWorkerTranscription, terminateTranscriptionWorker } from './transcription/workerClient';

const log = Logger.create('ClipTranscriber');

let isTranscribing = false;
let currentClipId: string | null = null;

function isLocalHostedApiUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('Hosted API route /api/ai/audio')
    && (error.message.includes('not available') || error.message.includes('did not respond'));
}

/**
 * Extract audio from a clip's file and transcribe it.
 * Signed-in accounts use hosted OpenAI credits; signed-out users use the configured provider.
 * When continueMode is true, only transcribes uncovered time ranges.
 */
export async function transcribeClip(
  clipId: string,
  language: string = 'auto',
  options?: { continueMode?: boolean },
): Promise<void> {
  if (isTranscribing) {
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
  const useHostedOpenAI = Boolean(useAccountStore.getState().session?.authenticated);
  const effectiveProvider = useHostedOpenAI ? 'openai' : transcriptionProvider;
  const fallbackApiKey = transcriptionProvider !== 'local' ? apiKeys[transcriptionProvider] : null;
  const apiKey = !useHostedOpenAI && effectiveProvider !== 'local' ? fallbackApiKey : null;

  if (!useHostedOpenAI && effectiveProvider !== 'local' && !apiKey) {
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

  isTranscribing = true;
  currentClipId = clipId;

  const providerName = useHostedOpenAI
    ? 'OpenAI Cloud'
    : effectiveProvider === 'local'
      ? 'Local Whisper'
      : effectiveProvider.toUpperCase();
  log.info(`Starting transcription for ${clip.name} using ${providerName}${continueMode ? ' (continue mode)' : ''}`);

  updateClipTranscript(clipId, {
    status: 'transcribing',
    progress: 0,
    message: 'Extracting audio...',
  });

  try {
    const ranges = transcriptionGaps || [[inPoint, outPoint] as [number, number]];
    const allNewWords: TranscriptWord[] = [];
    const totalDuration = ranges.reduce((sum, [s, e]) => sum + (e - s), 0);
    let processedDuration = 0;

    for (let ri = 0; ri < ranges.length; ri++) {
      const [rangeStart, rangeEnd] = ranges[ri];
      const rangeDuration = rangeEnd - rangeStart;

      log.debug(`Extracting audio from ${rangeStart.toFixed(1)}s to ${rangeEnd.toFixed(1)}s (${rangeDuration.toFixed(1)}s)`);

      const audioBuffer = await extractAudioBuffer(clip.file, rangeStart, rangeEnd);
      const audioDuration = audioBuffer.duration;

      log.debug(`Audio extracted: ${audioDuration.toFixed(1)}s`);

      const progressBase = Math.round((processedDuration / totalDuration) * 100);
      const progressScale = rangeDuration / totalDuration;
      let words: TranscriptWord[];

      if (effectiveProvider === 'local' && !useHostedOpenAI) {
        const audioData = await resampleAudio(audioBuffer, 16000);
        updateClipTranscript(clipId, {
          progress: progressBase + Math.round(5 * progressScale),
          message: ranges.length > 1 ? `Transcribing range ${ri + 1}/${ranges.length}...` : 'Starting local transcription...',
        });
        words = await runWorkerTranscription(
          clipId,
          audioData,
          language,
          audioDuration,
          rangeStart,
          updateClipTranscript,
        );
      } else {
        updateClipTranscript(clipId, {
          progress: progressBase + Math.round(10 * progressScale),
          message: ranges.length > 1 ? `Uploading range ${ri + 1}/${ranges.length} to ${providerName}...` : `Uploading to ${providerName}...`,
        });

        const audioBlob = await audioBufferToWav(audioBuffer);
        if (useHostedOpenAI) {
          try {
            words = await transcribeWithHostedOpenAI(clipId, audioBlob, language, rangeStart, updateClipTranscript);
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
                updateClipTranscript,
              );
            } else {
              const audioData = await resampleAudio(audioBuffer, 16000);
              updateClipTranscript(clipId, {
                progress: progressBase + Math.round(5 * progressScale),
                message: 'Hosted API unavailable; using local transcription...',
              });
              words = await runWorkerTranscription(
                clipId,
                audioData,
                language,
                audioDuration,
                rangeStart,
                updateClipTranscript,
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
            updateClipTranscript,
          );
        }
      }

      allNewWords.push(...words);
      processedDuration += rangeDuration;
    }

    const finalWords = continueMode && existingTranscript?.length
      ? mergeTranscriptWords(existingTranscript, allNewWords)
      : allNewWords;

    updateClipTranscript(clipId, {
      status: 'ready',
      progress: 100,
      words: finalWords,
      message: undefined,
    });
    triggerTimelineSave();

    if (mediaFileId && finalWords.length > 0) {
      const newRanges: [number, number][] = ranges.map(([s, e]) => [s, e]);
      propagateTranscriptToMediaFile(mediaFileId, finalWords, newRanges);
    }

    log.info(`Complete: ${finalWords.length} words for ${clip.name}`);
  } catch (error) {
    log.error('Transcription failed', error);
    updateClipTranscript(clipId, {
      status: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    isTranscribing = false;
    currentClipId = null;
  }
}

/**
 * Clear transcript from a clip.
 */
export function clearClipTranscript(clipId: string): void {
  updateClipTranscript(clipId, {
    status: 'none',
    progress: 0,
    words: undefined,
    message: undefined,
  });
  triggerTimelineSave();
}

/**
 * Cancel ongoing transcription.
 */
export function cancelTranscription(): void {
  if (isTranscribing && terminateTranscriptionWorker()) {
    if (currentClipId) {
      updateClipTranscript(currentClipId, {
        status: 'none',
        progress: 0,
        message: undefined,
      });
    }
    isTranscribing = false;
    currentClipId = null;
  }
}
