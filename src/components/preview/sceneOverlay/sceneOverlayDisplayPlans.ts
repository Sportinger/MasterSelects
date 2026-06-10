import type { CSSProperties } from 'react';
import type { SceneCamera } from '../../../engine/scene/types';
import {
  buildCameraWireframeLines,
  type PreviewSceneObject,
  type SceneAxisScreenHandle,
  type SceneGizmoAxis,
  type SceneGizmoMode,
} from '../sceneObjectOverlayMath';
import type { DisplayCameraWireframePath, DisplaySceneObject } from './sceneOverlayTypes';

export const AXES: SceneGizmoAxis[] = ['x', 'y', 'z'];
export const CENTER_SCALE_DIRECTION = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };

const CENTER_DRAG_FALLBACK_PIXELS_PER_UNIT = 72;

export const AXIS_LABELS: Record<SceneGizmoAxis, string> = {
  x: 'X',
  y: 'Y',
  z: 'Z',
};

export const MODE_LABELS: Record<SceneGizmoMode, string> = {
  move: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
};

export function getObjectBadge(kind: PreviewSceneObject['kind']): string {
  switch (kind) {
    case 'camera':
      return 'C';
    case 'effector':
      return 'E';
    case 'splat':
      return 'S';
    case 'model':
      return 'M';
    case 'plane':
      return '3D';
  }
}

export function resolveDisplayObjects(
  objects: PreviewSceneObject[],
  canvasSize: { width: number; height: number },
): DisplaySceneObject[] {
  const groups = new Map<string, PreviewSceneObject[]>();
  for (const object of objects) {
    if (!object.screen.visible) continue;
    const key = `${Math.round(object.screen.x / 32)}:${Math.round(object.screen.y / 32)}`;
    groups.set(key, [...(groups.get(key) ?? []), object]);
  }

  return objects.map((object) => {
    const key = `${Math.round(object.screen.x / 32)}:${Math.round(object.screen.y / 32)}`;
    const group = groups.get(key) ?? [object];
    const index = group.findIndex((candidate) => candidate.clipId === object.clipId);
    if (!object.screen.visible || group.length <= 1 || index < 0) {
      return { ...object, displayX: object.screen.x, displayY: object.screen.y };
    }

    const angle = -Math.PI / 2 + (index * Math.PI * 2) / group.length;
    const radius = 19;
    return {
      ...object,
      displayX: Math.max(14, Math.min(canvasSize.width - 14, object.screen.x + Math.cos(angle) * radius)),
      displayY: Math.max(14, Math.min(canvasSize.height - 14, object.screen.y + Math.sin(angle) * radius)),
    };
  });
}

export function getAxisStyle(handle: SceneAxisScreenHandle): CSSProperties {
  const length = Math.hypot(handle.end.x - handle.start.x, handle.end.y - handle.start.y);
  const angle = Math.atan2(handle.end.y - handle.start.y, handle.end.x - handle.start.x);
  return {
    left: handle.start.x,
    top: handle.start.y,
    width: length,
    transform: `rotate(${angle}rad)`,
  };
}

export function getCenterHandleLabel(mode: SceneGizmoMode): string {
  if (mode === 'move') return 'Move freely';
  if (mode === 'scale') return 'Scale all axes';
  return 'Selected scene object';
}

export function resolveCenterFreePixelsPerUnit(axisHandles: SceneAxisScreenHandle[]): { x: number; y: number } {
  const xHandle = axisHandles.find((handle) => handle.axis === 'x');
  const yHandle = axisHandles.find((handle) => handle.axis === 'y');
  const fallback = xHandle?.pixelsPerUnit ?? yHandle?.pixelsPerUnit ?? CENTER_DRAG_FALLBACK_PIXELS_PER_UNIT;
  return {
    x: Math.max(24, xHandle?.pixelsPerUnit ?? fallback),
    y: Math.max(24, yHandle?.pixelsPerUnit ?? fallback),
  };
}

export function getAveragePixelsPerUnit(pixelsPerUnit: { x: number; y: number }): number {
  return Math.max(24, (pixelsPerUnit.x + pixelsPerUnit.y) / 2);
}

function linesToSvgPath(lines: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>): string {
  return lines
    .map((line) => `M ${line.from.x.toFixed(2)} ${line.from.y.toFixed(2)} L ${line.to.x.toFixed(2)} ${line.to.y.toFixed(2)}`)
    .join(' ');
}

export function buildCameraWireframePaths(
  objects: PreviewSceneObject[],
  camera: SceneCamera,
  canvasSize: { width: number; height: number },
  selectedClipId: string | null,
): DisplayCameraWireframePath[] {
  return objects.flatMap((object) => {
    const lines = buildCameraWireframeLines(object, camera, canvasSize);
    if (lines.length === 0) return [];

    return (['body', 'frustum', 'direction'] as const).flatMap((role) => {
      const roleLines = lines.filter((line) => line.role === role);
      if (roleLines.length === 0) return [];
      return [{
        key: `${object.clipId}-${role}`,
        d: linesToSvgPath(roleLines),
        role,
        selected: object.clipId === selectedClipId,
      }];
    });
  });
}
