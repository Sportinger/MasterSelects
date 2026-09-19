import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import {
  COLOR_FIXED_ANCHOR_SPACING,
  type ColorNode,
} from '../../../types/colorCorrection';
import {
  getColorGraphOriginalSizeAnchorPosition,
  type ColorGraphViewport,
} from './colorGraphViewport';

interface ResponsiveColorGraphAnchorsOptions {
  canvasRef: RefObject<HTMLDivElement | null>;
  clipId: string;
  enabled: boolean;
  nodes: readonly ColorNode[];
  viewport: ColorGraphViewport;
  moveNode: (
    clipId: string,
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
}

export function useResponsiveColorGraphAnchors({
  canvasRef,
  clipId,
  enabled,
  nodes,
  viewport,
  moveNode,
}: ResponsiveColorGraphAnchorsOptions) {
  const nodesRef = useRef(nodes);
  const viewportRef = useRef(viewport);
  useLayoutEffect(() => {
    nodesRef.current = nodes;
    viewportRef.current = viewport;
  }, [nodes, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? canvas.getBoundingClientRect().width;
      if (width <= 0) return;

      const currentNodes = nodesRef.current;
      const input = currentNodes.find(node => node.type === 'input');
      const output = currentNodes.find(node => node.type === 'output');
      const sources = currentNodes.filter(node => node.type === 'source');
      currentNodes.forEach(node => {
        const anchorPosition = getColorGraphOriginalSizeAnchorPosition(
          node,
          width,
          viewportRef.current,
        );
        const position = anchorPosition && node.type === 'source' && input
          ? {
              ...anchorPosition,
              y: input.position.y
                + (sources.findIndex(source => source.id === node.id) + 1)
                * COLOR_FIXED_ANCHOR_SPACING,
            }
          : anchorPosition && node.type === 'alpha-output' && output
            ? { ...anchorPosition, y: output.position.y + COLOR_FIXED_ANCHOR_SPACING }
            : anchorPosition;
        if (position && (position.x !== node.position.x || position.y !== node.position.y)) {
          moveNode(clipId, node.id, position);
        }
      });
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, clipId, enabled, moveNode]);
}
