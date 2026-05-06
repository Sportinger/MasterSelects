import { PROXY_FPS } from '../constants';

const PROXY_COMPLETE_THRESHOLD = 0.98;
const FRAME_COUNT_EPSILON = 1e-3;

function ceilFrameCount(value: number): number {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= FRAME_COUNT_EPSILON) {
    return rounded;
  }
  return Math.ceil(value);
}

export function getExpectedProxyFps(fps?: number): number {
  if (!fps || !Number.isFinite(fps) || fps <= 0) return PROXY_FPS;
  return Math.min(PROXY_FPS, fps);
}

export function getExpectedProxyFrameCount(duration?: number, fps?: number): number | null {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return null;
  return ceilFrameCount(duration * getExpectedProxyFps(fps));
}

export function isProxyFrameCountComplete(
  frameCount: number | undefined,
  duration?: number,
  fps?: number
): boolean {
  const expectedFrames = getExpectedProxyFrameCount(duration, fps);
  if (!frameCount || !expectedFrames) return false;
  return frameCount >= expectedFrames * PROXY_COMPLETE_THRESHOLD;
}

export function isProxyFrameIndexSetComplete(
  frameIndices: Set<number> | undefined,
  duration?: number,
  fps?: number
): boolean {
  const expectedFrames = getExpectedProxyFrameCount(duration, fps);
  if (!frameIndices?.size || !expectedFrames) return false;

  let presentRequiredFrames = 0;
  for (let frameIndex = 0; frameIndex < expectedFrames; frameIndex++) {
    if (frameIndices.has(frameIndex)) presentRequiredFrames++;
  }

  return presentRequiredFrames >= expectedFrames * PROXY_COMPLETE_THRESHOLD;
}

export function getProxyProgressFromFrameCount(
  frameCount: number | undefined,
  duration?: number,
  fps?: number
): number {
  const expectedFrames = getExpectedProxyFrameCount(duration, fps);
  if (!frameCount || !expectedFrames) return 0;
  if (isProxyFrameCountComplete(frameCount, duration, fps)) return 100;
  return Math.max(1, Math.min(99, Math.round((frameCount / expectedFrames) * 100)));
}

export function getProxyProgressFromFrameIndices(
  frameIndices: Set<number> | undefined,
  duration?: number,
  fps?: number
): number {
  const expectedFrames = getExpectedProxyFrameCount(duration, fps);
  if (!frameIndices?.size || !expectedFrames) return 0;

  let presentRequiredFrames = 0;
  for (let frameIndex = 0; frameIndex < expectedFrames; frameIndex++) {
    if (frameIndices.has(frameIndex)) presentRequiredFrames++;
  }

  if (presentRequiredFrames >= expectedFrames * PROXY_COMPLETE_THRESHOLD) return 100;
  return Math.max(1, Math.min(99, Math.round((presentRequiredFrames / expectedFrames) * 100)));
}
