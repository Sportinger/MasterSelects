import { prefersSoftwareTimelineCanvas } from '../../../components/timeline/utils/timelineCanvasPlatform';

export interface CaptureCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureSize {
  width: number;
  height: number;
}

export type CaptureOutputScale = 1 | 0.75 | 0.5 | '1080p';
const MAX_CAPTURE_CANVAS_DIMENSION = 8192;

export function normalizeCaptureCrop(rect: CaptureCropRect, source: CaptureSize): CaptureCropRect {
  const maxRight = Math.max(2, Math.floor(source.width / 2) * 2);
  const maxBottom = Math.max(2, Math.floor(source.height / 2) * 2);
  const x = Math.max(0, Math.min(maxRight - 2, Math.floor(rect.x / 2) * 2));
  const y = Math.max(0, Math.min(maxBottom - 2, Math.floor(rect.y / 2) * 2));
  const right = Math.max(x + 2, Math.min(maxRight, Math.ceil((rect.x + rect.width) / 2) * 2));
  const bottom = Math.max(y + 2, Math.min(maxBottom, Math.ceil((rect.y + rect.height) / 2) * 2));
  return { x, y, width: right - x, height: bottom - y };
}

export function getContainedVideoRect(container: CaptureSize, source: CaptureSize): CaptureCropRect {
  if (container.width <= 0 || container.height <= 0 || source.width <= 0 || source.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(container.width / source.width, container.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height };
}

export function mapOverlayCropToSource(
  overlay: CaptureCropRect,
  container: CaptureSize,
  source: CaptureSize,
): CaptureCropRect {
  const content = getContainedVideoRect(container, source);
  const left = Math.max(content.x, Math.min(content.x + content.width, overlay.x));
  const top = Math.max(content.y, Math.min(content.y + content.height, overlay.y));
  const right = Math.max(left, Math.min(content.x + content.width, overlay.x + overlay.width));
  const bottom = Math.max(top, Math.min(content.y + content.height, overlay.y + overlay.height));
  return normalizeCaptureCrop({
    x: (left - content.x) * source.width / content.width,
    y: (top - content.y) * source.height / content.height,
    width: (right - left) * source.width / content.width,
    height: (bottom - top) * source.height / content.height,
  }, source);
}

export function mapSourceCropToOverlay(
  crop: CaptureCropRect,
  container: CaptureSize,
  source: CaptureSize,
): CaptureCropRect {
  const content = getContainedVideoRect(container, source);
  return {
    x: content.x + crop.x * content.width / source.width,
    y: content.y + crop.y * content.height / source.height,
    width: crop.width * content.width / source.width,
    height: crop.height * content.height / source.height,
  };
}

export function resolveCaptureOutputSize(source: CaptureSize, scale: CaptureOutputScale): CaptureSize {
  const ratio = scale === '1080p' ? Math.min(1, 1920 / source.width, 1080 / source.height) : scale;
  return {
    width: Math.max(2, Math.min(MAX_CAPTURE_CANVAS_DIMENSION, Math.floor(source.width * ratio / 2) * 2)),
    height: Math.max(2, Math.min(MAX_CAPTURE_CANVAS_DIMENSION, Math.floor(source.height * ratio / 2) * 2)),
  };
}

export function transformCaptureFrame(
  frame: VideoFrame,
  options: { crop?: CaptureCropRect; scale: CaptureOutputScale; timestamp: number },
): VideoFrame {
  const source = { width: frame.displayWidth, height: frame.displayHeight };
  const crop = options.crop ? normalizeCaptureCrop(options.crop, source) : { x: 0, y: 0, ...source };
  const output = resolveCaptureOutputSize({ width: crop.width, height: crop.height }, options.scale);
  if (output.width === crop.width && output.height === crop.height) {
    return new VideoFrame(frame, { visibleRect: crop, timestamp: options.timestamp });
  }

  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext('2d', prefersSoftwareTimelineCanvas() ? { willReadFrequently: true } : undefined);
  if (!context) throw new Error('Capture scale canvas is unavailable.');
  context.drawImage(frame, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
  return new VideoFrame(canvas, { timestamp: options.timestamp, duration: frame.duration ?? undefined });
}
