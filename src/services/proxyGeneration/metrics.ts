export interface ProxyGenerationMetrics {
  demuxMs: number;
  decodeFeedMs: number;
  decodeWallMs: number;
  decoderFlushMs: number;
  drawMs: number;
  jpegMs: number;
  saveMs: number;
  backpressureMs: number;
  backpressureWaits: number;
  maxPendingFrames: number;
  decodedOutputFrames: number;
  savedBytes: number;
}

export function createMetrics(): ProxyGenerationMetrics {
  return {
    demuxMs: 0,
    decodeFeedMs: 0,
    decodeWallMs: 0,
    decoderFlushMs: 0,
    drawMs: 0,
    jpegMs: 0,
    saveMs: 0,
    backpressureMs: 0,
    backpressureWaits: 0,
    maxPendingFrames: 0,
    decodedOutputFrames: 0,
    savedBytes: 0,
  };
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

interface ProxyGenerationLogger {
  info(message: string, data?: unknown): void;
}

export function logProxyPerformance(
  log: ProxyGenerationLogger,
  totalMs: number,
  processedFrames: number,
  totalFrames: number,
  metrics: ProxyGenerationMetrics
): void {
  const encodedFrames = Math.max(1, processedFrames);

  log.info('Performance', {
    frames: `${processedFrames}/${totalFrames}`,
    total: formatMs(totalMs),
    demux: formatMs(metrics.demuxMs),
    decodeWall: formatMs(metrics.decodeWallMs),
    decodeFeed: formatMs(metrics.decodeFeedMs),
    decoderFlush: formatMs(metrics.decoderFlushMs),
    drawImage: formatMs(metrics.drawMs),
    jpegEncode: formatMs(metrics.jpegMs),
    save: formatMs(metrics.saveMs),
    backpressure: formatMs(metrics.backpressureMs),
    backpressureWaits: metrics.backpressureWaits,
    maxPendingFrames: metrics.maxPendingFrames,
    decodedOutputFrames: metrics.decodedOutputFrames,
    avgDraw: formatMs(metrics.drawMs / encodedFrames),
    avgJpeg: formatMs(metrics.jpegMs / encodedFrames),
    avgSave: formatMs(metrics.saveMs / encodedFrames),
    outputMB: Number((metrics.savedBytes / 1024 / 1024).toFixed(2)),
  });
}
