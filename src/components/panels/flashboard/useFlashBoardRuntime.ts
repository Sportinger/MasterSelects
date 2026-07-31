import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearFlashBoardActiveGenerationSelection,
  ensureFlashBoardActiveGenerationBoard,
  failFlashBoardActiveGenerationRecord,
  getFlashBoardActiveGenerationRecord,
  hasDurableFlashBoardProviderIdempotency,
  isFlashBoardCancellationRequested,
  updateFlashBoardActiveGenerationJob,
  updateFlashBoardActiveGenerationOutputs,
  useFlashBoardActiveGenerationRecords,
  useHasFlashBoardActiveGenerationBoard,
  useRemoveFlashBoardActiveGenerationRecord,
  useSelectedFlashBoardActiveGenerationRecordIds,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import { flashBoardJobService } from '../../../services/flashboard/FlashBoardJobService';
import { flashBoardMediaBridge } from '../../../services/flashboard/FlashBoardMediaBridge';
import { reconcileStoryboardGenerationRecords } from '../../../services/storyboard/generation';
import {
  getStoryboardProjectSnapshot,
  hydrateStoryboardProjectState,
  useStoryboardStore,
} from '../../../stores/storyboardStore';

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
  const storyboardCandidates = useStoryboardStore((state) => state.candidates);
  const selectedRecordIds = useSelectedFlashBoardActiveGenerationRecordIds();
  const removeGenerationRecord = useRemoveFlashBoardActiveGenerationRecord();
  const refundDialogKeysRef = useRef<Set<string>>(new Set());
  const importingRecordIdsRef = useRef<Set<string>>(new Set());
  const recoverySubmissionIdsRef = useRef<Set<string>>(new Set());
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
        importingRecordIdsRef.current.add(recordId);
        updateFlashBoardActiveGenerationJob(recordId, {
          status: 'completed',
          remoteTaskId: update.remoteTaskId,
          progress: update.progress,
          completedAt: Date.now(),
        });

        if (update.outputs?.length) {
          updateFlashBoardActiveGenerationOutputs(recordId, update.outputs);
        }

        if (update.assets?.length) {
          void flashBoardMediaBridge.importGeneratedAssets(recordId, update.assets)
            .catch((error) => {
              const message = error instanceof Error ? error.message : 'Failed to import generated media';
              const hasTerminalOutputFailure = getFlashBoardActiveGenerationRecord(recordId)
                ?.outputs?.some((output) => output.importStatus === 'failed') === true;
              if (!hasTerminalOutputFailure) {
                failFlashBoardActiveGenerationRecord(recordId, message);
              }
            })
            .finally(() => {
              importingRecordIdsRef.current.delete(recordId);
            });
          return;
        }

        if (!update.mediaType || (!update.assetUrl && !update.assetFile)) {
          importingRecordIdsRef.current.delete(recordId);
          failFlashBoardActiveGenerationRecord(recordId, 'Generation finished without importable media.');
          return;
        }

        const outputId = update.outputs?.length === 1
          ? update.outputs[0]?.id
          : undefined;
        const importPromise = update.assetFile
          ? flashBoardMediaBridge.importGeneratedFile(
              recordId,
              update.assetFile,
              update.mediaType,
              outputId,
            )
          : flashBoardMediaBridge.importGeneratedMedia(
              recordId,
              update.assetUrl as string,
              update.mediaType,
              outputId,
            );

        void importPromise
          .catch((error) => {
            const message = error instanceof Error ? error.message : 'Failed to import generated media';
            const hasTerminalOutputFailure = getFlashBoardActiveGenerationRecord(recordId)
              ?.outputs?.some((output) => output.importStatus === 'failed') === true;
            if (!hasTerminalOutputFailure) {
              failFlashBoardActiveGenerationRecord(recordId, message);
            }
          })
          .finally(() => {
            importingRecordIdsRef.current.delete(recordId);
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

      if (update.outputs?.length) {
        updateFlashBoardActiveGenerationOutputs(recordId, update.outputs);
      }
      updateFlashBoardActiveGenerationJob(recordId, {
        status: update.status,
        ...(update.remoteTaskId === undefined ? {} : { remoteTaskId: update.remoteTaskId }),
        ...(update.progress === undefined ? {} : { progress: update.progress }),
        ...(update.startedAt === undefined ? {} : { startedAt: update.startedAt }),
      });
    });

    return () => {
      flashBoardJobService.setUpdateCallback(null);
    };
  }, []);

  useEffect(() => {
    const current = getStoryboardProjectSnapshot();
    const reconciled = reconcileStoryboardGenerationRecords(
      current,
      activeGenerationRecords,
    ).state;
    if (
      JSON.stringify(reconciled.candidates) !== JSON.stringify(current.candidates)
      || JSON.stringify(reconciled.scenes) !== JSON.stringify(current.scenes)
    ) {
      hydrateStoryboardProjectState(reconciled);
    }
  }, [activeGenerationRecords, storyboardCandidates]);

  useEffect(() => {
    activeGenerationRecords.forEach((record) => {
      const request = record.request;
      const remoteTaskId = record.job?.remoteTaskId;
      const isPending = !record.result && (record.job?.status === 'queued' || record.job?.status === 'processing');
      if (!request || !isPending) return;
      if (remoteTaskId) {
        flashBoardJobService.resume({
          recordId: record.id,
          request,
          remoteTaskId,
        });
        return;
      }
      if (importingRecordIdsRef.current.has(record.id)) {
        return;
      }
      if (
        !flashBoardJobService.hasJob(record.id)
        && !recoverySubmissionIdsRef.current.has(record.id)
      ) {
        const isStoryboardGeneration =
          request.idempotencyKey?.startsWith('storyboard-generation:') === true;
        if (
          isStoryboardGeneration
          && (
            !hasDurableFlashBoardProviderIdempotency(request)
            || isFlashBoardCancellationRequested(record)
          )
        ) {
          return;
        }
        recoverySubmissionIdsRef.current.add(record.id);
        flashBoardJobService.submit({
          recordId: record.id,
          request,
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
