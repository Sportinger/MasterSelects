import { useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard } from '../../../stores/flashboardStore/selectors';
import { FlashBoardToolbar } from './FlashBoardToolbar';
import { FlashBoardCanvas } from './FlashBoardCanvas';
import { FlashBoardComposer } from './FlashBoardComposer';
import './FlashBoard.css';

export function FlashBoardWorkspace() {
  const board = useFlashBoardStore(selectActiveBoard);
  const boards = useFlashBoardStore((s) => s.boards);
  const createBoard = useFlashBoardStore((s) => s.createBoard);
  const setActiveBoard = useFlashBoardStore((s) => s.setActiveBoard);

  useEffect(() => {
    if (boards.length === 0) {
      createBoard('FlashBoard 1');
    } else if (!board && boards.length > 0) {
      setActiveBoard(boards[0].id);
    }
  }, [boards, board, createBoard, setActiveBoard]);

  return (
    <div className="flashboard-workspace">
      <FlashBoardToolbar />
      <div className="flashboard-canvas-area">
        <FlashBoardCanvas />
        <FlashBoardComposer />
      </div>
    </div>
  );
}
