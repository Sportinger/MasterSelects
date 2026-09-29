// MPEG-2 Long GOP MXF essence (XDCAM HD422 and similar) decoded by one
// stateful libavcodec WASM worker through the shared long-GOP provider.
// Long GOP is decoded serially per stream: no frame parallelism (plan phase 5).

import { normalizeError } from '../codec/CodecFrameProviderBase';
import { MxfGopEngine, type GopDecoder, type GopDecoderCallbacks } from './mxfGopEngine';
import {
  MxfGopFrameProvider,
  type GopFrameSource,
  type MxfGopFrameProviderOptions,
} from './MxfGopFrameProvider';
import { createLibavOpenRequest, LibavWorker } from './MxfLibavFrameProvider';
import type { MxfPacket, MxfPacketSource } from './MxfPacketSource';

export interface MxfLibavGopFrameProviderOptions extends MxfGopFrameProviderOptions {
  eightBit?: boolean;
}

class LibavGopDecoder implements GopDecoder {
  private readonly worker: LibavWorker;
  private nextDrainId = 1;

  constructor(worker: LibavWorker, callbacks: GopDecoderCallbacks) {
    this.worker = worker;
    worker.onStreamFrame = (frame) => callbacks.output(frame);
    worker.onStreamError = (error) => callbacks.error(error);
  }

  get queueSize(): number {
    return this.worker.queueSize;
  }

  decode(packet: MxfPacket): void {
    this.worker.feed(packet);
  }

  waitForCapacity(): Promise<void> {
    return this.worker.waitForFeedAck();
  }

  flush(): Promise<void> {
    return this.worker.drain(this.nextDrainId++);
  }

  reset(): void {
    this.worker.resetStream();
  }

  close(): void {
    this.worker.terminate();
  }
}

export class MxfLibavGopFrameProvider extends MxfGopFrameProvider<MxfLibavGopFrameProviderOptions> {
  readonly backend = 'mxf-libav' as const;
  protected readonly label = 'MXF MPEG-2 Long GOP';
  protected readonly packetLabel = 'MXF packet';

  protected async createFrameSource(source: MxfPacketSource): Promise<GopFrameSource> {
    // Decoding already runs in the libavcodec worker; the engine and reads stay here.
    const engine = new MxfGopEngine(source, this.label);
    await engine.attachDecoder(async (callbacks: GopDecoderCallbacks): Promise<GopDecoder> => {
      const worker = new LibavWorker(createLibavOpenRequest(source, 'mpeg2video', this.options.eightBit === true));
      try {
        await worker.ready();
      } catch (error) {
        worker.terminate();
        throw error;
      }
      return new LibavGopDecoder(worker, callbacks);
    });
    return engine;
  }

  protected describeDecoder() {
    return { codec: `mxf-libav:${this.options.codecId}`, hwAccel: 'wasm-worker' };
  }
}

export async function createMxfLibavGopFrameProvider(
  options: MxfLibavGopFrameProviderOptions,
): Promise<MxfLibavGopFrameProvider | null> {
  const provider = new MxfLibavGopFrameProvider(options);
  try {
    await provider.load();
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    await provider.destroyAsync();
    return null;
  }
}
