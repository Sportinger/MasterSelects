import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipAudioEditOperationOverlays } from '../components/ClipAudioEditOperationOverlays';
import { ClipAudioEditStackControls } from '../components/ClipAudioEditStackControls';
import { ClipAudioRegionContextMenu } from '../components/ClipAudioRegionContextMenu';
import { ClipAudioRegionSelectionOverlay, type AudioRegionGainHandleMode } from '../components/ClipAudioRegionSelectionOverlay';
import {
  resolveAudioEditOperationOverlays,
  resolveAudioRegionGainControl,
  resolveAudioRegionOverlay,
} from '../utils/activeRegionOverlays';
import type { ClipAudioEditOperation } from '../../../types';
import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import { useTimelineStore } from '../../../stores/timeline';
import {
  AUDIO_REGION_TIMELINE_EPSILON,
  audioRegionGainDbFromClientY,
  resolveAudioRegionTimelineRangeForClip,
} from '../utils/audioRegionDisplay';
import {
  createAudioRegionContextMenuModel,
  type AudioRegionContextMenuCommand,
} from '../utils/audioRegionContextMenu';
import {
  moveTimelineAudioRegionSelection,
  resizeTimelineAudioRegionSelection,
} from '../utils/audioEditSelection';
import { useContextMenuPosition } from '../../../hooks/useContextMenuPosition';
import { Logger } from '../../../services/logger';
import type {
  ClipInteractionShellAudioRegionModuleState,
  ClipInteractionShellCommandContext,
} from './types';

const log = Logger.create('ClipAudioRegionControlsShell');
const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus']);

interface ClipAudioRegionControlsProps {
  context: ClipInteractionShellCommandContext;
}

interface ClipAudioRegionControlsActiveProps {
  context: ClipInteractionShellCommandContext;
  audioRegion: ClipInteractionShellAudioRegionModuleState;
  selection: TimelineAudioRegionSelection;
}

type AudioRegionMoveDragState = {
  startClientX: number;
  clipWidth: number;
  clipDuration: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};

type AudioRegionResizeDragState = {
  edge: 'left' | 'right';
  rectLeft: number;
  rectWidth: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};

type AudioRegionGainDragState = {
  mode: AudioRegionGainHandleMode;
  regionLeft: number;
  regionWidth: number;
  regionTop: number;
  regionHeight: number;
  regionDuration: number;
  currentGainDb: number;
  currentFadeInSeconds: number;
  currentFadeOutSeconds: number;
};

interface AudioRegionContextMenuState {
  x: number;
  y: number;
  selection: TimelineAudioRegionSelection;
}

function findSelectedGainOperation(
  operations: readonly ClipAudioEditOperation[],
  selection: TimelineAudioRegionSelection,
): ClipAudioEditOperation | null {
  const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
  const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);

  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const operation = operations[index];
    if (
      operation?.type === 'gain' &&
      operation.enabled !== false &&
      operation.timeRange &&
      Math.abs(Math.min(operation.timeRange.start, operation.timeRange.end) - start) <= 0.001 &&
      Math.abs(Math.max(operation.timeRange.start, operation.timeRange.end) - end) <= 0.001
    ) {
      return operation;
    }
  }

  return null;
}

function getMatchingAudioRegionOperationIds(
  operations: readonly ClipAudioEditOperation[],
  selection: TimelineAudioRegionSelection,
): string[] {
  const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
  const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);

  return operations
    .filter((operation) => {
      if (!operation.timeRange) return false;
      const operationStart = Math.min(operation.timeRange.start, operation.timeRange.end);
      const operationEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
      return Math.abs(operationStart - start) <= 0.001 &&
        Math.abs(operationEnd - end) <= 0.001;
    })
    .map((operation) => operation.id);
}

export function ClipAudioRegionControls({ context }: ClipAudioRegionControlsProps) {
  const audioRegion = context.activeModules.audioRegion;
  const selection = audioRegion?.selection;
  if (!audioRegion?.enabled || !selection) return null;

  return (
    <ClipAudioRegionControlsActive
      context={context}
      audioRegion={audioRegion}
      selection={selection}
    />
  );
}

function ClipAudioRegionControlsActive({
  context,
  audioRegion,
  selection,
}: ClipAudioRegionControlsActiveProps) {
  const [moveDrag, setMoveDrag] = useState<AudioRegionMoveDragState | null>(null);
  const [resizeDrag, setResizeDrag] = useState<AudioRegionResizeDragState | null>(null);
  const [gainDrag, setGainDrag] = useState<AudioRegionGainDragState | null>(null);
  const [contextMenu, setContextMenu] = useState<AudioRegionContextMenuState | null>(null);
  const [audioBakePending, setAudioBakePending] = useState(false);
  const contextMenuCommandHandledRef = useRef(false);
  const { menuRef: contextMenuRef, adjustedPosition: contextMenuPosition } = useContextMenuPosition(contextMenu);
  const audioFocusMode = useTimelineStore(state => state.audioFocusMode);
  const showAudioRegionEditMarkers = useTimelineStore(state => state.showAudioRegionEditMarkers);
  const hasAudioRegionClipboard = useTimelineStore(state => state.audioRegionClipboard !== null);
  const applyTimelineEditOperation = useTimelineStore(state => state.applyTimelineEditOperation);
  const applyAudioRegionEdit = useTimelineStore(state => state.applyAudioRegionEdit);
  const setAudioRegionSelection = useTimelineStore(state => state.setAudioRegionSelection);
  const clearAudioRegionSelection = useTimelineStore(state => state.clearAudioRegionSelection);
  const setClipAudioEditOperationRange = useTimelineStore(state => state.setClipAudioEditOperationRange);
  const setAudioRegionGainPreview = useTimelineStore(state => state.setAudioRegionGainPreview);
  const clearAudioRegionGainPreview = useTimelineStore(state => state.clearAudioRegionGainPreview);
  const setAudioRegionGainEdit = useTimelineStore(state => state.setAudioRegionGainEdit);
  const copySelectedAudioRegion = useTimelineStore(state => state.copySelectedAudioRegion);
  const pasteAudioRegionToSelection = useTimelineStore(state => state.pasteAudioRegionToSelection);
  const selectClip = useTimelineStore(state => state.selectClip);
  const setClipAudioEditOperationEnabled = useTimelineStore(state => state.setClipAudioEditOperationEnabled);
  const removeClipAudioEditOperation = useTimelineStore(state => state.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(state => state.clearClipAudioEditStack);
  const bakeClipAudioEditStack = useTimelineStore(state => state.bakeClipAudioEditStack);
  const unbakeClipAudioEditStack = useTimelineStore(state => state.unbakeClipAudioEditStack);

  const operations = useMemo(
    () => context.clip.audioState?.editStack ?? [],
    [context.clip.audioState?.editStack],
  );
  const activeAudioEditCount = useMemo(
    () => operations.filter(operation => operation.enabled !== false).length,
    [operations],
  );
  const canUnbakeAudioEditStack = Boolean(context.clip.audioState?.bakeHistory?.at(-1)?.restore);
  const sourceType = context.clip.source?.type;
  const fileExt = (context.clip.name || '').split('.').pop()?.toLowerCase() || '';
  const isAudioClip = context.track.type === 'audio' ||
    sourceType === 'audio' ||
    AUDIO_EXTENSIONS.has(fileExt);
  const canInteract = context.track.locked !== true;
  const selectionClip = useMemo(() => ({
    id: context.clip.id,
    trackId: context.clip.trackId,
    startTime: context.clip.startTime,
    duration: Math.max(0.001, context.clip.duration),
    inPoint: context.clip.inPoint,
    outPoint: context.clip.outPoint,
    reversed: context.clip.reversed,
    waveform: context.clip.waveform,
  }), [
    context.clip.duration,
    context.clip.id,
    context.clip.inPoint,
    context.clip.outPoint,
    context.clip.reversed,
    context.clip.startTime,
    context.clip.trackId,
    context.clip.waveform,
  ]);
  const sourceTimeToDisplayTimelineTime = useCallback((sourceTime: number): number => {
    const sourceStart = Math.max(0, context.clip.inPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + AUDIO_REGION_TIMELINE_EPSILON, context.clip.outPoint ?? sourceStart + Math.max(0.001, context.clip.duration));
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = context.clip.reversed ? 1 - sourceRatio : sourceRatio;
    return context.clip.startTime + timelineRatio * Math.max(0.001, context.clip.duration);
  }, [
    context.clip.duration,
    context.clip.inPoint,
    context.clip.outPoint,
    context.clip.reversed,
    context.clip.startTime,
  ]);

  const overlay = resolveAudioRegionOverlay({
    selection,
    displayStartTime: context.clip.startTime,
    displayDuration: Math.max(0.001, context.clip.duration),
    width: context.geometry.clip.width,
  });

  const selectedOperation = findSelectedGainOperation(
    operations,
    selection,
  );
  const gainControl = overlay
    ? resolveAudioRegionGainControl({
        selection,
        overlayWidth: overlay.width,
        selectedOperation,
        dragState: typeof audioRegion.gainPreviewDb === 'number'
          ? {
              currentGainDb: audioRegion.gainPreviewDb,
              currentFadeInSeconds: 0,
              currentFadeOutSeconds: 0,
            }
          : null,
      })
    : null;
  const audioEditOperationOverlays = useMemo(() => {
    if (!isAudioClip || !audioFocusMode || !showAudioRegionEditMarkers || operations.length === 0) {
      return [];
    }

    return resolveAudioEditOperationOverlays({
      operations,
      audioRegionSelection: selection,
      clipId: context.clip.id,
      trackId: context.clip.trackId,
      displayStartTime: context.clip.startTime,
      displayDuration: Math.max(0.001, context.clip.duration),
      width: context.geometry.clip.width,
      trackBaseHeight: context.geometry.clip.height,
      sourceTimeToDisplayTimelineTime,
    });
  }, [
    audioFocusMode,
    context.clip.duration,
    context.clip.id,
    context.clip.startTime,
    context.clip.trackId,
    context.geometry.clip.height,
    context.geometry.clip.width,
    isAudioClip,
    operations,
    selection,
    showAudioRegionEditMarkers,
    sourceTimeToDisplayTimelineTime,
  ]);

  const resolveMoveSelection = useCallback((
    drag: AudioRegionMoveDragState,
    clientX: number,
  ) => {
    const deltaX = clientX - drag.startClientX;
    const deltaTimelineSeconds = (deltaX / Math.max(1, drag.clipWidth)) * Math.max(0.001, drag.clipDuration);
    return moveTimelineAudioRegionSelection({
      clip: selectionClip,
      selection: drag.initialSelection,
      deltaTimelineSeconds,
    });
  }, [selectionClip]);

  const resolveResizeSelection = useCallback((
    drag: AudioRegionResizeDragState,
    clientX: number,
  ) => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    const focusTimelineTime = selectionClip.startTime +
      (x / Math.max(1, drag.rectWidth)) * Math.max(0.001, selectionClip.duration);
    return resizeTimelineAudioRegionSelection({
      clip: selectionClip,
      selection: drag.initialSelection,
      edge: drag.edge,
      focusTimelineTime,
      snapThresholdSeconds: 0,
    });
  }, [selectionClip]);

  const commitAudioRegionOperationRange = useCallback((
    operationIds: string[],
    nextSelection: TimelineAudioRegionSelection,
    historyLabel: string,
  ) => {
    if (operationIds.length === 0) return;
    setClipAudioEditOperationRange(context.clip.id, operationIds, nextSelection, {
      captureHistory: true,
      historyLabel,
    });
  }, [context.clip.id, setClipAudioEditOperationRange]);

  const handleSelectionMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canInteract || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setMoveDrag({
      startClientX: event.clientX,
      clipWidth: Math.max(1, context.geometry.clip.width),
      clipDuration: Math.max(0.001, context.clip.duration),
      initialSelection: selection,
      operationIds: getMatchingAudioRegionOperationIds(operations, selection),
    });
  }, [
    canInteract,
    context.clip.duration,
    context.geometry.clip.width,
    operations,
    selection,
  ]);

  const handleEdgeMouseDown = useCallback((edge: 'left' | 'right') => (
    event: React.MouseEvent<HTMLSpanElement>,
  ) => {
    if (!canInteract || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const shellElement = event.currentTarget.closest('.clip-interaction-shell');
    const rect = shellElement?.getBoundingClientRect();
    setResizeDrag({
      edge,
      rectLeft: rect?.left ?? context.geometry.clip.x,
      rectWidth: Math.max(1, rect?.width ?? context.geometry.clip.width),
      initialSelection: selection,
      operationIds: getMatchingAudioRegionOperationIds(operations, selection),
    });
  }, [
    canInteract,
    context.geometry.clip.width,
    context.geometry.clip.x,
    operations,
    selection,
  ]);

  const publishGainPreview = useCallback((gainInput: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    setAudioRegionGainPreview({
      clipId: context.clip.id,
      trackId: selection.trackId,
      startTime: selection.startTime,
      endTime: selection.endTime,
      sourceInPoint: selection.sourceInPoint,
      sourceOutPoint: selection.sourceOutPoint,
      gainDb: gainInput.gainDb,
      fadeInSeconds: gainInput.fadeInSeconds,
      fadeOutSeconds: gainInput.fadeOutSeconds,
    });
  }, [context.clip.id, selection, setAudioRegionGainPreview]);

  const commitGainEdit = useCallback((gainInput: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    setAudioRegionGainEdit({
      gainDb: gainInput.gainDb,
      fadeInSeconds: gainInput.fadeInSeconds,
      fadeOutSeconds: gainInput.fadeOutSeconds,
      keepSelection: true,
    });
  }, [setAudioRegionGainEdit]);

  const handleGainMouseDown = useCallback((mode: AudioRegionGainHandleMode) => (
    event: React.MouseEvent<HTMLButtonElement | HTMLDivElement>,
  ) => {
    if (!canInteract || event.button !== 0 || !gainControl) return;
    const regionElement = event.currentTarget.closest('.clip-audio-region-selection');
    if (!regionElement) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = regionElement.getBoundingClientRect();
    const startGainDb = mode === 'gain'
      ? Number(audioRegionGainDbFromClientY(event.clientY, rect).toFixed(1))
      : gainControl.gainDb;
    publishGainPreview({
      gainDb: startGainDb,
      fadeInSeconds: gainControl.fadeInSeconds,
      fadeOutSeconds: gainControl.fadeOutSeconds,
    });
    setGainDrag({
      mode,
      regionLeft: rect.left,
      regionWidth: rect.width,
      regionTop: rect.top,
      regionHeight: rect.height,
      regionDuration: gainControl.regionDuration,
      currentGainDb: startGainDb,
      currentFadeInSeconds: gainControl.fadeInSeconds,
      currentFadeOutSeconds: gainControl.fadeOutSeconds,
    });
  }, [canInteract, gainControl, publishGainPreview]);

  const handleResetGain = useCallback(() => {
    if (!canInteract) return;
    commitGainEdit({
      gainDb: 0,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    });
  }, [canInteract, commitGainEdit]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    if (!canInteract) return;
    event.preventDefault();
    event.stopPropagation();
    const expectedExpandedHeight = 340;
    const y = typeof window === 'undefined'
      ? event.clientY
      : Math.min(
          event.clientY,
          Math.max(8, window.innerHeight - expectedExpandedHeight - 8),
        );
    contextMenuCommandHandledRef.current = false;
    setContextMenu({ x: event.clientX, y, selection });
  }, [canInteract, selection]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleAudioEditOperationOverlayActivate = useCallback((operationOverlay: typeof audioEditOperationOverlays[number]) => {
    closeContextMenu();
    setAudioRegionSelection(operationOverlay.selection);
  }, [closeContextMenu, setAudioRegionSelection]);

  const handleAudioEditStackMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleToggleAudioEditOperation = useCallback((operationId: string, disabled: boolean) => {
    if (!canInteract) return;
    setClipAudioEditOperationEnabled(context.clip.id, operationId, disabled);
  }, [canInteract, context.clip.id, setClipAudioEditOperationEnabled]);

  const handleRemoveAudioEditOperation = useCallback((operationId: string) => {
    if (!canInteract) return;
    removeClipAudioEditOperation(context.clip.id, operationId);
  }, [canInteract, context.clip.id, removeClipAudioEditOperation]);

  const handleBakeAudioEditStack = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canInteract || audioBakePending) return;
    setAudioBakePending(true);
    void bakeClipAudioEditStack(context.clip.id).finally(() => {
      setAudioBakePending(false);
    });
  }, [audioBakePending, bakeClipAudioEditStack, canInteract, context.clip.id]);

  const handleUnbakeAudioEditStack = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canInteract || audioBakePending || !canUnbakeAudioEditStack) return;
    unbakeClipAudioEditStack(context.clip.id);
  }, [audioBakePending, canInteract, canUnbakeAudioEditStack, context.clip.id, unbakeClipAudioEditStack]);

  const handleClearAudioEditStack = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canInteract) return;
    clearClipAudioEditStack(context.clip.id);
  }, [canInteract, clearClipAudioEditStack, context.clip.id]);

  const handleSplitAudioRegionAtSelection = useCallback((selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const activeSelection = selectionSnapshot?.clipId === context.clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === context.clip.id
        ? store.audioRegionSelection
        : selection;
    const currentClip = store.clips.find(candidate => candidate.id === context.clip.id) ?? context.clip;
    if (!activeSelection) {
      log.warn('Cannot split audio region without an active selection', { clipId: context.clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, activeSelection);
    if (!range) {
      log.warn('Cannot split audio region outside clip bounds', { clipId: context.clip.id, selection: activeSelection });
      return;
    }

    const clipStart = currentClip.startTime;
    const clipEnd = currentClip.startTime + Math.max(AUDIO_REGION_TIMELINE_EPSILON, currentClip.duration);
    const splitTimes = [range.start, range.end].filter(time =>
      time > clipStart + AUDIO_REGION_TIMELINE_EPSILON &&
      time < clipEnd - AUDIO_REGION_TIMELINE_EPSILON
    );
    const result = splitTimes.length > 0
      ? applyTimelineEditOperation({
        id: `split-audio-region:${context.clip.id}:${range.start}:${range.end}`,
        type: 'split-at-times',
        clipId: currentClip.id,
        times: splitTimes,
        includeLinked: false,
      }, {
        source: 'context-menu',
        historyLabel: 'Split audio region',
      })
      : { success: true };

    if (result.success) {
      const middleClip = useTimelineStore.getState().clips.find(candidate =>
        candidate.trackId === currentClip.trackId &&
        Math.abs(candidate.startTime - range.start) <= AUDIO_REGION_TIMELINE_EPSILON &&
        Math.abs(candidate.duration - range.duration) <= AUDIO_REGION_TIMELINE_EPSILON
      );
      if (middleClip) {
        selectClip(middleClip.id);
      }
    } else {
      log.warn('Split audio region operation failed', { clipId: currentClip.id, range, result });
    }
    clearAudioRegionSelection();
  }, [
    applyTimelineEditOperation,
    clearAudioRegionSelection,
    context.clip,
    selectClip,
    selection,
  ]);

  const handleCutAudioRegion = useCallback((selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const activeSelection = selectionSnapshot?.clipId === context.clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === context.clip.id
        ? store.audioRegionSelection
        : selection;
    const currentClip = store.clips.find(candidate => candidate.id === context.clip.id) ?? context.clip;
    if (!activeSelection) {
      log.warn('Cannot cut audio region without an active selection', { clipId: context.clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, activeSelection);
    if (!range) {
      log.warn('Cannot cut audio region outside clip bounds', { clipId: context.clip.id, selection: activeSelection });
      return;
    }

    if (store.audioRegionSelection?.clipId !== currentClip.id) {
      setAudioRegionSelection(activeSelection);
    }
    copySelectedAudioRegion();
    const result = applyTimelineEditOperation({
      id: `cut-audio-region:${context.clip.id}:${range.start}:${range.end}`,
      type: 'lift-range',
      range: {
        startTime: range.start,
        endTime: range.end,
        trackIds: [currentClip.trackId],
      },
      includeLinked: false,
    }, {
      source: 'context-menu',
      historyLabel: 'Cut audio region',
    });
    if (result.success) {
      clearAudioRegionSelection();
    } else {
      log.warn('Cut audio region operation failed', { clipId: currentClip.id, range, result });
    }
  }, [
    applyTimelineEditOperation,
    clearAudioRegionSelection,
    context.clip,
    copySelectedAudioRegion,
    selection,
    setAudioRegionSelection,
  ]);

  const contextMenuSelection = contextMenu?.selection ?? selection;
  const contextMenuModel = useMemo(() => createAudioRegionContextMenuModel({
    hasAudioRegionClipboard,
    onSplit: () => handleSplitAudioRegionAtSelection(contextMenuSelection),
    onCut: () => handleCutAudioRegion(contextMenuSelection),
    onCopy: copySelectedAudioRegion,
    onPaste: pasteAudioRegionToSelection,
    applyAudioRegionEdit,
  }), [
    applyAudioRegionEdit,
    contextMenuSelection,
    copySelectedAudioRegion,
    handleCutAudioRegion,
    handleSplitAudioRegionAtSelection,
    hasAudioRegionClipboard,
    pasteAudioRegionToSelection,
  ]);

  const runContextMenuCommand = useCallback((
    command: AudioRegionContextMenuCommand,
    commandSelection: TimelineAudioRegionSelection,
  ) => {
    if (contextMenuCommandHandledRef.current) return;
    if (command.disabled) return;
    contextMenuCommandHandledRef.current = true;
    log.info('Audio region shell context command', {
      command: command.key,
      clipId: context.clip.id,
      selection: commandSelection,
    });
    setAudioRegionSelection(commandSelection);
    command.action();
    closeContextMenu();
  }, [closeContextMenu, context.clip.id, setAudioRegionSelection]);

  const contextMenuRenderPosition = useMemo(() => {
    if (!contextMenu) return null;
    return {
      x: contextMenuPosition?.x ?? contextMenu.x,
      y: contextMenuPosition?.y ?? contextMenu.y,
    };
  }, [
    contextMenu,
    contextMenuPosition?.x,
    contextMenuPosition?.y,
  ]);

  useEffect(() => {
    if (!moveDrag || !canInteract) return undefined;

    const handleDocumentMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      setAudioRegionSelection(resolveMoveSelection(moveDrag, event.clientX));
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const nextSelection = resolveMoveSelection(moveDrag, event.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(moveDrag.operationIds, nextSelection, 'Move audio region edit');
      setMoveDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canInteract,
    commitAudioRegionOperationRange,
    moveDrag,
    resolveMoveSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!resizeDrag || !canInteract) return undefined;

    const handleDocumentMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      setAudioRegionSelection(resolveResizeSelection(resizeDrag, event.clientX));
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const nextSelection = resolveResizeSelection(resizeDrag, event.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(resizeDrag.operationIds, nextSelection, 'Resize audio region edit');
      setResizeDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canInteract,
    commitAudioRegionOperationRange,
    resizeDrag,
    resolveResizeSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!gainDrag || !canInteract) return undefined;

    const getNextDragState = (event: MouseEvent): AudioRegionGainDragState => {
      if (gainDrag.mode === 'gain') {
        return {
          ...gainDrag,
          currentGainDb: Number(audioRegionGainDbFromClientY(event.clientY, {
            top: gainDrag.regionTop,
            height: gainDrag.regionHeight,
          }).toFixed(1)),
        };
      }

      const localX = Math.max(0, Math.min(gainDrag.regionWidth, event.clientX - gainDrag.regionLeft));
      const secondsAtPointer = (localX / Math.max(1, gainDrag.regionWidth)) * gainDrag.regionDuration;
      const maxFadeSeconds = gainDrag.regionDuration / 2;

      return {
        ...gainDrag,
        currentFadeInSeconds: gainDrag.mode === 'fade-in'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, secondsAtPointer)).toFixed(4))
          : gainDrag.currentFadeInSeconds,
        currentFadeOutSeconds: gainDrag.mode === 'fade-out'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, gainDrag.regionDuration - secondsAtPointer)).toFixed(4))
          : gainDrag.currentFadeOutSeconds,
      };
    };

    const handleDocumentMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      const next = getNextDragState(event);
      publishGainPreview({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      setGainDrag(next);
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const next = getNextDragState(event);
      commitGainEdit({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      clearAudioRegionGainPreview();
      setGainDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canInteract,
    clearAudioRegionGainPreview,
    commitGainEdit,
    gainDrag,
    publishGainPreview,
  ]);

  useEffect(() => () => {
    const preview = useTimelineStore.getState().audioRegionGainPreview;
    if (preview?.clipId === context.clip.id) {
      useTimelineStore.getState().clearAudioRegionGainPreview();
    }
  }, [context.clip.id]);

  useEffect(() => {
    if (!contextMenu) return undefined;

    const handlePointerDown = () => closeContextMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeContextMenu, contextMenu]);

  if (!overlay) return null;

  return (
    <div
      className="shell-audio-region-module"
      data-clip-interaction-slot="audio-region"
    >
      <ClipAudioEditOperationOverlays
        overlays={audioEditOperationOverlays}
        onActivateOverlay={handleAudioEditOperationOverlayActivate}
      />
      <ClipAudioRegionSelectionOverlay
        overlay={overlay}
        snappedToZeroCrossing={Boolean(selection.snappedToZeroCrossing)}
        moving={Boolean(moveDrag)}
        resizing={Boolean(resizeDrag)}
        gainControl={gainControl}
        onSelectionMouseDown={handleSelectionMouseDown}
        onContextMenu={handleContextMenu}
        onEdgeMouseDown={handleEdgeMouseDown}
        onGainMouseDown={handleGainMouseDown}
        onResetGain={handleResetGain}
        interactive={canInteract}
      />
      {isAudioClip && audioFocusMode && (operations.length > 0 || canUnbakeAudioEditStack) && (
        <ClipAudioEditStackControls
          operations={operations}
          activeCount={activeAudioEditCount}
          audioBakePending={audioBakePending}
          canUnbakeAudioEditStack={canUnbakeAudioEditStack}
          onMouseDown={handleAudioEditStackMouseDown}
          onToggleOperation={handleToggleAudioEditOperation}
          onRemoveOperation={handleRemoveAudioEditOperation}
          onBake={handleBakeAudioEditStack}
          onUnbake={handleUnbakeAudioEditStack}
          onClear={handleClearAudioEditStack}
        />
      )}
      {contextMenu && (
        <ClipAudioRegionContextMenu
          menuRef={contextMenuRef}
          position={contextMenuRenderPosition ?? contextMenu}
          model={contextMenuModel}
          selection={contextMenu.selection}
          onRunCommand={runContextMenuCommand}
        />
      )}
    </div>
  );
}
