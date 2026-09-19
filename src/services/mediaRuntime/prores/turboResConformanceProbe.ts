import type { PixelFormat } from 'turbores';
import type { TurboResProResFourCC } from './turboResCodecIdentity';

export interface TurboResConformanceProbeOptions {
  fourCC: TurboResProResFourCC;
  packetData: Uint8Array;
  timestampMicroseconds?: number;
  durationMicroseconds?: number;
  concurrency?: number;
  useSharedMemory?: boolean;
  allowedOutputFormats?: PixelFormat[];
}

export interface TurboResConformanceProbeResult {
  supported: boolean;
  fourCC: TurboResProResFourCC;
  useSharedMemory: boolean;
  concurrency: number;
  pixelFormat?: PixelFormat;
  originalPixelFormat?: PixelFormat;
  scanType?: string;
  codedWidth?: number;
  codedHeight?: number;
  visibleWidth?: number;
  visibleHeight?: number;
  errorName?: string;
  errorMessage?: string;
}

function getProbeConcurrency(requested: number | undefined): number {
  if (requested !== undefined) return Math.max(1, Math.min(4, Math.floor(requested)));
  const hardwareConcurrency = typeof navigator === 'undefined'
    ? 2
    : navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(2, hardwareConcurrency - 1));
}

function getErrorResult(
  options: TurboResConformanceProbeOptions,
  useSharedMemory: boolean,
  concurrency: number,
  error: unknown,
): TurboResConformanceProbeResult {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    supported: false,
    fourCC: options.fourCC,
    useSharedMemory,
    concurrency,
    errorName: normalized.name,
    errorMessage: normalized.message,
  };
}

/**
 * Decodes one already-demuxed packet and constructs a WebCodecs VideoFrame.
 * This is a bounded capability probe, not the timeline playback provider.
 */
export async function probeTurboResPacketToVideoFrame(
  options: TurboResConformanceProbeOptions,
): Promise<TurboResConformanceProbeResult> {
  const concurrency = getProbeConcurrency(options.concurrency);
  let useSharedMemory = options.useSharedMemory ?? false;

  if (typeof VideoFrame === 'undefined') {
    return getErrorResult(
      options,
      useSharedMemory,
      concurrency,
      new Error('WebCodecs VideoFrame is unavailable'),
    );
  }

  const { Decoder, Frame } = await import('turbores');
  useSharedMemory = options.useSharedMemory ?? Decoder.canUseSharedMemory();
  let decoder: Awaited<ReturnType<typeof Decoder.create>> | null = null;
  const frame = new Frame();

  try {
    decoder = await Decoder.create({
      proresFourCc: options.fourCC,
      useSharedMemory,
      concurrency,
      allowedOutputFormats: options.allowedOutputFormats ?? ['I420'],
    });
    if (decoder instanceof Error) {
      return getErrorResult(options, useSharedMemory, concurrency, decoder);
    }

    const decoded = await decoder.decode(options.packetData, frame);
    if (decoded instanceof Error) {
      return getErrorResult(options, useSharedMemory, concurrency, decoded);
    }

    const colorSpace: VideoColorSpaceInit = {
      primaries: decoded.colorPrimariesString as VideoColorSpaceInit['primaries'],
      transfer: decoded.colorTransferString as VideoColorSpaceInit['transfer'],
      matrix: decoded.colorMatrixString as VideoColorSpaceInit['matrix'],
      fullRange: decoded.colorRangeFull,
    };
    const videoFrame = new VideoFrame(decoded.frameData, {
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
      timestamp: options.timestampMicroseconds ?? 0,
      duration: options.durationMicroseconds,
    });
    videoFrame.close();

    return {
      supported: true,
      fourCC: options.fourCC,
      useSharedMemory,
      concurrency,
      pixelFormat: decoded.pixelFormat,
      originalPixelFormat: decoded.originalPixelFormat,
      scanType: decoded.scanType,
      codedWidth: decoded.codedWidth,
      codedHeight: decoded.codedHeight,
      visibleWidth: decoded.visibleWidth,
      visibleHeight: decoded.visibleHeight,
    };
  } catch (error) {
    return getErrorResult(options, useSharedMemory, concurrency, error);
  } finally {
    if (!frame.isLocked) {
      try { frame.clear(); } catch { /* best-effort probe cleanup */ }
    }
    if (decoder && !(decoder instanceof Error)) {
      try { await decoder.close(); } catch { /* best-effort probe cleanup */ }
    }
  }
}
