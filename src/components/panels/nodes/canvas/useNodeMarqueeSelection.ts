import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { NodeGraphNode } from '../../../../services/nodeGraph';
import { getNodeHeight, getNodeWidth, type Viewport } from './canvasGeometry';

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
    && node.layout.x + getNodeWidth(node) > marquee.left
    && node.layout.y < bottom
    && node.layout.y + getNodeHeight(node) > marquee.top
  )).map(node => node.id);
}

interface Options {
  nodes: readonly NodeGraphNode[];
  viewport: Viewport;
  getGraphPoint: (clientX: number, clientY: number) => { x: number; y: number };
  onSelectNodes?: (nodeIds: string[]) => void;
  /** The marquee in graph units, for selectable items that are not cards. */
  onSelectRect?: (rect: NodeMarqueeRect) => void;
}

export function useNodeMarqueeSelection({ nodes, viewport, getGraphPoint, onSelectNodes, onSelectRect }: Options) {
  const gestureRef = useRef<Gesture | null>(null);
  const suppressContextMenuRef = useRef(false);
  const deferredContextMenuRef = useRef<{ target: EventTarget; clientX: number; clientY: number } | null>(null);
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
    deferredContextMenuRef.current = null;
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
    onSelectRect?.(graphRect);
    setMarquee(normalizedNodeMarquee(
      (startPoint.x * viewport.zoom) + viewport.panX,
      (startPoint.y * viewport.zoom) + viewport.panY,
      (endPoint.x * viewport.zoom) + viewport.panX,
      (endPoint.y * viewport.zoom) + viewport.panY,
    ));
    return true;
  }, [getGraphPoint, nodes, onSelectNodes, onSelectRect, viewport]);

  const finish = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return false;
    const deferred = deferredContextMenuRef.current;
    deferredContextMenuRef.current = null;
    // A context menu that already arrived on press (Linux) leaves nothing to suppress afterwards.
    suppressContextMenuRef.current = gesture.active && !deferred;
    gestureRef.current = null;
    setMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // It was a plain right click after all: open the held context menu where it was asked for.
    if (deferred && !gesture.active) {
      deferred.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: RIGHT_BUTTON,
        clientX: deferred.clientX, clientY: deferred.clientY }));
    }
    return true;
  }, []);

  /**
   * Linux delivers contextmenu on press, before the gesture can tell a click from a marquee drag:
   * while a right-button gesture is open the menu is held, and finish() replays it only if the
   * pointer did not drag. Returns true when the caller must not open its menu now.
   */
  const deferContextMenu = useCallback((event: ReactMouseEvent) => {
    if (!gestureRef.current) return false;
    deferredContextMenuRef.current = { target: event.target, clientX: event.clientX, clientY: event.clientY };
    return true;
  }, []);

  const suppressContextMenu = useCallback(() => {
    if (!suppressContextMenuRef.current) return false;
    suppressContextMenuRef.current = false;
    return true;
  }, []);

  return { marquee, start, move, finish, suppressContextMenu, deferContextMenu };
}
