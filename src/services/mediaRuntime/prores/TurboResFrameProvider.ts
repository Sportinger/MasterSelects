import type { PixelFormat } from 'turbores';
import {
  CodecFrameProviderBase,
  normalizeError,
  type CodecFrameProviderBaseOptions,
  type CodecPacketReader,
} from '../codec/CodecFrameProviderBase';
import type { TurboResPacket, TurboResPacketReader } from './TurboResPacketSource';
import { createProResPacketReader } from './proResPacketReader';
import type { TurboResProResFourCC } from './turboResCodecIdentity';
import { planTurboResRuntimePolicy } from './turboResResourceEstimate';
import { probeTurboResVideoFrameFormats } from './turboResVideoFrameCapabilities';

interface DecodedTurboResFrame {
  frameData: Uint8Array;
  codedWidth: number;
  codedHeight: number;
  visibleWidth: number;
  visibleHeight: number;
  pixelFormat: PixelFormat;
  originalPixelFormat: PixelFormat;
  colorPrimariesString?: string;
  colorTransferString?: string;
  colorMatrixString?: string;
  colorRangeFull: boolean;
  scanType: string;
}

interface TurboResFrameLike {
  readonly isLocked: boolean;
  clear(): unknown;
}

interface TurboResDecoderLike {
  readonly useSharedMemory: boolean;
  readonly concurrency: number;
  readonly decodeQueueSize: number;
  decode(packet: Uint8Array, frame: TurboResFrameLike): Promise<DecodedTurboResFrame | Error>;
  close(): Promise<void>;
}

interface TurboResModuleLike {
  Decoder: {
    canUseSharedMemory(): boolean;
    create(options: {
      proresFourCc: TurboResProResFourCC;
      useSharedMemory: boolean;
      concurrency: number;
      allowedOutputFormats: PixelFormat[];
    }): Promise<TurboResDecoderLike | Error>;
  };
  Frame: new () => TurboResFrameLike;
}

export interface TurboResFrameProviderOptions extends CodecFrameProviderBaseOptions {
  fourCC: TurboResProResFourCC;
  useSharedMemory?: boolean;
  concurrency?: number;
  allowedOutputFormats?: PixelFormat[];
  packetSourceFactory?: (
    file: File,
    expectedFourCC: TurboResProResFourCC,
  ) => Promise<TurboResPacketReader>;
  moduleLoader?: () => Promise<TurboResModuleLike>;
  outputFormatProbe?: (fourCC: TurboResProResFourCC) => PixelFormat[];
}

function packetDurationInit(packet: TurboResPacket): Pick<VideoFrameBufferInit, 'duration'> | object {
  return packet.microsecondDuration > 0
    ? { duration: packet.microsecondDuration }
    : {};
}

export class TurboResFrameProvider extends CodecFrameProviderBase<TurboResPacket, TurboResFrameProviderOptions> {
  readonly backend = 'turbores' as const;
  protected readonly label = 'TurboRes';
  protected readonly packetLabel = 'ProRes packet';

  private decoder: TurboResDecoderLike | null = null;
  private decodeFrame: TurboResFrameLike | null = null;
  private emittedPixelFormat: PixelFormat | null = null;
  private originalPixelFormat: PixelFormat | null = null;
  private useSharedMemory = false;
  private concurrency = 1;

  protected async initializeResources(): Promise<CodecPacketReader<TurboResPacket>> {
    const sourceFactory = this.options.packetSourceFactory
      ?? ((file, fourCC) => createProResPacketReader(file, fourCC));
    const moduleLoader = this.options.moduleLoader
      ?? (async () => await import('turbores') as unknown as TurboResModuleLike);
    const outputFormatProbe = this.options.outputFormatProbe
      ?? probeTurboResVideoFrameFormats;

    const packetSource = await this.withLoadTimeout(
      sourceFactory(this.options.file, this.options.fourCC),
      'demux initialization',
      (lateSource) => lateSource.dispose(),
    );
    this.packetSource = packetSource;
    const turboRes = await this.withLoadTimeout(moduleLoader(), 'module initialization');

    const allowedOutputFormats = this.options.allowedOutputFormats
      ?? outputFormatProbe(this.options.fourCC);
    if (allowedOutputFormats.length === 0) {
      throw new Error(`Browser accepts no alpha-safe TurboRes output for ${this.options.fourCC}`);
    }

    const sharedMemoryAvailable = turboRes.Decoder.canUseSharedMemory();
    const policy = planTurboResRuntimePolicy(
      this.options.policy ?? 'interactive',
      this.options.useSharedMemory ?? sharedMemoryAvailable,
    );
    this.useSharedMemory = policy.useSharedMemory;
    this.concurrency = this.options.concurrency === undefined
      ? policy.concurrency
      : Math.max(0, Math.min(4, Math.floor(this.options.concurrency)));

    const decoder = await this.withLoadTimeout(
      turboRes.Decoder.create({
        proresFourCc: this.options.fourCC,
        useSharedMemory: this.useSharedMemory,
        concurrency: this.concurrency,
        allowedOutputFormats,
      }),
      'decoder worker initialization',
      async (lateDecoder) => {
        if (!(lateDecoder instanceof Error)) await lateDecoder.close();
      },
    );
    if (decoder instanceof Error) throw decoder;

    this.decoder = decoder;
    this.decodeFrame = new turboRes.Frame();
    return packetSource;
  }

  protected hasDecoder(): boolean {
    return this.decoder !== null && this.decodeFrame !== null;
  }

  protected getBackendDebugInfo() {
    return {
      codec: `turbores:${this.options.fourCC}`,
      hwAccel: this.useSharedMemory ? 'wasm-shared-memory' : 'wasm-worker',
      decodeQueueSize: this.decoder?.decodeQueueSize ?? (this.isDecodePending() ? 1 : 0),
      emittedPixelFormat: this.emittedPixelFormat,
      originalPixelFormat: this.originalPixelFormat,
      concurrency: this.concurrency,
    };
  }

  protected async decodePacketToFrame(packet: TurboResPacket): Promise<VideoFrame> {
    const decoder = this.decoder;
    const decodeFrame = this.decodeFrame;
    if (!decoder || !decodeFrame) throw new Error('TurboRes decoder is unavailable');

    const decoded = await decoder.decode(packet.data, decodeFrame);
    if (decoded instanceof Error) throw decoded;
    if (decoded.scanType !== 'progressive') {
      throw new Error(`Interlaced ProRes is not enabled (${decoded.scanType})`);
    }
    const colorSpace: VideoColorSpaceInit = {
      primaries: decoded.colorPrimariesString as VideoColorSpaceInit['primaries'],
      transfer: decoded.colorTransferString as VideoColorSpaceInit['transfer'],
      matrix: decoded.colorMatrixString as VideoColorSpaceInit['matrix'],
      fullRange: decoded.colorRangeFull,
    };
    const outputFrame = new VideoFrame(decoded.frameData, {
      format: decoded.pixelFormat as VideoPixelFormat,
      codedWidth: decoded.codedWidth,
      codedHeight: decoded.codedHeight,
      visibleRect: {
        x: 0,
        y: 0,
        width: decoded.visibleWidth,
        height: decoded.visibleHeight,
      },
      colorSpace,
      timestamp: packet.microsecondTimestamp,
      ...packetDurationInit(packet),
    });
    this.emittedPixelFormat = decoded.pixelFormat;
    this.originalPixelFormat = decoded.originalPixelFormat;
    return outputFrame;
  }

  protected async releaseDecoderResources(): Promise<void> {
    const decoder = this.decoder;
    const frame = this.decodeFrame;
    this.decoder = null;
    this.decodeFrame = null;
    if (frame && !frame.isLocked) {
      try { frame.clear(); } catch { /* already cleared */ }
    }
    if (decoder) {
      try { await decoder.close(); } catch { /* best-effort close */ }
    }
  }
}

export async function createTurboResFrameProvider(
  options: TurboResFrameProviderOptions,
): Promise<TurboResFrameProvider | null> {
  const provider = new TurboResFrameProvider(options);
  try {
    await provider.load();
    return provider;
  } catch (error) {
    options.onError?.(normalizeError(error));
    await provider.destroyAsync();
    return null;
  }
}
