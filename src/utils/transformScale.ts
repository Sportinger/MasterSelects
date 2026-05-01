import type { ClipTransform } from '../types';

type ClipScale = ClipTransform['scale'];

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getScaleAll(scale: Partial<ClipScale> | undefined): number {
  return finiteNumber(scale?.all, 1);
}

export function getEffectiveScale(scale: Partial<ClipScale> | undefined): { x: number; y: number; z?: number } {
  const all = getScaleAll(scale);
  const scaleZ = scale?.z;

  return {
    x: finiteNumber(scale?.x, 1) * all,
    y: finiteNumber(scale?.y, 1) * all,
    ...(scaleZ !== undefined ? { z: finiteNumber(scaleZ, 1) * all } : {}),
  };
}

export function getEffectiveCameraScale(scale: Partial<ClipScale> | undefined): { x: number; y: number; z?: number } {
  const all = getScaleAll(scale);
  const scaleZ = scale?.z;

  return {
    x: finiteNumber(scale?.x, 1) * all,
    y: finiteNumber(scale?.y, 1) * all,
    ...(scaleZ !== undefined ? { z: finiteNumber(scaleZ, 0) } : {}),
  };
}
