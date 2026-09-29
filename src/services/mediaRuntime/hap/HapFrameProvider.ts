// HAP RuntimeFrameProvider on CodecFrameProviderBase (queue, epochs, prefetch,
// exact seek). Decode (section parse + Snappy + BC unpack) runs in a dedicated
// worker; the provider publishes ordinary RGBA VideoFrames to the existing runtime.

import {
  CodecFrameProviderBase,
  normalizeError,
  type CodecFrameProviderBaseOptions,
  type CodecPacketReader,
} from '../codec/CodecFrameProviderBase';
import type {
  HapDecodeWorkerRequest,
  HapDecodeWorkerResponse,
} from '../../../workers/hapDecodeWorker';
import type { HapVideoFourCC } from '../../hap/hapCodecIdentity';
import {
  HapPacketSource,
  type HapPacket,
  type HapPacketReader,
} from './HapPacketSource';

export interface HapFrameProviderOptions extends CodecFrameProviderBaseOptions {
  fourCC: HapVideoFourCC;
  packetSourceFactory?: (
    file: File,
    expectedFourCC: HapVideoFourCC,
  ) => Promise<HapPacketReader>;
}

/** Request/response client for the decode worker. Session-owned. */
class HapDecodeWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, {
    resolve: (value: { rgba: Uint8Array; hasAlpha: boolean }) => void;
    reject: (error: Error) => void;
  }>();
  private nextId = 1;
  private terminated = false;

  constructor() {
    this.worker = new Worker(new URL('../../../workers/hapDecodeWorker.ts', import.meta.url), {
      type: 'module',
      name: 'hap-decode',
    });
    this.worker.onmessage = (event: MessageEvent<HapDecodeWorkerResponse>) => {
      const response = event.data;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      if (response.ok) {
        entry.resolve({ rgba: new Uint8Array(response.rgba), hasAlpha: response.hasAlpha });
      } else {
        entry.reject(new Error(response.error));
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(`HAP decode worker error: ${event.message}`);
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
  }

  get queueSize(): number {
    return this.pending.size;
  }

  decode(
    packet: Uint8Array,
    fourCC: HapVideoFourCC,
    width: number,
    height: number,
  ): Promise<{ rgba: Uint8Array; hasAlpha: boolean }> {
    if (this.terminated) return Promise.reject(new Error('HAP decode worker is terminated'));
    const id = this.nextId++;
    // The demuxer may reuse packet storage; copy so the transfer stays safe.
    const copy = packet.slice();
    const request: HapDecodeWorkerRequest = {
      id,
      packet: copy.buffer as ArrayBuffer,
      fourCC,
      width,
      height,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(request, [request.packet]);
    });
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    const error = new Error('HAP decode worker terminated');
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}

export class HapFrameProvider extends CodecFrameProviderBase<HapPacket, HapFrameProviderOptions> {
  readonly backend = 'hap' as const;
  protected readonly label = 'HAP';
  protected readonly packetLabel = 'HAP packet';

  private decoder: HapDecodeWorkerClient | null = null;
  private lastFrameHadAlpha = false;

  protected async initializeResources(): Promise<CodecPacketReader<HapPacket>> {
    const sourceFactory = this.options.packetSourceFactory
      ?? ((file, fourCC) => HapPacketSource.create(file, fourCC));
    const packetSource = await this.withLoadTimeout(
      sourceFactory(this.options.file, this.options.fourCC),
      'demux initialization',
      (lateSource) => lateSource.dispose(),
    );
    this.packetSource = packetSource;
    this.decoder = new HapDecodeWorkerClient();
    return packetSource;
  }

  protected hasDecoder(): boolean {
    return this.decoder !== null;
  }

  protected getBackendDebugInfo() {
    return {
      codec: `hap:${this.options.fourCC}`,
      hwAccel: 'cpu-worker',
      decodeQueueSize: this.decoder?.queueSize ?? 0,
      lastFrameHadAlpha: this.lastFrameHadAlpha,
    };
  }

  protected async decodePacketToFrame(packet: HapPacket): Promise<VideoFrame> {
    const decoder = this.decoder;
    const metadata = this.packetSource?.metadata;
    if (!decoder || !metadata) throw new Error('HAP decoder is unavailable');

    const decoded = await decoder.decode(
      packet.data,
      this.options.fourCC,
      metadata.width,
      metadata.height,
    );
    const outputFrame = new VideoFrame(decoded.rgba, {
      format: 'RGBA',
      codedWidth: metadata.width,
      codedHeight: metadata.height,
      colorSpace: {
        primaries: 'bt709',
        transfer: 'iec61966-2-1',
        matrix: 'rgb',
        fullRange: true,
      },
      timestamp: packet.microsecondTimestamp,
      ...(packet.microsecondDuration > 0 ? { duration: packet.microsecondDuration } : {}),
    });
    this.lastFrameHadAlpha = decoded.hasAlpha;
    return outputFrame;
  }

  protected async releaseDecoderResources(): Promise<void> {
    const decoder = this.decoder;
    this.decoder = null;
    try { decoder?.terminate(); } catch { /* best-effort */ }
  }
}

export async function createHapFrameProvider(
  options: HapFrameProviderOptions,
): Promise<HapFrameProvider | null> {
  const provider = new HapFrameProvider(options);
  try {
    await provider.load();
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    await provider.destroyAsync();
    return null;
  }
}
