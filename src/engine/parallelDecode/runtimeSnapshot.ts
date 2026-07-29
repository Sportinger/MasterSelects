export interface ParallelDecodeClipRuntimeSnapshot {
  clipId: string;
  clipName: string;
  codec: string;
  decoderState: string;
  decodeQueueSize: number;
  hardwareAcceleration?: HardwareAcceleration;
  dimensions: {
    width: number;
    height: number;
  };
  sampleCount: number;
  sampleIndex: number;
  isDecoding: boolean;
  hasPendingDecode: boolean;
  frameBufferSize: number;
  estimatedBufferedFrameBytes: number;
  oldestBufferedTimeSeconds?: number;
  newestBufferedTimeSeconds?: number;
  lastDecodedTimeSeconds?: number;
  isNested?: boolean;
  parentClipId?: string;
}

export interface ParallelDecodeRuntimeSnapshot {
  isActive: boolean;
  frameToleranceUs: number;
  clipCount: number;
  registeredClipIds?: string[];
  totalBufferedFrames: number;
  estimatedBufferedFrameBytes: number;
  clips: ParallelDecodeClipRuntimeSnapshot[];
}

export function secondsFromTimestamp(timestamp: number): number | undefined {
  return Number.isFinite(timestamp) ? timestamp / 1_000_000 : undefined;
}

export function estimateDecodedFrameBytes(width: number, height: number, frameBufferSize: number): number {
  return Math.max(0, width * height * 4 * frameBufferSize);
}

export function createParallelDecodeRuntimeSnapshot(params: {
  isActive: boolean;
  frameToleranceUs: number;
  clips: ParallelDecodeClipRuntimeSnapshot[];
  registeredClipIds?: string[];
}): ParallelDecodeRuntimeSnapshot {
  return {
    isActive: params.isActive,
    frameToleranceUs: params.frameToleranceUs,
    clipCount: params.clips.length,
    registeredClipIds: params.registeredClipIds ?? params.clips.map(clip => clip.clipId),
    totalBufferedFrames: params.clips.reduce((sum, clip) => sum + clip.frameBufferSize, 0),
    estimatedBufferedFrameBytes: params.clips.reduce(
      (sum, clip) => sum + clip.estimatedBufferedFrameBytes,
      0
    ),
    clips: params.clips,
  };
}
