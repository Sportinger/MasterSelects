// WebCodecs-based video player for hardware-accelerated decoding
// Bypasses browser VAAPI issues by using WebCodecs API directly
// With timeout fallback for problematic MP4 files

import * as MP4BoxModule from 'mp4box';
const MP4Box = (MP4BoxModule as any).default || MP4BoxModule;

// MP4Box types
interface MP4ArrayBuffer extends ArrayBuffer {
  fileStart: number;
}

interface Sample {
  number: number;
  track_id: number;
  data: ArrayBuffer;
  size: number;
  cts: number;
  dts: number;
  duration: number;
  is_sync: boolean;
  timescale: number;
}

interface MP4VideoTrack {
  id: number;
  codec: string;
  duration: number;
  timescale: number;
  nb_samples: number;
  video: { width: number; height: number };
}

interface MP4File {
  onReady: (info: { videoTracks: MP4VideoTrack[] }) => void;
  onSamples: (trackId: number, ref: any, samples: Sample[]) => void;
  onError: (error: string) => void;
  appendBuffer: (buffer: MP4ArrayBuffer) => number;
  start: () => void;
  flush: () => void;
  setExtractionOptions: (trackId: number, user: any, options: { nbSamples: number }) => void;
}

export interface WebCodecsPlayerOptions {
  loop?: boolean;
  onFrame?: (frame: VideoFrame) => void;
  onReady?: (width: number, height: number) => void;
  onError?: (error: Error) => void;
}

export class WebCodecsPlayer {
  private mp4File: MP4File | null = null;
  private decoder: VideoDecoder | null = null;
  private currentFrame: VideoFrame | null = null;
  private samples: Sample[] = [];
  private sampleIndex = 0;
  private isPlaying = false;
  private loop: boolean;
  private frameRate = 30;
  private frameInterval = 1000 / 30;
  private lastFrameTime = 0;
  private animationId: number | null = null;
  private videoTrack: MP4VideoTrack | null = null;
  private codecConfig: VideoDecoderConfig | null = null;

  public width = 0;
  public height = 0;
  public ready = false;

  private onFrame?: (frame: VideoFrame) => void;
  private onReady?: (width: number, height: number) => void;
  private onError?: (error: Error) => void;

  constructor(options: WebCodecsPlayerOptions = {}) {
    this.loop = options.loop ?? true;
    this.onFrame = options.onFrame;
    this.onReady = options.onReady;
    this.onError = options.onError;
  }

  async loadFile(file: File): Promise<void> {
    // Check WebCodecs support
    if (!('VideoDecoder' in window)) {
      throw new Error('WebCodecs API not supported in this browser');
    }

    const arrayBuffer = await file.arrayBuffer();
    await this.loadArrayBuffer(arrayBuffer);
  }

  async loadArrayBuffer(buffer: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      // Timeout if mp4box fails to parse (e.g., due to unusual metadata boxes)
      const timeout = setTimeout(() => {
        reject(new Error('MP4 parsing timeout - file may have unsupported metadata'));
      }, 2000);

      this.mp4File = MP4Box.createFile();

      this.mp4File.onReady = (info) => {
        // Don't clear timeout here - wait for onSamples to actually deliver frames
        const videoTrack = info.videoTracks[0];
        if (!videoTrack) {
          reject(new Error('No video track found in file'));
          return;
        }

        this.videoTrack = videoTrack;
        this.width = videoTrack.video.width;
        this.height = videoTrack.video.height;
        this.frameRate = videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale);
        this.frameInterval = 1000 / this.frameRate;

        // Build codec string
        const codec = this.getCodecString(videoTrack);

        this.codecConfig = {
          codec,
          codedWidth: videoTrack.video.width,
          codedHeight: videoTrack.video.height,
          hardwareAcceleration: 'prefer-hardware',
          optimizeForLatency: true,
        };

        // Check if codec is supported
        VideoDecoder.isConfigSupported(this.codecConfig).then((support) => {
          if (!support.supported) {
            reject(new Error(`Codec ${codec} not supported`));
            return;
          }

          console.log(`[WebCodecs] Codec ${codec} supported, config:`, support.config);
          this.initDecoder();

          // Set extraction options and start
          this.mp4File!.setExtractionOptions(videoTrack.id, null, {
            nbSamples: Infinity,
          });
          this.mp4File!.start();
        });
      };

      this.mp4File.onSamples = (trackId, ref, samples) => {
        this.samples.push(...samples);

        // Signal ready after first batch of samples
        if (!this.ready && this.samples.length > 0) {
          this.ready = true;
          clearTimeout(timeout);
          console.log(`[WebCodecs] READY: ${this.width}x${this.height} @ ${this.frameRate.toFixed(1)}fps, ${this.samples.length} samples`);
          this.onReady?.(this.width, this.height);
          resolve();
        }
      };

      this.mp4File.onError = (e) => {
        clearTimeout(timeout);
        const error = new Error(`MP4 parsing error: ${e}`);
        this.onError?.(error);
        reject(error);
      };

      // Feed the buffer to mp4box
      const mp4Buffer = buffer as MP4ArrayBuffer;
      mp4Buffer.fileStart = 0;
      this.mp4File.appendBuffer(mp4Buffer);
      this.mp4File.flush();
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
        // Close previous frame to prevent memory leak
        if (this.currentFrame) {
          this.currentFrame.close();
        }
        this.currentFrame = frame;
        this.onFrame?.(frame);
      },
      error: (e) => {
        console.error('VideoDecoder error:', e);
        this.onError?.(new Error(`Decoder error: ${e.message}`));
      },
    });

    this.decoder.configure(this.codecConfig);
  }

  play(): void {
    if (this.isPlaying || !this.ready) return;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.scheduleNextFrame();
  }

  pause(): void {
    this.isPlaying = false;
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
    if (!this.isPlaying) return;

    this.animationId = requestAnimationFrame((now) => {
      const elapsed = now - this.lastFrameTime;

      if (elapsed >= this.frameInterval) {
        this.decodeNextFrame();
        this.lastFrameTime = now - (elapsed % this.frameInterval);
      }

      this.scheduleNextFrame();
    });
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

  // Get current frame for WebGPU rendering
  getCurrentFrame(): VideoFrame | null {
    return this.currentFrame;
  }

  // Check if there's a valid frame available
  hasFrame(): boolean {
    return this.currentFrame !== null;
  }

  seek(timeSeconds: number): void {
    if (!this.videoTrack || this.samples.length === 0) return;

    const targetTime = timeSeconds * this.videoTrack.timescale;

    // Find the nearest keyframe before the target time
    let targetIndex = 0;
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].cts > targetTime) break;
      if (this.samples[i].is_sync) {
        targetIndex = i;
      }
    }

    this.sampleIndex = targetIndex;

    // Reset decoder and decode from keyframe
    if (this.decoder) {
      this.decoder.reset();
      this.decoder.configure(this.codecConfig!);
    }
  }

  get duration(): number {
    if (!this.videoTrack) return 0;
    return this.videoTrack.duration / this.videoTrack.timescale;
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

    if (this.currentFrame) {
      this.currentFrame.close();
      this.currentFrame = null;
    }

    this.mp4File = null;
    this.samples = [];
    this.ready = false;
  }
}
