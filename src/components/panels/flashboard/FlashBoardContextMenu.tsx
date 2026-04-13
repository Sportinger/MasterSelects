import { useCallback, useEffect, useRef } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardNode } from '../../../stores/flashboardStore/types';
import { flashBoardMediaBridge } from '../../../services/flashboard/FlashBoardMediaBridge';

interface ContextMenuProps {
  x: number;
  y: number;
  node: FlashBoardNode | null;
  boardId: string;
  canvasPosition: { x: number; y: number };
  onClose: () => void;
}

export function FlashBoardContextMenu({ x, y, node, boardId, canvasPosition, onClose }: ContextMenuProps) {
  const createDraftNode = useFlashBoardStore((s) => s.createDraftNode);
  const openComposer = useFlashBoardStore((s) => s.openComposer);
  const duplicateNode = useFlashBoardStore((s) => s.duplicateNode);
  const removeNode = useFlashBoardStore((s) => s.removeNode);
  const queueNode = useFlashBoardStore((s) => s.queueNode);
  const clearSelection = useFlashBoardStore((s) => s.clearSelection);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const status = node?.job?.status;

  const handleNewDraft = useCallback(() => {
    const n = createDraftNode(boardId, canvasPosition);
    openComposer(n.id);
    onClose();
  }, [boardId, canvasPosition, createDraftNode, openComposer, onClose]);

  const handleEdit = useCallback(() => {
    if (!node) return;
    openComposer(node.id);
    onClose();
  }, [node, openComposer, onClose]);

  const handleRetry = useCallback(() => {
    if (!node) return;
    queueNode(node.id);
    onClose();
  }, [node, queueNode, onClose]);

  const handleDuplicate = useCallback(() => {
    if (!node) return;
    duplicateNode(node.id);
    onClose();
  }, [node, duplicateNode, onClose]);

  const handleDelete = useCallback(() => {
    if (!node) return;
    removeNode(node.id);
    clearSelection();
    onClose();
  }, [node, removeNode, clearSelection, onClose]);

  const handleAddToTimeline = useCallback(() => {
    if (!node?.result?.mediaFileId) return;
    flashBoardMediaBridge.addToTimeline(node.result.mediaFileId);
    onClose();
  }, [node, onClose]);

  return (
    <div
      ref={menuRef}
      className="flashboard-context-menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!node && (
        <>
          <button className="flashboard-context-item" onClick={handleNewDraft}>
            New Draft
          </button>
        </>
      )}
      {node && (
        <>
          {(status === 'draft' || status === 'failed') && (
            <button className="flashboard-context-item" onClick={handleEdit}>
              Edit
            </button>
          )}
          {status === 'failed' && (
            <button className="flashboard-context-item" onClick={handleRetry}>
              Retry
            </button>
          )}
          {status === 'completed' && node.result?.mediaFileId && (
            <button className="flashboard-context-item" onClick={handleAddToTimeline}>
              Add to Timeline
            </button>
          )}
          <button className="flashboard-context-item" onClick={handleDuplicate}>
            Duplicate
          </button>
          <div className="flashboard-context-separator" />
          <button className="flashboard-context-item danger" onClick={handleDelete}>
            Delete
          </button>
        </>
      )}
    </div>
  );
}
