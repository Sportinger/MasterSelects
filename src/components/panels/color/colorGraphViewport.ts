import {
  getColorGraphNodeHeight,
  getColorGraphNodeTop,
  getColorGraphNodeWidth,
} from './colorEditorMath';
import type { ColorEditorNode } from './colorEditorTypes';

export interface ColorGraphBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ColorGraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export function getColorGraphOriginalSizeViewport(
  viewport: ColorGraphViewport,
): ColorGraphViewport {
  return { ...viewport, zoom: 1 };
}

const ORIGINAL_SIZE_EDGE_INSET = 8;

export function getColorGraphBounds(
  nodes: readonly ColorEditorNode[],
): ColorGraphBounds | null {
  if (nodes.length === 0) return null;

  return {
    left: Math.min(...nodes.map(node => node.position.x)),
    top: Math.min(...nodes.map(getColorGraphNodeTop)),
    right: Math.max(...nodes.map(node => node.position.x + getColorGraphNodeWidth(node))),
    bottom: Math.max(...nodes.map(
      node => getColorGraphNodeTop(node) + getColorGraphNodeHeight(node),
    )),
  };
}

export function getColorGraphOriginalSizeAnchorPosition(
  node: Pick<ColorEditorNode, 'type' | 'position'>,
  panelWidth: number,
  viewport: ColorGraphViewport = { x: 0, y: 0, zoom: 1 },
): ColorEditorNode['position'] | null {
  const inputSide = node.type === 'input' || node.type === 'source';
  const outputSide = node.type === 'output' || node.type === 'alpha-output';
  if (!inputSide && !outputSide) return null;

  const zoom = Math.max(0.01, viewport.zoom);
  const screenX = inputSide
    ? ORIGINAL_SIZE_EDGE_INSET
    : Math.max(
        ORIGINAL_SIZE_EDGE_INSET,
        Math.round(panelWidth) - getColorGraphNodeWidth(node) - ORIGINAL_SIZE_EDGE_INSET,
      );

  return {
    x: Math.round((screenX - viewport.x) / zoom),
    y: node.position.y,
  };
}

export function getColorGraphFitViewport(
  bounds: ColorGraphBounds,
  panelWidth: number,
  panelHeight: number,
  padding = 48,
): ColorGraphViewport {
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const zoom = Math.max(0.25, Math.min(
    2,
    (panelWidth - padding * 2) / width,
    (panelHeight - padding * 2) / height,
  ));

  return {
    x: Math.round((panelWidth - width * zoom) / 2 - bounds.left * zoom),
    y: Math.round((panelHeight - height * zoom) / 2 - bounds.top * zoom),
    zoom: Number(zoom.toFixed(2)),
  };
}
