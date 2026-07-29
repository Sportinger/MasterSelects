// Video encoder wrapper using WebCodecs — muxing via MediaBunny adapter

import { Logger } from '../../services/logger';
import { MediaBunnyMuxerAdapter, type MuxerAdapter } from './MediaBunnyMuxerAdapter';

const log = Logger.create('VideoEncoder');
import { AudioEncoderWrapper, type AudioCodec, type EncodedAudioResult } from '../audio';
import type { ExportSettings, VideoCodec, ContainerFormat } from './types';
import { getCodecString, isCodecSupportedInContainer, getFallbackCodec } from './codecHelpers';

export class VideoEncoderWrapper {
  // VideoEncoder.encode() only enqueues work. Without backpressure each queued
  // 1080p RGBA VideoFrame can retain ~8.3 MB until the codec consumes it,
  // allowing a fast render loop to grow the renderer into multiple GB.
  private static readonly MAX_ENCODE_QUEUE_SIZE = 4;
  // Bound retained input surfaces by bytes rather than frame count. This keeps
  // 4K/8K exports within the same memory envelope as 1080p exports.
  private static readonly MAX_UNFLUSHED_INPUT_BYTES = 96 * 1024 * 1024;

  private encoder: VideoEncoder | null = null;
  private muxer: MuxerAdapter | null = null;
  private settings: ExportSettings;
  private encodedFrameCount = 0;
  private framesSubmittedSinceFlush = 0;
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
    // Safari may report realtime H.264 as supported, then close the encoder on
    // the first 1080p frame. Export is offline work, so prefer quality configs.
    const buildEncoderConfigCandidates = (bitrateMode: VideoEncoderBitrateMode): VideoEncoderConfig[] => [
      {
        ...supportCheckConfig,
        latencyMode: 'quality',
        hardwareAcceleration: 'prefer-hardware',
        bitrateMode,
        contentHint: 'motion',
      },
      {
        ...supportCheckConfig,
        latencyMode: 'quality',
        hardwareAcceleration: 'no-preference',
        bitrateMode,
        contentHint: 'motion',
      },
      {
        ...supportCheckConfig,
        latencyMode: 'quality',
        hardwareAcceleration: 'prefer-software',
        bitrateMode,
        contentHint: 'motion',
      },
      {
        ...supportCheckConfig,
        latencyMode: 'realtime',
        hardwareAcceleration: 'prefer-hardware',
        bitrateMode,
        contentHint: 'motion',
      },
      {
        ...supportCheckConfig,
        latencyMode: 'realtime',
        hardwareAcceleration: 'no-preference',
        bitrateMode,
        contentHint: 'motion',
      },
      {
        ...supportCheckConfig,
        latencyMode: 'realtime',
        hardwareAcceleration: 'prefer-software',
        bitrateMode,
        contentHint: 'motion',
      },
    ];
    const bitrateModesToTry: VideoEncoderBitrateMode[] = requestedBitrateMode === 'constant'
      ? ['constant', 'variable']
      : ['variable'];
    const supportedEncoderConfigs: VideoEncoderConfig[] = [];

    try {
      for (const bitrateMode of bitrateModesToTry) {
        for (const config of buildEncoderConfigCandidates(bitrateMode)) {
          const support = await VideoEncoder.isConfigSupported(config);
          if (support.supported) {
            supportedEncoderConfigs.push(config);
          }
        }
      }
    } catch (e) {
      log.error('Codec support check failed:', e);
      return false;
    }

    if (supportedEncoderConfigs.length === 0) {
      log.error(`Codec not supported: ${codecString}`);
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

    let selectedEncoderConfig: VideoEncoderConfig | null = null;

    for (const config of supportedEncoderConfigs) {
      try {
        this.encoder.configure(config);
        selectedEncoderConfig = config;
        this.effectiveBitrateMode = config.bitrateMode ?? 'variable';
        break;
      } catch (error) {
        log.warn(
          `Encoder configure failed for ${config.latencyMode ?? 'default'} / ${config.hardwareAcceleration ?? 'default'} / ${config.bitrateMode ?? 'default'}, trying next config`,
          error
        );
      }
    }

    if (!selectedEncoderConfig) {
      throw new Error(`Failed to configure encoder for codec ${codecString}`);
    }

    if (requestedBitrateMode !== this.effectiveBitrateMode) {
      log.warn(`Requested ${requestedBitrateMode} bitrate mode is not supported for this encoder config; using ${this.effectiveBitrateMode}`);
    }

    log.info(
      `Initialized: ${this.settings.width}x${this.settings.height} @ ${this.settings.fps}fps (${this.effectiveVideoCodec.toUpperCase()}, ${(this.settings.bitrate / 1_000_000).toFixed(1)} Mbps, ${this.effectiveBitrateMode}, ${selectedEncoderConfig.latencyMode ?? 'default'} latency, ${selectedEncoderConfig.hardwareAcceleration ?? 'default'} hw)`
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
    await this.waitForEncodeCapacity();

    const timestampMicros = Math.round(frameIndex * (1_000_000 / this.settings.fps));
    const durationMicros = Math.round(1_000_000 / this.settings.fps);
    const expectedByteLength = this.settings.width * this.settings.height * 4;
    if (pixels.byteLength !== expectedByteLength) {
      throw new Error(
        `Export frame buffer size mismatch at frame ${frameIndex}: ` +
        `received ${pixels.byteLength} RGBA bytes, expected ${expectedByteLength} ` +
        `for ${this.settings.width}x${this.settings.height}.`
      );
    }

    // Keep the exact view bounds. A subarray's backing buffer can contain
    // unrelated bytes before or after the RGBA frame.
    const frameData = pixels.byteOffset === 0 && pixels.byteLength === pixels.buffer.byteLength
      ? pixels.buffer
      : pixels.slice().buffer;
    const frame = new VideoFrame(frameData, {
      format: 'RGBA',
      codedWidth: this.settings.width,
      codedHeight: this.settings.height,
      timestamp: timestampMicros,
      duration: durationMicros,
    });

    // FPS-based keyframe interval (default: 1 keyframe per second)
    const interval = keyframeInterval ?? this.settings.fps;
    const keyFrame = frameIndex % interval === 0;
    try {
      this.encoder.encode(frame, { keyFrame });
      this.framesSubmittedSinceFlush++;
    } finally {
      frame.close();
    }

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
    await this.waitForEncodeCapacity();

    // FPS-based keyframe interval (default: 1 keyframe per second)
    const interval = keyframeInterval ?? this.settings.fps;
    const keyFrame = frameIndex % interval === 0;
    this.encoder.encode(frame, { keyFrame });
    this.framesSubmittedSinceFlush++;

    // Yield to event loop periodically
    if (frameIndex % 30 === 0) {
      await new Promise<void>(resolve => queueMicrotask(() => resolve()));
    }
  }

  getEncodeQueueSize(): number {
    return this.encoder?.encodeQueueSize ?? 0;
  }

  private async waitForEncodeCapacity(): Promise<void> {
    const encoder = this.encoder;
    if (!encoder || this.isClosed) {
      throw new Error('Encoder not initialized or already closed');
    }
    const queueIsBelowLimit =
      encoder.encodeQueueSize < VideoEncoderWrapper.MAX_ENCODE_QUEUE_SIZE;
    const bytesPerFrame = this.settings.width * this.settings.height * 4;
    const maxFramesWithoutFlush = Math.max(
      1,
      Math.floor(VideoEncoderWrapper.MAX_UNFLUSHED_INPUT_BYTES / bytesPerFrame)
    );
    const submittedFramesAreBelowLimit =
      this.framesSubmittedSinceFlush < maxFramesWithoutFlush;
    if (queueIsBelowLimit && submittedFramesAreBelowLimit) {
      return;
    }

    // flush() is deliberately used instead of merely waiting for a dequeue
    // event: dequeue means the control message left the JS queue, but the codec
    // may still retain the frame's backing pixels. The submitted-frame limit is
    // essential for Chromium, where encodeQueueSize often returns to zero while
    // full-resolution input surfaces remain owned by the codec. The byte-based
    // boundary drains after 3 frames at 4K and 12 frames at 1080p.
    await encoder.flush();
    this.framesSubmittedSinceFlush = 0;
    if (encoder.state === 'closed' || this.isClosed) {
      throw new Error('Encoder closed while applying export backpressure');
    }
  }

  async flushPendingVideo(): Promise<void> {
    if (!this.encoder || this.isClosed) return;
    await this.encoder.flush();
    this.framesSubmittedSinceFlush = 0;
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
    this.framesSubmittedSinceFlush = 0;
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
      this.framesSubmittedSinceFlush = 0;
      // Cancel any pending muxer flush
      if (this.muxer && this.muxer instanceof MediaBunnyMuxerAdapter) {
        this.muxer.cancel();
      }
    }
  }
}
