// H.264 essence from MXF (XAVC-I / XAVC Long GOP / AVC-Intra) decoded with
// WebCodecs through the shared long-GOP provider (plan E2: WebCodecs first).

import { normalizeError } from '../codec/CodecFrameProviderBase';
import { getAvcCodecStringFromAnnexB } from './avcCodecString';
import {
  MxfGopFrameProvider,
  type GopDecoder,
  type GopDecoderCallbacks,
  type MxfGopFrameProviderOptions,
} from './MxfGopFrameProvider';
import type { MxfPacket, MxfPacketSource } from './MxfPacketSource';

export type MxfAvcFrameProviderOptions = MxfGopFrameProviderOptions;

class WebCodecsGopDecoder implements GopDecoder {
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

export class MxfAvcFrameProvider extends MxfGopFrameProvider<MxfAvcFrameProviderOptions> {
  readonly backend = 'mxf-avc' as const;
  protected readonly label = 'MXF AVC';
  protected readonly packetLabel = 'MXF AVC packet';
  private codecString = '';

  protected async createGopDecoder(source: MxfPacketSource, callbacks: GopDecoderCallbacks): Promise<GopDecoder> {
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
    this.codecString = codec;
    return new WebCodecsGopDecoder(support.config ?? config, callbacks);
  }

  protected describeDecoder() {
    return { codec: `mxf-avc:${this.codecString || this.options.codecId}`, hwAccel: 'webcodecs' };
  }
}

export async function createMxfAvcFrameProvider(
  options: MxfAvcFrameProviderOptions,
): Promise<MxfAvcFrameProvider | null> {
  const provider = new MxfAvcFrameProvider(options);
  try {
    await provider.load();
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    await provider.destroyAsync();
    return null;
  }
}
