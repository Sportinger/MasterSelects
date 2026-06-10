// Clip Transcriber Service
// Handles transcription of individual clips using Whisper (local) or cloud APIs

import { Logger } from './logger';
import { useTimelineStore } from '../stores/timeline';
import { triggerTimelineSave } from '../stores/mediaStore';
import type { TranscriptWord } from '../types/clipMetadata';
import { projectFileService } from './project/ProjectFileService';
import { useSettingsStore } from '../stores/settingsStore';
import { extractAudioBuffer, isAudioBearingFile, resampleAudio, audioBufferToWav } from './transcription/audioPrep';
import { propagateTranscriptToMediaFile, updateClipTranscript } from './transcription/artifactPersistence';
import { findGaps, mergeTranscriptWords } from './transcription/resultMapping';
import { transcribeWithCloudProvider } from './transcription/cloudProviders';
import { runWorkerTranscription, terminateTranscriptionWorker } from './transcription/workerClient';

const log = Logger.create('ClipTranscriber');

let isTranscribing = false;
let currentClipId: string | null = null;

/**
 * Extract audio from a clip's file and transcribe it.
 * Uses the configured provider (local Whisper, OpenAI, AssemblyAI, or Deepgram).
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
  const apiKey = transcriptionProvider !== 'local' ? apiKeys[transcriptionProvider] : null;

  if (transcriptionProvider !== 'local' && !apiKey) {
    log.error(`No API key configured for ${transcriptionProvider}`);
    updateClipTranscript(clipId, {
      status: 'error',
      progress: 0,
      message: `No API key configured for ${transcriptionProvider}. Go to Settings to add one.`,
    });
    return;
  }

  const continueMode = options?.continueMode ?? false;
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

  const providerName = transcriptionProvider === 'local' ? 'Local Whisper' : transcriptionProvider.toUpperCase();
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

      if (transcriptionProvider === 'local') {
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
        words = await transcribeWithCloudProvider(
          transcriptionProvider,
          clipId,
          audioBlob,
          language,
          apiKey!,
          rangeStart,
          updateClipTranscript,
        );
      }

      allNewWords.push(...words);
      processedDuration += rangeDuration;
    }

    const finalWords = continueMode && clip.transcript?.length
      ? mergeTranscriptWords(clip.transcript, allNewWords)
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
