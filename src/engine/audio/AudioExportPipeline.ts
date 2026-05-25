/**
 * AudioExportPipeline - Orchestrates the complete audio export process
 *
 * Coordinates:
 * 1. AudioExtractor - Decode audio from files
 * 2. TimeStretchProcessor - Handle speed/pitch changes
 * 3. AudioEffectRenderer - Apply EQ and volume
 * 4. AudioMixer - Mix all tracks
 * 5. AudioEncoder - Encode to AAC
 *
 * Returns encoded audio chunks ready for muxing with video
 */

import { Logger } from '../../services/logger';
import { AudioExtractor, audioExtractor } from './AudioExtractor';

const log = Logger.create('AudioExportPipeline');
import { AudioEncoderWrapper, type EncodedAudioResult } from './AudioEncoder';
import { AudioMixer, type AudioTrackData } from './AudioMixer';
import { ClipAudioRenderService, type ClipAudioRenderProgress } from '../../services/audio/ClipAudioRenderService';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import type { TimelineClip, TimelineTrack, Keyframe } from '../../types';

export interface AudioExportSettings {
  sampleRate: number;       // 44100 or 48000
  bitrate: number;          // 128000 - 320000
  normalize: boolean;       // Peak normalize output
}

export interface AudioExportProgress {
  phase: 'extracting' | 'processing' | 'effects' | 'mixing' | 'encoding' | 'complete';
  percent: number;
  currentClip?: string;
  message?: string;
}

export type AudioExportProgressCallback = (progress: AudioExportProgress) => void;

export class AudioExportPipeline {
  private extractor: AudioExtractor;
  private encoder: AudioEncoderWrapper | null = null;
  private mixer: AudioMixer;
  private clipAudioRenderer: ClipAudioRenderService;
  private settings: AudioExportSettings;
  private cancelled = false;

  constructor(settings?: Partial<AudioExportSettings>) {
    this.settings = {
      sampleRate: settings?.sampleRate ?? 48000,
      bitrate: settings?.bitrate ?? 256000,
      normalize: settings?.normalize ?? false,
    };

    this.extractor = audioExtractor;
    this.mixer = new AudioMixer({
      sampleRate: this.settings.sampleRate,
      normalize: this.settings.normalize,
    });
    this.clipAudioRenderer = new ClipAudioRenderService({
      extractor: this.extractor,
    });
  }

  /**
   * Export all audio from timeline
   * @param startTime - Export start time
   * @param endTime - Export end time
   * @param onProgress - Progress callback
   * @returns Encoded audio result with chunks for muxing
   */
  async exportAudio(
    startTime: number,
    endTime: number,
    onProgress?: AudioExportProgressCallback
  ): Promise<EncodedAudioResult | null> {
    this.cancelled = false;

    const { clips, tracks, clipKeyframes } = useTimelineStore.getState();
    const duration = endTime - startTime;

    log.info(`Starting export: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s (${duration.toFixed(2)}s)`);

    // 1. Find all clips with audio in the export range
    const audioClips = AudioExportPipeline.getClipsWithAudio(clips, tracks, startTime, endTime);

    if (audioClips.length === 0) {
      log.info('No audio clips found in export range');
      return null;
    }

    log.info(`Found ${audioClips.length} clips with audio`);

    try {
      // 2. Extract audio from all clips
      onProgress?.({ phase: 'extracting', percent: 0, message: 'Extracting audio...' });
      const extractedBuffers = await this.extractAllAudio(audioClips, onProgress);

      if (this.cancelled) return null;

      // 3. Render each clip through the same processed graph used by timeline waveform artifacts
      onProgress?.({ phase: 'processing', percent: 0, message: 'Rendering timeline audio graph...' });
      const effectBuffers = await this.renderAllClipAudio(
        audioClips,
        extractedBuffers,
        clipKeyframes,
        onProgress
      );

      if (this.cancelled) return null;

      // 4. Mix all tracks
      onProgress?.({ phase: 'mixing', percent: 0, message: 'Mixing tracks...' });
      const trackData = this.prepareTrackData(audioClips, effectBuffers, tracks, startTime);
      const mixedBuffer = await this.mixer.mixTracks(trackData, duration);

      if (this.cancelled) return null;

      // 5. Encode to AAC
      onProgress?.({ phase: 'encoding', percent: 0, message: 'Encoding audio...' });
      const result = await this.encodeAudio(mixedBuffer, onProgress);

      // 6. Cleanup
      this.extractor.clearCache();

      onProgress?.({ phase: 'complete', percent: 100, message: 'Audio export complete' });

      log.info(`Export complete: ${result.chunks.length} chunks`);
      return result;

    } catch (error) {
      log.error('Export failed:', error);
      this.extractor.clearCache();
      throw error;
    }
  }

  /**
   * Export raw audio (mixed but not encoded) for use with external encoders like FFmpeg
   * @param startTime - Export start time
   * @param endTime - Export end time
   * @param onProgress - Progress callback
   * @returns Mixed AudioBuffer as raw PCM data
   */
  async exportRawAudio(
    startTime: number,
    endTime: number,
    onProgress?: AudioExportProgressCallback
  ): Promise<AudioBuffer | null> {
    this.cancelled = false;

    const { clips, tracks, clipKeyframes } = useTimelineStore.getState();
    const duration = endTime - startTime;

    log.info(`Starting raw audio export: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`);

    // 1. Find all clips with audio in the export range
    const audioClips = AudioExportPipeline.getClipsWithAudio(clips, tracks, startTime, endTime);

    if (audioClips.length === 0) {
      log.info('No audio clips found in export range');
      return null;
    }

    log.info(`Found ${audioClips.length} clips with audio`);

    try {
      // 2. Extract audio from all clips
      onProgress?.({ phase: 'extracting', percent: 0, message: 'Extracting audio...' });
      const extractedBuffers = await this.extractAllAudio(audioClips, onProgress);

      if (this.cancelled) return null;

      // 3. Render each clip through the same processed graph used by timeline waveform artifacts
      onProgress?.({ phase: 'processing', percent: 0, message: 'Rendering timeline audio graph...' });
      const effectBuffers = await this.renderAllClipAudio(
        audioClips,
        extractedBuffers,
        clipKeyframes,
        onProgress
      );

      if (this.cancelled) return null;

      // 4. Mix all tracks
      onProgress?.({ phase: 'mixing', percent: 0, message: 'Mixing tracks...' });
      const trackData = this.prepareTrackData(audioClips, effectBuffers, tracks, startTime);
      const mixedBuffer = await this.mixer.mixTracks(trackData, duration);

      // 5. Cleanup
      this.extractor.clearCache();

      onProgress?.({ phase: 'complete', percent: 100, message: 'Audio mixing complete' });

      log.info(`Raw audio export complete: ${mixedBuffer.duration.toFixed(2)}s, ${mixedBuffer.numberOfChannels}ch`);
      return mixedBuffer;

    } catch (error) {
      log.error('Raw audio export failed:', error);
      this.extractor.clearCache();
      throw error;
    }
  }

  /**
   * Cancel the export
   */
  cancel(): void {
    this.cancelled = true;
    log.info('Export cancelled');
  }

  /**
   * Get clips that have audio in the export range
   */
  static hasAudioInRange(
    clips: TimelineClip[],
    tracks: TimelineTrack[],
    startTime: number,
    endTime: number
  ): boolean {
    return AudioExportPipeline.getClipsWithAudio(clips, tracks, startTime, endTime).length > 0;
  }

  /**
   * Get clips that have audio in the export range
   */
  static getClipsWithAudio(
    clips: TimelineClip[],
    tracks: TimelineTrack[],
    startTime: number,
    endTime: number
  ): TimelineClip[] {
    const hasSoloAudioTrack = tracks.some(t => t.type === 'audio' && t.solo);
    const mediaFiles = useMediaStore.getState().files;

    return clips.filter(clip => {
      // Check if clip is in range
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= startTime || clip.startTime >= endTime) {
        return false;
      }

      // Nested composition with mixdown audio
      if (clip.isComposition && clip.mixdownBuffer && clip.hasMixdownAudio) {
        // Check track is not muted (nested comps are on video tracks)
        const track = tracks.find(t => t.id === clip.trackId);
        if (track && !track.visible) return false;
        return true;
      }

      // Check if clip has audio source
      if (!clip.source?.audioElement && !clip.source?.videoElement && !clip.file) {
        return false;
      }

      // For video clips, we need the linked audio clip
      // For audio clips, we use them directly
      if (clip.source?.type === 'audio') {
        const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
        const mediaFile = mediaFileId ? mediaFiles.find(file => file.id === mediaFileId) : null;
        if (mediaFile?.hasAudio === false) {
          log.debug('Skipping audio clip for media marked without audio', {
            clip: clip.name,
            mediaFile: mediaFile.name,
          });
          return false;
        }

        // Check track is not muted
        const track = tracks.find(t => t.id === clip.trackId);
        if (track?.muted) return false;
        if (hasSoloAudioTrack && !track?.solo) return false;
        return true;
      }

      // Video clips don't have audio in this architecture
      // (audio is in separate linked clips)
      return false;
    });
  }

  /**
   * Extract audio from all clips
   */
  private async extractAllAudio(
    clips: TimelineClip[],
    onProgress?: AudioExportProgressCallback
  ): Promise<Map<string, AudioBuffer>> {
    const buffers = new Map<string, AudioBuffer>();

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];

      if (this.cancelled) break;

      onProgress?.({
        phase: 'extracting',
        percent: Math.round((i / clips.length) * 100),
        currentClip: clip.name,
        message: `Extracting: ${clip.name}`,
      });

      try {
        let buffer: AudioBuffer;

        // Nested composition with pre-mixed audio buffer
        if (clip.isComposition && clip.mixdownBuffer) {
          buffer = clip.mixdownBuffer;
          log.debug(`Using mixdown buffer for nested comp ${clip.name}`);
        } else if (clip.source?.audioElement) {
          // Extract from audio element
          buffer = await this.extractor.extractFromElement(
            clip.source.audioElement,
            clip.id
          );
        } else if (clip.file) {
          // Extract from file
          buffer = await this.extractor.extractAudio(clip.file, clip.id);
        } else {
          log.warn(`No audio source for clip ${clip.id}`);
          continue;
        }

        buffers.set(clip.id, buffer);
      } catch (error) {
        log.error(`Failed to extract audio from ${clip.name}:`, error);
        // Create silent buffer as fallback
        const fallbackDuration = Math.max(clip.outPoint ?? clip.duration, clip.duration, 0.001);
        buffers.set(clip.id, this.extractor.createSilentBuffer(fallbackDuration));
      }
    }

    return buffers;
  }

  /**
   * Render all clip-local audio edits/effects through the shared offline graph.
   */
  private async renderAllClipAudio(
    clips: TimelineClip[],
    buffers: Map<string, AudioBuffer>,
    clipKeyframes: Map<string, Keyframe[]>,
    onProgress?: AudioExportProgressCallback
  ): Promise<Map<string, AudioBuffer>> {
    const processed = new Map<string, AudioBuffer>();

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const buffer = buffers.get(clip.id);

      if (!buffer || this.cancelled) continue;

      onProgress?.({
        phase: 'processing',
        percent: Math.round((i / clips.length) * 100),
        currentClip: clip.name,
        message: `Rendering audio: ${clip.name}`,
      });

      const keyframes = clipKeyframes.get(clip.id) || [];

      const rendered = await this.clipAudioRenderer.render({
        clip,
        sourceBuffer: buffer,
        keyframes,
        onProgress: progress => this.emitClipRenderProgress(clip, i, clips.length, progress, onProgress),
      });

      processed.set(clip.id, rendered.buffer);
    }

    return processed;
  }

  private emitClipRenderProgress(
    clip: TimelineClip,
    clipIndex: number,
    totalClips: number,
    progress: ClipAudioRenderProgress,
    onProgress?: AudioExportProgressCallback,
  ): void {
    const phase: AudioExportProgress['phase'] = progress.phase === 'effects' ? 'effects' : 'processing';
    onProgress?.({
      phase,
      percent: Math.round(((clipIndex + progress.percent / 100) / Math.max(1, totalClips)) * 100),
      currentClip: clip.name,
      message: progress.message ?? `Rendering audio: ${clip.name}`,
    });
  }

  /**
   * Prepare track data for mixer
   */
  private prepareTrackData(
    clips: TimelineClip[],
    buffers: Map<string, AudioBuffer>,
    tracks: TimelineTrack[],
    exportStartTime: number
  ): AudioTrackData[] {
    const trackData: AudioTrackData[] = [];

    // Check for soloed tracks
    const hasSolo = tracks.some(t => t.type === 'audio' && t.solo);

    for (const clip of clips) {
      const buffer = buffers.get(clip.id);
      if (!buffer) continue;

      const track = tracks.find(t => t.id === clip.trackId);
      if (!track) continue;

      // Skip if track is muted, or if solo mode is active and this track isn't soloed
      if (track.muted || (hasSolo && !track.solo)) continue;

      trackData.push({
        clipId: clip.id,
        buffer,
        startTime: clip.startTime - exportStartTime, // Adjust for export range
        trackId: clip.trackId,
        trackMuted: track.muted,
        trackSolo: track.solo,
      });
    }

    return trackData;
  }

  /**
   * Encode mixed audio to AAC
   */
  private async encodeAudio(
    buffer: AudioBuffer,
    onProgress?: AudioExportProgressCallback
  ): Promise<EncodedAudioResult> {
    // Ensure stereo
    let stereoBuffer = buffer;
    if (buffer.numberOfChannels === 1) {
      stereoBuffer = this.extractor.convertToStereo(buffer);
    }

    // Resample if needed
    if (stereoBuffer.sampleRate !== this.settings.sampleRate) {
      stereoBuffer = await this.extractor.resampleBuffer(
        stereoBuffer,
        this.settings.sampleRate
      );
    }

    // Create encoder
    this.encoder = new AudioEncoderWrapper({
      sampleRate: this.settings.sampleRate,
      numberOfChannels: 2,
      bitrate: this.settings.bitrate,
    });

    const supported = await this.encoder.init();
    if (!supported) {
      throw new Error('AAC audio encoding is not supported in this browser');
    }

    // Encode with progress
    await this.encoder.encode(stereoBuffer, (progress) => {
      onProgress?.({
        phase: 'encoding',
        percent: progress.percent,
        message: `Encoding: ${progress.percent}%`,
      });
    });

    return await this.encoder.finalize();
  }

  /**
   * Get current settings
   */
  getSettings(): AudioExportSettings {
    return { ...this.settings };
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<AudioExportSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.mixer.updateSettings({
      sampleRate: this.settings.sampleRate,
      normalize: this.settings.normalize,
    });
  }

  /**
   * Check if audio export is supported
   */
  static async isSupported(): Promise<boolean> {
    return await AudioEncoderWrapper.isSupported();
  }
}

// Default instance
export const audioExportPipeline = new AudioExportPipeline();
