import { useCallback, useRef } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardNode as FlashBoardNodeType } from '../../../stores/flashboardStore/types';
import { useMediaStore } from '../../../stores/mediaStore';

interface FlashBoardNodeProps {
  node: FlashBoardNodeType;
  isSelected: boolean;
  zoom: number;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
}

export function FlashBoardNode({ node, isSelected, zoom, onContextMenu }: FlashBoardNodeProps) {
  const moveNode = useFlashBoardStore((s) => s.moveNode);
  const setSelectedNodes = useFlashBoardStore((s) => s.setSelectedNodes);
  const openComposer = useFlashBoardStore((s) => s.openComposer);

  const dragRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);

  const status = node.job?.status ?? (node.kind === 'reference' ? 'completed' : 'draft');
  const prompt = node.request?.prompt;
  const provider = node.request?.providerId;

  // Get thumbnail for reference/completed nodes
  const mediaFileId = node.result?.mediaFileId;
  const thumbnailUrl = useMediaStore((s) => {
    if (!mediaFileId) return undefined;
    const file = s.files.find((f) => f.id === mediaFileId);
    return file?.thumbnailUrl || file?.url;
  });
  const mediaName = useMediaStore((s) => {
    if (!mediaFileId) return undefined;
    return s.files.find((f) => f.id === mediaFileId)?.name;
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    setSelectedNodes([node.id]);

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.position.x,
      nodeY: node.position.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = (ev.clientX - dragRef.current.startX) / zoom;
      const dy = (ev.clientY - dragRef.current.startY) / zoom;
      moveNode(node.id, {
        x: dragRef.current.nodeX + dx,
        y: dragRef.current.nodeY + dy,
      });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [node.id, node.position.x, node.position.y, zoom, moveNode, setSelectedNodes]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.kind === 'generation') {
      openComposer(node.id);
    }
  }, [node.id, node.kind, openComposer]);

  const handleRightClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNodes([node.id]);
    onContextMenu(e, node.id);
  }, [node.id, setSelectedNodes, onContextMenu]);

  // DnD: allow dragging completed/reference nodes to timeline
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!mediaFileId) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/x-media-file-id', mediaFileId);
    e.dataTransfer.effectAllowed = 'copy';
  }, [mediaFileId]);

  const isReference = node.kind === 'reference';

  return (
    <div
      className={`flashboard-node ${status} ${isSelected ? 'selected' : ''} ${isReference ? 'reference' : ''}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.size.width,
        height: node.size.height,
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleRightClick}
      draggable={!!mediaFileId}
      onDragStart={handleDragStart}
    >
      <div className="flashboard-node-status" />
      <div className="flashboard-node-body">
        {thumbnailUrl && (
          <img className="flashboard-node-thumbnail" src={thumbnailUrl} alt="" />
        )}
        {isReference && mediaName && (
          <div className="flashboard-node-prompt">{mediaName}</div>
        )}
        {!isReference && (
          <>
            <div className={`flashboard-node-prompt ${!prompt ? 'empty' : ''}`}>
              {prompt || 'No prompt yet'}
            </div>
            {provider && (
              <div className="flashboard-node-provider">{provider}</div>
            )}
          </>
        )}
        {status === 'processing' && node.job?.progress != null && (
          <div className="flashboard-node-progress">
            <div
              className="flashboard-node-progress-bar"
              style={{ width: `${Math.round(node.job.progress * 100)}%` }}
            />
          </div>
        )}
        {status === 'failed' && node.job?.error && (
          <div className="flashboard-node-error" title={node.job.error}>
            {node.job.error}
          </div>
        )}
      </div>
    </div>
  );
}
