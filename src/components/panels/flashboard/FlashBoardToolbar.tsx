import { useState, useCallback, useRef, useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard, selectQueuedNodes, selectProcessingNodes } from '../../../stores/flashboardStore/selectors';

interface BoardContextMenuState {
  boardId: string;
  x: number;
  y: number;
}

export function FlashBoardToolbar() {
  const board = useFlashBoardStore(selectActiveBoard);
  const boards = useFlashBoardStore((s) => s.boards);
  const createBoard = useFlashBoardStore((s) => s.createBoard);
  const removeBoard = useFlashBoardStore((s) => s.removeBoard);
  const renameBoard = useFlashBoardStore((s) => s.renameBoard);
  const setActiveBoard = useFlashBoardStore((s) => s.setActiveBoard);
  const createDraftNode = useFlashBoardStore((s) => s.createDraftNode);
  const openComposer = useFlashBoardStore((s) => s.openComposer);
  const queuedCount = useFlashBoardStore((s) => selectQueuedNodes(s).length);
  const processingCount = useFlashBoardStore((s) => selectProcessingNodes(s).length);

  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [contextMenu, setContextMenu] = useState<BoardContextMenuState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingBoardId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingBoardId]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const startRename = useCallback((boardId: string, currentName: string) => {
    setEditName(currentName);
    setEditingBoardId(boardId);
    setContextMenu(null);
  }, []);

  const commitRename = useCallback(() => {
    if (editingBoardId && editName.trim()) {
      renameBoard(editingBoardId, editName.trim());
    }
    setEditingBoardId(null);
  }, [editingBoardId, editName, renameBoard]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setEditingBoardId(null);
  }, [commitRename]);

  const handleNewDraft = useCallback(() => {
    if (!board) return;
    const node = createDraftNode(board.id);
    openComposer(node.id);
  }, [board, createDraftNode, openComposer]);

  const handleNewBoard = useCallback(() => {
    const nextIndex = boards.length + 1;
    createBoard(`FlashBoard ${nextIndex}`);
  }, [boards.length, createBoard]);

  const handleTabContextMenu = useCallback((event: React.MouseEvent, boardId: string) => {
    event.preventDefault();
    event.stopPropagation();

    setContextMenu({
      boardId,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const handleDeleteBoard = useCallback(() => {
    if (!contextMenu) {
      return;
    }

    removeBoard(contextMenu.boardId);
    setContextMenu(null);
  }, [contextMenu, removeBoard]);

  const activeCount = queuedCount + processingCount;
  const contextBoard = contextMenu
    ? boards.find((boardItem) => boardItem.id === contextMenu.boardId) ?? null
    : null;

  return (
    <div className="flashboard-toolbar">
      <div className="flashboard-toolbar-tabs" role="tablist" aria-label="FlashBoards">
        {boards.map((boardItem) => {
          const isActive = boardItem.id === board?.id;
          const isEditing = editingBoardId === boardItem.id;

          return isEditing ? (
            <input
              key={boardItem.id}
              ref={inputRef}
              className="flashboard-toolbar-name-input flashboard-toolbar-tab-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={handleKeyDown}
            />
          ) : (
            <button
              key={boardItem.id}
              type="button"
              className={`flashboard-toolbar-tab ${isActive ? 'active' : ''}`}
              onClick={() => setActiveBoard(boardItem.id)}
              onDoubleClick={() => startRename(boardItem.id, boardItem.name)}
              onContextMenu={(event) => handleTabContextMenu(event, boardItem.id)}
              title={boardItem.name}
            >
              <span className="flashboard-toolbar-tab-label">{boardItem.name}</span>
            </button>
          );
        })}

        <button
          type="button"
          className="flashboard-toolbar-tab-add"
          onClick={handleNewBoard}
          title="New FlashBoard"
        >
          +
        </button>
      </div>

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

      {contextMenu && contextBoard && (
        <div
          ref={menuRef}
          className="flashboard-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="flashboard-context-item danger"
            onClick={handleDeleteBoard}
            disabled={boards.length <= 1}
          >
            Delete Board
          </button>
          {boards.length <= 1 && (
            <button className="flashboard-context-item hint" disabled>
              Create another board first
            </button>
          )}
        </div>
      )}
    </div>
  );
}
