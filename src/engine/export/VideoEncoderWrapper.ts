// Video encoder wrapper using WebCodecs — muxing via MediaBunny adapter

import { Logger } from '../../services/logger';
import { MediaBunnyMuxerAdapter, type MuxerAdapter } from './MediaBunnyMuxerAdapter';

const log = Logger.create('VideoEncoder');
import { AudioEncoderWrapper, type AudioCodec, type EncodedAudioResult } from '../audio';
import type { ExportSettings, VideoCodec, ContainerFormat } from './types';
import { getCodecString, isCodecSupportedInContainer, getFallbackCodec } from './codecHelpers';
import { isMobileAppleWebKit } from '../../utils/mobileAppleWebKit';
import { resolveVideoEncoderBitrate } from './videoEncoderConfigPolicy';

/** Frame-rate hint used when an encoder rejects the real rate (see init). */
const HARDWARE_FRAMERATE_HINT = 30;

export class VideoEncoderWrapper {
  // VideoEncoder.encode() only enqueues work. Without backpressure each queued
  // 1080p RGBA VideoFrame can retain ~8.3 MB until the codec consumes it,
  // allowing a fast render loop to grow the renderer into multiple GB.
  private static readonly MAX_ENCODE_QUEUE_SIZE = 4;
  // Bound retained input surfaces by bytes rather than frame count. This keeps
  // 4K/8K exports within the same memory envelope as 1080p exports.
  private static readonly MAX_UNFLUSHED_INPUT_BYTES = 96 * 1024 * 1024;
  // Hardware encoders hold several input frames before the first output (lookahead).
  // Fewer frames in flight than that pipeline depth makes every new frame wait for the
  // codec, serializing render and encode. Keep at least this many in flight while the
  // retained surfaces stay under the hard byte ceiling (8K stays at two frames).
  private static readonly MIN_FRAMES_IN_FLIGHT = 8;
  private static readonly MAX_IN_FLIGHT_INPUT_BYTES = 384 * 1024 * 1024;
  // How long backpressure waits for encoded output before it falls back to flush().
  private static readonly OUTPUT_WAIT_MS = 1000;

  private encoder: VideoEncoder | null = null;
  private startEncoder: (() => void) | null = null;
  private muxer: MuxerAdapter | null = null;
  private settings: ExportSettings;
  private encodedFrameCount = 0;
  private framesSubmittedSinceFlush = 0;
  /** Frames handed to encode(); with encodedFrameCount this gives the frames the codec still holds. */
  private framesSubmitted = 0;
  private outputWaiters: Array<() => void> = [];
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

  async init(options: { deferVideoEncoder?: boolean } = {}): Promise<boolean> {
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
    const codecString = getCodecString(this.effectiveVideoCodec, {
      width: this.settings.width,
      height: this.settings.height,
      fps: this.settings.fps,
    });
    const bitratePolicy = resolveVideoEncoderBitrate(
      this.effectiveVideoCodec,
      this.settings.bitrate,
    );
    if (bitratePolicy.limited) {
      log.warn(
        `Limited iPadOS H.264 target bitrate to ${(bitratePolicy.bitrate / 1_000_000).toFixed(1)} Mbps ` +
        `from ${(this.settings.bitrate / 1_000_000).toFixed(1)} Mbps to satisfy AVC Level 4.0`,
      );
    }
    const requestedBitrateMode: VideoEncoderBitrateMode =
      this.settings.rateControl === 'cbr' ? 'constant' : 'variable';
    // Chrome's Windows hardware encoders advertise at most 30 fps above 1080p,
    // although they encode 60 fps timestamps fine. The framerate is only a
    // rate-control hint, so a second round hints 30 fps with the bitrate scaled
    // to keep the requested bits per second. Timestamps keep the real frame rate.
    const framerateRounds: Array<{ framerate: number; bitrate: number }> = [
      { framerate: this.settings.fps, bitrate: bitratePolicy.bitrate },
    ];
    if (this.settings.fps > HARDWARE_FRAMERATE_HINT) {
      framerateRounds.push({
        framerate: HARDWARE_FRAMERATE_HINT,
        bitrate: Math.round(bitratePolicy.bitrate * HARDWARE_FRAMERATE_HINT / this.settings.fps),
      });
    }
    // Safari may report realtime H.264 as supported, then close the encoder on
    // the first 1080p frame. Export is offline work, so prefer quality configs.
    const buildEncoderConfigCandidates = (
      bitrateMode: VideoEncoderBitrateMode,
      round: { framerate: number; bitrate: number },
    ): VideoEncoderConfig[] => {
      const base = {
        codec: codecString,
        width: this.settings.width,
        height: this.settings.height,
        bitrate: round.bitrate,
        framerate: round.framerate,
        bitrateMode,
        contentHint: 'motion',
      };
      return (['quality', 'realtime'] as const).flatMap((latencyMode) =>
        (['prefer-hardware', 'no-preference', 'prefer-software'] as const).map((hardwareAcceleration) => ({
          ...base,
          latencyMode,
          hardwareAcceleration,
        })));
    };
    const bitrateModesToTry: VideoEncoderBitrateMode[] = requestedBitrateMode === 'constant'
      ? ['constant', 'variable']
      : ['variable'];
    const supportedByRound: VideoEncoderConfig[][] = framerateRounds.map(() => []);

    try {
      for (const [roundIndex, round] of framerateRounds.entries()) {
        for (const bitrateMode of bitrateModesToTry) {
          for (const config of buildEncoderConfigCandidates(bitrateMode, round)) {
            const support = await VideoEncoder.isConfigSupported(config);
            if (support.supported) {
              supportedByRound[roundIndex].push(config);
            }
          }
        }
      }
    } catch (e) {
      log.error('Codec support check failed:', e);
      return false;
    }
    // Hardware encoders first (a hinted hardware config beats a software one at the real rate).
    const isHardware = (config: VideoEncoderConfig) => config.hardwareAcceleration === 'prefer-hardware';
    const supportedEncoderConfigs = [
      ...supportedByRound.flat().filter(isHardware),
      ...supportedByRound.flat().filter((config) => !isHardware(config)),
    ];

    if (supportedEncoderConfigs.length === 0) {
      log.error(`Codec not supported: ${codecString}`);
      return false;
    }

    if (this.isClosed) return false;

    // Create muxer (MediaBunny adapter)
    this.createMuxer();

    // Source/audio preparation can take minutes. Keep codec resources unallocated
    // until a frame is ready, while validating support and choosing audio up front.
    this.startEncoder = () => {
      // Create encoder
      this.encoder = new VideoEncoder({
        output: (chunk, meta) => {
          if (this.muxer) {
            // Synchronous queue — MediaBunnyMuxerAdapter buffers internally
            this.muxer.addVideoChunk(chunk, meta);
          }
          this.encodedFrameCount++;
          const waiters = this.outputWaiters; this.outputWaiters = [];
          for (const wake of waiters) wake();
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
        `Initialized: ${this.settings.width}x${this.settings.height} @ ${this.settings.fps}fps (${this.effectiveVideoCodec.toUpperCase()}, ${(bitratePolicy.bitrate / 1_000_000).toFixed(1)} Mbps, ${this.effectiveBitrateMode}, ${selectedEncoderConfig.latencyMode ?? 'default'} latency, ${selectedEncoderConfig.hardwareAcceleration ?? 'default'} hw${selectedEncoderConfig.framerate !== this.settings.fps ? `, ${selectedEncoderConfig.framerate}fps rate-control hint` : ''})`
      );
    };
    if (!options.deferVideoEncoder) this.ensureEncoderStarted();
    return true;
  }

  private ensureEncoderStarted(): void {
    if (this.isClosed) throw new Error('Encoder already closed');
    const start = this.startEncoder;
    if (start) {
      this.startEncoder = null;
      start();
    }
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
    this.ensureEncoderStarted();
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
      this.framesSubmitted++;
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
    this.ensureEncoderStarted();
    if (!this.encoder || this.isClosed) {
      throw new Error('Encoder not initialized or already closed');
    }
    const __w0 = performance.now(); // TEMP-PROFILE
    await this.waitForEncodeCapacity();
    const __w1 = performance.now(); // TEMP-PROFILE

    // FPS-based keyframe interval (default: 1 keyframe per second)
    const interval = keyframeInterval ?? this.settings.fps;
    const keyFrame = frameIndex % interval === 0;
    this.encoder.encode(frame, { keyFrame });
    { // TEMP-PROFILE
      const w = window as unknown as { __encPhases?: Record<string, number> };
      const a = (w.__encPhases ??= { frames: 0, wait: 0, encodeCall: 0, inFlightAtEncode: 0, queueAtEncode: 0 });
      a.frames++; a.wait += __w1 - __w0; a.encodeCall += performance.now() - __w1;
      a.inFlightAtEncode += this.framesSubmitted - this.encodedFrameCount; a.queueAtEncode += this.encoder.encodeQueueSize;
    }
    this.framesSubmittedSinceFlush++;
    this.framesSubmitted++;

    // WebKit can keep the GPU-backed canvas surface alive asynchronously after
    // encode() returns. Re-rendering into that surface before the encode task
    // finishes invalidates Safari's encoder. Drain each iPadOS zero-copy frame
    // before the export canvas is reused; pixels remain on the GPU throughout.
    if (isMobileAppleWebKit()) {
      await this.encoder.flush();
      this.framesSubmittedSinceFlush = 0;
      return;
    }

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
      Math.floor(VideoEncoderWrapper.MAX_UNFLUSHED_INPUT_BYTES / bytesPerFrame),
      Math.min(
        VideoEncoderWrapper.MIN_FRAMES_IN_FLIGHT,
        Math.floor(VideoEncoderWrapper.MAX_IN_FLIGHT_INPUT_BYTES / bytesPerFrame),
      ),
    );
    const inFlight = () => this.framesSubmitted - this.encodedFrameCount;
    const hasCapacity = () => encoder.encodeQueueSize < VideoEncoderWrapper.MAX_ENCODE_QUEUE_SIZE
      && inFlight() < maxFramesWithoutFlush;
    if (queueIsBelowLimit && hasCapacity()) {
      return;
    }

    // A dequeue event only means the control message left the JS queue; the codec
    // may still retain the frame's backing pixels. An encoded output chunk means
    // the frame was consumed, so wait for outputs first. Encoder flush() would
    // also release the surfaces, but hardware encoders restart the GOP after
    // every flush: frequent flushes (every 3-4 frames at 4K) turned exports into
    // all-keyframe streams far above the requested bitrate. The byte-based
    // in-flight limit keeps 4K/8K inside the same memory envelope as 1080p.
    const deadline = performance.now() + VideoEncoderWrapper.OUTPUT_WAIT_MS;
    while (!hasCapacity() && performance.now() < deadline) {
      await this.waitForEncodedOutput(deadline - performance.now());
      if (encoder.state === 'closed' || this.isClosed) {
        throw new Error('Encoder closed while applying export backpressure');
      }
    }
    if (hasCapacity()) return;
    // Codecs that hold frames until more input or a flush arrives still drain here.
    await encoder.flush();
    this.framesSubmittedSinceFlush = 0;
    if (encoder.state === 'closed' || this.isClosed) {
      throw new Error('Encoder closed while applying export backpressure');
    }
  }

  private waitForEncodedOutput(timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(done, Math.max(0, timeoutMs));
      function done() { clearTimeout(timer); resolve(); }
      this.outputWaiters.push(done);
    });
  }

  async flushPendingVideo(): Promise<void> {
    if (!this.encoder || this.isClosed) return;
    await this.encoder.flush();
    this.framesSubmittedSinceFlush = 0;
  }

  addAudioChunks(audioResult: EncodedAudioResult, maxDurationSeconds?: number): void {
    if (!this.muxer || !this.hasAudio) {
      log.warn('Cannot add audio: muxer not ready or audio not enabled');
      return;
    }

    log.debug(`Adding ${audioResult.chunks.length} audio chunks`);

    for (let i = 0; i < audioResult.chunks.length; i++) {
      const chunk = audioResult.chunks[i];
      // Keep complete audio packets only; compressed packets cannot be split.
      if (maxDurationSeconds !== undefined &&
        chunk.timestamp + (chunk.duration ?? 0) > Math.round(maxDurationSeconds * 1_000_000)) break;
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
    if (this.isClosed) return;
    this.isClosed = true;
    this.startEncoder = null;
    try { this.encoder?.close(); } catch {}
    this.framesSubmittedSinceFlush = 0;
    // Preparation may have created a muxer without allocating a codec yet.
    if (this.muxer instanceof MediaBunnyMuxerAdapter) this.muxer.cancel();
  }
}
