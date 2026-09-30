// WebCodecs adapter for MxfGopEngine (H.264 essence from MXF; plan E2: WebCodecs first).

import { normalizeError } from '../codec/CodecFrameProviderBase';
import { getAvcCodecStringFromAnnexB } from './avcCodecString';
import type { GopDecoder, GopDecoderCallbacks } from './mxfGopEngine';
import type { MxfPacket, MxfPacketSource } from './MxfPacketSource';

export class WebCodecsGopDecoder implements GopDecoder {
  private decoder: VideoDecoder;
  private readonly config: VideoDecoderConfig;
  private readonly callbacks: GopDecoderCallbacks;

  constructor(config: VideoDecoderConfig, callbacks: GopDecoderCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.decoder = this.createDecoder();
  }

  get queueSize(): number {
    return this.decoder.decodeQueueSize;
  }

  decode(packet: MxfPacket): void {
    this.decoder.decode(new EncodedVideoChunk({
      type: packet.isKeyframe ? 'key' : 'delta',
      timestamp: packet.microsecondTimestamp,
      duration: packet.microsecondDuration,
      data: packet.data,
    }));
  }

  waitForCapacity(): Promise<void> {
    return new Promise((resolve) => this.decoder.addEventListener('dequeue', () => resolve(), { once: true }));
  }

  flush(): Promise<void> {
    return this.decoder.flush();
  }

  reset(): void {
    if (this.decoder.state === 'closed') {
      this.decoder = this.createDecoder();
      return;
    }
    this.decoder.reset();
    this.decoder.configure(this.config);
  }

  restartAtKey(): Promise<void> {
    if (this.decoder.state !== 'configured') {
      this.reset();
      return Promise.resolve();
    }
    // After flush() the decoder requires a key chunk, which is where the engine resumes.
    return this.decoder.flush();
  }

  close(): void {
    if (this.decoder.state !== 'closed') this.decoder.close();
  }

  private createDecoder(): VideoDecoder {
    const decoder = new VideoDecoder({
      output: (frame) => this.callbacks.output(frame),
      error: (error) => this.callbacks.error(normalizeError(error)),
    });
    decoder.configure(this.config);
    return decoder;
  }
}

/** Builds a supported decoder config from the in-band SPS of the first key frame. */
export async function createAvcDecoderConfig(source: MxfPacketSource): Promise<VideoDecoderConfig> {
  if (typeof VideoDecoder === 'undefined') throw new Error('WebCodecs VideoDecoder is unavailable');
  const firstKey = await source.getPacketByStoredIndex(source.keyframeStoredIndexFor(0));
  const codec = firstKey ? getAvcCodecStringFromAnnexB(firstKey.data) : null;
  if (!codec) throw new Error('MXF AVC essence carries no in-band SPS');
  const meta = source.metadata;
  const config: VideoDecoderConfig = {
    codec,
    codedWidth: meta.codedWidth || meta.width,
    codedHeight: meta.codedHeight || meta.height,
    optimizeForLatency: true,
  };
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) throw new Error(`Browser cannot decode ${codec} (${meta.width}x${meta.height})`);
  return support.config ?? config;
}
