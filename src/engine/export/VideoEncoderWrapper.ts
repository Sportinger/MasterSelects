// Video encoder wrapper using WebCodecs — muxing via MediaBunny adapter

import { Logger } from '../../services/logger';
import { MediaBunnyMuxerAdapter, type MuxerAdapter } from './MediaBunnyMuxerAdapter';

const log = Logger.create('VideoEncoder');
import { AudioEncoderWrapper, type AudioCodec, type EncodedAudioResult } from '../audio';
import type { ExportSettings, VideoCodec, ContainerFormat } from './types';
import { getCodecString, isCodecSupportedInContainer, getFallbackCodec } from './codecHelpers';

export class VideoEncoderWrapper {
  private encoder: VideoEncoder | null = null;
  private muxer: MuxerAdapter | null = null;
  private settings: ExportSettings;
  private encodedFrameCount = 0;
  private isClosed = false;
  private hasAudio = false;
  private audioCodec: AudioCodec = 'aac';
  private containerFormat: ContainerFormat = 'mp4';
  private effectiveVideoCodec: VideoCodec = 'h264';
  private effectiveBitrateMode: VideoEncoderBitrateMode = 'variable';

  constructor(settings: ExportSettings) {
    this.settings = settings;
    this.hasAudio = settings.includeAudio ?? false;
    this.containerFormat = settings.container ?? 'mp4';
  }

  async init(): Promise<boolean> {
    if (!('VideoEncoder' in window)) {
      log.error('WebCodecs not supported');
      return false;
    }

    // Determine audio codec based on container
    await this.initializeAudioCodec();

    // Determine effective video codec based on container compatibility
    this.effectiveVideoCodec = this.settings.codec;
    if (!isCodecSupportedInContainer(this.settings.codec, this.containerFormat)) {
      log.warn(`${this.settings.codec} not supported in ${this.containerFormat}, using fallback`);
      this.effectiveVideoCodec = getFallbackCodec(this.containerFormat);
    }

    // Check codec support
    const codecString = getCodecString(this.effectiveVideoCodec);
    const requestedBitrateMode: VideoEncoderBitrateMode =
      this.settings.rateControl === 'cbr' ? 'constant' : 'variable';
    const supportCheckConfig = {
      codec: codecString,
      width: this.settings.width,
      height: this.settings.height,
      bitrate: this.settings.bitrate,
      framerate: this.settings.fps,
    };
    try {
      const requestedSupport = await VideoEncoder.isConfigSupported({
        ...supportCheckConfig,
        bitrateMode: requestedBitrateMode,
      });

      this.effectiveBitrateMode = requestedBitrateMode;

      if (!requestedSupport.supported) {
        if (requestedBitrateMode !== 'constant') {
          log.error(`Codec not supported: ${codecString}`);
          return false;
        }

        log.warn('Constant bitrate support check failed for this encoder config, will try configure() and fall back to variable if needed');

        const fallbackSupport = await VideoEncoder.isConfigSupported({
          ...supportCheckConfig,
          bitrateMode: 'variable',
        });
        if (!fallbackSupport.supported) {
          this.effectiveBitrateMode = 'variable';
          log.error(`Codec not supported: ${codecString}`);
          return false;
        }
      } else if (requestedBitrateMode === 'constant') {
        const fallbackSupport = await VideoEncoder.isConfigSupported({
          ...supportCheckConfig,
          bitrateMode: 'variable',
        });
        if (!fallbackSupport.supported) {
          log.error(`Codec not supported: ${codecString}`);
          return false;
        }
      }
    } catch (e) {
      log.error('Codec support check failed:', e);
      return false;
    }

    // Create muxer (MediaBunny adapter)
    this.createMuxer();

    // Create encoder
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (this.muxer) {
          // Synchronous queue — MediaBunnyMuxerAdapter buffers internally
          this.muxer.addVideoChunk(chunk, meta);
        }
        this.encodedFrameCount++;
      },
      error: (e) => {
        log.error('Encode error:', e);
      },
    });

    const buildEncoderConfig = (bitrateMode: VideoEncoderBitrateMode): VideoEncoderConfig => ({
      ...supportCheckConfig,
      latencyMode: 'quality',
      bitrateMode,
    });

    try {
      this.encoder.configure(buildEncoderConfig(requestedBitrateMode));
      this.effectiveBitrateMode = requestedBitrateMode;
    } catch (error) {
      if (requestedBitrateMode !== 'constant') {
        throw error;
      }

      log.warn('Constant bitrate configure() failed, falling back to variable bitrate', error);
      this.encoder.configure(buildEncoderConfig('variable'));
      this.effectiveBitrateMode = 'variable';
    }

    log.info(
      `Initialized: ${this.settings.width}x${this.settings.height} @ ${this.settings.fps}fps (${this.effectiveVideoCodec.toUpperCase()}, ${(this.settings.bitrate / 1_000_000).toFixed(1)} Mbps, ${this.effectiveBitrateMode})`
    );
    return true;
  }

  private async initializeAudioCodec(): Promise<void> {
    if (!this.hasAudio) return;

    if (this.containerFormat === 'webm') {
      const opusSupported = await AudioEncoderWrapper.isOpusSupported();
      if (opusSupported) {
        this.audioCodec = 'opus';
        log.info('Using Opus audio for WebM');
      } else {
        log.warn('Opus not supported, disabling audio for WebM');
        this.hasAudio = false;
      }
    } else {
      const aacSupported = await AudioEncoderWrapper.isAACSupported();
      if (aacSupported) {
        this.audioCodec = 'aac';
        log.info('Using AAC audio for MP4');
      } else {
        const opusSupported = await AudioEncoderWrapper.isOpusSupported();
        if (opusSupported) {
          this.audioCodec = 'opus';
          log.info('AAC not supported, using Opus audio for MP4 (fallback)');
        } else {
          log.warn('No audio codec supported, disabling audio');
          this.hasAudio = false;
        }
      }
    }
  }

  private createMuxer(): void {
    this.muxer = new MediaBunnyMuxerAdapter({
      container: this.containerFormat,
      videoCodec: this.effectiveVideoCodec,
      fps: this.settings.fps,
      hasAudio: this.hasAudio,
      audioCodec: this.audioCodec,
    });

    const audioLabel = this.hasAudio ? this.audioCodec.toUpperCase() : 'no';
    log.info(`Using MediaBunny ${this.containerFormat.toUpperCase()}/${this.effectiveVideoCodec.toUpperCase()} with ${audioLabel} audio`);
  }

  getContainerFormat(): ContainerFormat {
    return this.containerFormat;
  }

  getAudioCodec(): AudioCodec {
    return this.audioCodec;
  }

  async encodeFrame(pixels: Uint8ClampedArray, frameIndex: number, keyframeInterval?: number): Promise<void> {
    if (!this.encoder || this.isClosed) {
      throw new Error('Encoder not initialized or already closed');
    }

    const timestampMicros = Math.round(frameIndex * (1_000_000 / this.settings.fps));
    const durationMicros = Math.round(1_000_000 / this.settings.fps);

    const frame = new VideoFrame(pixels.buffer, {
      format: 'RGBA',
      codedWidth: this.settings.width,
      codedHeight: this.settings.height,
      timestamp: timestampMicros,
      duration: durationMicros,
    });

    // FPS-based keyframe interval (default: 1 keyframe per second)
    const interval = keyframeInterval ?? this.settings.fps;
    const keyFrame = frameIndex % interval === 0;
    this.encoder.encode(frame, { keyFrame });
    frame.close();

    // Yield to event loop periodically - use queueMicrotask for lower latency
    if (frameIndex % 30 === 0) {
      await new Promise<void>(resolve => queueMicrotask(() => resolve()));
    }
  }

  /**
   * Encode a VideoFrame directly (zero-copy path from OffscreenCanvas).
   * The caller is responsible for closing the frame after this returns.
   */
  async encodeVideoFrame(frame: VideoFrame, frameIndex: number, keyframeInterval?: number): Promise<void> {
    if (!this.encoder || this.isClosed) {
      throw new Error('Encoder not initialized or already closed');
    }

    // FPS-based keyframe interval (default: 1 keyframe per second)
    const interval = keyframeInterval ?? this.settings.fps;
    const keyFrame = frameIndex % interval === 0;
    this.encoder.encode(frame, { keyFrame });

    // Yield to event loop periodically
    if (frameIndex % 30 === 0) {
      await new Promise<void>(resolve => queueMicrotask(() => resolve()));
    }
  }

  addAudioChunks(audioResult: EncodedAudioResult): void {
    if (!this.muxer || !this.hasAudio) {
      log.warn('Cannot add audio: muxer not ready or audio not enabled');
      return;
    }

    log.debug(`Adding ${audioResult.chunks.length} audio chunks`);

    for (let i = 0; i < audioResult.chunks.length; i++) {
      const chunk = audioResult.chunks[i];
      const meta = audioResult.metadata[i];
      this.muxer.addAudioChunk(chunk, meta);
    }

    log.debug('Audio chunks added successfully');
  }

  async finish(): Promise<Blob> {
    if (!this.encoder || !this.muxer) {
      throw new Error('Encoder not initialized');
    }

    this.isClosed = true;

    // Flush all pending frames from the WebCodecs encoder
    await this.encoder.flush();
    this.encoder.close();

    // Finalize the muxer — this flushes the internal queue and writes the file
    await this.muxer.finalize();

    const buffer = this.muxer.getBuffer();
    const mimeType = this.containerFormat === 'webm' ? 'video/webm' : 'video/mp4';

    log.info(`Finished: ${this.encodedFrameCount} frames, ${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB (${this.containerFormat.toUpperCase()})`);
    return new Blob([buffer], { type: mimeType });
  }

  cancel(): void {
    if (this.encoder && !this.isClosed) {
      this.isClosed = true;
      try {
        this.encoder.close();
      } catch {}
      // Cancel any pending muxer flush
      if (this.muxer && this.muxer instanceof MediaBunnyMuxerAdapter) {
        this.muxer.cancel();
      }
    }
  }
}
