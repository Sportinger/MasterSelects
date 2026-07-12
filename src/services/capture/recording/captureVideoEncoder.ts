import { getCodecString } from '../../../engine/export/codecHelpers';
import type { CaptureMuxer } from './captureMuxer';

interface CaptureVideoEncoderLike {
  readonly encodeQueueSize: number;
  configure(config: VideoEncoderConfig): void;
  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void;
  flush(): Promise<void>;
  close(): void;
}

interface CaptureVideoEncoderConstructor {
  new(init: VideoEncoderInit): CaptureVideoEncoderLike;
  isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
}

export class CaptureVideoEncoder {
  private readonly options: {
    width: number;
    height: number;
    fps: number;
    bitrate: number;
    muxer: Pick<CaptureMuxer, 'addVideoChunk'> & Partial<Pick<CaptureMuxer, 'canAcceptVideoFrame'>>;
    maxEncodeQueueSize?: number;
    Encoder?: CaptureVideoEncoderConstructor;
    onError?: (error: Error) => void;
  };
  private encoder: CaptureVideoEncoderLike | null = null;
  private droppedFrames = 0;
  private lastKeyframeTimestamp = -Infinity;
  private outputError: unknown;

  constructor(options: {
    width: number;
    height: number;
    fps: number;
    bitrate: number;
    muxer: Pick<CaptureMuxer, 'addVideoChunk'> & Partial<Pick<CaptureMuxer, 'canAcceptVideoFrame'>>;
    maxEncodeQueueSize?: number;
    Encoder?: CaptureVideoEncoderConstructor;
    onError?: (error: Error) => void;
  }) {
    this.options = options;
  }

  async initialize(): Promise<VideoEncoderConfig> {
    const Encoder = this.options.Encoder ?? globalThis.VideoEncoder;
    if (!Encoder) throw new Error('VideoEncoder is not available.');
    const base = {
      codec: getCodecString('h264'),
      width: this.options.width,
      height: this.options.height,
      bitrate: this.options.bitrate,
      framerate: this.options.fps,
      latencyMode: 'realtime' as const,
      contentHint: 'detail' as const,
    };
    const candidates: VideoEncoderConfig[] = [
      { ...base, hardwareAcceleration: 'prefer-hardware' },
      { ...base, hardwareAcceleration: 'no-preference' },
      { ...base, hardwareAcceleration: 'prefer-software' },
    ];
    let selected: VideoEncoderConfig | undefined;
    for (const candidate of candidates) {
      if ((await Encoder.isConfigSupported(candidate)).supported) {
        selected = candidate;
        break;
      }
    }
    if (!selected) throw new Error('No realtime H.264 capture encoder is supported.');
    this.encoder = new Encoder({
      output: (chunk, metadata) => {
        void this.options.muxer.addVideoChunk(chunk, metadata).catch(error => {
          this.outputError = error;
          this.options.onError?.(error instanceof Error ? error : new Error('Screen capture video muxing failed.'));
        });
      },
      error: error => {
        this.outputError = error;
        this.options.onError?.(error);
      },
    });
    this.encoder.configure(selected);
    return selected;
  }

  encode(frame: VideoFrame): boolean {
    if (!this.encoder) throw new Error('Capture video encoder is not initialized.');
    if (this.encoder.encodeQueueSize >= (this.options.maxEncodeQueueSize ?? 8)
      || this.options.muxer.canAcceptVideoFrame?.() === false) {
      this.droppedFrames += 1;
      return false;
    }
    const keyFrame = frame.timestamp - this.lastKeyframeTimestamp >= 1_000_000;
    if (keyFrame) this.lastKeyframeTimestamp = frame.timestamp;
    this.encoder.encode(frame, { keyFrame });
    return true;
  }

  async flush(): Promise<void> {
    if (!this.encoder) return;
    await this.encoder.flush();
    if (this.outputError) throw this.outputError;
  }

  close(): void {
    this.encoder?.close();
    this.encoder = null;
  }

  getStats(): { encodeQueueSize: number; droppedFrames: number } {
    return { encodeQueueSize: this.encoder?.encodeQueueSize ?? 0, droppedFrames: this.droppedFrames };
  }
}
