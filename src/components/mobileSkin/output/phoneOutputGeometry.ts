// Pure geometry of the phone output editor: pinch zoom / two-finger pan of the stage and the mapping
// from a finger position to normalized (0..1) output coordinates.

import type { OutputSlice, Point2D } from '../../../types/outputSlice';
import { clampOutputZoom, type PhoneOutputView } from './phoneOutputStore';

export interface ScreenPoint { x: number; y: number }

const mid = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The view after two fingers moved from (startA, startB) to (a, b), all in stage coordinates: the
 * content point under the starting midpoint stays under the current midpoint, the zoom follows the
 * finger spread (clamped).
 */
export function pinchView(start: PhoneOutputView, startA: ScreenPoint, startB: ScreenPoint, a: ScreenPoint, b: ScreenPoint): PhoneOutputView {
  const startDistance = distance(startA, startB);
  const zoom = startDistance > 1 ? clampOutputZoom(start.zoom * (distance(a, b) / startDistance)) : start.zoom;
  const startMid = mid(startA, startB);
  const content = { x: (startMid.x - start.panX) / start.zoom, y: (startMid.y - start.panY) / start.zoom };
  const now = mid(a, b);
  return { zoom, panX: now.x - zoom * content.x, panY: now.y - zoom * content.y };
}

/** A finger position (client pixels) as normalized coordinates of the output box `rect` (as drawn, zoom included). */
export function clientToNormalized(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): Point2D | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

/** Rounds a normalized coordinate for display and storage of typed values (0.1 % steps). */
export function roundNormalized(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Percent text of a normalized value, e.g. 0.25 -> "25". */
export function toPercentText(value: number): string {
  const percent = Math.round(value * 1000) / 10;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

/** Parses a typed percent ("25", "25.5", "25 %", "-10") into a normalized value; null for anything else. */
export function parsePercent(text: string): number | null {
  const cleaned = text.replace('%', '').replace(',', '.').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return roundNormalized(Number(cleaned) / 100);
}

/** The four corners an item shows on a tab (null for a mesh warp on the Output tab: no editor for it). */
export function cornersOnTab(item: OutputSlice, tab: 'input' | 'output'): readonly Point2D[] | null {
  if (tab === 'input') return item.inputCorners;
  return item.warp.mode === 'cornerPin' ? item.warp.corners : null;
}
