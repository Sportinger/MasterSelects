/**
 * AudioMixer - Mix multiple audio tracks into single stereo output
 *
 * Features:
 * - Position clips at correct timeline positions
 * - Handle overlapping audio (automatic summing)
 * - Track mute/solo support
 * - Gain normalization to prevent clipping
 */

import { Logger } from '../../services/logger';
import {
  DEFAULT_TRUE_PEAK_CEILING_DB,
  clampAudioPan,
  clampLinearGain,
  dbToLinearGain,
  finiteNumber,
  hasNonDefaultAudioPan,
  volumeDbToLinearGain,
} from './audioMath';
import { createBuffer } from './audioBufferFactory';

const log = Logger.create('AudioMixer');

export interface AudioTrackData {
  clipId: string;
  buffer: AudioBuffer;      // Already processed (speed, effects)
  startTime: number;        // Position on timeline (seconds)
  sourceOffsetTime?: number; // Offset into buffer for exports that begin inside a clip
  trackId: string;
  trackMuted: boolean;
  trackSolo: boolean;
  mixRole?: 'main' | 'send';
  sendId?: string;
  sendTargetBusId?: string;
  sendPreFader?: boolean;
  clipVolume?: number;      // Additional clip volume (0-1, default 1)
  trackVolumeDb?: number;   // Track fader in dB, default 0
  trackPan?: number;        // Stereo pan -1..1, default 0
}

export interface MixerSettings {
  sampleRate: number;       // Output sample rate (default 48000)
  numberOfChannels: number; // Output channels (default 2 = stereo)
  normalize: boolean;       // Peak normalize output (default false)
  headroom: number;         // Headroom in dB for normalization (default -1)
  masterVolumeDb: number;   // Master fader in dB (default 0)
  masterLimiterEnabled: boolean; // Reduce final peak to truePeakCeilingDb
  masterTruePeakCeilingDb: number; // Final peak ceiling in dBFS
}

export interface MixProgress {
  phase: 'preparing' | 'mixing' | 'normalizing';
  percent: number;
  tracksProcessed: number;
  totalTracks: number;
}

export type MixProgressCallback = (progress: MixProgress) => void;

export class AudioMixer {
  private settings: MixerSettings;

  constructor(settings?: Partial<MixerSettings>) {
    this.settings = {
      sampleRate: settings?.sampleRate ?? 48000,
      numberOfChannels: settings?.numberOfChannels ?? 2,
      normalize: settings?.normalize ?? false,
      headroom: settings?.headroom ?? -1,
      masterVolumeDb: settings?.masterVolumeDb ?? 0,
      masterLimiterEnabled: settings?.masterLimiterEnabled ?? false,
      masterTruePeakCeilingDb: settings?.masterTruePeakCeilingDb ?? DEFAULT_TRUE_PEAK_CEILING_DB,
    };
  }

  /**
   * Mix all tracks into a single stereo AudioBuffer
   * @param tracks - Array of processed audio tracks with timing info
   * @param duration - Total timeline duration in seconds
   * @param onProgress - Optional progress callback
   * @returns Mixed stereo AudioBuffer
   */
  async mixTracks(
    tracks: AudioTrackData[],
    duration: number,
    onProgress?: MixProgressCallback
  ): Promise<AudioBuffer> {
    const { sampleRate, numberOfChannels } = this.settings;
    const totalSamples = Math.ceil(duration * sampleRate);

    log.info(`Mixing ${tracks.length} tracks into ${duration.toFixed(2)}s output`);

    onProgress?.({
      phase: 'preparing',
      percent: 0,
      tracksProcessed: 0,
      totalTracks: tracks.length,
    });

    // Filter tracks based on mute/solo state
    const activeTracks = this.getActiveTracks(tracks);

    if (activeTracks.length === 0) {
      log.debug('No active tracks, returning silence');
      return this.createSilentBuffer(duration);
    }

    log.debug(`${activeTracks.length} active tracks after mute/solo filtering`);

    // Create output buffer
    const offlineContext = new OfflineAudioContext(
      numberOfChannels,
      totalSamples,
      sampleRate
    );

    // Add each track at its position
    for (let i = 0; i < activeTracks.length; i++) {
      const track = activeTracks[i];

      onProgress?.({
        phase: 'mixing',
        percent: Math.round((i / activeTracks.length) * 80),
        tracksProcessed: i,
        totalTracks: activeTracks.length,
      });

      await this.addTrackToMix(offlineContext, track);
    }

    onProgress?.({
      phase: 'mixing',
      percent: 80,
      tracksProcessed: activeTracks.length,
      totalTracks: activeTracks.length,
    });

    // Render the mix
    const mixedBuffer = await offlineContext.startRendering();

    if (
      this.settings.masterVolumeDb !== 0
      || this.settings.masterLimiterEnabled
      || this.settings.normalize
    ) {
      onProgress?.({
        phase: 'normalizing',
        percent: 90,
        tracksProcessed: activeTracks.length,
        totalTracks: activeTracks.length,
      });

      this.processMasterBuffer(mixedBuffer);
    }

    onProgress?.({
      phase: 'normalizing',
      percent: 100,
      tracksProcessed: activeTracks.length,
      totalTracks: activeTracks.length,
    });

    log.info(`Mix complete: ${mixedBuffer.duration.toFixed(2)}s`);

    return mixedBuffer;
  }

  /**
   * Filter tracks based on mute/solo state
   */
  private getActiveTracks(tracks: AudioTrackData[]): AudioTrackData[] {
    // Check if any track has solo enabled
    const hasSolo = tracks.some(t => t.trackSolo);

    return tracks.filter(track => {
      // Skip muted tracks
      if (track.trackMuted) return false;

      // If any track has solo, only include soloed tracks
      if (hasSolo && !track.trackSolo) return false;

      // Skip empty buffers
      if (!track.buffer || track.buffer.length === 0) return false;

      return true;
    });
  }

  /**
   * Add a single track to the offline context mix
   */
  private async addTrackToMix(
    context: OfflineAudioContext,
    track: AudioTrackData
  ): Promise<void> {
    // Ensure buffer matches output sample rate
    let buffer = track.buffer;
    if (buffer.sampleRate !== context.sampleRate) {
      buffer = await this.resampleBuffer(buffer, context.sampleRate);
    }

    // Ensure stereo
    if (buffer.numberOfChannels === 1 && this.settings.numberOfChannels === 2) {
      buffer = this.convertToStereo(buffer);
    }

    // Create source and per-track processing nodes
    const source = context.createBufferSource();
    source.buffer = buffer;

    const clipGain = clampLinearGain(track.clipVolume, 1);
    const trackGain = volumeDbToLinearGain(track.trackVolumeDb);
    const combinedGain = clipGain * trackGain;
    let outputNode: AudioNode = source;

    if (Math.abs(combinedGain - 1) > 0.001) {
      const gainNode = context.createGain();
      gainNode.gain.value = Math.max(0, Math.min(8, combinedGain));
      outputNode.connect(gainNode);
      outputNode = gainNode;
    }

    const pan = clampAudioPan(track.trackPan);
    if (this.settings.numberOfChannels >= 2 && hasNonDefaultAudioPan(pan)) {
      const panNode = context.createStereoPanner();
      panNode.pan.value = pan;
      outputNode.connect(panNode);
      outputNode = panNode;
    }

    outputNode.connect(context.destination);

    // Start at the correct timeline position and source offset. When an export
    // begins mid-clip, startTime is clamped to 0 while sourceOffsetTime skips
    // the already elapsed part of the rendered clip buffer.
    const startTime = Math.max(0, track.startTime);
    const sourceOffsetTime = Math.max(
      0,
      finiteNumber(track.sourceOffsetTime, track.startTime < 0 ? -track.startTime : 0)
    );
    if (sourceOffsetTime >= buffer.duration) {
      log.debug(`Skipping clip ${track.clipId}: source offset ${sourceOffsetTime.toFixed(2)}s exceeds buffer duration ${buffer.duration.toFixed(2)}s`);
      return;
    }
    source.start(startTime, sourceOffsetTime);

    log.debug(`Added clip ${track.clipId} at ${startTime.toFixed(2)}s (${buffer.duration.toFixed(2)}s)`, {
      sourceOffsetTime,
      trackVolumeDb: track.trackVolumeDb ?? 0,
      trackPan: pan,
    });
  }

  /**
   * Resample buffer to target sample rate
   */
  private async resampleBuffer(
    buffer: AudioBuffer,
    targetSampleRate: number
  ): Promise<AudioBuffer> {
    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      Math.ceil(buffer.duration * targetSampleRate),
      targetSampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineContext.destination);
    source.start(0);

    return await offlineContext.startRendering();
  }

  /**
   * Convert mono buffer to stereo
   */
  private convertToStereo(buffer: AudioBuffer): AudioBuffer {
    const stereoBuffer = createBuffer(
      2,
      buffer.length,
      buffer.sampleRate
    );

    const monoData = buffer.getChannelData(0);
    const leftData = stereoBuffer.getChannelData(0);
    const rightData = stereoBuffer.getChannelData(1);

    for (let i = 0; i < buffer.length; i++) {
      leftData[i] = monoData[i];
      rightData[i] = monoData[i];
    }

    return stereoBuffer;
  }

  /**
   * Create a silent buffer
   */
  private createSilentBuffer(duration: number): AudioBuffer {
    return createBuffer(
      this.settings.numberOfChannels,
      Math.ceil(duration * this.settings.sampleRate),
      this.settings.sampleRate
    );
  }

  /**
   * Peak normalize buffer to prevent clipping
   * Modifies buffer in place
   */
  private normalizeBuffer(buffer: AudioBuffer): void {
    // Find peak across all channels
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }

    if (peak === 0) return; // All silence

    // Calculate target level with headroom
    const headroomLinear = Math.pow(10, this.settings.headroom / 20);
    const normalizeGain = headroomLinear / peak;

    // Only normalize if we would reduce (prevent amplifying noise)
    if (normalizeGain >= 1) return;

    log.debug(`Normalizing: peak=${peak.toFixed(4)}, gain=${normalizeGain.toFixed(4)}`);

    // Apply gain
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] *= normalizeGain;
      }
    }
  }

  /**
   * Apply master fader, optional final peak ceiling, and requested normalization.
   * Modifies the buffer in place and returns it for call chaining.
   */
  processMasterBuffer(buffer: AudioBuffer, settings?: Partial<MixerSettings>): AudioBuffer {
    const masterVolumeDb = finiteNumber(settings?.masterVolumeDb, this.settings.masterVolumeDb);
    const limiterEnabled = settings?.masterLimiterEnabled ?? this.settings.masterLimiterEnabled;
    const truePeakCeilingDb = finiteNumber(
      settings?.masterTruePeakCeilingDb,
      this.settings.masterTruePeakCeilingDb
    );
    const normalize = settings?.normalize ?? this.settings.normalize;

    const masterGain = volumeDbToLinearGain(masterVolumeDb);
    if (Math.abs(masterGain - 1) > 0.001) {
      this.applyLinearGain(buffer, masterGain);
    }

    if (limiterEnabled) {
      this.applyPeakCeiling(buffer, truePeakCeilingDb);
    }

    if (normalize) {
      this.normalizeBuffer(buffer);
    }

    return buffer;
  }

  private applyLinearGain(buffer: AudioBuffer, gain: number): void {
    if (!Number.isFinite(gain) || gain === 1) return;
    const safeGain = Math.max(0, Math.min(16, gain));
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] *= safeGain;
      }
    }
  }

  private applyPeakCeiling(buffer: AudioBuffer, ceilingDb: number): void {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
      }
    }

    if (peak <= 0) return;

    const ceiling = dbToLinearGain(ceilingDb, DEFAULT_TRUE_PEAK_CEILING_DB);
    if (peak <= ceiling) return;

    this.applyLinearGain(buffer, ceiling / peak);
  }

  /**
   * Get peak level of a buffer in dB
   */
  static getPeakLevel(buffer: AudioBuffer): number {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  }

  /**
   * Get RMS level of a buffer in dB
   */
  static getRMSLevel(buffer: AudioBuffer): number {
    let sumSquares = 0;
    let totalSamples = 0;

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        sumSquares += data[i] * data[i];
        totalSamples++;
      }
    }

    const rms = Math.sqrt(sumSquares / totalSamples);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<MixerSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Get current settings
   */
  getSettings(): MixerSettings {
    return { ...this.settings };
  }
}

// Default mixer instance
export const audioMixer = new AudioMixer();
