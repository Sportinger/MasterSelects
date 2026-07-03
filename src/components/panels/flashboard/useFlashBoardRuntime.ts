import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearFlashBoardActiveGenerationSelection,
  ensureFlashBoardActiveGenerationBoard,
  failFlashBoardActiveGenerationRecord,
  updateFlashBoardActiveGenerationJob,
  useFlashBoardActiveGenerationRecords,
  useHasFlashBoardActiveGenerationBoard,
  useRemoveFlashBoardActiveGenerationRecord,
  useSelectedFlashBoardActiveGenerationRecordIds,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import { flashBoardJobService } from '../../../services/flashboard/FlashBoardJobService';
import { flashBoardMediaBridge } from '../../../services/flashboard/FlashBoardMediaBridge';

interface FlashBoardRuntimeOptions {
  enableKeyboardDelete?: boolean;
}

export interface FlashBoardRefundDialogState {
  credits: number;
  jobId: string;
  creditBalance: number;
}

export function useFlashBoardRuntime(options: FlashBoardRuntimeOptions = {}) {
  const { enableKeyboardDelete = true } = options;
  const hasGenerationBoard = useHasFlashBoardActiveGenerationBoard();
  const activeGenerationRecords = useFlashBoardActiveGenerationRecords();
  const selectedRecordIds = useSelectedFlashBoardActiveGenerationRecordIds();
  const removeGenerationRecord = useRemoveFlashBoardActiveGenerationRecord();
  const refundDialogKeysRef = useRef<Set<string>>(new Set());
  const [refundDialog, setRefundDialog] = useState<FlashBoardRefundDialogState | null>(null);

  const dismissRefundDialog = useCallback(() => {
    setRefundDialog(null);
  }, []);

  useEffect(() => {
    if (!hasGenerationBoard) {
      ensureFlashBoardActiveGenerationBoard();
    }
  }, [hasGenerationBoard]);

  useEffect(() => {
    flashBoardJobService.setUpdateCallback((recordId, update) => {
      if (update.status === 'completed') {
        if (!update.mediaType || (!update.assetUrl && !update.assetFile)) {
          failFlashBoardActiveGenerationRecord(recordId, 'Generation finished without importable media.');
          return;
        }

        const importPromise = update.assetFile
          ? flashBoardMediaBridge.importGeneratedFile(recordId, update.assetFile, update.mediaType)
          : flashBoardMediaBridge.importGeneratedMedia(recordId, update.assetUrl as string, update.mediaType);

        void importPromise.catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to import generated media';
          failFlashBoardActiveGenerationRecord(recordId, message);
        });
        return;
      }

      if (update.status === 'failed') {
        failFlashBoardActiveGenerationRecord(recordId, update.error || 'Generation failed', update.refund);
        if (update.refund?.credits) {
          const dialogKey = `${recordId}:${update.refund.jobId}:${update.refund.credits}`;
          if (!refundDialogKeysRef.current.has(dialogKey)) {
            refundDialogKeysRef.current.add(dialogKey);
            setRefundDialog({
              credits: update.refund.credits,
              jobId: update.refund.jobId,
              creditBalance: update.refund.creditBalance,
            });
          }
        }
        return;
      }

      updateFlashBoardActiveGenerationJob(recordId, {
        status: update.status,
        remoteTaskId: update.remoteTaskId,
        progress: update.progress,
      });
    });

    return () => {
      flashBoardJobService.setUpdateCallback(null);
    };
  }, []);

  useEffect(() => {
    activeGenerationRecords.forEach((record) => {
      const request = record.request;
      const remoteTaskId = record.job?.remoteTaskId;
      const isResumable = request
        && remoteTaskId
        && !record.result
        && (record.job?.status === 'queued' || record.job?.status === 'processing');
      if (isResumable) {
        flashBoardJobService.resume({
          recordId: record.id,
          request,
          remoteTaskId,
        });
      }
    });
  }, [activeGenerationRecords]);

  useEffect(() => {
    if (!enableKeyboardDelete) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || selectedRecordIds.length === 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }

      event.preventDefault();
      selectedRecordIds.forEach((recordId) => removeGenerationRecord(recordId));
      clearFlashBoardActiveGenerationSelection();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboardDelete, removeGenerationRecord, selectedRecordIds]);

  return {
    dismissRefundDialog,
    refundDialog,
  };
}
