/**
 * TimeStretchProcessor - Handle speed changes and pitch preservation
 *
 * Uses SoundTouchJS for high-quality time-stretching with independent
 * control over tempo and pitch.
 *
 * Features:
 * - Constant speed processing
 * - Variable speed with keyframes
 * - Pitch preservation option
 * - Chunked processing for memory efficiency
 */

import { Logger } from '../../services/logger';
import { SoundTouch } from 'soundtouch-ts';

const log = Logger.create('TimeStretchProcessor');
import type { Keyframe } from '../../types';
import { createClipSpeedSource, resolveClipSourceTime, type ClipRetimeTiming } from '../../services/timeline/retime/clipRetime';
import { createBuffer } from './audioBufferFactory';

export interface TimeStretchSettings {
  preservePitch: boolean;  // Keep original pitch when changing speed
  quality: 'fast' | 'normal' | 'high';  // Processing quality
}

export interface TimeStretchProgress {
  processedSamples: number;
  totalSamples: number;
  percent: number;
  currentSpeed: number;
}

export type TimeStretchProgressCallback = (progress: TimeStretchProgress) => void;

export class TimeStretchProcessor {
  private settings: TimeStretchSettings;

  constructor(settings?: Partial<TimeStretchSettings>) {
    this.settings = {
      preservePitch: settings?.preservePitch ?? true,
      quality: settings?.quality ?? 'normal',
    };
  }

  /**
   * Process audio with constant speed
   * @param buffer - Source AudioBuffer
   * @param speed - Positive playback magnitude (direction is resolved by the clip renderer)
   * @param preservePitch - Override pitch preservation setting
   * @returns Processed AudioBuffer
   */
  async processConstantSpeed(
    buffer: AudioBuffer,
    speed: number,
    preservePitch?: boolean
  ): Promise<AudioBuffer> {
    const shouldPreservePitch = preservePitch ?? this.settings.preservePitch;

    // Never silently clamp: that would change duration relative to video.
    if (!Number.isFinite(speed) || speed <= 0) throw new Error('Audio stretch speed must be positive.');

    log.debug(`Processing constant speed: ${speed}x, preservePitch: ${shouldPreservePitch}`);

    // If speed is 1.0, no processing needed
    if (Math.abs(speed - 1.0) < 0.001) {
      return buffer;
    }

    // If not preserving pitch, use simple resampling (faster)
    if (!shouldPreservePitch) {
      return this.resampleForSpeed(buffer, speed);
    }

    // Use SoundTouch for pitch-preserved time-stretching
    return this.soundTouchProcess(buffer, speed);
  }

  /**
   * Process audio with speed keyframes
   * @param buffer - Source AudioBuffer
   * @param keyframes - All keyframes for the clip
   * @param defaultSpeed - Default speed if no keyframes at a given time
   * @param clipDuration - Timeline duration of the clip
   * @param preservePitch - Override pitch preservation setting
   * @param onProgress - Optional progress callback
   * @returns Processed AudioBuffer
   */
  async processWithKeyframes(
    buffer: AudioBuffer,
    keyframes: Keyframe[],
    defaultSpeed: number,
    clipDuration: number,
    preservePitch?: boolean,
    onProgress?: TimeStretchProgressCallback,
    timing?: ClipRetimeTiming,
    signal?: AbortSignal,
    sourceBufferStart?: number,
  ): Promise<AudioBuffer> {
    const shouldPreservePitch = preservePitch ?? this.settings.preservePitch;

    const clip = timing ?? { inPoint: 0, outPoint: buffer.duration, duration: clipDuration, speed: defaultSpeed };
    const source = createClipSpeedSource(clip, keyframes);
    const sampleAt = (time: number) => resolveClipSourceTime(clip, time, source);
    const outputSamples = Math.max(1, Math.ceil(clipDuration * buffer.sampleRate));
    const output = createBuffer(buffer.numberOfChannels, outputSamples, buffer.sampleRate);
    const keys = keyframes.filter(key => key.property === 'speed');
    const looped = clip.timeRemap?.kind === 'loop' && !clip.transitionSourceMap &&
      !clip.transitionSourceHold && !Number.isFinite(clip.transitionSourceTimeOverride);
    // Direction changes/freezes use exact signed resampling. Pitch preservation
    // across a turn or freeze is intentionally unsupported, never abs-normalized.
    const signs = new Set(keys.map(key => Math.sign(key.value)));
    const exactResample = clip.timeRemap?.kind === 'warp' || !shouldPreservePitch || signs.size > 1 || signs.has(0) || looped ||
      Boolean(clip.transitionSourceMap || clip.transitionSourceHold ||
        Number.isFinite(clip.transitionSourceTimeOverride));
    const inputs = Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch));
    const outputs = inputs.map((_, ch) => output.getChannelData(ch));
    if (exactResample) {
      const origin = sourceBufferStart ?? clip.inPoint;
      const cycle = (clip.outPoint - clip.inPoint) * buffer.sampleRate;
      const wrap = (position: number) => looped && cycle > 0
        ? clip.inPoint * buffer.sampleRate + ((position - clip.inPoint * buffer.sampleRate) % cycle + cycle) % cycle : position;
      for (let i = 0; i < outputSamples; i++) {
        if (i % 16384 === 0) signal?.throwIfAborted();
        const sample = sampleAt(i / buffer.sampleRate);
        // A held video frame has no changing audio signal (silence, not DC).
        if (!sample.isHold) {
          const samplePosition = sample.sourceTime * buffer.sampleRate - (sample.sourceRate < 0 ? 1 : 0);
          const position = wrap(samplePosition) - origin * buffer.sampleRate;
          if (position >= 0 && position < buffer.length) {
            const index = Math.floor(position);
            const fraction = position - index;
            for (let ch = 0; ch < inputs.length; ch++) {
              const a = inputs[ch][index];
              const next = looped ? Math.round(wrap((index + 1) + origin * buffer.sampleRate) - origin * buffer.sampleRate)
                : Math.min(index + 1, buffer.length - 1);
              const b = inputs[ch][next] ?? a;
              outputs[ch][i] = a + (b - a) * fraction;
            }
          }
        }
        if (i % 16384 === 0) {
          onProgress?.({ processedSamples: i, totalSamples: outputSamples,
            percent: 100 * i / outputSamples, currentSpeed: sample.sourceRate });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    } else {
      // Retain pitch-preserved segments, but derive every endpoint from the same
      // contract as video. Keyframe boundaries also split segments (including holds).
      const boundaries = new Set([0, clipDuration]);
      for (let time = 0.1; time < clipDuration; time += 0.1) boundaries.add(time);
      for (const key of keys) if (key.time > 0 && key.time < clipDuration) boundaries.add(key.time);
      const times = [...boundaries].toSorted((a, b) => a - b);
      for (let segment = 0; segment < times.length - 1; segment++) {
        signal?.throwIfAborted();
        const start = times[segment];
        const end = times[segment + 1];
        const a = sampleAt(start);
        const b = sampleAt(end);
        const speed = (b.sourceTime - a.sourceTime) / (end - start);
        if (Math.abs(speed) < 1e-8) continue;
        let samples = this.extractSegment(buffer,
          Math.max(0, Math.min(a.sourceTime, b.sourceTime) - (sourceBufferStart ?? clip.inPoint)),
          Math.min(buffer.duration, Math.max(a.sourceTime, b.sourceTime) - (sourceBufferStart ?? clip.inPoint)));
        if (!samples.length) continue;
        if (speed < 0) samples = samples.map(channel => channel.toReversed());
        if (Math.abs(Math.abs(speed) - 1) > 0.001) {
          samples = await this.stretchSegment(samples, Math.abs(speed), buffer.sampleRate, inputs.length);
        }
        const first = Math.round(start * buffer.sampleRate);
        const last = Math.min(outputSamples, Math.round(end * buffer.sampleRate));
        for (let ch = 0; ch < inputs.length; ch++) {
          const data = samples[ch];
          for (let i = first; i < last; i++) {
            outputs[ch][i] = data[Math.floor((i - first) * data.length / (last - first))] ?? 0;
          }
        }
        onProgress?.({ processedSamples: last, totalSamples: outputSamples,
          percent: 100 * last / outputSamples, currentSpeed: speed });
        if (segment % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    onProgress?.({ processedSamples: outputSamples, totalSamples: outputSamples, percent: 100,
      currentSpeed: sampleAt(clipDuration).sourceRate });
    return output;
  }

  /**
   * Extract a segment from buffer as Float32Array per channel
   */
  private extractSegment(
    buffer: AudioBuffer,
    startTime: number,
    endTime: number
  ): Float32Array[] {
    const startSample = Math.floor(startTime * buffer.sampleRate);
    const endSample = Math.ceil(endTime * buffer.sampleRate);
    const length = Math.max(0, Math.min(endSample - startSample, buffer.length - startSample));

    if (length === 0) return [];

    const segments: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const channelData = buffer.getChannelData(ch);
      const segment = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        segment[i] = channelData[startSample + i] || 0;
      }
      segments.push(segment);
    }
    return segments;
  }

  /**
   * Time-stretch a segment using SoundTouch
   */
  private async stretchSegment(
    segments: Float32Array[],
    speed: number,
    sampleRate: number,
    channels: number
  ): Promise<Float32Array[]> {
    const length = segments[0].length;
    const outputLength = Math.ceil(length / speed);
    const output = Array.from({ length: channels }, () => new Float32Array(outputLength));
    // SoundTouch consumes stereo frames. Pair channels (duplicate an odd final
    // channel) and flush its lookahead with silence so short ramp segments and
    // constant-speed outputs retain their declared duration and final samples.
    const padding = Math.ceil(sampleRate * Math.max(0.25, 0.15 * speed));
    for (let channel = 0; channel < channels; channel += 2) {
      const soundtouch = new SoundTouch(sampleRate);
      soundtouch.tempo = speed;
      soundtouch.pitch = 1;
      const interleaved = new Float32Array((length + padding) * 2);
      const left = segments[channel];
      const right = segments[channel + 1] ?? left;
      for (let i = 0; i < length; i++) {
        interleaved[2 * i] = left[i];
        interleaved[2 * i + 1] = right[i];
      }
      soundtouch.inputBuffer.putSamples(interleaved);
      soundtouch.process();
      const frames = Math.min(outputLength, soundtouch.outputBuffer.frameCount);
      const processed = new Float32Array(frames * 2);
      soundtouch.outputBuffer.receiveSamples(processed, frames);
      for (let i = 0; i < frames; i++) {
        output[channel][i] = processed[2 * i];
        if (channel + 1 < channels) output[channel + 1][i] = processed[2 * i + 1];
      }
    }
    return output;
  }

  /**
   * Process entire buffer with SoundTouch (for constant speed)
   */
  private async soundTouchProcess(buffer: AudioBuffer, speed: number): Promise<AudioBuffer> {
    const channels = buffer.numberOfChannels;
    const segments: Float32Array[] = [];

    for (let ch = 0; ch < channels; ch++) {
      segments.push(buffer.getChannelData(ch).slice());
    }

    const processed = await this.stretchSegment(segments, speed, buffer.sampleRate, channels);

    // Create output buffer
    const outputLength = Math.ceil(buffer.length / speed);
    const outputBuffer = createBuffer(channels, outputLength, buffer.sampleRate);

    for (let ch = 0; ch < channels; ch++) {
      const outputData = outputBuffer.getChannelData(ch);
      const srcData = processed[ch] || processed[0];
      for (let i = 0; i < outputLength; i++) {
        outputData[i] = srcData[i] || 0;
      }
    }

    return outputBuffer;
  }

  /**
   * Simple resampling for speed without pitch preservation
   */
  private async resampleForSpeed(buffer: AudioBuffer, speed: number): Promise<AudioBuffer> {
    const outputLength = Math.ceil(buffer.length / speed);
    const outputBuffer = createBuffer(
      buffer.numberOfChannels,
      outputLength,
      buffer.sampleRate
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = outputBuffer.getChannelData(ch);

      for (let i = 0; i < outputLength; i++) {
        const srcIdx = i * speed;
        const srcIdxFloor = Math.floor(srcIdx);
        const frac = srcIdx - srcIdxFloor;

        const s1 = input[srcIdxFloor] || 0;
        const s2 = input[srcIdxFloor + 1] ?? s1;
        output[i] = s1 + (s2 - s1) * frac;
      }
    }

    return outputBuffer;
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<TimeStretchSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Get current settings
   */
  getSettings(): TimeStretchSettings {
    return { ...this.settings };
  }
}

// Default instance
export const timeStretchProcessor = new TimeStretchProcessor();
