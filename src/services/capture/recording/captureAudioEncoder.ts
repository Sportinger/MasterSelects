import { AudioEncoderWrapper, type AudioCodec } from '../../../engine/audio';
import type { CaptureMuxer } from './captureMuxer';

interface CaptureAudioEncoderLike {
  readonly encodeQueueSize: number;
  configure(config: AudioEncoderConfig): void;
  encode(data: AudioData): void;
  flush(): Promise<void>;
  close(): void;
}

interface CaptureAudioEncoderConstructor {
  new(init: AudioEncoderInit): CaptureAudioEncoderLike;
  isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport>;
}

const AUDIO_CODEC_CANDIDATES: readonly { codec: AudioCodec; codecString: string }[] = [
  { codec: 'aac', codecString: 'mp4a.40.2' },
  { codec: 'opus', codecString: 'opus' },
];

export async function detectCaptureAudioCodec(options?: {
  sampleRate: number;
  numberOfChannels: number;
  bitrate: number;
  Encoder?: CaptureAudioEncoderConstructor;
}): Promise<{ codec: AudioCodec; codecString: string } | null> {
  if (!options) return AudioEncoderWrapper.detectSupportedCodec();
  const Encoder = options.Encoder ?? globalThis.AudioEncoder;
  if (!Encoder) return null;
  for (const candidate of AUDIO_CODEC_CANDIDATES) {
    const config: AudioEncoderConfig = {
      codec: candidate.codecString,
      sampleRate: options.sampleRate,
      numberOfChannels: options.numberOfChannels,
      bitrate: candidate.codec === 'opus' ? Math.min(options.bitrate, 192_000) : options.bitrate,
    };
    if ((await Encoder.isConfigSupported(config)).supported) return candidate;
  }
  return null;
}

export class CaptureAudioEncoder {
  private readonly options: {
    sampleRate: number;
    numberOfChannels: number;
    bitrate: number;
    muxer: Pick<CaptureMuxer, 'addAudioChunk'>;
    Encoder?: CaptureAudioEncoderConstructor;
    detectCodec?: () => Promise<{ codec: AudioCodec; codecString: string } | null>;
    onError?: (error: Error) => void;
  };
  private encoder: CaptureAudioEncoderLike | null = null;
  private outputError: unknown;
  private codec: AudioCodec = 'aac';

  constructor(options: CaptureAudioEncoder['options']) {
    this.options = options;
  }

  async initialize(): Promise<AudioCodec> {
    const Encoder = this.options.Encoder ?? globalThis.AudioEncoder;
    if (!Encoder) throw new Error('AudioEncoder is not available.');
    const detected = await (this.options.detectCodec
      ? this.options.detectCodec()
      : detectCaptureAudioCodec({
          sampleRate: this.options.sampleRate,
          numberOfChannels: this.options.numberOfChannels,
          bitrate: this.options.bitrate,
          Encoder,
        }));
    if (!detected) throw new Error('No supported WebCodecs capture audio encoder is available.');
    const config: AudioEncoderConfig = {
      codec: detected.codecString,
      sampleRate: this.options.sampleRate,
      numberOfChannels: this.options.numberOfChannels,
      bitrate: detected.codec === 'opus' ? Math.min(this.options.bitrate, 192_000) : this.options.bitrate,
    };
    if (!(await Encoder.isConfigSupported(config)).supported) throw new Error('The capture audio encoder configuration is unsupported.');
    this.codec = detected.codec;
    this.encoder = new Encoder({
      output: (chunk, metadata) => {
        void Promise.resolve().then(() => this.options.muxer.addAudioChunk(chunk, metadata))
          .catch(error => {
            this.outputError = error;
            this.options.onError?.(error instanceof Error ? error : new Error('Screen capture audio muxing failed.'));
          });
      },
      error: error => {
        this.outputError = error;
        this.options.onError?.(error);
      },
    });
    this.encoder.configure(config);
    return this.codec;
  }

  async encode(data: AudioData): Promise<void> {
    if (!this.encoder) throw new Error('Capture audio encoder is not initialized.');
    try {
      if (this.encoder.encodeQueueSize >= 8) await this.encoder.flush();
      this.encoder.encode(data);
    } finally {
      data.close();
    }
    if (this.outputError) throw this.outputError;
  }

  async flush(): Promise<void> {
    await this.encoder?.flush();
    if (this.outputError) throw this.outputError;
  }

  close(): void {
    this.encoder?.close();
    this.encoder = null;
  }
}
