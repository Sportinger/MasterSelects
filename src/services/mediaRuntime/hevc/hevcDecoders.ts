import type { GopDecoder, GopDecoderCallbacks } from '../codec/GopDecodeEngine';
import type { GopPacket } from '../codec/GopPacketSource';
import { LibavWorker } from '../codec/LibavWorker';

/** Der Browser muss die konkrete Konfiguration unterstützen; kein Betriebssystem-Filter. */
export async function supportsNativeHevc(config: VideoDecoderConfig): Promise<boolean> {
  try { return typeof VideoDecoder !== 'undefined' && (await VideoDecoder.isConfigSupported(config)).supported === true; }
  catch { return false; }
}

export class NativeHevcDecoder implements GopDecoder {
  private readonly decoder: VideoDecoder;
  private readonly waiters = new Set<() => void>();

  private readonly config: VideoDecoderConfig;
  constructor(config: VideoDecoderConfig, callbacks: GopDecoderCallbacks) {
    this.config = config;
    this.decoder = new VideoDecoder(callbacks);
    this.decoder.addEventListener('dequeue', () => this.wake());
    try { this.decoder.configure(config); }
    catch (error) { this.close(); throw error; }
  }
  get queueSize(): number { return this.decoder.decodeQueueSize; }
  decode(packet: GopPacket): void {
    this.decoder.decode(new EncodedVideoChunk({
      type: packet.isKeyframe ? 'key' : 'delta', timestamp: packet.microsecondTimestamp,
      duration: Math.max(0, packet.microsecondDuration), data: packet.data,
    }));
  }
  waitForCapacity(): Promise<void> {
    return this.queueSize < 4 ? Promise.resolve() : this.waitForInputProgress();
  }
  waitForInputProgress(): Promise<void> {
    return new Promise(resolve => this.waiters.add(resolve));
  }
  flush(): Promise<void> { return this.decoder.flush(); }
  reset(): void { this.decoder.reset(); this.decoder.configure(this.config); this.wake(); }
  close(): void { if (this.decoder.state !== 'closed') this.decoder.close(); this.wake(); }
  private wake(): void { for (const resolve of this.waiters) resolve(); this.waiters.clear(); }
}

export class WasmHevcDecoder implements GopDecoder {
  private drainId = 1;
  private readonly worker: LibavWorker;
  private constructor(worker: LibavWorker) { this.worker = worker; }

  static async create(config: VideoDecoderConfig, callbacks: GopDecoderCallbacks, eightBit: boolean): Promise<WasmHevcDecoder> {
    const raw = config.description;
    const description = raw ? new Uint8Array(ArrayBuffer.isView(raw)
      ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : new Uint8Array(raw)) : undefined;
    const worker = new LibavWorker({
      type: 'open', codec: 'hevc', description, eightBit, visibleRect: null,
      colorMatrix: 'bt709', colorSpace: config.colorSpace, frameDurationUs: 0, deinterlace: false,
    });
    worker.onStreamFrame = callbacks.output;
    worker.onStreamError = callbacks.error;
    try { await worker.ready(); return new WasmHevcDecoder(worker); }
    catch (error) { worker.terminate(); throw error; }
  }
  get queueSize(): number { return this.worker.queueSize; }
  decode(packet: GopPacket): void { this.worker.feed(packet); }
  waitForCapacity(): Promise<void> { return this.worker.waitForFeedAck(); }
  waitForInputProgress(): Promise<void> { return this.worker.waitForFeedAck(); }
  flush(): Promise<void> { return this.worker.drain(this.drainId++); }
  reset(): void { this.worker.resetStream(); }
  close(): void { this.worker.terminate(); }
}
