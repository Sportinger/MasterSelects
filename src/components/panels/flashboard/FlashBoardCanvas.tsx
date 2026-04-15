import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import {
  selectActiveBoard,
  selectActiveBoardNodes,
  selectActiveBoardReferenceUsageByMediaFileId,
  selectNodeById,
} from '../../../stores/flashboardStore/selectors';
import { useMediaStore } from '../../../stores/mediaStore';
import { FlashBoardNode } from './FlashBoardNode';
import { FlashBoardContextMenu } from './FlashBoardContextMenu';
import { resolveFlashBoardNodeDisplaySize } from './nodeSizing';

interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string | null;
  canvasPosition: { x: number; y: number };
}

interface PanSession {
  latestClientX: number;
  latestClientY: number;
  currentPanX: number;
  currentPanY: number;
}

interface MarqueeSelectionState {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  hasDragged: boolean;
}

const NODE_VISIBILITY_OVERSCAN_PX = 240;
const MARQUEE_SELECTION_THRESHOLD = 4;

export function FlashBoardCanvas() {
  const board = useFlashBoardStore(selectActiveBoard);
  const nodes = useFlashBoardStore(selectActiveBoardNodes);
  const referenceUsageByMediaFileId = useFlashBoardStore(selectActiveBoardReferenceUsageByMediaFileId);
  const hoveredComposerReference = useFlashBoardStore((s) => s.hoveredComposerReference);
  const selectedNodeIds = useFlashBoardStore((s) => s.selectedNodeIds);
  const clearSelection = useFlashBoardStore((s) => s.clearSelection);
  const setSelectedNodes = useFlashBoardStore((s) => s.setSelectedNodes);
  const updateViewport = useFlashBoardStore((s) => s.updateViewport);
  const createReferenceNode = useFlashBoardStore((s) => s.createReferenceNode);
  const mediaFiles = useMediaStore((s) => s.files);

  const isPanning = useRef(false);
  const marqueeSelectionRef = useRef<MarqueeSelectionState | null>(null);
  const suppressContextMenuRef = useRef(false);
  const panStart = useRef<PanSession>({
    latestClientX: 0,
    latestClientY: 0,
    currentPanX: 0,
    currentPanY: 0,
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [overlapHoverNodeId, setOverlapHoverNodeId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelectionState | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const zoom = board?.viewport.zoom ?? 1;
  const panX = board?.viewport.panX ?? 0;
  const panY = board?.viewport.panY ?? 0;

  // Convert screen coords to canvas coords
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - panX) / zoom,
      y: (clientY - rect.top - panY) / zoom,
    };
  }, [panX, panY, zoom]);

  // Non-passive wheel handler so preventDefault works (avoids browser warning)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const boardState = useFlashBoardStore.getState();
      const activeBoard = boardState.boards.find((b) => b.id === boardState.activeBoardId);
      if (!activeBoard) return;

      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const curZoom = activeBoard.viewport.zoom;
      const newZoom = Math.max(0.1, Math.min(5, curZoom * delta));

      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const newPanX = cursorX - (cursorX - activeBoard.viewport.panX) * (newZoom / curZoom);
      const newPanY = cursorY - (cursorY - activeBoard.viewport.panY) * (newZoom / curZoom);

      boardState.updateViewport(activeBoard.id, { zoom: newZoom, panX: newPanX, panY: newPanY });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    const handlePointerLockChange = () => {
      setIsPointerLocked(document.pointerLockElement === canvasRef.current);
    };

    const handlePointerLockError = () => {
      setIsPointerLocked(false);
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('pointerlockerror', handlePointerLockError);

    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('pointerlockerror', handlePointerLockError);
    };
  }, []);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return;
    }

    const updateSize = () => {
      const rect = canvasElement.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => updateSize());
    resizeObserver.observe(canvasElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const mediaFilesById = useMemo(
    () => new Map(mediaFiles.map((file) => [file.id, file])),
    [mediaFiles],
  );
  const selectNodesInMarquee = useCallback((startClientX: number, startClientY: number, endClientX: number, endClientY: number) => {
    const start = screenToCanvas(startClientX, startClientY);
    const end = screenToCanvas(endClientX, endClientY);
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);

    const nextSelectedNodeIds = nodes.filter((node) => {
      const mediaFileId = node.result?.mediaFileId;
      const mediaFile = mediaFileId ? mediaFilesById.get(mediaFileId) : undefined;
      const { width, height } = resolveFlashBoardNodeDisplaySize(node, mediaFile);
      const left = node.position.x;
      const top = node.position.y;
      const right = left + width;
      const bottom = top + height;

      return right >= minX && left <= maxX && bottom >= minY && top <= maxY;
    }).map((node) => node.id);

    setSelectedNodes(nextSelectedNodeIds);
  }, [mediaFilesById, nodes, screenToCanvas, setSelectedNodes]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (contextMenu) {
      setContextMenu(null);
    }
    if (e.button === 2) {
      const session: MarqueeSelectionState = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
        hasDragged: false,
      };
      marqueeSelectionRef.current = session;

      const handleMouseMove = (ev: MouseEvent) => {
        const currentSession = marqueeSelectionRef.current;
        if (!currentSession) {
          return;
        }

        currentSession.currentClientX = ev.clientX;
        currentSession.currentClientY = ev.clientY;
        const dragDistance = Math.hypot(
          ev.clientX - currentSession.startClientX,
          ev.clientY - currentSession.startClientY,
        );

        if (!currentSession.hasDragged && dragDistance >= MARQUEE_SELECTION_THRESHOLD) {
          currentSession.hasDragged = true;
          suppressContextMenuRef.current = true;
          setOverlapHoverNodeId(null);
        }

        if (!currentSession.hasDragged) {
          return;
        }

        setMarqueeSelection({ ...currentSession });
        selectNodesInMarquee(
          currentSession.startClientX,
          currentSession.startClientY,
          currentSession.currentClientX,
          currentSession.currentClientY,
        );
      };

      const finishMarquee = () => {
        const currentSession = marqueeSelectionRef.current;
        if (currentSession?.hasDragged) {
          selectNodesInMarquee(
            currentSession.startClientX,
            currentSession.startClientY,
            currentSession.currentClientX,
            currentSession.currentClientY,
          );
        }
        marqueeSelectionRef.current = null;
        setMarqueeSelection(null);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('blur', handleWindowBlur);
      };

      const handleMouseUp = () => {
        finishMarquee();
      };

      const handleWindowBlur = () => {
        finishMarquee();
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleWindowBlur);
      return;
    }

    if (e.button === 0) {
      clearSelection();
    }
    if (e.button === 0 || e.button === 1) {
      if (!board) return;
      if (e.button === 1) {
        e.preventDefault();
      }
      isPanning.current = true;
      const canvasElement = canvasRef.current;
      panStart.current = {
        latestClientX: e.clientX,
        latestClientY: e.clientY,
        currentPanX: board.viewport.panX,
        currentPanY: board.viewport.panY,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isPanning.current || !board) return;
        const pointerLocked = document.pointerLockElement === canvasElement;
        let deltaX: number;
        let deltaY: number;

        if (pointerLocked) {
          deltaX = ev.movementX;
          deltaY = ev.movementY;
        } else {
          deltaX = ev.clientX - panStart.current.latestClientX;
          deltaY = ev.clientY - panStart.current.latestClientY;
          panStart.current.latestClientX = ev.clientX;
          panStart.current.latestClientY = ev.clientY;
        }

        const nextPanX = panStart.current.currentPanX + deltaX;
        const nextPanY = panStart.current.currentPanY + deltaY;
        panStart.current.currentPanX = nextPanX;
        panStart.current.currentPanY = nextPanY;
        updateViewport(board.id, {
          panX: nextPanX,
          panY: nextPanY,
        });
      };

      const finishPan = () => {
        isPanning.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('blur', handleWindowBlur);
        if (document.pointerLockElement === canvasElement) {
          void document.exitPointerLock();
        }
      };

      const handleMouseUp = () => {
        finishPan();
      };

      const handleWindowBlur = () => {
        finishPan();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleWindowBlur);

      if (canvasElement?.requestPointerLock) {
        void Promise.resolve(canvasElement.requestPointerLock()).catch(() => undefined);
      }
    }
  }, [board, clearSelection, contextMenu, selectNodesInMarquee, updateViewport]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    setOverlapHoverNodeId(null);
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: null, canvasPosition: canvasPos });
  }, [screenToCanvas]);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    setOverlapHoverNodeId(null);
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, canvasPosition: canvasPos });
  }, [screenToCanvas]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (marqueeSelectionRef.current) {
      setOverlapHoverNodeId(null);
      return;
    }
    if (isPanning.current) {
      setOverlapHoverNodeId(null);
      return;
    }

    const stackedNodeIds: string[] = [];
    for (const element of document.elementsFromPoint(e.clientX, e.clientY)) {
      const nodeElement = element.closest<HTMLElement>('.flashboard-node[data-flashboard-node-id]');
      const nodeId = nodeElement?.dataset.flashboardNodeId;
      if (!nodeId || stackedNodeIds.includes(nodeId)) {
        continue;
      }
      stackedNodeIds.push(nodeId);
      if (stackedNodeIds.length >= 2) {
        break;
      }
    }

    setOverlapHoverNodeId(stackedNodeIds[1] ?? null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setOverlapHoverNodeId(null);
  }, []);

  // DnD handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!board) return;

    const canvasPos = screenToCanvas(e.clientX, e.clientY);

    // Check for media file ID (from Media Panel or Timeline)
    const mediaFileId = e.dataTransfer.getData('application/x-media-file-id');
    if (mediaFileId) {
      createReferenceNode(board.id, mediaFileId, canvasPos);
      return;
    }

    // Check for desktop files
    if (e.dataTransfer.files.length > 0) {
      // Import desktop files as reference nodes via media store
      import('../../../stores/mediaStore').then(({ useMediaStore }) => {
        const { importFile } = useMediaStore.getState();
        Array.from(e.dataTransfer.files).forEach(async (file, i) => {
          const mediaFile = await importFile(file);
          if (mediaFile) {
            createReferenceNode(board.id, mediaFile.id, {
              x: canvasPos.x + i * 220,
              y: canvasPos.y,
            });
          }
        });
      });
    }
  }, [board, screenToCanvas, createReferenceNode]);

  const visibleNodes = useMemo(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) {
      return nodes;
    }

    const overscanWorld = NODE_VISIBILITY_OVERSCAN_PX / Math.max(zoom, 0.1);
    const minX = ((-panX) / Math.max(zoom, 0.1)) - overscanWorld;
    const minY = ((-panY) / Math.max(zoom, 0.1)) - overscanWorld;
    const maxX = ((canvasSize.width - panX) / Math.max(zoom, 0.1)) + overscanWorld;
    const maxY = ((canvasSize.height - panY) / Math.max(zoom, 0.1)) + overscanWorld;

    return nodes.filter((node) => {
      const mediaFileId = node.result?.mediaFileId;
      const mediaFile = mediaFileId ? mediaFilesById.get(mediaFileId) : undefined;
      const { width, height } = resolveFlashBoardNodeDisplaySize(node, mediaFile);
      const left = node.position.x;
      const top = node.position.y;
      const right = left + width;
      const bottom = top + height;

      return right >= minX && left <= maxX && bottom >= minY && top <= maxY;
    });
  }, [canvasSize.height, canvasSize.width, mediaFilesById, nodes, panX, panY, zoom]);

  const selectedSet = new Set(selectedNodeIds);
  const contextNode = useFlashBoardStore((s) =>
    contextMenu?.nodeId ? selectNodeById(s, contextMenu.nodeId) : null
  );
  const overlapOutlineNode = useFlashBoardStore((s) =>
    overlapHoverNodeId ? selectNodeById(s, overlapHoverNodeId) : null
  );
  const overlapOutlineMediaFile = useMediaStore((s) => {
    const mediaFileId = overlapOutlineNode?.result?.mediaFileId;
    if (!mediaFileId) return undefined;
    return s.files.find((file) => file.id === mediaFileId);
  });
  const overlapOutlineSize = overlapOutlineNode
    ? resolveFlashBoardNodeDisplaySize(overlapOutlineNode, overlapOutlineMediaFile)
    : null;
  const marqueeRect = useMemo(() => {
    if (!marqueeSelection?.hasDragged) {
      return null;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const startX = clamp(marqueeSelection.startClientX - rect.left, 0, rect.width);
    const startY = clamp(marqueeSelection.startClientY - rect.top, 0, rect.height);
    const endX = clamp(marqueeSelection.currentClientX - rect.left, 0, rect.width);
    const endY = clamp(marqueeSelection.currentClientY - rect.top, 0, rect.height);

    return {
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
    };
  }, [marqueeSelection]);

  return (
    <div
      ref={canvasRef}
      className={`flashboard-canvas ${isDragOver ? 'drag-over' : ''} ${isPointerLocked ? 'pointer-locked' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="flashboard-canvas-inner"
        style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}
      >
        {visibleNodes.map((node) => (
          <FlashBoardNode
            key={node.id}
            node={node}
            isSelected={selectedSet.has(node.id)}
            isOverlapOutlined={overlapHoverNodeId === node.id}
            zoom={zoom}
            referenceUsage={node.result?.mediaFileId ? referenceUsageByMediaFileId[node.result.mediaFileId] : undefined}
            hoveredComposerReferenceRole={
              node.result?.mediaFileId && hoveredComposerReference?.mediaFileId === node.result.mediaFileId
                ? hoveredComposerReference.role
                : undefined
            }
            onContextMenu={handleNodeContextMenu}
          />
        ))}
        {overlapOutlineNode && overlapOutlineSize && (
          <div
            className="flashboard-node-overlap-outline"
            style={{
              left: overlapOutlineNode.position.x,
              top: overlapOutlineNode.position.y,
              width: overlapOutlineSize.width,
              height: overlapOutlineSize.height,
            }}
          />
        )}
      </div>

      {marqueeRect && (
        <div
          className="flashboard-canvas-marquee"
          style={marqueeRect}
        />
      )}

      {contextMenu && board && (
        <FlashBoardContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextNode ?? null}
          boardId={board.id}
          canvasPosition={contextMenu.canvasPosition}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
