import type { StoryboardAnimaticCameraMove } from './types';

export function clampAnimaticProgress(localTime: number, durationSeconds: number): number {
  if (!Number.isFinite(localTime) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, localTime / durationSeconds));
}
export function resolveStillImageScale(
  progress: number,
  cameraMove: StoryboardAnimaticCameraMove,
): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  if (cameraMove === 'push-in') return 1 + (clamped * 0.08);
  if (cameraMove === 'pull-out') return 1.08 - (clamped * 0.08);
  return 1;
}
