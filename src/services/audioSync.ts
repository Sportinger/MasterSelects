// Audio Sync Service
// Synchronizes selected clips using audio waveform correlation.

import type { Keyframe } from '../types/keyframes';
import type { TimelineClip } from '../types/timeline';
import { prepareClipAudioAnalysisInput } from './audio/ClipAudioAnalysisOrchestrator';
import { Logger } from './logger';
import { audioAnalyzer, type AudioFingerprint } from './audioAnalyzer';
import {
  DEFAULT_SAMPLE_RATE,
  DEFAULT_TARGET_EXCERPT_SECONDS,
  MIN_SYNC_SECONDS,
  findAudioSyncOffset,
  type AudioSyncOffsetResult,
} from './audioSyncOffset';

export { findAudioSyncOffset } from './audioSyncOffset';
export type { AudioSyncOffsetResult } from './audioSyncOffset';

const log = Logger.create('AudioSync');

export interface TimelineAudioSyncClipInput {
  clip: TimelineClip;
  keyframes?: readonly Keyframe[];
}

export interface TimelineAudioSyncAlignment {
  clipId: string;
  audioClipId: string;
  offsetSeconds: number;
  targetStartTime: number;
  peakRatio: number | null;
  confidence: 'low' | 'medium' | 'high';
  method: AudioSyncOffsetResult['method'];
}

export interface TimelineAudioSyncFailure {
  clipId: string;
  reason: string;
}

export interface TimelineAudioSyncReport {
  masterClipId: string;
  masterAudioClipId: string;
  alignments: TimelineAudioSyncAlignment[];
  failures: TimelineAudioSyncFailure[];
}

export interface TimelineAudioSyncOptions {
  masterClipId?: string;
  sampleRate?: number;
  targetExcerptSeconds?: number;
  minPeakRatio?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

interface PreparedSyncClip {
  clip: TimelineClip;
  samples: Float32Array;
  sampleRate: number;
  sourceDurationSeconds: number;
  timelineSpeed: number;
}

interface Excerpt {
  samples: Float32Array;
  startSeconds: number;
}

/**
 * Cross-correlation algorithm to find the offset between two audio signals.
 * Returns sample offset; positive means the second signal is delayed.
 */
export function crossCorrelate(
  signal1: Float32Array,
  signal2: Float32Array,
  maxOffsetSamples: number,
): { offset: number; correlation: number } {
  let bestOffset = 0;
  let bestCorrelation = -Infinity;

  for (let offset = -maxOffsetSamples; offset <= maxOffsetSamples; offset += 1) {
    let correlation = 0;
    let count = 0;

    for (let i = 0; i < signal1.length; i += 1) {
      const j = i + offset;
      if (j >= 0 && j < signal2.length) {
        correlation += signal1[i] * signal2[j];
        count += 1;
      }
    }

    if (count > 0) {
      correlation /= count;
    } else {
      correlation = 0;
    }

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  return { offset: bestOffset, correlation: bestCorrelation === -Infinity ? 0 : bestCorrelation };
}

function normalizedCrossCorrelate(
  signal1: Float32Array,
  signal2: Float32Array,
  maxOffsetSamples: number,
): { offset: number; correlation: number } {
  const normalized1 = normalizeSeries(signal1);
  const normalized2 = normalizeSeries(signal2);
  return crossCorrelate(normalized1, normalized2, maxOffsetSamples);
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / samples.length);
}

function normalizeSeries(samples: Float32Array): Float32Array {
  if (samples.length === 0) return new Float32Array();

  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) {
    mean += samples[index];
  }
  mean /= samples.length;

  let variance = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centered = samples[index] - mean;
    variance += centered * centered;
  }

  const standardDeviation = Math.sqrt(variance / samples.length);
  const normalized = new Float32Array(samples.length);
  if (standardDeviation < 1e-12) {
    for (let index = 0; index < samples.length; index += 1) {
      normalized[index] = samples[index] - mean;
    }
    return normalized;
  }

  for (let index = 0; index < samples.length; index += 1) {
    normalized[index] = (samples[index] - mean) / standardDeviation;
  }
  return normalized;
}

function downsampleAudioBuffer(
  buffer: AudioBuffer,
  startSeconds: number,
  durationSeconds: number,
  sampleRate: number,
): Float32Array {
  const sourceStart = Math.max(0, Math.floor(startSeconds * buffer.sampleRate));
  const sourceEnd = Math.min(buffer.length, Math.ceil((startSeconds + durationSeconds) * buffer.sampleRate));
  const outputLength = Math.max(0, Math.floor(((sourceEnd - sourceStart) / buffer.sampleRate) * sampleRate));
  const output = new Float32Array(outputLength);
  if (outputLength === 0) return output;

  const ratio = buffer.sampleRate / sampleRate;
  const channelCount = Math.max(1, buffer.numberOfChannels);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourceIndex = Math.min(sourceEnd - 1, sourceStart + Math.floor(outputIndex * ratio));
    let sample = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      sample += buffer.getChannelData(channel)[sourceIndex] ?? 0;
    }
    output[outputIndex] = sample / channelCount;
  }
  return output;
}

function chooseActiveExcerpt(samples: Float32Array, sampleRate: number, maxSeconds: number): Excerpt {
  const windowLength = Math.max(1, Math.round(maxSeconds * sampleRate));
  if (samples.length <= windowLength) {
    return { samples, startSeconds: 0 };
  }

  const step = Math.max(1, Math.round(Math.min(10, maxSeconds / 4) * sampleRate));
  let bestStart = 0;
  let bestScore = -Infinity;
  for (let start = 0; start <= samples.length - windowLength; start += step) {
    const window = samples.subarray(start, start + windowLength);
    let onset = 0;
    for (let index = 1; index < window.length; index += 1) {
      onset += Math.abs(window[index] - window[index - 1]);
    }
    const score = rms(window) + 0.8 * (onset / Math.max(1, window.length - 1));
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  return {
    samples: samples.slice(bestStart, bestStart + windowLength),
    startSeconds: bestStart / sampleRate,
  };
}

async function prepareSyncClip(
  input: TimelineAudioSyncClipInput,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<PreparedSyncClip> {
  const { clip, keyframes = [] } = input;
  if (clip.reversed) {
    throw new Error('Reversed clips are not supported for audio sync.');
  }

  const prepared = await prepareClipAudioAnalysisInput({
    clip,
    keyframes,
    needsProcessed: false,
    signal,
  });
  if (!prepared) {
    throw new Error('No readable audio source found.');
  }

  const speed = Math.abs(clip.speed ?? 1) || 1;
  const sourceDurationSeconds = Math.max(
    MIN_SYNC_SECONDS,
    Math.min(
      prepared.sourceBuffer.duration - clip.inPoint,
      clip.outPoint > clip.inPoint ? clip.outPoint - clip.inPoint : clip.duration * speed,
    ),
  );
  const samples = downsampleAudioBuffer(prepared.sourceBuffer, clip.inPoint, sourceDurationSeconds, sampleRate);
  if (samples.length < MIN_SYNC_SECONDS * sampleRate || rms(samples) < 1e-5) {
    throw new Error('Audio is too short or silent for sync.');
  }

  return {
    clip,
    samples,
    sampleRate,
    sourceDurationSeconds,
    timelineSpeed: speed,
  };
}

// Clip info for legacy sync callers.
export interface ClipSyncInfo {
  mediaFileId: string;
  clipId: string;
  inPoint: number;
  duration: number;
}

class AudioSync {
  private fingerprintCache = new Map<string, AudioFingerprint>();

  private getCacheKey(mediaFileId: string, startTime: number, duration: number): string {
    return `${mediaFileId}-${startTime.toFixed(2)}-${duration.toFixed(2)}`;
  }

  private async getFingerprint(
    mediaFileId: string,
    startTime = 0,
    duration = 30,
  ): Promise<AudioFingerprint | null> {
    const cacheKey = this.getCacheKey(mediaFileId, startTime, duration);
    if (this.fingerprintCache.has(cacheKey)) {
      return this.fingerprintCache.get(cacheKey)!;
    }

    const fingerprint = await audioAnalyzer.generateFingerprint(mediaFileId, 2000, startTime, duration);
    if (fingerprint) {
      this.fingerprintCache.set(cacheKey, fingerprint);
    }
    return fingerprint;
  }

  async syncTimelineClipsViaAudio(
    inputs: TimelineAudioSyncClipInput[],
    options: TimelineAudioSyncOptions = {},
  ): Promise<TimelineAudioSyncReport> {
    const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const targetExcerptSeconds = options.targetExcerptSeconds ?? DEFAULT_TARGET_EXCERPT_SECONDS;
    const uniqueInputs = [...new Map(inputs.map(input => [input.clip.id, input])).values()];
    const masterInput = uniqueInputs.find(input => input.clip.id === options.masterClipId) ?? uniqueInputs[0];
    if (!masterInput || uniqueInputs.length < 2) {
      throw new Error('Select at least two clips with audio to sync.');
    }

    const failures: TimelineAudioSyncFailure[] = [];
    const preparedById = new Map<string, PreparedSyncClip>();
    for (let index = 0; index < uniqueInputs.length; index += 1) {
      const input = uniqueInputs[index];
      try {
        preparedById.set(input.clip.id, await prepareSyncClip(input, sampleRate, options.signal));
      } catch (error) {
        failures.push({
          clipId: input.clip.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      options.onProgress?.(Math.round(((index + 1) / (uniqueInputs.length * 2)) * 100));
    }

    const master = preparedById.get(masterInput.clip.id);
    if (!master) {
      throw new Error(failures.find(failure => failure.clipId === masterInput.clip.id)?.reason ?? 'Master audio could not be prepared.');
    }

    const alignments: TimelineAudioSyncAlignment[] = [{
      clipId: master.clip.id,
      audioClipId: master.clip.id,
      offsetSeconds: 0,
      targetStartTime: master.clip.startTime,
      peakRatio: null,
      confidence: 'high',
      method: 'waveform',
    }];

    const targets = [...preparedById.values()].filter(candidate => candidate.clip.id !== master.clip.id);
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const excerpt = chooseActiveExcerpt(target.samples, sampleRate, targetExcerptSeconds);
      const measured = findAudioSyncOffset(master.samples, excerpt.samples, sampleRate, {
        minPeakRatio: options.minPeakRatio,
      });

      if (!measured) {
        failures.push({ clipId: target.clip.id, reason: 'No stable audio correlation peak found.' });
      } else {
        const masterMatchSeconds = measured.offsetSeconds;
        const targetStartTime = master.clip.startTime
          + masterMatchSeconds / master.timelineSpeed
          - excerpt.startSeconds / target.timelineSpeed;
        alignments.push({
          clipId: target.clip.id,
          audioClipId: target.clip.id,
          offsetSeconds: measured.offsetSeconds - excerpt.startSeconds,
          targetStartTime,
          peakRatio: measured.peakRatio,
          confidence: measured.confidence,
          method: measured.method,
        });
      }

      options.onProgress?.(Math.round(50 + ((index + 1) / Math.max(1, targets.length)) * 50));
    }

    return {
      masterClipId: master.clip.id,
      masterAudioClipId: master.clip.id,
      alignments,
      failures,
    };
  }

  async findOffset(
    masterMediaFileId: string,
    targetMediaFileId: string,
    maxOffsetSeconds = 30,
  ): Promise<number> {
    log.info(`Finding offset between ${masterMediaFileId} and ${targetMediaFileId}`);
    const [masterFp, targetFp] = await Promise.all([
      this.getFingerprint(masterMediaFileId),
      this.getFingerprint(targetMediaFileId),
    ]);

    if (!masterFp || !targetFp) {
      log.warn('Could not generate fingerprints');
      return 0;
    }

    const maxOffsetSamples = Math.floor(maxOffsetSeconds * masterFp.sampleRate);
    const result = normalizedCrossCorrelate(masterFp.data, targetFp.data, maxOffsetSamples);
    const offsetMs = (result.offset / masterFp.sampleRate) * 1000;
    log.info(`Found offset: ${offsetMs.toFixed(2)}ms (correlation: ${result.correlation.toFixed(4)})`);
    return offsetMs;
  }

  async syncMultipleClips(
    masterClip: ClipSyncInfo,
    targetClips: ClipSyncInfo[],
    onProgress?: (progress: number) => void,
  ): Promise<Map<string, number>> {
    const offsets = new Map<string, number>();
    offsets.set(masterClip.clipId, 0);

    const totalSteps = targetClips.length + 1;
    let currentStep = 0;
    const reportProgress = () => onProgress?.(Math.round((currentStep / totalSteps) * 100));

    log.info(`Generating master fingerprint (${masterClip.inPoint.toFixed(1)}s - ${(masterClip.inPoint + masterClip.duration).toFixed(1)}s)...`);
    reportProgress();
    const masterFp = await this.getFingerprint(masterClip.mediaFileId, masterClip.inPoint, Math.min(masterClip.duration, 30));
    currentStep += 1;
    reportProgress();

    if (!masterFp) {
      log.warn('Could not generate master fingerprint');
      return offsets;
    }

    for (const targetClip of targetClips) {
      const targetFp = await this.getFingerprint(targetClip.mediaFileId, targetClip.inPoint, Math.min(targetClip.duration, 30));
      if (!targetFp) {
        log.warn('Could not generate fingerprint for clip', targetClip.clipId);
        currentStep += 1;
        reportProgress();
        continue;
      }

      const maxOffsetSamples = Math.floor(10 * masterFp.sampleRate);
      const result = normalizedCrossCorrelate(masterFp.data, targetFp.data, maxOffsetSamples);
      const offsetMs = (result.offset / masterFp.sampleRate) * 1000;
      offsets.set(targetClip.clipId, offsetMs);
      log.info(`Offset for ${targetClip.clipId}: ${offsetMs.toFixed(1)}ms (correlation: ${result.correlation.toFixed(4)})`);

      currentStep += 1;
      reportProgress();
    }

    return offsets;
  }

  async syncMultiple(
    masterMediaFileId: string,
    targetMediaFileIds: string[],
    onProgress?: (progress: number) => void,
  ): Promise<Map<string, number>> {
    const offsets = new Map<string, number>();
    offsets.set(masterMediaFileId, 0);

    const totalSteps = targetMediaFileIds.length + 1;
    let currentStep = 0;
    const reportProgress = () => onProgress?.(Math.round((currentStep / totalSteps) * 100));

    log.info('Generating master fingerprint...');
    reportProgress();
    const masterFp = await this.getFingerprint(masterMediaFileId);
    currentStep += 1;
    reportProgress();

    if (!masterFp) {
      log.warn('Could not generate master fingerprint');
      return offsets;
    }

    for (const targetId of targetMediaFileIds) {
      if (targetId === masterMediaFileId) {
        currentStep += 1;
        reportProgress();
        continue;
      }

      const targetFp = await this.getFingerprint(targetId);
      if (!targetFp) {
        log.warn('Could not generate fingerprint for', targetId);
        currentStep += 1;
        reportProgress();
        continue;
      }

      const maxOffsetSamples = Math.floor(10 * masterFp.sampleRate);
      const result = normalizedCrossCorrelate(masterFp.data, targetFp.data, maxOffsetSamples);
      const offsetMs = (result.offset / masterFp.sampleRate) * 1000;
      offsets.set(targetId, offsetMs);
      log.info(`Offset for ${targetId}: ${offsetMs.toFixed(1)}ms (correlation: ${result.correlation.toFixed(4)})`);

      currentStep += 1;
      reportProgress();
    }

    return offsets;
  }

  clearCache(): void {
    this.fingerprintCache.clear();
  }
}

export const audioSync = new AudioSync();
