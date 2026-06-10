import { useCallback, useEffect, useRef, type Dispatch, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type SetStateAction } from 'react';
import { Logger } from '../../../../services/logger';
import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import type { MediaFolder, ProjectItem } from '../../../../stores/mediaStore';
import {
  applyExternalDragPayloadToDataTransfer,
  clearExternalDragPayload,
  createExternalDragPayloadForProjectItem,
  setExternalDragPayload,
} from '../../../timeline/utils/externalDragSession';
import { collectDroppedMediaFiles, planDroppedMediaImports } from '../dropImport';
import { isImportedMediaFileItem } from '../itemTypeGuards';

const log = Logger.create('MediaPanel');

export interface MediaPanelMarquee {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface UseMediaPanelDragDropMarqueeInput {
  itemListRef: { current: HTMLDivElement | null };
  renameTimerRef: { current: number | null };
  folders: MediaFolder[];
  selectedIds: string[];
  activeCompositionId: string | null;
  setSelection: (ids: string[]) => void;
  moveToFolder: (itemIds: string[], folderId: string | null) => void;
  createFolder: (name: string, parentId?: string | null) => MediaFolder;
  importFiles: (files: File[] | FileList, parentId?: string | null) => Promise<unknown>;
  importFilesWithHandles: (
    filesWithHandles: Array<{
      file: File;
      handle: FileSystemFileHandle;
      absolutePath?: string;
    }>,
    parentId?: string | null,
  ) => Promise<unknown>;
  setMarquee: Dispatch<SetStateAction<MediaPanelMarquee | null>>;
  setInternalDragId: Dispatch<SetStateAction<string | null>>;
  setDragOverFolderId: Dispatch<SetStateAction<string | null>>;
  setIsExternalDragOver: Dispatch<SetStateAction<boolean>>;
  clearMediaBoardInsertionPreview: () => void;
  getSlotGridProgress: () => number;
}

export function useMediaPanelDragDropMarquee({
  itemListRef,
  renameTimerRef,
  folders,
  selectedIds,
  activeCompositionId,
  setSelection,
  moveToFolder,
  createFolder,
  importFiles,
  importFilesWithHandles,
  setMarquee,
  setInternalDragId,
  setDragOverFolderId,
  setIsExternalDragOver,
  clearMediaBoardInsertionPreview,
  getSlotGridProgress,
}: UseMediaPanelDragDropMarqueeInput) {
  const marqueeRef = useRef<{ startX: number; startY: number; initialSelection: string[] } | null>(null);
  const nativeDragGuardsRef = useRef<(() => void) | null>(null);
  const externalOverGuardsRef = useRef<(() => void) | null>(null);

  const removeExternalOverGuards = useCallback(() => {
    externalOverGuardsRef.current?.();
    externalOverGuardsRef.current = null;
  }, []);

  const clearExternalDragOver = useCallback(() => {
    setIsExternalDragOver(false);
    removeExternalOverGuards();
  }, [removeExternalOverGuards, setIsExternalDragOver]);

  // OS file drags fire no dragend in the page and dragleave coordinates are
  // unreliable in Chromium, so the panel-local leave check alone can strand
  // the import overlay. Watch the whole document while the overlay is up.
  const installExternalOverGuards = useCallback((panelEl: HTMLElement) => {
    if (externalOverGuardsRef.current) return;

    const handleDocumentDragOver = (event: DragEvent) => {
      if (!(event.target instanceof Node) || !panelEl.contains(event.target)) {
        clearExternalDragOver();
      }
    };
    const handleDrop = () => {
      window.setTimeout(clearExternalDragOver, 0);
    };
    const handleWindowDragLeave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        clearExternalDragOver();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearExternalDragOver();
    };

    document.addEventListener('dragover', handleDocumentDragOver, true);
    document.addEventListener('drop', handleDrop, true);
    document.addEventListener('dragend', clearExternalDragOver, true);
    document.addEventListener('dragleave', handleWindowDragLeave, true);
    document.addEventListener('keydown', handleKeyDown, true);

    externalOverGuardsRef.current = () => {
      document.removeEventListener('dragover', handleDocumentDragOver, true);
      document.removeEventListener('drop', handleDrop, true);
      document.removeEventListener('dragend', clearExternalDragOver, true);
      document.removeEventListener('dragleave', handleWindowDragLeave, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [clearExternalDragOver]);

  const removeNativeDragGuards = useCallback(() => {
    nativeDragGuardsRef.current?.();
    nativeDragGuardsRef.current = null;
  }, []);

  const clearMediaPanelDragSession = useCallback(() => {
    setInternalDragId(null);
    setDragOverFolderId(null);
    clearExternalDragOver();
    clearMediaBoardInsertionPreview();
    clearExternalDragPayload();
  }, [
    clearExternalDragOver,
    clearMediaBoardInsertionPreview,
    setDragOverFolderId,
    setInternalDragId,
  ]);

  const finishNativeDragSession = useCallback(() => {
    clearMediaPanelDragSession();
    removeNativeDragGuards();
  }, [clearMediaPanelDragSession, removeNativeDragGuards]);

  const installNativeDragGuards = useCallback(() => {
    removeNativeDragGuards();

    let deferredDropCleanup: number | null = null;
    const finishNow = () => {
      if (deferredDropCleanup !== null) {
        window.clearTimeout(deferredDropCleanup);
        deferredDropCleanup = null;
      }
      finishNativeDragSession();
    };
    const finishAfterDropHandlers = () => {
      if (deferredDropCleanup !== null) return;
      deferredDropCleanup = window.setTimeout(() => {
        deferredDropCleanup = null;
        finishNativeDragSession();
      }, 0);
    };
    const handleDocumentDragLeave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        finishNow();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finishNow();
      }
    };

    document.addEventListener('drop', finishAfterDropHandlers, true);
    document.addEventListener('dragend', finishNow, true);
    document.addEventListener('dragleave', handleDocumentDragLeave, true);
    document.addEventListener('keydown', handleKeyDown, true);

    nativeDragGuardsRef.current = () => {
      if (deferredDropCleanup !== null) {
        window.clearTimeout(deferredDropCleanup);
      }
      document.removeEventListener('drop', finishAfterDropHandlers, true);
      document.removeEventListener('dragend', finishNow, true);
      document.removeEventListener('dragleave', handleDocumentDragLeave, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [finishNativeDragSession, removeNativeDragGuards]);

  useEffect(() => () => {
    removeNativeDragGuards();
    removeExternalOverGuards();
  }, [removeExternalOverGuards, removeNativeDragGuards]);

  const handleExternalDropImport = useCallback(async (dataTransfer: DataTransfer, targetParentId: string | null) => {
    const droppedFiles = await collectDroppedMediaFiles(dataTransfer);

    if (droppedFiles.length === 0) {
      return;
    }

    const importBatches = planDroppedMediaImports(
      droppedFiles,
      folders,
      targetParentId,
      createFolder,
    );

    for (const batch of importBatches) {
      if (batch.filesWithHandles.length > 0) {
        await importFilesWithHandles(batch.filesWithHandles, batch.parentId);
      }

      if (batch.files.length > 0) {
        await importFiles(batch.files, batch.parentId);
      }
    }
  }, [createFolder, folders, importFiles, importFilesWithHandles]);

  const handleDragOver = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const hasFiles = e.dataTransfer.types.includes('Files');
    const isInternalDrag = e.dataTransfer.types.includes('application/x-media-panel-item');

    log.debug('DragOver', { hasFiles, isInternalDrag, types: [...e.dataTransfer.types] });

    if (hasFiles && !isInternalDrag) {
      e.dataTransfer.dropEffect = 'copy';
      setIsExternalDragOver(true);
      if (e.currentTarget instanceof HTMLElement) {
        installExternalOverGuards(e.currentTarget);
      }
    }
  }, [installExternalOverGuards, setIsExternalDragOver]);

  const handleDragLeave = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      clearExternalDragOver();
    }
  }, [clearExternalDragOver]);

  const handleMarqueeMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, .context-menu, .media-column-headers, .media-col-resize-handle')) return;

    const clickedOnItem = !!target.closest('.media-item, .media-grid-item');
    if (clickedOnItem) return;

    const container = itemListRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const startX = e.clientX - rect.left + container.scrollLeft;
    const startY = e.clientY - rect.top + container.scrollTop;
    const clientStartX = e.clientX;
    const clientStartY = e.clientY;

    const initial = e.ctrlKey || e.metaKey ? [...selectedIds] : [];
    let isDragging = false;

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - clientStartX;
      const dy = ev.clientY - clientStartY;

      if (!isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        isDragging = true;
        marqueeRef.current = { startX, startY, initialSelection: initial };
        if (!ev.ctrlKey && !ev.metaKey) {
          setSelection([]);
        }
      }

      if (!isDragging || !marqueeRef.current) return;

      const r = container.getBoundingClientRect();
      const cx = ev.clientX - r.left + container.scrollLeft;
      const cy = ev.clientY - r.top + container.scrollTop;
      setMarquee({ startX: marqueeRef.current.startX, startY: marqueeRef.current.startY, currentX: cx, currentY: cy });

      const mLeft = Math.min(marqueeRef.current.startX, cx);
      const mRight = Math.max(marqueeRef.current.startX, cx);
      const mTop = Math.min(marqueeRef.current.startY, cy);
      const mBottom = Math.max(marqueeRef.current.startY, cy);

      const itemEls = container.querySelectorAll('.media-item, .media-grid-item');
      const hitIds: string[] = [];
      itemEls.forEach((el) => {
        const elRect = el.getBoundingClientRect();
        const elTop = elRect.top - r.top + container.scrollTop;
        const elBottom = elTop + elRect.height;
        const elLeft = elRect.left - r.left + container.scrollLeft;
        const elRight = elLeft + elRect.width;
        if (elRight > mLeft && elLeft < mRight && elBottom > mTop && elTop < mBottom) {
          const itemId = (el as HTMLElement).dataset.mediaPanelAnimId ?? el.parentElement?.getAttribute('data-item-id');
          if (itemId) hitIds.push(itemId);
        }
      });

      const combined = [...new Set([...marqueeRef.current.initialSelection, ...hitIds])];
      setSelection(combined);
    };

    const handleMouseUp = () => {
      if (!isDragging && !e.ctrlKey && !e.metaKey) {
        setSelection([]);
      }
      isDragging = false;
      marqueeRef.current = null;
      setMarquee(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [itemListRef, selectedIds, setMarquee, setSelection]);

  const handleDragStart = useCallback((e: ReactDragEvent, item: ProjectItem) => {
    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }
    const isFolder = 'isExpanded' in item;
    clearExternalDragPayload();

    e.dataTransfer.setData('application/x-media-panel-item', item.id);
    setInternalDragId(item.id);
    installNativeDragGuards();

    if (isFolder) {
      e.dataTransfer.effectAllowed = 'move';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    if (isImportedMediaFileItem(item) && (item.isImporting || mediaNeedsRelink(item))) {
      e.dataTransfer.effectAllowed = 'move';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    const payload = createExternalDragPayloadForProjectItem(item, {
      activeCompositionId,
      slotGridProgress: getSlotGridProgress(),
    });

    if (!payload) {
      e.preventDefault();
      return;
    }

    setExternalDragPayload(payload);
    applyExternalDragPayloadToDataTransfer(e.dataTransfer, payload);
    e.dataTransfer.effectAllowed = 'copyMove';

    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
    }
  }, [activeCompositionId, getSlotGridProgress, installNativeDragGuards, renameTimerRef, setInternalDragId]);

  const handleDragEnd = useCallback(() => {
    finishNativeDragSession();
  }, [finishNativeDragSession]);

  const handleFolderDragOver = useCallback((e: ReactDragEvent, folderId: string) => {
    const isInternalDrag = e.dataTransfer.types.includes('application/x-media-panel-item');
    const hasFiles = e.dataTransfer.types.includes('Files');

    if (!isInternalDrag && !hasFiles) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = isInternalDrag ? 'move' : 'copy';
    setDragOverFolderId(folderId);
  }, [setDragOverFolderId]);

  const handleFolderDragLeave = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
  }, [setDragOverFolderId]);

  const handleFolderDrop = useCallback(async (e: ReactDragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!e.dataTransfer.types.includes('application/x-media-panel-item')) {
      setIsExternalDragOver(false);
      await handleExternalDropImport(e.dataTransfer, folderId);
      clearMediaPanelDragSession();
      return;
    }

    const itemId = e.dataTransfer.getData('application/x-media-panel-item');
    if (itemId && itemId !== folderId) {
      const draggedFolder = folders.find(f => f.id === itemId);
      if (draggedFolder) {
        let parent = folders.find(f => f.id === folderId);
        while (parent) {
          if (parent.id === itemId) {
            clearMediaPanelDragSession();
            return;
          }
          parent = folders.find(f => f.id === parent?.parentId);
        }
      }

      const itemsToMove = selectedIds.includes(itemId) ? selectedIds : [itemId];
      moveToFolder(itemsToMove, folderId);
    }

    clearMediaPanelDragSession();
  }, [clearMediaPanelDragSession, folders, handleExternalDropImport, moveToFolder, selectedIds, setIsExternalDragOver]);

  const handleRootDrop = useCallback(async (e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExternalDragOver(false);

    log.debug('Drop event', { types: [...e.dataTransfer.types], filesCount: e.dataTransfer.files.length });

    if (!e.dataTransfer.types.includes('application/x-media-panel-item')) {
      await handleExternalDropImport(e.dataTransfer, null);
      clearMediaPanelDragSession();
      return;
    }

    const itemId = e.dataTransfer.getData('application/x-media-panel-item');
    if (itemId) {
      const itemsToMove = selectedIds.includes(itemId) ? selectedIds : [itemId];
      moveToFolder(itemsToMove, null);
    }

    clearMediaPanelDragSession();
  }, [clearMediaPanelDragSession, handleExternalDropImport, moveToFolder, selectedIds, setIsExternalDragOver]);

  return {
    handleExternalDropImport,
    handleDragOver,
    handleDragLeave,
    handleMarqueeMouseDown,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    handleRootDrop,
  };
}
