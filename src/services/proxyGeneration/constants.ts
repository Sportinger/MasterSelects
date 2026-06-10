export const PROXY_FPS = 30;
export const PROXY_MAX_WIDTH = 1280;
export const JPEG_QUALITY = 0.82;
export const PROXY_H264_BITS_PER_PIXEL_SECOND = 0.16;
export const PROXY_MIN_BITRATE = 4_000_000;
export const PROXY_MAX_BITRATE = 30_000_000;
export const CANVAS_POOL_SIZE = 8;
export const WORKER_ENCODER_MAX_COUNT = 8;
export const WORKER_ENCODER_RESERVED_THREADS = 2;
export const DECODE_BATCH_SIZE = 30;
export const MAX_PENDING_ENCODE_FRAMES = CANVAS_POOL_SIZE * 8;
export const BACKPRESSURE_TARGET_FRAMES = CANVAS_POOL_SIZE * 4;
export const BACKPRESSURE_POLL_MS = 5;
export const MIN_FLUSH_TIMEOUT_MS = 30000;
export const MAX_FLUSH_TIMEOUT_MS = 180000;
export const FLUSH_TIMEOUT_PER_SAMPLE_MS = 120;

export function getProxyVideoBitrate(width: number, height: number, fps: number): number {
  const bitrate = Math.round(width * height * fps * PROXY_H264_BITS_PER_PIXEL_SECOND);
  return Math.max(PROXY_MIN_BITRATE, Math.min(PROXY_MAX_BITRATE, bitrate));
}
