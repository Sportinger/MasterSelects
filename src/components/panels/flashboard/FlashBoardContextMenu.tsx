import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardNode } from '../../../stores/flashboardStore/types';
import { flashBoardMediaBridge } from '../../../services/flashboard/FlashBoardMediaBridge';
import { getCatalogEntry } from '../../../services/flashboard/FlashBoardModelCatalog';

interface ContextMenuProps {
  x: number;
  y: number;
  node: FlashBoardNode | null;
  boardId: string;
  canvasPosition: { x: number; y: number };
  onClose: () => void;
}

export function FlashBoardContextMenu({ x, y, node, boardId, canvasPosition, onClose }: ContextMenuProps) {
  const boardNodes = useFlashBoardStore((s) => s.boards.find((board) => board.id === boardId)?.nodes ?? []);
  const selectedNodeIds = useFlashBoardStore((s) => s.selectedNodeIds);
  const composer = useFlashBoardStore((s) => s.composer);
  const createDraftNode = useFlashBoardStore((s) => s.createDraftNode);
  const bringNodesToFront = useFlashBoardStore((s) => s.bringNodesToFront);
  const openComposer = useFlashBoardStore((s) => s.openComposer);
  const duplicateNode = useFlashBoardStore((s) => s.duplicateNode);
  const removeNode = useFlashBoardStore((s) => s.removeNode);
  const queueNode = useFlashBoardStore((s) => s.queueNode);
  const sendNodesToBack = useFlashBoardStore((s) => s.sendNodesToBack);
  const updateComposer = useFlashBoardStore((s) => s.updateComposer);
  const updateNodeRequest = useFlashBoardStore((s) => s.updateNodeRequest);
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
  const selectedGenerationTarget = boardNodes.find((candidate) => (
    selectedNodeIds.includes(candidate.id) &&
    candidate.id !== node?.id &&
    candidate.kind === 'generation' &&
    Boolean(candidate.request)
  )) ?? null;
  const selectedTargetCatalogEntry = selectedGenerationTarget?.request
    ? getCatalogEntry(selectedGenerationTarget.request.service, selectedGenerationTarget.request.providerId)
    : undefined;
  const selectedTargetOutputType =
    selectedGenerationTarget?.request?.outputType ??
    selectedTargetCatalogEntry?.outputType ??
    (selectedTargetCatalogEntry?.supportsTextToImage ? 'image' : 'video');
  const selectedTargetSupportsImageReference =
    selectedTargetOutputType === 'image' ||
    Boolean(selectedTargetCatalogEntry?.supportsTextToImage);
  const selectedVideoTarget = (
    !selectedTargetSupportsImageReference &&
    selectedTargetCatalogEntry?.supportsImageToVideo
  ) ? selectedGenerationTarget : null;
  const selectedVideoTargetMultiShots = Boolean(selectedVideoTarget?.request?.multiShots);
  const selectedImageTarget = selectedTargetSupportsImageReference ? selectedGenerationTarget : null;
  const generationNode = node?.kind === 'generation' ? node : null;
  const generationCatalogEntry = generationNode?.request
    ? getCatalogEntry(generationNode.request.service, generationNode.request.providerId)
    : undefined;
  const generationOutputType =
    generationNode?.request?.outputType ??
    generationCatalogEntry?.outputType ??
    (generationCatalogEntry?.supportsTextToImage ? 'image' : 'video');
  const targetNodeIds = useMemo(() => (
    node
      ? (selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id])
      : []
  ), [node, selectedNodeIds]);
  const selectedReferenceTargetLabel = selectedGenerationTarget?.request?.prompt?.trim()
    ? `"${selectedGenerationTarget.request.prompt.trim().slice(0, 28)}${selectedGenerationTarget.request.prompt.trim().length > 28 ? '...' : ''}"`
    : 'selected draft';
  const composerCatalogEntry = composer.service && composer.providerId
    ? getCatalogEntry(composer.service, composer.providerId)
    : undefined;
  const composerOutputType =
    composer.outputType ??
    composerCatalogEntry?.outputType ??
    (composerCatalogEntry?.supportsTextToImage ? 'image' : 'video');
  const composerSupportsImageReference =
    composerOutputType === 'image' ||
    Boolean(composerCatalogEntry?.supportsTextToImage);
  const composerImageTarget = !selectedImageTarget && composerSupportsImageReference ? composer : null;
  const composerVideoTarget = !selectedVideoTarget && !composerSupportsImageReference && composerCatalogEntry?.supportsImageToVideo
    ? composer
    : null;
  const composerVideoTargetMultiShots = Boolean(composerVideoTarget?.multiShots);
  const activeImageReferenceTarget = selectedImageTarget ?? composerImageTarget;
  const activeVideoReferenceTarget = selectedVideoTarget ?? composerVideoTarget;
  const composerTargetLabel = composerCatalogEntry
    ? composerCatalogEntry.name.replace(' (Kie.ai)', '')
    : 'current composer';
  const imageReferenceTargetLabel = selectedImageTarget ? selectedReferenceTargetLabel : composerTargetLabel;
  const videoReferenceTargetLabel = selectedVideoTarget ? selectedReferenceTargetLabel : composerTargetLabel;
  const videoReferenceSupportsEndFrame = selectedVideoTarget
    ? !selectedVideoTargetMultiShots
    : !composerVideoTargetMultiShots;
  const canAssignVideoReference = Boolean(node?.result?.mediaFileId && activeVideoReferenceTarget);
  const canAssignImageReference = Boolean(node?.result?.mediaFileId && activeImageReferenceTarget);
  const canSendBackward = targetNodeIds.length > 0 && boardNodes.length > 1;
  const canBringForward = targetNodeIds.length > 0 && boardNodes.length > 1;

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

  const handleBringToFront = useCallback(() => {
    if (targetNodeIds.length === 0) return;
    bringNodesToFront(targetNodeIds);
    onClose();
  }, [bringNodesToFront, onClose, targetNodeIds]);

  const handleSendToBack = useCallback(() => {
    if (targetNodeIds.length === 0) return;
    sendNodesToBack(targetNodeIds);
    onClose();
  }, [onClose, sendNodesToBack, targetNodeIds]);

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

  const handleAssignReference = useCallback((slot: 'start' | 'end' | 'reference') => {
    if (!node?.result?.mediaFileId) return;

    if (slot === 'reference') {
      if (selectedImageTarget) {
        updateNodeRequest(selectedImageTarget.id, {
          outputType: 'image',
          referenceMediaFileIds: [node.result.mediaFileId],
        });
      } else if (composerImageTarget) {
        updateComposer({
          outputType: 'image',
          referenceMediaFileIds: [node.result.mediaFileId],
        });
      } else {
        return;
      }
    } else {
      if (selectedVideoTarget) {
        updateNodeRequest(selectedVideoTarget.id, {
          outputType: 'video',
          [slot === 'start' ? 'startMediaFileId' : 'endMediaFileId']: node.result.mediaFileId,
        });
      } else if (composerVideoTarget) {
        updateComposer({
          outputType: 'video',
          [slot === 'start' ? 'startMediaFileId' : 'endMediaFileId']: node.result.mediaFileId,
        });
      } else {
        return;
      }
    }

    onClose();
  }, [composerImageTarget, composerVideoTarget, node, onClose, selectedImageTarget, selectedVideoTarget, updateComposer, updateNodeRequest]);

  const handleClearReference = useCallback((slot: 'start' | 'end' | 'reference') => {
    if (!generationNode) return;

    if (slot === 'reference') {
      updateNodeRequest(generationNode.id, {
        referenceMediaFileIds: [],
      });
    } else {
      updateNodeRequest(generationNode.id, {
        [slot === 'start' ? 'startMediaFileId' : 'endMediaFileId']: undefined,
      });
    }

    onClose();
  }, [generationNode, onClose, updateNodeRequest]);

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
          {node.result?.mediaFileId && (
            <>
              {activeVideoReferenceTarget && (
                <>
                  <button
                    className="flashboard-context-item"
                    disabled={!canAssignVideoReference}
                    onClick={() => handleAssignReference('start')}
                  >
                    Set As Start Frame for {videoReferenceTargetLabel}
                  </button>
                  {videoReferenceSupportsEndFrame && (
                    <button
                      className="flashboard-context-item"
                      disabled={!canAssignVideoReference}
                      onClick={() => handleAssignReference('end')}
                    >
                      Set As End Frame for {videoReferenceTargetLabel}
                    </button>
                  )}
                </>
              )}
              {activeImageReferenceTarget && (
                <button
                  className="flashboard-context-item"
                  disabled={!canAssignImageReference}
                  onClick={() => handleAssignReference('reference')}
                >
                  Set As Reference Frame for {imageReferenceTargetLabel}
                </button>
              )}
              {!activeVideoReferenceTarget && !activeImageReferenceTarget && (
                <button className="flashboard-context-item hint" disabled>
                  Select a draft or choose a model first
                </button>
              )}
              <div className="flashboard-context-separator" />
            </>
          )}
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
          {generationOutputType === 'image' && generationNode?.request?.referenceMediaFileIds?.length ? (
            <button className="flashboard-context-item" onClick={() => handleClearReference('reference')}>
              Clear Reference Frame
            </button>
          ) : (
            <>
              {generationNode?.request?.startMediaFileId && (
                <button className="flashboard-context-item" onClick={() => handleClearReference('start')}>
                  Clear Start Frame
                </button>
              )}
              {generationNode?.request?.endMediaFileId && (
                <button className="flashboard-context-item" onClick={() => handleClearReference('end')}>
                  Clear End Frame
                </button>
              )}
            </>
          )}
          <button className="flashboard-context-item" onClick={handleDuplicate}>
            Duplicate
          </button>
          <button className="flashboard-context-item" disabled={!canBringForward} onClick={handleBringToFront}>
            Bring to Front
          </button>
          <button className="flashboard-context-item" disabled={!canSendBackward} onClick={handleSendToBack}>
            Send to Back
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
