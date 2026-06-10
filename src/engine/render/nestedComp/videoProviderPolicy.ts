import type { Layer } from '../../core/types';

export function getFrameTimestampSeconds(timestamp: unknown, fallback?: number): number | undefined {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? timestamp / 1_000_000
    : fallback;
}

export function isPendingWebCodecsFrameStable(
  provider: NonNullable<Layer['source']>['webCodecsPlayer'] | undefined
): boolean {
  if (!provider) {
    return true;
  }

  const pendingTarget = provider.getPendingSeekTime?.();
  if (pendingTarget == null) {
    return true;
  }

  const fps = provider.getFrameRate?.() ?? 30;
  const tolerance = Math.max(1.5 / Math.max(fps, 1), 0.05);
  return Math.abs(pendingTarget - provider.currentTime) <= tolerance;
}
