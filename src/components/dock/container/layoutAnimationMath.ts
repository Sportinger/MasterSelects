import type { DockLayoutAnimationRect, DockLayoutAnimationTarget, DockLayoutEdge } from './layoutAnimationTypes';
import {
  DOCK_LAYOUT_PUZZLE_DURATION_RATIO,
  DOCK_LAYOUT_PUZZLE_STAGGER_MAX_RATIO,
  DOCK_LAYOUT_TIMELINE_REVEAL_RATIO,
} from './layoutAnimationTypes';

export function toAnimationRect(rect: DOMRect): DockLayoutAnimationRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashAnimationId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function getPuzzleAnimationTiming(
  id: string,
  rect: DockLayoutAnimationRect | DOMRect,
  containerRect: DOMRect,
  snapshotDurationMs: number,
  movementDistance: number,
): Pick<DockLayoutAnimationTarget, 'delayMs' | 'durationMs'> {
  const normalizedX = clampNumber((rect.left - containerRect.left) / Math.max(containerRect.width, 1), 0, 1);
  const normalizedY = clampNumber((rect.top - containerRect.top) / Math.max(containerRect.height, 1), 0, 1);
  const layoutWave = (normalizedX * 0.42) + (normalizedY * 0.58);
  const movementWeight = clampNumber(movementDistance / 720, 0, 1);
  const idJitter = (hashAnimationId(id) % 5) * Math.max(9, snapshotDurationMs * 0.012);
  const staggerMaxMs = Math.max(0, snapshotDurationMs * DOCK_LAYOUT_PUZZLE_STAGGER_MAX_RATIO);
  const delayMs = Math.round(layoutWave * staggerMaxMs + movementWeight * snapshotDurationMs * 0.04 + idJitter);
  const maxDurationMs = Math.max(180, snapshotDurationMs - delayMs);
  const rawDurationMs = Math.round(
    snapshotDurationMs * DOCK_LAYOUT_PUZZLE_DURATION_RATIO
    + movementWeight * snapshotDurationMs * 0.14
    - layoutWave * snapshotDurationMs * 0.08
    + idJitter,
  );

  return {
    delayMs,
    durationMs: clampNumber(rawDurationMs, Math.min(420, maxDurationMs), maxDurationMs),
  };
}

export function getPuzzleOvershoot(delta: number): number {
  return clampNumber(-delta * 0.025, -8, 8);
}

export function toRelativeRect(rect: DockLayoutAnimationRect | DOMRect, containerRect: DOMRect): DockLayoutAnimationRect {
  return {
    left: rect.left - containerRect.left,
    top: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function toPx(value: number): string {
  return `${value}px`;
}

function getNearestDockLayoutEdge(rect: DockLayoutAnimationRect, containerRect: DOMRect): DockLayoutEdge {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const distances: Record<DockLayoutEdge, number> = {
    left: centerX,
    right: Math.max(0, containerRect.width - centerX),
    top: centerY,
    bottom: Math.max(0, containerRect.height - centerY),
  };

  return (Object.entries(distances) as Array<[DockLayoutEdge, number]>)
    .reduce((nearest, candidate) => (candidate[1] < nearest[1] ? candidate : nearest))[0];
}

export function getDockLayoutEdgeRect(rect: DockLayoutAnimationRect, containerRect: DOMRect): DockLayoutAnimationRect {
  const edge = getNearestDockLayoutEdge(rect, containerRect);
  const padding = 28;

  switch (edge) {
    case 'left':
      return { ...rect, left: -rect.width - padding };
    case 'right':
      return { ...rect, left: containerRect.width + padding };
    case 'top':
      return { ...rect, top: -rect.height - padding };
    case 'bottom':
      return { ...rect, top: containerRect.height + padding };
    default:
      return rect;
  }
}

function isTimelineLayoutAnimationId(id: string): boolean {
  return id === 'panel:timeline' || id.startsWith('timeline-');
}

function isPreviewLayoutAnimationId(id: string): boolean {
  return id === 'panel:preview'
    || id.startsWith('panel:preview-')
    || id === 'panel:multi-preview'
    || id.startsWith('panel:multi-preview-');
}

export function shouldAnimateLiveLayoutElement(id: string): boolean {
  return isPreviewLayoutAnimationId(id) || id === 'panel:timeline' || id === 'panel:media';
}

export function getDockLayoutOverlayZIndex(id: string, kind: 'panel' | 'child'): string {
  if (isTimelineLayoutAnimationId(id)) {
    return kind === 'child' ? '4' : '3';
  }

  return kind === 'child' ? '24' : '20';
}

export function getDockLayoutEffectiveTiming(
  id: string,
  snapshotDurationMs: number,
  delayMs: number,
  durationMs: number,
): Pick<DockLayoutAnimationTarget, 'delayMs' | 'durationMs'> {
  if (!isTimelineLayoutAnimationId(id)) {
    return { delayMs, durationMs };
  }

  return {
    delayMs: 0,
    durationMs: Math.max(120, Math.round(snapshotDurationMs * DOCK_LAYOUT_TIMELINE_REVEAL_RATIO)),
  };
}
