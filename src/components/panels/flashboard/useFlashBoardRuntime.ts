import { useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard } from '../../../stores/flashboardStore/selectors';
import { flashBoardJobService } from '../../../services/flashboard/FlashBoardJobService';
import { flashBoardMediaBridge } from '../../../services/flashboard/FlashBoardMediaBridge';

interface FlashBoardRuntimeOptions {
  enableKeyboardDelete?: boolean;
}

export function useFlashBoardRuntime(options: FlashBoardRuntimeOptions = {}) {
  const { enableKeyboardDelete = true } = options;
  const board = useFlashBoardStore(selectActiveBoard);
  const boards = useFlashBoardStore((s) => s.boards);
  const createBoard = useFlashBoardStore((s) => s.createBoard);
  const setActiveBoard = useFlashBoardStore((s) => s.setActiveBoard);
  const updateNodeJob = useFlashBoardStore((s) => s.updateNodeJob);
  const failNode = useFlashBoardStore((s) => s.failNode);
  const selectedNodeIds = useFlashBoardStore((s) => s.selectedNodeIds);
  const removeNode = useFlashBoardStore((s) => s.removeNode);
  const clearSelection = useFlashBoardStore((s) => s.clearSelection);

  useEffect(() => {
    if (boards.length === 0) {
      createBoard('FlashBoard 1');
    } else if (!board && boards.length > 0) {
      setActiveBoard(boards[0].id);
    }
  }, [boards, board, createBoard, setActiveBoard]);

  useEffect(() => {
    flashBoardJobService.setUpdateCallback((nodeId, update) => {
      if (update.status === 'completed') {
        if (!update.mediaType || (!update.assetUrl && !update.assetFile)) {
          failNode(nodeId, 'Generation finished without importable media.');
          return;
        }

        const importPromise = update.assetFile
          ? flashBoardMediaBridge.importGeneratedFile(nodeId, update.assetFile, update.mediaType)
          : flashBoardMediaBridge.importGeneratedMedia(nodeId, update.assetUrl as string, update.mediaType);

        void importPromise.catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to import generated media';
          failNode(nodeId, message);
        });
        return;
      }

      if (update.status === 'failed') {
        failNode(nodeId, update.error || 'Generation failed');
        return;
      }

      updateNodeJob(nodeId, {
        status: update.status,
        remoteTaskId: update.remoteTaskId,
        progress: update.progress,
      });
    });

    return () => {
      flashBoardJobService.setUpdateCallback(null);
    };
  }, [updateNodeJob, failNode]);

  useEffect(() => {
    if (!enableKeyboardDelete) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || selectedNodeIds.length === 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }

      event.preventDefault();
      selectedNodeIds.forEach((nodeId) => removeNode(nodeId));
      clearSelection();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, enableKeyboardDelete, removeNode, selectedNodeIds]);
}
