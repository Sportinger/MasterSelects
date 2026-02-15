// WebCodecs-based video player for hardware-accelerated decoding
// Bypasses browser VAAPI issues by using WebCodecs API directly
// Export mode delegated to WebCodecsExportMode

import { Logger } from '../services/logger';
const log = Logger.create('WebCodecsPlayer');

import * as MP4BoxModule from 'mp4box';
const MP4Box = (MP4BoxModule as any).default || MP4BoxModule;

import type { Sample, MP4VideoTrack, MP4ArrayBuffer, MP4File } from './webCodecsTypes';
import { WebCodecsExportMode } from './WebCodecsExportMode';
import type { ExportModePlayer } from './WebCodecsExportMode';
import type { AudioTrackInfo } from './WebCodecsAudioPlayer';

export interface WebCodecsPlayerOptions {
  loop?: boolean;
  onFrame?: (frame: VideoFrame) => void;
  onReady?: (width: number, height: number) => void;
  onError?: (error: Error) => void;
}

export class WebCodecsPlayer implements ExportModePlayer {
  private mp4File: MP4File | null = null;
  private decoder: VideoDecoder | null = null;
  private currentFrame: VideoFrame | null = null;
  private samples: Sample[] = [];
  private sampleIndex = 0;
  private _isPlaying = false;
  private loop: boolean;
  private frameRate = 30;
  private frameInterval = 1000 / 30;
  private lastFrameTime = 0;
  private animationId: number | null = null;
  private videoTrack: MP4VideoTrack | null = null;
  private codecConfig: VideoDecoderConfig | null = null;

  // Audio track info extracted from MP4Box
  private audioTrackInfo: AudioTrackInfo | null = null;

  public width = 0;
  public height = 0;
  public ready = false;

  private onFrame?: (frame: VideoFrame) => void;
  private onReady?: (width: number, height: number) => void;
  private onError?: (error: Error) => void;

  // Export mode (delegated to WebCodecsExportMode)
  private exportMode: WebCodecsExportMode;
  private frameResolve: (() => void) | null = null;
  private decoderInitialized = false;
  private pendingDecodeFirstFrame = false;
  private loadResolve: (() => void) | null = null;

  // ExportModePlayer interface implementation
  getDecoder(): VideoDecoder | null { return this.decoder; }
  getSamples(): Sample[] { return this.samples; }
  getSampleIndex(): number { return this.sampleIndex; }
  setSampleIndex(index: number): void { this.sampleIndex = index; }
  getVideoTrackTimescale(): number | null { return this.videoTrack?.timescale ?? null; }
  getCodecConfig(): VideoDecoderConfig | null { return this.codecConfig; }
  getFrameRate(): number { return this.frameRate; }
  getCurrentFrame(): VideoFrame | null { return this.currentFrame; }
  setCurrentFrame(frame: VideoFrame | null): void { this.currentFrame = frame; }

  // Audio track info accessors
  hasAudioTrack(): boolean { return this.audioTrackInfo !== null; }
  getAudioTrackInfo(): AudioTrackInfo | null { return this.audioTrackInfo; }

  constructor(options: WebCodecsPlayerOptions = {}) {
    this.exportMode = new WebCodecsExportMode(this);
    this.loop = options.loop ?? true;
    this.onFrame = options.onFrame;
    this.onReady = options.onReady;
    this.onError = options.onError;
  }

  async loadFile(file: File): Promise<void> {
    if (!('VideoFrame' in window)) {
      throw new Error('VideoFrame API not supported in this browser');
    }
    if (!('VideoDecoder' in window)) {
      throw new Error('WebCodecs VideoDecoder not supported in this browser');
    }

    const arrayBuffer = await file.arrayBuffer();
    await this.loadArrayBuffer(arrayBuffer);
  }

  async loadArrayBuffer(buffer: ArrayBuffer): Promise<void> {
    const endLoad = log.time('loadArrayBuffer');
    return new Promise((resolve, reject) => {
      log.info(`Parsing MP4 (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)...`);

      // Reduced timeout - we only wait for codec info now, not all samples
      const timeout = setTimeout(() => {
        reject(new Error('MP4 parsing timeout - file may have unsupported metadata'));
      }, 5000);

      this.mp4File = MP4Box.createFile();
      const mp4File = this.mp4File!;
      let resolved = false;

      mp4File.onReady = (info) => {
        log.info(`MP4 onReady: ${info.videoTracks.length} video tracks, ${info.audioTracks?.length ?? 0} audio tracks`);
        const videoTrack = info.videoTracks[0];
        if (!videoTrack) {
          clearTimeout(timeout);
          reject(new Error('No video track found in file'));
          return;
        }

        this.videoTrack = videoTrack;

        // Extract audio track info if present
        if (info.audioTracks && info.audioTracks.length > 0) {
          const audioTrack = info.audioTracks[0];
          this.audioTrackInfo = {
            codec: audioTrack.codec,
            sampleRate: audioTrack.audio?.sample_rate ?? 48000,
            channels: audioTrack.audio?.channel_count ?? 2,
            duration: audioTrack.duration / audioTrack.timescale,
          };
          log.debug('Audio track found', this.audioTrackInfo);
        }
        this.width = videoTrack.video.width;
        this.height = videoTrack.video.height;
        this.frameRate = videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale);
        this.frameInterval = 1000 / this.frameRate;

        // Build codec string
        const codec = this.getCodecString(videoTrack);

        // Extract codec-specific description (avcC for H.264, hvcC for H.265, etc.)
        // This is REQUIRED for AVC/HEVC to work properly
        let description: ArrayBuffer | undefined;

        // Get the track structure from mp4File to access codec config boxes
        try {
          const trak = (mp4File as any).getTrackById(videoTrack.id);
          if (trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]) {
            const entry = trak.mdia.minf.stbl.stsd.entries[0];

            // Try to extract codec-specific configuration
            const configBox = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
            if (configBox) {
              const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
              configBox.write(stream);
              // The write() includes the box header (8 bytes: size + type), we need to skip it
              description = stream.buffer.slice(8);
              log.debug(`Extracted codec description: ${description!.byteLength} bytes from ${entry.avcC ? 'avcC' : entry.hvcC ? 'hvcC' : entry.vpcC ? 'vpcC' : 'av1C'}`);
            } else {
              log.warn('No codec config box found in sample entry', Object.keys(entry));
            }
          }
        } catch (e) {
          log.warn('Failed to extract codec description', e);
        }

        this.codecConfig = {
          codec,
          codedWidth: videoTrack.video.width,
          codedHeight: videoTrack.video.height,
          hardwareAcceleration: 'prefer-hardware',
          optimizeForLatency: true,
          description,
        };

        // Set extraction options and start BEFORE codec check (to not miss samples)
        mp4File.setExtractionOptions(videoTrack.id, null, {
          nbSamples: Infinity,
        });
        mp4File.start();
        log.debug(`Extraction started for track ${videoTrack.id}`);

        // Check if codec is supported (async, but extraction already started)
        VideoDecoder.isConfigSupported(this.codecConfig).then((support) => {
          if (!support.supported) {
            clearTimeout(timeout);
            reject(new Error(`Codec ${codec} not supported`));
            return;
          }

          log.debug(`Codec ${codec} supported`, support.config);
          this.initDecoder();

          // RESOLVE IMMEDIATELY after decoder is configured - don't wait for samples!
          // Samples will continue loading in background
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            endLoad();
            log.info(`Decoder configured: ${this.width}x${this.height} @ ${this.frameRate.toFixed(1)}fps (samples loading in background)`);
            resolve();
          }
        });
      };

      mp4File.onSamples = (_trackId, _ref, samples) => {
        this.samples.push(...samples);

        // Mark ready when we have samples and decoder (for playback mode)
        if (!this.ready && this.samples.length > 0 && this.decoderInitialized) {
          this.ready = true;
          log.info(`READY: ${this.samples.length} samples loaded so far`);

          this.decodeFirstFrame();
          this.onReady?.(this.width, this.height);
        } else if (!this.ready && this.samples.length > 0 && !this.decoderInitialized) {
          // Samples received but decoder not ready yet
          this.pendingDecodeFirstFrame = true;
        }
      };

      mp4File.onError = (e) => {
        clearTimeout(timeout);
        const error = new Error(`MP4 parsing error: ${e}`);
        this.onError?.(error);
        reject(error);
      };

      // Feed the buffer to mp4box
      const mp4Buffer = buffer as MP4ArrayBuffer;
      mp4Buffer.fileStart = 0;
      try {
        const appendedBytes = mp4File.appendBuffer(mp4Buffer);
        log.debug(`Appended ${appendedBytes} bytes to MP4Box`);
        mp4File.flush();
        log.debug('Flushed MP4Box, waiting for callbacks...');
      } catch (e) {
        clearTimeout(timeout);
        reject(new Error(`MP4Box appendBuffer failed: ${e}`));
      }
    });
  }

  private getCodecString(track: MP4VideoTrack): string {
    const dominated = track.codec;

    // Handle common codecs
    if (dominated.startsWith('avc1') || dominated.startsWith('avc3')) {
      // H.264/AVC
      return dominated;
    } else if (dominated.startsWith('hvc1') || dominated.startsWith('hev1')) {
      // H.265/HEVC
      return dominated;
    } else if (dominated.startsWith('vp09')) {
      // VP9
      return dominated;
    } else if (dominated.startsWith('av01')) {
      // AV1
      return dominated;
    }

    return dominated;
  }

  private initDecoder(): void {
    if (!this.codecConfig) return;

    this.decoder = new VideoDecoder({
      output: (frame) => {
        // In export mode, buffer ALL frames via export mode handler
        if (this.exportMode.isInExportMode) {
          this.exportMode.handleDecoderOutput(frame);
        } else {
          // Normal mode: just keep current frame
          if (this.currentFrame) {
            this.currentFrame.close();
          }
          this.currentFrame = frame;
          this.onFrame?.(frame);
        }

        // Resolve any pending frame wait
        if (this.frameResolve) {
          this.frameResolve();
          this.frameResolve = null;
        }
      },
      error: (e) => {
        log.error('VideoDecoder error', e);
        this.onError?.(new Error(`Decoder error: ${e.message}`));
      },
    });

    this.decoder.configure(this.codecConfig);
    this.decoderInitialized = true;

    // Handle any deferred first frame decode and resolve loadArrayBuffer promise
    if (this.pendingDecodeFirstFrame && this.samples.length > 0) {
      this.pendingDecodeFirstFrame = false;
      this.ready = true;
      log.info(`READY (deferred): ${this.width}x${this.height} @ ${this.frameRate.toFixed(1)}fps, ${this.samples.length} samples`);

      this.decodeFirstFrame();
      this.onReady?.(this.width, this.height);

      // Resolve the loadArrayBuffer promise
      if (this.loadResolve) {
        this.loadResolve();
        this.loadResolve = null;
      }
    }
  }

  play(): void {
    if (this._isPlaying || !this.ready) return;
    this._isPlaying = true;
    this.lastFrameTime = performance.now();
    this.scheduleNextFrame();
  }

  pause(): void {
    this._isPlaying = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  stop(): void {
    this.pause();
    this.sampleIndex = 0;

    if (this.currentFrame) {
      this.currentFrame.close();
      this.currentFrame = null;
    }
  }

  private scheduleNextFrame(): void {
    if (!this._isPlaying) return;

    this.animationId = requestAnimationFrame((now) => {
      const elapsed = now - this.lastFrameTime;

      if (elapsed >= this.frameInterval) {
        this.decodeNextFrame();
        this.lastFrameTime = now - (elapsed % this.frameInterval);
      }

      this.scheduleNextFrame();
    });
  }

  private decodeFirstFrame(): void {
    if (!this.decoder || this.samples.length === 0) return;

    // Decode the first keyframe to have an initial frame available
    const firstSample = this.samples[0];
    if (!firstSample.is_sync) return; // First frame should be a keyframe

    const chunk = new EncodedVideoChunk({
      type: 'key',
      timestamp: (firstSample.cts * 1_000_000) / firstSample.timescale,
      duration: (firstSample.duration * 1_000_000) / firstSample.timescale,
      data: firstSample.data,
    });

    try {
      this.decoder.decode(chunk);
      this.sampleIndex = 1;
    } catch {
      // Ignore decode errors on first frame
    }
  }

  private decodeNextFrame(): void {
    if (!this.decoder || this.samples.length === 0) return;

    // Get next sample
    if (this.sampleIndex >= this.samples.length) {
      if (this.loop) {
        this.sampleIndex = 0;
        // Reset decoder for loop
        this.decoder.reset();
        this.decoder.configure(this.codecConfig!);
      } else {
        this.pause();
        return;
      }
    }

    const sample = this.samples[this.sampleIndex];
    this.sampleIndex++;

    // Create EncodedVideoChunk from sample
    const chunk = new EncodedVideoChunk({
      type: sample.is_sync ? 'key' : 'delta',
      timestamp: (sample.cts * 1_000_000) / sample.timescale, // Convert to microseconds
      duration: (sample.duration * 1_000_000) / sample.timescale,
      data: sample.data,
    });

    // Decode
    try {
      this.decoder.decode(chunk);
    } catch {
      // Silently skip decode errors - can happen during seek or loop
    }
  }

  // Check if there's a valid frame available
  hasFrame(): boolean {
    return this.currentFrame !== null;
  }

  seek(timeSeconds: number): void {
    if (!this.videoTrack || this.samples.length === 0 || !this.decoder) return;

    const targetTime = timeSeconds * this.videoTrack.timescale;

    // Find sample with CTS closest to target time
    // IMPORTANT: Samples are in DECODE order (DTS), not presentation order (CTS)
    // due to B-frame reordering. We must search for closest CTS match.
    let targetIndex = 0;
    let closestDiff = Infinity;

    for (let i = 0; i < this.samples.length; i++) {
      const diff = Math.abs(this.samples[i].cts - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        targetIndex = i;
      }
    }

    // Find the nearest keyframe before the target sample (in decode order)
    let keyframeIndex = 0;
    for (let i = 0; i <= targetIndex; i++) {
      if (this.samples[i].is_sync) {
        keyframeIndex = i;
      }
    }

    // Reset decoder
    this.decoder.reset();
    this.decoder.configure(this.codecConfig!);

    // Decode from keyframe up to target frame to get correct frame
    for (let i = keyframeIndex; i <= targetIndex; i++) {
      const sample = this.samples[i];
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: (sample.cts * 1_000_000) / sample.timescale,
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });
      try {
        this.decoder.decode(chunk);
      } catch {
        // Skip decode errors
      }
    }

    this.sampleIndex = targetIndex + 1;
  }

  /**
   * Async seek that waits for the frame to be decoded
   * Use this for export where we need guaranteed frame accuracy
   */
  async seekAsync(timeSeconds: number): Promise<void> {
    if (!this.videoTrack || this.samples.length === 0 || !this.decoder) {
      return;
    }

    const targetTime = timeSeconds * this.videoTrack.timescale;

    // Find sample with CTS closest to target time
    // IMPORTANT: Samples are in DECODE order (DTS), not presentation order (CTS)
    // due to B-frame reordering. We must search for closest CTS match.
    let targetIndex = 0;
    let closestDiff = Infinity;

    for (let i = 0; i < this.samples.length; i++) {
      const diff = Math.abs(this.samples[i].cts - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        targetIndex = i;
      }
    }

    // Find the nearest keyframe before the target sample (in decode order)
    let keyframeIndex = 0;
    for (let i = 0; i <= targetIndex; i++) {
      if (this.samples[i].is_sync) {
        keyframeIndex = i;
      }
    }

    // Reset decoder
    this.decoder.reset();
    this.decoder.configure(this.codecConfig!);

    // Decode from keyframe up to target frame
    for (let i = keyframeIndex; i <= targetIndex; i++) {
      const sample = this.samples[i];
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: (sample.cts * 1_000_000) / sample.timescale,
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });
      try {
        this.decoder.decode(chunk);
      } catch {
        // Skip decode errors
      }
    }

    // Flush to ensure all frames are decoded
    await this.decoder.flush();

    this.sampleIndex = targetIndex + 1;
  }

  // ==================== EXPORT MODE (delegated to WebCodecsExportMode) ====================

  async prepareForSequentialExport(startTimeSeconds: number): Promise<void> {
    return this.exportMode.prepareForSequentialExport(startTimeSeconds);
  }

  async seekDuringExport(timeSeconds: number): Promise<void> {
    return this.exportMode.seekDuringExport(timeSeconds);
  }

  getCurrentSampleIndex(): number {
    return this.sampleIndex;
  }

  isExportMode(): boolean {
    return this.exportMode.isInExportMode;
  }

  endSequentialExport(): void {
    this.exportMode.endSequentialExport();
  }

  get duration(): number {
    if (!this.videoTrack) return 0;
    return this.videoTrack.duration / this.videoTrack.timescale;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get currentTime(): number {
    if (!this.videoTrack || this.samples.length === 0 || this.sampleIndex === 0) return 0;
    const sample = this.samples[Math.min(this.sampleIndex - 1, this.samples.length - 1)];
    return sample.cts / sample.timescale;
  }

  destroy(): void {
    this.stop();

    if (this.decoder) {
      this.decoder.close();
      this.decoder = null;
    }

    // Clean up export mode
    this.exportMode.destroy();

    if (this.currentFrame) {
      try {
        this.currentFrame.close();
      } catch {
        // Already closed
      }
      this.currentFrame = null;
    }

    this.mp4File = null;
    this.samples = [];
    this.ready = false;
  }
}
