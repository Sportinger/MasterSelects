import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from 'react';

import {
  getColorGraphNodeBottom,
  getColorGraphNodeRight,
  getColorGraphNodeTop,
  isColorGraphAnchorNode,
} from './colorEditorMath';
import type { ColorEditorNode, ColorGraphMarquee } from './colorEditorTypes';

interface ColorGraphCanvasInteractionOptions {
  canvasRef: RefObject<HTMLDivElement | null>;
  getNodes: () => ColorEditorNode[];
  selectionScope: string;
  viewport: { x: number; y: number; zoom: number };
  workspace: boolean;
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void;
  onPrimaryNodeSelect: (nodeId: string) => void;
}

const WHEEL_PAN_SPEED = 0.06;
const MAX_WHEEL_DELTA_PER_EVENT = 120;

function getMarqueeNodeIds(
  nodes: ColorEditorNode[],
  start: { x: number; y: number },
  current: { x: number; y: number },
  visualZoom: number,
) {
  const left = Math.min(start.x, current.x);
  const right = Math.max(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const bottom = Math.max(start.y, current.y);

  return nodes
    .filter(node => {
      if (isColorGraphAnchorNode(node)) return false;
      const nodeLeft = node.position.x;
      const nodeRight = getColorGraphNodeRight(node, visualZoom);
      const nodeTop = getColorGraphNodeTop(node);
      const nodeBottom = getColorGraphNodeBottom(node, visualZoom);
      return nodeRight >= left && nodeLeft <= right && nodeBottom >= top && nodeTop <= bottom;
    })
    .map(node => node.id);
}

function previewGraphViewport(
  canvas: HTMLDivElement | null,
  nextViewport: { x: number; y: number; zoom: number },
) {
  const content = canvas?.querySelector<HTMLElement>('.color-graph-content');
  if (content) {
    content.style.transform = `translate(${nextViewport.x}px, ${nextViewport.y}px) scale(${nextViewport.zoom})`;
  }
  const surface = canvas?.parentElement;
  if (surface?.classList.contains('color-graph-scroll')) {
    const gridSize = 52 * nextViewport.zoom;
    surface.style.backgroundPosition = `${nextViewport.x}px ${nextViewport.y}px`;
    surface.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  }
}

export function useColorGraphCanvasInteraction({
  canvasRef,
  getNodes,
  selectionScope,
  viewport,
  workspace,
  onViewportChange,
  onPrimaryNodeSelect,
}: ColorGraphCanvasInteractionOptions) {
  const [isPanning, setIsPanning] = useState(false);
  const [marqueeState, setMarqueeState] = useState<{
    scope: string;
    value: ColorGraphMarquee | null;
  } | null>(null);
  const [selectionState, setSelectionState] = useState<{
    scope: string;
    nodeIds: string[];
  } | null>(null);
  const marquee = marqueeState?.scope === selectionScope ? marqueeState.value : null;
  const marqueeSelectedNodeIds = selectionState?.scope === selectionScope
    ? selectionState.nodeIds
    : [];
  const wheelViewportRef = useRef(viewport);
  const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelPreviewFrameRef = useRef(0);
  const viewportX = viewport.x;
  const viewportY = viewport.y;
  const viewportZoom = viewport.zoom;

  useEffect(() => {
    if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
    wheelCommitTimerRef.current = null;
    if (wheelPreviewFrameRef.current) cancelAnimationFrame(wheelPreviewFrameRef.current);
    wheelPreviewFrameRef.current = 0;
    wheelViewportRef.current = { x: viewportX, y: viewportY, zoom: viewportZoom };
  }, [selectionScope, viewportX, viewportY, viewportZoom]);

  useLayoutEffect(() => {
    if (wheelCommitTimerRef.current) {
      previewGraphViewport(canvasRef.current, wheelViewportRef.current);
    }
  });

  useEffect(() => () => {
    if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
    if (wheelPreviewFrameRef.current) cancelAnimationFrame(wheelPreviewFrameRef.current);
  }, []);

  const toGraphPoint = (event: globalThis.PointerEvent | PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round((event.clientX - rect.left - viewport.x) / viewport.zoom),
      y: Math.round((event.clientY - rect.top - viewport.y) / viewport.zoom),
    };
  };

  const clearMarqueeSelection = () => setSelectionState({ scope: selectionScope, nodeIds: [] });

  const startCanvasInteraction = (event: PointerEvent<HTMLDivElement>) => {
    if (!workspace || (event.button !== 0 && event.button !== 1)) return;

    const target = event.target as Element | null;
    const isMiddleButton = event.button === 1;
    const isInteractiveTarget = !!target?.closest(
      '.color-graph-node,.color-graph-edge-hit,.color-graph-port,button,input',
    );

    if (!isMiddleButton && isInteractiveTarget) return;
    event.preventDefault();

    if (isMiddleButton) {
      if (wheelCommitTimerRef.current) {
        clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = null;
      }
      setIsPanning(true);
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const startViewport = wheelViewportRef.current;
      let nextViewport = startViewport;
      let animationFrame = 0;
      const previewViewport = () => {
        animationFrame = 0;
        previewGraphViewport(canvasRef.current, nextViewport);
      };
      const handleMove = (moveEvent: globalThis.PointerEvent) => {
        nextViewport = {
          ...startViewport,
          x: Math.round(startViewport.x + moveEvent.clientX - startClientX),
          y: Math.round(startViewport.y + moveEvent.clientY - startClientY),
        };
        if (!animationFrame) animationFrame = requestAnimationFrame(previewViewport);
      };
      const finish = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        if (animationFrame) cancelAnimationFrame(animationFrame);
        previewViewport();
        wheelViewportRef.current = nextViewport;
        onViewportChange(nextViewport);
        setIsPanning(false);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      return;
    }

    const start = toGraphPoint(event);
    const nodes = getNodes();
    let selectedIds: string[] = [];
    setMarqueeState({ scope: selectionScope, value: { start, current: start } });
    setSelectionState({ scope: selectionScope, nodeIds: [] });

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const current = toGraphPoint(moveEvent);
      selectedIds = getMarqueeNodeIds(nodes, start, current, viewport.zoom);
      setMarqueeState({ scope: selectionScope, value: { start, current } });
      setSelectionState({ scope: selectionScope, nodeIds: selectedIds });
    };
    const finish = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setMarqueeState({ scope: selectionScope, value: null });
      const primaryNodeId = selectedIds.at(-1);
      if (primaryNodeId) onPrimaryNodeSelect(primaryNodeId);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const scrollCanvas = (event: WheelEvent<HTMLDivElement>) => {
    if (!workspace) return;
    event.preventDefault();
    const deltaUnit = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? canvasRef.current?.clientHeight ?? 1
        : 1;
    const rawDelta = event.deltaY * deltaUnit;
    const limitedDelta = Math.max(
      -MAX_WHEEL_DELTA_PER_EVENT,
      Math.min(MAX_WHEEL_DELTA_PER_EVENT, rawDelta),
    );
    const nextViewport = {
      ...wheelViewportRef.current,
      y: Math.round(
        (wheelViewportRef.current.y - limitedDelta * WHEEL_PAN_SPEED) * 1_000,
      ) / 1_000,
    };
    wheelViewportRef.current = nextViewport;
    if (!wheelPreviewFrameRef.current) {
      wheelPreviewFrameRef.current = requestAnimationFrame(() => {
        wheelPreviewFrameRef.current = 0;
        previewGraphViewport(canvasRef.current, wheelViewportRef.current);
      });
    }
    if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
    wheelCommitTimerRef.current = setTimeout(() => {
      wheelCommitTimerRef.current = null;
      if (wheelPreviewFrameRef.current) {
        cancelAnimationFrame(wheelPreviewFrameRef.current);
        wheelPreviewFrameRef.current = 0;
      }
      previewGraphViewport(canvasRef.current, wheelViewportRef.current);
      onViewportChange(wheelViewportRef.current);
    }, 100);
  };

  return {
    clearMarqueeSelection,
    isPanning,
    marquee,
    marqueeSelectedNodeIds,
    scrollCanvas,
    startCanvasInteraction,
  };
}
