import { createClipSpeedSource, resolveClipSourceTime } from './timeline/retime/clipRetime';
// Audio Sync Service
// Synchronizes selected clips using audio waveform correlation.

import type { Keyframe } from '../types/keyframes';
import type { TimelineClip } from '../types/timeline';
import { prepareClipAudioAnalysisInput } from './audio/ClipAudioAnalysisOrchestrator';
import { Logger } from './logger';
import { accumulatePeakBins, loadStreamedSyncSignal } from './audio/syncSignalSource';
import { createAudioSyncMatcher } from './audio/audioSyncMatcher';
import { audioAnalyzer, type AudioFingerprint } from './audioAnalyzer';
import {
  DEFAULT_SAMPLE_RATE,
  DEFAULT_TARGET_EXCERPT_SECONDS,
  MIN_SYNC_SECONDS,
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

export type AudioSyncConfidence = TimelineAudioSyncAlignment['confidence'];

export interface TimelineAudioSyncProgress {
  /** 0..100 over the whole sync. */
  percent: number;
  phase: 'proxy' | 'reading' | 'matching';
  /** 1-based clip being read or matched. */
  clipIndex: number;
  clipCount: number;
  clipName: string;
  /** 0..1 within the current clip and phase. */
  clipFraction: number;
}

export interface TimelineAudioSyncOptions {
  masterClipId?: string;
  sampleRate?: number;
  targetExcerptSeconds?: number;
  minPeakRatio?: number;
  /** Matches below this confidence are reported as failures instead of being applied. */
  minConfidence?: AudioSyncConfidence;
  signal?: AbortSignal;
  onProgress?: (progress: number, detail?: TimelineAudioSyncProgress) => void;
}

const CONFIDENCE_RANK: Record<AudioSyncConfidence, number> = { low: 0, medium: 1, high: 2 };

interface PreparedSyncClip {
  clip: TimelineClip;
  samples: Float32Array;
  sampleRate: number;
  sourceDurationSeconds: number;
  timelineSpeed: number;
  /** Set when only an excerpt was read: its start, in seconds after the clip's inPoint. */
  excerptStartSeconds?: number;
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

function clipSourceSeconds(clip: TimelineClip, speed: number): number {
  return clip.outPoint > clip.inPoint ? clip.outPoint - clip.inPoint : clip.duration * speed;
}

function assertAudible(samples: Float32Array, sampleRate: number): void {
  if (samples.length < MIN_SYNC_SECONDS * sampleRate || rms(samples) < 1e-5) {
    throw new Error('Audio is too short or silent for sync.');
  }
}

async function prepareSyncClip(
  input: TimelineAudioSyncClipInput,
  sampleRate: number,
  signal?: AbortSignal,
  onSourceProgress?: (phase: 'proxy' | 'reading', fraction: number) => void,
  excerptSeconds?: number,
): Promise<PreparedSyncClip> {
  const { clip, keyframes = [] } = input;
  const source = createClipSpeedSource(clip, keyframes);
  const speed = resolveClipSourceTime(clip, 0, source).sourceRate;
  if (speed <= 0 || keyframes.some(key => key.property === 'speed') || clip.transitionSourceMap ||
    clip.transitionSourceHold || Number.isFinite(clip.transitionSourceTimeOverride)) {
    throw new Error('Audio alignment requires constant forward source time; reverse, holds and speed automation are unsupported.');
  }
  // Long stems and camera files stream; only short sources are decoded whole.
  const streamedDuration = Math.max(MIN_SYNC_SECONDS, clipSourceSeconds(clip, speed));
  const streamed = await loadStreamedSyncSignal({
    clip,
    startSeconds: clip.inPoint,
    durationSeconds: streamedDuration,
    sampleRate,
    excerptSeconds,
    signal,
    onProgress: (progress) => onSourceProgress?.(progress.phase, progress.fraction),
  });
  if (streamed) {
    assertAudible(streamed.samples, sampleRate);
    return {
      clip,
      samples: streamed.samples,
      sampleRate,
      sourceDurationSeconds: streamedDuration,
      timelineSpeed: speed,
      ...(streamed.offsetSeconds > 0 || streamed.samples.length < Math.floor(streamedDuration * sampleRate)
        ? { excerptStartSeconds: streamed.offsetSeconds }
        : {}),
    };
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

  const sourceDurationSeconds = Math.max(
    MIN_SYNC_SECONDS,
    Math.min(prepared.sourceBuffer.duration - clip.inPoint, clipSourceSeconds(clip, speed)),
  );
  const samples = new Float32Array(Math.max(0, Math.floor(sourceDurationSeconds * sampleRate)));
  accumulatePeakBins(prepared.sourceBuffer, 0, samples, clip.inPoint, sampleRate);
  assertAudible(samples, sampleRate);

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

    const clipCount = uniqueInputs.length;
    const report = (
      phase: TimelineAudioSyncProgress['phase'],
      clipIndex: number,
      clipName: string,
      clipFraction: number,
    ) => {
      const done = phase === 'matching'
        ? 0.5 + ((clipIndex - 1 + clipFraction) / Math.max(1, clipCount - 1)) * 0.5
        : ((clipIndex - 1 + clipFraction) / clipCount) * 0.5;
      const percent = Math.min(100, Math.round(done * 100));
      options.onProgress?.(percent, { percent, phase, clipIndex, clipCount, clipName, clipFraction });
    };

    const failures: TimelineAudioSyncFailure[] = [];
    const preparedById = new Map<string, PreparedSyncClip>();
    for (let index = 0; index < uniqueInputs.length; index += 1) {
      const input = uniqueInputs[index];
      report('reading', index + 1, input.clip.name, 0);
      try {
        // The master is searched end to end; a target only needs its most active excerpt.
        const excerptSeconds = input.clip.id === masterInput.clip.id ? undefined : targetExcerptSeconds;
        preparedById.set(input.clip.id, await prepareSyncClip(input, sampleRate, options.signal, (phase, fraction) => {
          report(phase, index + 1, input.clip.name, fraction);
        }, excerptSeconds));
      } catch (error) {
        if (options.signal?.aborted) throw error;
        failures.push({
          clipId: input.clip.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      report('reading', index + 1, input.clip.name, 1);
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

    const minimumRank = CONFIDENCE_RANK[options.minConfidence ?? 'low'];
    const targets = [...preparedById.values()].filter(candidate => candidate.clip.id !== master.clip.id);
    // Correlations against an hour-long master are large FFTs: they run in a worker.
    const matcher = createAudioSyncMatcher(master.samples, sampleRate);
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        report('matching', index + 1, target.clip.name, 0);
        if (options.signal?.aborted) throw new DOMException('Audio sync was cancelled.', 'AbortError');
        const excerpt = target.excerptStartSeconds !== undefined
          ? { samples: target.samples, startSeconds: target.excerptStartSeconds }
          : chooseActiveExcerpt(target.samples, sampleRate, targetExcerptSeconds);
        const measured = await matcher.match(excerpt.samples, { minPeakRatio: options.minPeakRatio });

        if (!measured) {
          failures.push({ clipId: target.clip.id, reason: 'No stable audio correlation peak found.' });
        } else if (CONFIDENCE_RANK[measured.confidence] < minimumRank) {
          failures.push({
            clipId: target.clip.id,
            reason: `Only a ${measured.confidence}-confidence match (peak ratio ${measured.peakRatio?.toFixed(3) ?? 'n/a'}); the clip was left in place. It may not overlap the master recording.`,
          });
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

        report('matching', index + 1, target.clip.name, 1);
      }
    } finally {
      matcher.dispose();
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
