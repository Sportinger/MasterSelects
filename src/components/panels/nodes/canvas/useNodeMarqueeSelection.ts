import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { NodeGraphNode } from '../../../../services/nodeGraph';
import { getNodeHeight, NODE_WIDTH, type Viewport } from './canvasGeometry';

const RIGHT_BUTTON = 2;
export const NODE_MARQUEE_DRAG_THRESHOLD = 5;

export interface NodeMarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Gesture {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  active: boolean;
}

export function normalizedNodeMarquee(startX: number, startY: number, endX: number, endY: number): NodeMarqueeRect {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

export function nodesIntersectingMarquee(nodes: readonly NodeGraphNode[], marquee: NodeMarqueeRect): string[] {
  const right = marquee.left + marquee.width;
  const bottom = marquee.top + marquee.height;
  return nodes.filter(node => (
    node.layout.x < right
    && node.layout.x + NODE_WIDTH > marquee.left
    && node.layout.y < bottom
    && node.layout.y + getNodeHeight(node) > marquee.top
  )).map(node => node.id);
}

interface Options {
  nodes: readonly NodeGraphNode[];
  viewport: Viewport;
  getGraphPoint: (clientX: number, clientY: number) => { x: number; y: number };
  onSelectNodes?: (nodeIds: string[]) => void;
}

export function useNodeMarqueeSelection({ nodes, viewport, getGraphPoint, onSelectNodes }: Options) {
  const gestureRef = useRef<Gesture | null>(null);
  const suppressContextMenuRef = useRef(false);
  const [marquee, setMarquee] = useState<NodeMarqueeRect | null>(null);

  const start = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== RIGHT_BUTTON || !onSelectNodes) return false;
    if ((event.target as Element).closest('.node-workspace-port, .node-workspace-edge-hit')) return false;
    gestureRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      active: false,
    };
    suppressContextMenuRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    return true;
  }, [onSelectNodes]);

  const move = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return false;
    if (!gesture.active && Math.hypot(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY) < NODE_MARQUEE_DRAG_THRESHOLD) return true;
    gesture.active = true;
    const startPoint = getGraphPoint(gesture.startClientX, gesture.startClientY);
    const endPoint = getGraphPoint(event.clientX, event.clientY);
    const graphRect = normalizedNodeMarquee(startPoint.x, startPoint.y, endPoint.x, endPoint.y);
    onSelectNodes?.(nodesIntersectingMarquee(nodes, graphRect));
    setMarquee(normalizedNodeMarquee(
      (startPoint.x * viewport.zoom) + viewport.panX,
      (startPoint.y * viewport.zoom) + viewport.panY,
      (endPoint.x * viewport.zoom) + viewport.panX,
      (endPoint.y * viewport.zoom) + viewport.panY,
    ));
    return true;
  }, [getGraphPoint, nodes, onSelectNodes, viewport]);

  const finish = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return false;
    suppressContextMenuRef.current = gesture.active;
    gestureRef.current = null;
    setMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    return true;
  }, []);

  const suppressContextMenu = useCallback(() => {
    if (!suppressContextMenuRef.current) return false;
    suppressContextMenuRef.current = false;
    return true;
  }, []);

  return { marquee, start, move, finish, suppressContextMenu };
}
