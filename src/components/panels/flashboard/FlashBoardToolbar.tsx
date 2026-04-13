import { useState, useCallback, useRef, useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard, selectQueuedNodes, selectProcessingNodes } from '../../../stores/flashboardStore/selectors';

export function FlashBoardToolbar() {
  const board = useFlashBoardStore(selectActiveBoard);
  const renameBoard = useFlashBoardStore((s) => s.renameBoard);
  const createDraftNode = useFlashBoardStore((s) => s.createDraftNode);
  const openComposer = useFlashBoardStore((s) => s.openComposer);
  const queuedCount = useFlashBoardStore((s) => selectQueuedNodes(s).length);
  const processingCount = useFlashBoardStore((s) => selectProcessingNodes(s).length);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = useCallback(() => {
    if (!board) return;
    setEditName(board.name);
    setIsEditing(true);
  }, [board]);

  const commitRename = useCallback(() => {
    if (board && editName.trim()) {
      renameBoard(board.id, editName.trim());
    }
    setIsEditing(false);
  }, [board, editName, renameBoard]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setIsEditing(false);
  }, [commitRename]);

  const handleNewDraft = useCallback(() => {
    if (!board) return;
    const node = createDraftNode(board.id);
    openComposer(node.id);
  }, [board, createDraftNode, openComposer]);

  const activeCount = queuedCount + processingCount;

  return (
    <div className="flashboard-toolbar">
      {isEditing ? (
        <input
          ref={inputRef}
          className="flashboard-toolbar-name-input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span
          className="flashboard-toolbar-name"
          onDoubleClick={handleDoubleClick}
        >
          {board?.name ?? 'FlashBoard'}
        </span>
      )}

      <div className="flashboard-toolbar-spacer" />

      {activeCount > 0 && (
        <span className={`flashboard-queue-badge ${activeCount > 0 ? 'has-active' : ''}`}>
          {processingCount > 0 && `${processingCount} running`}
          {processingCount > 0 && queuedCount > 0 && ' / '}
          {queuedCount > 0 && `${queuedCount} queued`}
        </span>
      )}

      <button className="flashboard-toolbar-btn" onClick={handleNewDraft}>
        + New Draft
      </button>
    </div>
  );
}
