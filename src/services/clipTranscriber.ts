// Clip Transcriber Service
// Handles transcription of individual clips using local Whisper (WebGPU)

import { Logger } from './logger';
import { useTimelineStore } from '../stores/timeline';
import { triggerTimelineSave, useMediaStore } from '../stores/mediaStore';
import type { MediaFile } from '../stores/mediaStore/types';
import type { TranscriptWord, TranscriptStatus } from '../types';
import { projectFileService } from './project/ProjectFileService';

const log = Logger.create('ClipTranscriber');

/**
 * Calculate coverage ratio from a set of time ranges vs total duration.
 * Merges overlapping ranges and returns 0-1.
 */
function calcCoverage(ranges: [number, number][], totalDuration: number): number {
  if (totalDuration <= 0 || ranges.length === 0) return 0;
  // Sort by start time
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  // Merge overlapping
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push([...sorted[i]]);
    }
  }
  const covered = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
  return Math.min(1, covered / totalDuration);
}

// Worker instance
let worker: Worker | null = null;
let isTranscribing = false;
let currentClipId: string | null = null;

/**
 * Get or create the transcription worker
 */
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../workers/transcriptionWorker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return worker;
}

/**
 * Find uncovered time gaps within a range given a set of covered ranges.
 */
function findGaps(
  coveredRanges: [number, number][],
  rangeStart: number,
  rangeEnd: number
): [number, number][] {
  const clipped: [number, number][] = [];
  for (const [s, e] of coveredRanges) {
    const cs = Math.max(s, rangeStart);
    const ce = Math.min(e, rangeEnd);
    if (cs < ce) clipped.push([cs, ce]);
  }
  clipped.sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const range of clipped) {
    if (merged.length > 0 && range[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], range[1]);
    } else {
      merged.push([...range]);
    }
  }

  const gaps: [number, number][] = [];
  let cursor = rangeStart;
  for (const [s, e] of merged) {
    if (cursor < s) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < rangeEnd) gaps.push([cursor, rangeEnd]);
  return gaps;
}

/**
 * Extract audio from a clip's file and transcribe it using local Whisper.
 * When continueMode is true, only transcribes uncovered time ranges.
 */
export async function transcribeClip(clipId: string, language: string = 'auto', options?: { continueMode?: boolean }): Promise<void> {
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

  // Check if file has audio (also check extension as fallback since file.type can be empty after project reload)
  const mimeType = clip.file.type || '';
  const fileName = clip.file.name || '';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const audioVideoExts = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'];
  const hasAudio = mimeType.startsWith('video/') || mimeType.startsWith('audio/') || audioVideoExts.includes(ext);
  if (!hasAudio) {
    log.warn('File does not contain audio', { type: mimeType, name: fileName });
    return;
  }

  const continueMode = options?.continueMode ?? false;
  const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;

  // In continue mode, find uncovered gaps
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

  log.info(`Starting transcription for ${clip.name} using Local Whisper${continueMode ? ' (continue mode)' : ''}`);

  // Update status to transcribing
  updateClipTranscript(clipId, {
    status: 'transcribing',
    progress: 0,
    message: 'Extracting audio...',
  });

  try {
    // Determine ranges to transcribe
    const ranges = transcriptionGaps || [[inPoint, outPoint]];
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

      // Calculate progress offset for this range
      const progressBase = Math.round((processedDuration / totalDuration) * 100);
      const progressScale = rangeDuration / totalDuration;

      const audioData = await resampleAudio(audioBuffer, 16000);
      updateClipTranscript(clipId, {
        progress: progressBase + Math.round(5 * progressScale),
        message: ranges.length > 1 ? `Transcribing range ${ri + 1}/${ranges.length}...` : 'Starting local transcription...',
      });
      const words = await runWorkerTranscription(clipId, audioData, language, audioDuration, rangeStart);

      allNewWords.push(...words);
      processedDuration += rangeDuration;
    }

    // Merge with existing words if continue mode
    let finalWords = allNewWords;
    if (continueMode && clip.transcript?.length) {
      const existing = clip.transcript;
      const merged = [...existing];
      for (const word of allNewWords) {
        const duplicate = merged.some(
          (w: TranscriptWord) => Math.abs(w.start - word.start) < 0.05 && Math.abs(w.end - word.end) < 0.05
        );
        if (!duplicate) merged.push(word);
      }
      finalWords = merged.sort((a, b) => a.start - b.start);
    }

    // Complete
    updateClipTranscript(clipId, {
      status: 'ready',
      progress: 100,
      words: finalWords,
      message: undefined,
    });
    triggerTimelineSave();

    // Propagate transcript to MediaFile for badge display + carry-over
    if (mediaFileId && finalWords.length > 0) {
      // Collect all transcribed ranges (existing + new)
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
 * Run transcription in Web Worker
 * @param inPointOffset - Offset to add to word timestamps (for trimmed clips)
 */
function runWorkerTranscription(
  clipId: string,
  audioData: Float32Array,
  language: string,
  audioDuration: number,
  inPointOffset: number = 0
): Promise<TranscriptWord[]> {
  return new Promise((resolve, reject) => {
    const w = getWorker();

    // Helper to offset word timestamps
    const offsetWords = (words: TranscriptWord[]): TranscriptWord[] =>
      words.map(word => ({
        ...word,
        start: word.start + inPointOffset,
        end: word.end + inPointOffset,
      }));

    const handleMessage = (event: MessageEvent) => {
      const { type, progress, message, words, error } = event.data;

      switch (type) {
        case 'progress':
          updateClipTranscript(clipId, { progress, message });
          break;

        case 'words':
          // Offset partial results too
          updateClipTranscript(clipId, {
            words: offsetWords(words),
            message: `Transcribed ${words.length} words`,
          });
          break;

        case 'complete':
          w.removeEventListener('message', handleMessage);
          w.removeEventListener('error', handleError);
          // Offset final words before returning
          resolve(offsetWords(words));
          break;

        case 'error':
          w.removeEventListener('message', handleMessage);
          w.removeEventListener('error', handleError);
          reject(new Error(error));
          break;
      }
    };

    const handleError = (error: ErrorEvent) => {
      w.removeEventListener('message', handleMessage);
      w.removeEventListener('error', handleError);
      reject(new Error(error.message || 'Worker error'));
    };

    w.addEventListener('message', handleMessage);
    w.addEventListener('error', handleError);

    // Send audio data to worker (transferable for performance)
    w.postMessage(
      { type: 'transcribe', audioData, language, audioDuration },
      [audioData.buffer]
    );
  });
}

/**
 * Update clip transcript data in the timeline store
 */
function updateClipTranscript(
  clipId: string,
  data: {
    status?: TranscriptStatus;
    progress?: number;
    words?: TranscriptWord[];
    message?: string;
  }
): void {
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
 * Also tracks transcribed ranges for continue mode.
 */
function propagateTranscriptToMediaFile(mediaFileId: string, words: TranscriptWord[], newRanges?: [number, number][]): void {
  try {
    const mediaState = useMediaStore.getState();
    const file = mediaState.files.find((f: MediaFile) => f.id === mediaFileId);
    if (!file) return;

    // Merge with existing transcript if present
    let mergedWords = words;
    if (file.transcript?.length) {
      const existing = file.transcript;
      const merged = [...existing];
      for (const word of words) {
        const duplicate = merged.some(
          (w: TranscriptWord) => Math.abs(w.start - word.start) < 0.05 && Math.abs(w.end - word.end) < 0.05
        );
        if (!duplicate) {
          merged.push(word);
        }
      }
      mergedWords = merged.sort((a, b) => a.start - b.start);
    }

    // Calculate transcript coverage from transcribed ranges (not word ranges - silence is still transcribed)
    let transcriptCoverage = 0;
    if (file.duration && file.duration > 0) {
      // Merge existing transcribed ranges with new ones
      const existingRanges = (file as any).transcribedRanges || [];
      const allRanges = [...existingRanges, ...(newRanges || [])];
      transcriptCoverage = allRanges.length > 0 ? calcCoverage(allRanges, file.duration) : 0;
    }

    // Merge transcribed ranges for storage
    const existingRanges: [number, number][] = (file as any).transcribedRanges || [];
    const mergedRanges = mergeRanges([...existingRanges, ...(newRanges || [])]);

    useMediaStore.setState({
      files: mediaState.files.map((f: MediaFile) =>
        f.id === mediaFileId
          ? { ...f, transcriptStatus: 'ready' as TranscriptStatus, transcript: mergedWords, transcriptCoverage, transcribedRanges: mergedRanges }
          : f
      ),
    });
    // Persist transcript + ranges to project folder (TRANSCRIPTS/{mediaId}.json)
    projectFileService.saveTranscript(mediaFileId, mergedWords, mergedRanges).then(saved => {
      if (saved) log.debug('Transcript saved to project folder', { mediaFileId });
    }).catch(() => { /* no project open */ });

    log.debug('Propagated transcript to MediaFile', { mediaFileId, wordCount: mergedWords.length, coverage: transcriptCoverage.toFixed(2) });
  } catch (e) {
    log.warn('Failed to propagate transcript to MediaFile', e);
  }
}

/**
 * Merge and sort a list of ranges, combining overlapping ones.
 */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push([...sorted[i]]);
    }
  }
  return merged;
}

/**
 * Extract audio buffer from a media file, optionally slicing to a time range
 * @param file - The media file to extract audio from
 * @param startTime - Start time in seconds (optional, defaults to 0)
 * @param endTime - End time in seconds (optional, defaults to full duration)
 */
async function extractAudioBuffer(
  file: File,
  startTime?: number,
  endTime?: number
): Promise<AudioBuffer> {
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const fullBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // If no time range specified, return full buffer
  if (startTime === undefined && endTime === undefined) {
    audioContext.close();
    return fullBuffer;
  }

  // Calculate sample range
  const sampleRate = fullBuffer.sampleRate;
  const startSample = Math.floor((startTime || 0) * sampleRate);
  const endSample = Math.min(
    Math.ceil((endTime || fullBuffer.duration) * sampleRate),
    fullBuffer.length
  );
  const sliceLength = endSample - startSample;

  // Create new buffer with sliced audio
  const slicedBuffer = audioContext.createBuffer(
    fullBuffer.numberOfChannels,
    sliceLength,
    sampleRate
  );

  // Copy each channel's data
  for (let channel = 0; channel < fullBuffer.numberOfChannels; channel++) {
    const sourceData = fullBuffer.getChannelData(channel);
    const destData = slicedBuffer.getChannelData(channel);
    for (let i = 0; i < sliceLength; i++) {
      destData[i] = sourceData[startSample + i];
    }
  }

  audioContext.close();
  return slicedBuffer;
}

/**
 * Resample audio to target sample rate (e.g., 16kHz for Whisper)
 */
async function resampleAudio(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<Float32Array> {
  const channelData = audioBuffer.getChannelData(0); // Mono
  const originalSampleRate = audioBuffer.sampleRate;

  if (originalSampleRate === targetSampleRate) {
    return channelData;
  }

  // Simple linear interpolation resampling
  const ratio = originalSampleRate / targetSampleRate;
  const newLength = Math.floor(channelData.length / ratio);
  const resampled = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, channelData.length - 1);
    const t = srcIndex - srcIndexFloor;
    resampled[i] = channelData[srcIndexFloor] * (1 - t) + channelData[srcIndexCeil] * t;
  }

  return resampled;
}

/**
 * Clear transcript from a clip
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
 * Cancel ongoing transcription
 */
export function cancelTranscription(): void {
  if (worker && isTranscribing) {
    worker.terminate();
    worker = null;
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
