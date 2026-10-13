import { Logger } from '../../logger';
import { CodecFrameProviderBase, closeVideoFrame, normalizeError, type CodecFrameProviderBaseOptions } from '../codec/CodecFrameProviderBase';
import { GopDecodeEngine } from '../codec/GopDecodeEngine';
import type { GopPacket } from '../codec/GopPacketSource';
import { HevcPacketSource } from './HevcPacketSource';
import { NativeHevcDecoder, WasmHevcDecoder, supportsNativeHevc } from './hevcDecoders';

const log = Logger.create('HEVC');
// Laufzeitwissen gehört zur Dateiinstanz, nicht in gespeicherte Projekte.
const nativeFailures = new WeakMap<File, string>();

export interface HevcFrameProviderOptions extends CodecFrameProviderBaseOptions {
  eightBit?: boolean;
}

export class HevcFrameProvider extends CodecFrameProviderBase<GopPacket, HevcFrameProviderOptions> {
  readonly backend = 'hevc' as const;
  readonly frameCacheLimit = 0;
  protected readonly label = 'HEVC';
  protected readonly packetLabel = 'HEVC packet';
  private source: HevcPacketSource | null = null;
  private engine: GopDecodeEngine | null = null;
  private native = false;
  private fallbackReason: string | null = null;

  protected async initializeResources(): Promise<HevcPacketSource> {
    const source = await this.withLoadTimeout(HevcPacketSource.create(this.options.file), 'MP4-Index', late => late.dispose());
    this.source = source;
    this.packetSource = source;
    this.fallbackReason = nativeFailures.get(this.options.file) ?? null;
    this.native = !this.fallbackReason && await supportsNativeHevc(source.config);
    if (!this.native && !this.fallbackReason) this.fallbackReason = 'Der Browser unterstützt diese HEVC-Konfiguration nicht.';
    try { await this.openEngine(); }
    catch (error) {
      if (!this.native) throw error;
      this.fallbackReason = normalizeError(error).message;
      nativeFailures.set(this.options.file, this.fallbackReason);
      this.native = false;
      await this.openEngine();
    }
    const first = await source.getPacketAt(0);
    if (!first) throw new Error('HEVC enthält kein erstes Videobild.');
    // Ein positives isConfigSupported genügt nicht: ein echtes Bild ist Pflicht.
    const frame = await this.decodeWithFallback(first);
    closeVideoFrame(frame);
    return source;
  }

  protected hasDecoder(): boolean { return this.engine !== null; }
  protected getBackendDebugInfo() {
    return {
      codec: this.source?.config.codec ?? 'hevc',
      hwAccel: this.native ? 'webcodecs' : 'wasm-worker',
      decodeQueueSize: this.engine?.stats.decodeQueueSize ?? 0,
      fallbackReason: this.fallbackReason,
      gop: this.engine?.stats,
    };
  }

  private async openEngine(): Promise<void> {
    this.engine?.close();
    const source = this.source;
    if (!source) throw new Error('HEVC-Quelle wurde geschlossen.');
    const engine = new GopDecodeEngine(source, 'HEVC');
    this.engine = engine;
    try {
      await this.withLoadTimeout(engine.attachDecoder(async callbacks => this.native
        ? new NativeHevcDecoder(source.config, callbacks)
        : WasmHevcDecoder.create(source.config, callbacks, this.options.eightBit === true)), 'Decoder-Start');
    } catch (error) {
      engine.close();
      throw error;
    }
  }

  private async decodeWithFallback(packet: GopPacket): Promise<VideoFrame> {
    try {
      return await this.decodeBounded(packet);
    } catch (error) {
      if (!this.native || this.destroyed) throw error;
      this.fallbackReason = normalizeError(error).message;
      nativeFailures.set(this.options.file, this.fallbackReason);
      this.native = false;
      log.warn('Browser-HEVC liefert kein nutzbares Bild; wechsle zu WASM.', { reason: this.fallbackReason });
      await this.openEngine();
      return this.decodeBounded(packet);
    }
  }

  private async decodeBounded(packet: GopPacket): Promise<VideoFrame> {
    if (!this.engine) throw new Error('HEVC-Decoder wurde geschlossen.');
    return this.withLoadTimeout(this.engine.decodeFrame(packet.displayIndex), 'Videobild', closeVideoFrame);
  }

  protected decodePacketToFrame(packet: GopPacket): Promise<VideoFrame> { return this.decodeWithFallback(packet); }
  protected async releaseDecoderResources(): Promise<void> {
    this.engine?.close();
    this.engine = null;
    this.source = null;
  }
}

export async function createHevcFrameProvider(options: HevcFrameProviderOptions): Promise<HevcFrameProvider | null> {
  const provider = new HevcFrameProvider(options);
  try {
    await provider.load();
    log.info('HEVC-Decoder bereit', provider.getDebugInfo());
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    log.warn('HEVC-Decoder konnte nicht gestartet werden', { error: normalizeError(error).message });
    await provider.destroyAsync();
    return null;
  }
}
