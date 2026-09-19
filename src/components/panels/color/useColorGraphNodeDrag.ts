import { useCallback, type PointerEvent, type RefObject } from 'react';

import {
  getColorGraphNodeTop,
  getColorGraphPortX,
  getColorGraphPortY,
  getEdgePath,
  isColorGraphAnchorNode,
} from './colorEditorMath';
import type { ColorEditorEdge, ColorEditorNode } from './colorEditorTypes';

interface ColorGraphNodeDragOptions {
  canvasRef: RefObject<HTMLDivElement | null>;
  getNodes: () => ColorEditorNode[];
  getEdges: () => ColorEditorEdge[];
  zoom: number;
  onDragStart: (nodeId: string) => void;
  onDragEnd: (nodeId: string, position: { x: number; y: number } | null) => void;
}

export function useColorGraphNodeDrag({
  canvasRef,
  getNodes,
  getEdges,
  zoom,
  onDragStart,
  onDragEnd,
}: ColorGraphNodeDragOptions) {
  return useCallback((event: PointerEvent<HTMLDivElement>, node: ColorEditorNode) => {
    if ((event.target as HTMLElement).closest('button,input,.color-graph-port')) return;
    if (event.button !== 0 || isColorGraphAnchorNode(node)) return;

    event.preventDefault();
    onDragStart(node.id);

    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startPosition = node.position;
    let nextPosition = startPosition;
    let animationFrame = 0;
    let moved = false;

    const previewPosition = () => {
      animationFrame = 0;
      const canvas = canvasRef.current;
      const nodeElement = canvas?.querySelector<HTMLElement>(`[data-color-node-id="${node.id}"]`);
      if (nodeElement) {
        nodeElement.style.left = `${nextPosition.x}px`;
        nodeElement.style.top = `${getColorGraphNodeTop({ ...node, position: nextPosition })}px`;
      }

      const nodeById = new Map(getNodes().map(candidate => [
        candidate.id,
        candidate.id === node.id ? { ...candidate, position: nextPosition } : candidate,
      ]));
      const edgeById = new Map(getEdges().map(edge => [edge.id, edge]));
      canvas?.querySelectorAll<SVGGElement>('[data-color-edge-id]').forEach(group => {
        const edge = edgeById.get(group.dataset.colorEdgeId ?? '');
        if (!edge || (edge.fromNodeId !== node.id && edge.toNodeId !== node.id)) return;
        const fromNode = nodeById.get(edge.fromNodeId);
        const toNode = nodeById.get(edge.toNodeId);
        if (!fromNode || !toNode) return;
        const path = getEdgePath(
          getColorGraphPortX(fromNode, 'output', zoom),
          getColorGraphPortY(fromNode, 'output', edge.fromPortId, zoom),
          getColorGraphPortX(toNode, 'input', zoom),
          getColorGraphPortY(toNode, 'input', edge.toPortId, zoom),
        );
        group.querySelectorAll<SVGPathElement>('path').forEach(element => element.setAttribute('d', path));
      });
    };

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      nextPosition = {
        x: Math.round(startPosition.x + (moveEvent.clientX - startClientX) / zoom),
        y: Math.round(startPosition.y + (moveEvent.clientY - startClientY) / zoom),
      };
      moved = moved || nextPosition.x !== startPosition.x || nextPosition.y !== startPosition.y;
      if (!animationFrame) animationFrame = requestAnimationFrame(previewPosition);
    };

    const finish = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (moved) {
        previewPosition();
        onDragEnd(node.id, nextPosition);
      } else {
        onDragEnd(node.id, null);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, [canvasRef, getEdges, getNodes, onDragEnd, onDragStart, zoom]);
}
