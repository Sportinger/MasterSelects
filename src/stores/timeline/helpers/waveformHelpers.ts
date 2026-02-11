// Waveform generation helper - centralizes waveform logic and file size checks
// Provides consistent thresholds and logging across clip loading

import { Logger } from '../../../services/logger';

const log = Logger.create('WaveformHelpers');

// File size thresholds for waveform generation
// Video waveforms: skip if >500MB (video decode + audio decode is expensive)
export const VIDEO_WAVEFORM_THRESHOLD = 500 * 1024 * 1024; // 500MB

// Audio-only waveforms: can handle up to 4GB (just audio decode)
export const AUDIO_WAVEFORM_THRESHOLD = 4 * 1024 * 1024 * 1024; // 4GB

export interface WaveformGenerationOptions {
  samplesPerSecond?: number;
  onProgress?: (progress: number, partialWaveform: number[]) => void;
}

/**
 * Generate waveform data from audio file.
 * Uses ~50 samples per second for good visual resolution.
 * Supports optional progress callback for real-time updates.
 */
export async function generateWaveform(
  file: File,
  samplesPerSecond: number = 50,
  onProgress?: (progress: number, partialWaveform: number[]) => void
): Promise<number[]> {
  try {
    const audioContext = new AudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const channelData = audioBuffer.getChannelData(0); // Use first channel
    const duration = audioBuffer.duration;

    // Calculate samples based on duration (more samples for longer files)
    const sampleCount = Math.max(200, Math.min(10000, Math.floor(duration * samplesPerSecond)));
    const blockSize = Math.floor(channelData.length / sampleCount);

    const samples: number[] = [];
    let runningMax = 0;

    for (let i = 0; i < sampleCount; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channelData.length);

      // Use peak value for better visual representation
      let peak = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > peak) peak = abs;
      }

      samples.push(peak);
      if (peak > runningMax) runningMax = peak;

      // Report progress with normalized partial waveform every 5%
      if (onProgress && (i % Math.max(1, Math.floor(sampleCount / 20)) === 0 || i === sampleCount - 1)) {
        const progress = Math.round(((i + 1) / sampleCount) * 100);
        // Normalize partial waveform with running max
        const normalizedPartial = runningMax > 0
          ? samples.map(s => s / runningMax)
          : samples;
        onProgress(progress, normalizedPartial);
        // Yield to UI
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Final normalization to 0-1 range
    const max = Math.max(...samples);
    await audioContext.close();

    if (max > 0) {
      return samples.map(s => s / max);
    }
    return samples;
  } catch (e) {
    log.warn('Failed to generate waveform', e);
    return [];
  }
}

/**
 * Generate waveform data from an already decoded AudioBuffer.
 * Synchronous version for use with pre-decoded buffers (e.g., composition mixdowns).
 */
export function generateWaveformFromBuffer(
  audioBuffer: AudioBuffer,
  samplesPerSecond: number = 50
): number[] {
  try {
    const channelData = audioBuffer.getChannelData(0); // Use first channel
    const duration = audioBuffer.duration;

    // Calculate samples based on duration
    const sampleCount = Math.max(200, Math.min(10000, Math.floor(duration * samplesPerSecond)));
    const blockSize = Math.floor(channelData.length / sampleCount);

    const samples: number[] = [];

    for (let i = 0; i < sampleCount; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, channelData.length);

      // Use peak value for better visual representation
      let peak = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > peak) peak = abs;
      }

      samples.push(peak);
    }

    // Normalize to 0-1 range
    const max = Math.max(...samples);
    if (max > 0) {
      return samples.map(s => s / max);
    }
    return samples;
  } catch (e) {
    log.warn('Failed to generate waveform from buffer', e);
    return [];
  }
}

/**
 * Start waveform generation for a file.
 * Returns the complete waveform data.
 */
export async function generateWaveformForFile(
  file: File,
  options: WaveformGenerationOptions = {}
): Promise<number[]> {
  const { samplesPerSecond = 50, onProgress } = options;

  log.debug('Starting waveform generation', { file: file.name });

  const waveform = await generateWaveform(file, samplesPerSecond, onProgress);

  log.debug('Waveform complete', { samples: waveform.length, file: file.name });

  return waveform;
}

/**
 * Check if waveform generation should be skipped based on file size.
 * @param file - The file to check
 * @param isAudioOnly - True for audio-only files (higher threshold)
 */
export function shouldSkipWaveform(file: File, isAudioOnly: boolean = false): boolean {
  const threshold = isAudioOnly ? AUDIO_WAVEFORM_THRESHOLD : VIDEO_WAVEFORM_THRESHOLD;

  if (file.size > threshold) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(0);
    log.debug('Skipping waveform for large file', { sizeMB, file: file.name });
    return true;
  }

  return false;
}

/**
 * Generate a flat (silent) waveform for a given duration.
 * Used for composition clips without audio.
 */
export function generateSilentWaveform(duration: number, samplesPerSecond: number = 50): number[] {
  return new Array(Math.max(1, Math.floor(duration * samplesPerSecond))).fill(0);
}

/**
 * Calculate expected waveform sample count for a duration.
 */
export function getExpectedWaveformSamples(duration: number, samplesPerSecond: number = 50): number {
  return Math.max(200, Math.min(10000, Math.floor(duration * samplesPerSecond)));
}
