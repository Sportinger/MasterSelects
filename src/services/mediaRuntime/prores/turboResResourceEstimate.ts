import type { PixelFormat } from 'turbores';
import type { DecodeSessionPolicy } from '../types';
import { estimatePlanarFrameBytes } from './turboResVideoFrameCapabilities';

export const TURBORES_BLOB_CACHE_BYTES = 8 * 1024 * 1024;

export interface TurboResRuntimePolicy {
  concurrency: number;
  useSharedMemory: boolean;
}

export interface TurboResResourceEstimate {
  heapBytes: number;
  decodedFrameBytes: number;
  framePoolSize: number;
  workerCount: number;
}

export function planTurboResRuntimePolicy(
  policy: DecodeSessionPolicy,
  sharedMemoryAvailable: boolean,
  hardwareConcurrency = typeof navigator === 'undefined'
    ? 2
    : navigator.hardwareConcurrency || 2,
): TurboResRuntimePolicy {
  const availableAfterUiReserve = Math.max(1, Math.floor(hardwareConcurrency) - 2);
  const policyLimit = policy === 'interactive'
    ? 4
    : policy === 'export'
      ? 4
      : 2;
  const concurrency = Math.max(1, Math.min(policyLimit, availableAfterUiReserve));
  return {
    concurrency: sharedMemoryAvailable ? concurrency : 1,
    useSharedMemory: sharedMemoryAvailable,
  };
}

export function estimateTurboResResources(options: {
  width: number;
  height: number;
  pixelFormat: PixelFormat;
  concurrency: number;
  useSharedMemory: boolean;
}): TurboResResourceEstimate {
  const decodedFrameBytes = estimatePlanarFrameBytes(
    options.width,
    options.height,
    options.pixelFormat,
  );
  const framePoolSize = options.useSharedMemory
    ? 2
    : Math.max(1, options.concurrency);
  const workerCount = Math.max(1, options.concurrency);
  const decoderWorkingBytes = decodedFrameBytes * (options.useSharedMemory ? 2 : workerCount + 1);
  return {
    decodedFrameBytes,
    framePoolSize,
    workerCount,
    heapBytes: TURBORES_BLOB_CACHE_BYTES
      + decoderWorkingBytes
      + decodedFrameBytes * (framePoolSize + 1),
  };
}
