import { DEFAULT_COLOR_WINDOW_PARAMS, type ColorWindowParams } from '../../../types/colorWindow';
import type { ColorNode } from '../../../types/colorCorrection';

export const COLOR_WINDOW_KEYS = Object.keys(DEFAULT_COLOR_WINDOW_PARAMS) as (keyof ColorWindowParams)[];

export interface UvPoint { x: number; y: number }

/** The window parameters of a correction node, with defaults for missing values. */
export function readColorWindow(node: Pick<ColorNode, 'params'>): ColorWindowParams {
  const window = { ...DEFAULT_COLOR_WINDOW_PARAMS };
  for (const key of COLOR_WINDOW_KEYS) {
    const value = node.params[key];
    if (typeof value === 'number' && Number.isFinite(value)) window[key] = value;
  }
  return window;
}

export function hasColorWindow(window: ColorWindowParams): boolean {
  const shape = Math.round(window.windowShape);
  return shape === 1 || shape === 2;
}

/**
 * Outline of the window in layer UV, scaled by `scale` (1 = the edge, 1 -/+ softness = where the soft
 * edge starts and ends, matching colorWindowWeight).
 */
export function colorWindowOutline(window: ColorWindowParams, scale = 1, segments = 72): UvPoint[] {
  const rx = (window.windowWidth / 2) * scale;
  const ry = (window.windowHeight / 2) * scale;
  if (Math.round(window.windowShape) === 2) {
    const corners: UvPoint[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: window.windowX + x * rx, y: window.windowY + y * ry }));
    // Subdivide the edges so the projected outline follows perspective and rotation.
    return corners.flatMap((corner, index) => {
      const next = corners[(index + 1) % 4]!;
      return Array.from({ length: segments / 4 }, (_, step) => ({
        x: corner.x + (next.x - corner.x) * (step / (segments / 4)),
        y: corner.y + (next.y - corner.y) * (step / (segments / 4)),
      }));
    });
  }
  return Array.from({ length: segments }, (_, step) => {
    const angle = (step / segments) * Math.PI * 2;
    return { x: window.windowX + Math.cos(angle) * rx, y: window.windowY + Math.sin(angle) * ry };
  });
}

/** Nodes of a version whose window equals this one; they move together (e.g. an inside/outside pair). */
export function nodesSharingWindow(nodes: readonly ColorNode[], window: ColorWindowParams): ColorNode[] {
  const same = (other: ColorWindowParams) => (['windowShape', 'windowX', 'windowY', 'windowWidth', 'windowHeight'] as const)
    .every(key => Math.abs(other[key] - window[key]) < 1e-6);
  return nodes.filter(node => (node.type === 'primary' || node.type === 'wheels') && hasColorWindow(readColorWindow(node)) && same(readColorWindow(node)));
}

export type ColorWindowDragMode = 'move' | 'width' | 'height';

/** New window geometry for a drag from `start` to `current` (both layer UV). */
export function dragColorWindow(window: ColorWindowParams, mode: ColorWindowDragMode, start: UvPoint, current: UvPoint): Partial<ColorWindowParams> {
  if (mode === 'move') return { windowX: window.windowX + current.x - start.x, windowY: window.windowY + current.y - start.y };
  if (mode === 'width') return { windowWidth: Math.max(0.01, Math.abs(current.x - window.windowX) * 2) };
  return { windowHeight: Math.max(0.01, Math.abs(current.y - window.windowY) * 2) };
}
