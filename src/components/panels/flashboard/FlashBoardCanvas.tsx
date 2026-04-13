import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard, selectActiveBoardNodes, selectNodeById } from '../../../stores/flashboardStore/selectors';
import { FlashBoardNode } from './FlashBoardNode';
import { FlashBoardContextMenu } from './FlashBoardContextMenu';

interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string | null;
  canvasPosition: { x: number; y: number };
}

export function FlashBoardCanvas() {
  const board = useFlashBoardStore(selectActiveBoard);
  const nodes = useFlashBoardStore(selectActiveBoardNodes);
  const selectedNodeIds = useFlashBoardStore((s) => s.selectedNodeIds);
  const clearSelection = useFlashBoardStore((s) => s.clearSelection);
  const updateViewport = useFlashBoardStore((s) => s.updateViewport);
  const createReferenceNode = useFlashBoardStore((s) => s.createReferenceNode);

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Right-click: don't interfere, let contextmenu handle it
    if (e.button === 2) return;
    // Close context menu on any left/middle click
    if (contextMenu) {
      setContextMenu(null);
    }
    if (e.button === 0) {
      clearSelection();
    }
    if (e.button === 0 || e.button === 1) {
      if (!board) return;
      isPanning.current = true;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: board.viewport.panX,
        panY: board.viewport.panY,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isPanning.current || !board) return;
        const dx = ev.clientX - panStart.current.x;
        const dy = ev.clientY - panStart.current.y;
        updateViewport(board.id, {
          panX: panStart.current.panX + dx,
          panY: panStart.current.panY + dy,
        });
      };

      const handleMouseUp = () => {
        isPanning.current = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
  }, [board, clearSelection, updateViewport, contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: null, canvasPosition: canvasPos });
  }, [screenToCanvas]);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, canvasPosition: canvasPos });
  }, [screenToCanvas]);

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

  const selectedSet = new Set(selectedNodeIds);
  const contextNode = useFlashBoardStore((s) =>
    contextMenu?.nodeId ? selectNodeById(s, contextMenu.nodeId) : null
  );

  return (
    <div
      ref={canvasRef}
      className={`flashboard-canvas ${isDragOver ? 'drag-over' : ''}`}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="flashboard-canvas-inner"
        style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}
      >
        {nodes.map((node) => (
          <FlashBoardNode
            key={node.id}
            node={node}
            isSelected={selectedSet.has(node.id)}
            zoom={zoom}
            onContextMenu={handleNodeContextMenu}
          />
        ))}
      </div>

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
