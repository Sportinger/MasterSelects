import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipAudioEditOperation, ClipAudioRegionGainPreview, TimelineClip } from '../../../types';
import {
  useTimelineStore,
} from '../../../stores/timeline';
import type {
  ApplyAudioRegionGainEditOptions,
  ApplyAudioRegionEditOptions,
  TimelineAudioRegionEditType,
  TimelineAudioRegionSelection,
} from '../../../stores/timeline/types';
import type {
  ApplyTimelineEditOperationOptions,
  TimelineEditOperation,
  TimelineEditResult,
} from '../../../stores/timeline/editOperations/types';
import { useContextMenuPosition } from '../../../hooks/useContextMenuPosition';
import { Logger } from '../../../services/logger';
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
  resolveAudioRegionGainControl,
  resolveAudioRegionOverlay,
  type AudioRegionGainControlOverlay,
  type TimelineRegionOverlay,
} from '../utils/activeRegionOverlays';

const log = Logger.create('ClipAudioRegionControls');

type ApplyTimelineEditOperation = (
  operation: TimelineEditOperation,
  options: ApplyTimelineEditOperationOptions,
) => TimelineEditResult;

type ApplyAudioRegionEdit = (
  type: TimelineAudioRegionEditType,
  options?: ApplyAudioRegionEditOptions,
) => string | null;

type SetAudioRegionGainEdit = (options: ApplyAudioRegionGainEditOptions) => string | null;

type SelectClip = (id: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;

type AudioRegionGainDragState = {
  mode: 'gain' | 'fade-in' | 'fade-out';
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

interface AudioRegionContextMenuPosition {
  x: number;
  y: number;
}

export interface ClipAudioRegionControls {
  audioRegionOverlay: TimelineRegionOverlay | null;
  audioRegionGainControl: AudioRegionGainControlOverlay | null;
  audioRegionContextMenu: AudioRegionContextMenuState | null;
  audioRegionContextMenuRef: ReturnType<typeof useContextMenuPosition>['menuRef'];
  audioRegionContextMenuRenderPosition: AudioRegionContextMenuPosition | null;
  audioRegionContextMenuModel: ReturnType<typeof createAudioRegionContextMenuModel>;
  runAudioRegionContextMenuCommand: (
    command: AudioRegionContextMenuCommand,
    selection: TimelineAudioRegionSelection,
  ) => void;
  closeAudioRegionContextMenu: () => void;
  handleAudioRegionGainMouseDown: (
    mode: AudioRegionGainDragState['mode'],
  ) => (e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => void;
  handleAudioRegionContextMenu: (e: React.MouseEvent) => void;
  handleResetAudioRegionGain: () => void;
}

export function useClipAudioRegionControls(input: {
  clip: TimelineClip;
  audioRegionSelection: TimelineAudioRegionSelection | null;
  displayAudioEditStack: readonly ClipAudioEditOperation[];
  displayStartTime: number;
  displayDuration: number;
  width: number;
  hasAudioRegionClipboard: boolean;
  applyTimelineEditOperation: ApplyTimelineEditOperation;
  applyAudioRegionEdit: ApplyAudioRegionEdit;
  setAudioRegionGainPreview: (preview: ClipAudioRegionGainPreview | null) => void;
  clearAudioRegionGainPreview: () => void;
  setAudioRegionGainEdit: SetAudioRegionGainEdit;
  setAudioRegionSelection: (selection: TimelineAudioRegionSelection) => void;
  clearAudioRegionSelection: () => void;
  copySelectedAudioRegion: () => boolean;
  pasteAudioRegionToSelection: () => string | null;
  selectClip: SelectClip;
}): ClipAudioRegionControls {
  const [audioRegionGainDrag, setAudioRegionGainDrag] = useState<AudioRegionGainDragState | null>(null);
  const [audioRegionContextMenu, setAudioRegionContextMenu] = useState<AudioRegionContextMenuState | null>(null);
  const audioRegionCommandHandledRef = useRef(false);
  const { menuRef: audioRegionContextMenuRef, adjustedPosition: audioRegionContextMenuPosition } =
    useContextMenuPosition(audioRegionContextMenu);
  const {
    clip,
    audioRegionSelection,
    displayAudioEditStack,
    displayStartTime,
    displayDuration,
    width,
    hasAudioRegionClipboard,
    applyTimelineEditOperation,
    applyAudioRegionEdit,
    setAudioRegionGainPreview,
    clearAudioRegionGainPreview,
    setAudioRegionGainEdit,
    setAudioRegionSelection,
    clearAudioRegionSelection,
    copySelectedAudioRegion,
    pasteAudioRegionToSelection,
    selectClip,
  } = input;

  const audioRegionOverlay = useMemo(() => resolveAudioRegionOverlay({
    selection: audioRegionSelection,
    displayStartTime,
    displayDuration,
    width,
  }), [
    audioRegionSelection,
    displayDuration,
    displayStartTime,
    width,
  ]);

  const selectedAudioRegionGainOperation = useMemo(() => {
    if (!audioRegionSelection) return null;
    const start = Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const end = Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);

    for (let index = displayAudioEditStack.length - 1; index >= 0; index -= 1) {
      const operation = displayAudioEditStack[index];
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
  }, [displayAudioEditStack, audioRegionSelection]);

  const audioRegionGainControl = useMemo(() => audioRegionOverlay
    ? resolveAudioRegionGainControl({
        selection: audioRegionSelection,
        overlayWidth: audioRegionOverlay.width,
        selectedOperation: selectedAudioRegionGainOperation,
        dragState: audioRegionGainDrag,
      })
    : null, [
      audioRegionGainDrag,
      audioRegionOverlay,
      audioRegionSelection,
      selectedAudioRegionGainOperation,
    ]);

  const commitAudioRegionGainEdit = useCallback((gainInput: {
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

  const handleResetAudioRegionGain = useCallback(() => {
    commitAudioRegionGainEdit({
      gainDb: 0,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    });
  }, [commitAudioRegionGainEdit]);

  const publishAudioRegionGainPreview = useCallback((gainInput: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    if (!audioRegionSelection) return;
    setAudioRegionGainPreview({
      clipId: clip.id,
      trackId: audioRegionSelection.trackId,
      startTime: audioRegionSelection.startTime,
      endTime: audioRegionSelection.endTime,
      sourceInPoint: audioRegionSelection.sourceInPoint,
      sourceOutPoint: audioRegionSelection.sourceOutPoint,
      gainDb: gainInput.gainDb,
      fadeInSeconds: gainInput.fadeInSeconds,
      fadeOutSeconds: gainInput.fadeOutSeconds,
    });
  }, [audioRegionSelection, clip.id, setAudioRegionGainPreview]);

  const handleAudioRegionGainMouseDown = useCallback((
    mode: AudioRegionGainDragState['mode'],
  ) => (e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!audioRegionGainControl) return;
    const regionElement = e.currentTarget.closest('.clip-audio-region-selection');
    if (!regionElement) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = regionElement.getBoundingClientRect();
    const startGainDb = mode === 'gain'
      ? Number(audioRegionGainDbFromClientY(e.clientY, rect).toFixed(1))
      : audioRegionGainControl.gainDb;
    publishAudioRegionGainPreview({
      gainDb: startGainDb,
      fadeInSeconds: audioRegionGainControl.fadeInSeconds,
      fadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
    });

    setAudioRegionGainDrag({
      mode,
      regionLeft: rect.left,
      regionWidth: rect.width,
      regionTop: rect.top,
      regionHeight: rect.height,
      regionDuration: audioRegionGainControl.regionDuration,
      currentGainDb: startGainDb,
      currentFadeInSeconds: audioRegionGainControl.fadeInSeconds,
      currentFadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
    });
  }, [audioRegionGainControl, publishAudioRegionGainPreview]);

  const handleAudioRegionContextMenu = useCallback((e: React.MouseEvent) => {
    if (!audioRegionSelection) return;
    e.preventDefault();
    e.stopPropagation();
    const expectedExpandedHeight = 340;
    const y = typeof window === 'undefined'
      ? e.clientY
      : Math.min(
          e.clientY,
          Math.max(8, window.innerHeight - expectedExpandedHeight - 8),
        );
    audioRegionCommandHandledRef.current = false;
    setAudioRegionContextMenu({ x: e.clientX, y, selection: audioRegionSelection });
  }, [audioRegionSelection]);

  const closeAudioRegionContextMenu = useCallback(() => {
    setAudioRegionContextMenu(null);
  }, []);

  useEffect(() => {
    if (!audioRegionGainDrag) return;

    const getNextDragState = (e: MouseEvent): AudioRegionGainDragState => {
      if (audioRegionGainDrag.mode === 'gain') {
        return {
          ...audioRegionGainDrag,
          currentGainDb: Number(audioRegionGainDbFromClientY(e.clientY, {
            top: audioRegionGainDrag.regionTop,
            height: audioRegionGainDrag.regionHeight,
          }).toFixed(1)),
        };
      }

      const localX = Math.max(0, Math.min(audioRegionGainDrag.regionWidth, e.clientX - audioRegionGainDrag.regionLeft));
      const secondsAtPointer = (localX / Math.max(1, audioRegionGainDrag.regionWidth)) * audioRegionGainDrag.regionDuration;
      const maxFadeSeconds = audioRegionGainDrag.regionDuration / 2;

      return {
        ...audioRegionGainDrag,
        currentFadeInSeconds: audioRegionGainDrag.mode === 'fade-in'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, secondsAtPointer)).toFixed(4))
          : audioRegionGainDrag.currentFadeInSeconds,
        currentFadeOutSeconds: audioRegionGainDrag.mode === 'fade-out'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, audioRegionGainDrag.regionDuration - secondsAtPointer)).toFixed(4))
          : audioRegionGainDrag.currentFadeOutSeconds,
      };
    };

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const next = getNextDragState(e);
      publishAudioRegionGainPreview({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      setAudioRegionGainDrag(next);
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const next = getNextDragState(e);
      commitAudioRegionGainEdit({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      clearAudioRegionGainPreview();
      setAudioRegionGainDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [audioRegionGainDrag, clearAudioRegionGainPreview, commitAudioRegionGainEdit, publishAudioRegionGainPreview]);

  useEffect(() => () => {
    const preview = useTimelineStore.getState().audioRegionGainPreview;
    if (preview?.clipId === clip.id) {
      useTimelineStore.getState().clearAudioRegionGainPreview();
    }
  }, [clip.id]);

  useEffect(() => {
    if (!audioRegionContextMenu) return;

    const handlePointerDown = () => closeAudioRegionContextMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAudioRegionContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [audioRegionContextMenu, closeAudioRegionContextMenu]);

  const handleSplitAudioRegionAtSelection = useCallback((selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const selection = selectionSnapshot?.clipId === clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === clip.id
      ? store.audioRegionSelection
      : audioRegionSelection;
    const currentClip = store.clips.find(candidate => candidate.id === clip.id) ?? clip;
    if (!selection) {
      log.warn('Cannot split audio region without an active selection', { clipId: clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
    if (!range) {
      log.warn('Cannot split audio region outside clip bounds', { clipId: clip.id, selection });
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
        id: `split-audio-region:${clip.id}:${range.start}:${range.end}`,
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
    audioRegionSelection,
    clearAudioRegionSelection,
    clip,
    selectClip,
  ]);

  const handleCutAudioRegion = useCallback((selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const selection = selectionSnapshot?.clipId === clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === clip.id
      ? store.audioRegionSelection
      : audioRegionSelection;
    const currentClip = store.clips.find(candidate => candidate.id === clip.id) ?? clip;
    if (!selection) {
      log.warn('Cannot cut audio region without an active selection', { clipId: clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
    if (!range) {
      log.warn('Cannot cut audio region outside clip bounds', { clipId: clip.id, selection });
      return;
    }

    if (store.audioRegionSelection?.clipId !== currentClip.id) {
      setAudioRegionSelection(selection);
    }
    copySelectedAudioRegion();
    const result = applyTimelineEditOperation({
      id: `cut-audio-region:${clip.id}:${range.start}:${range.end}`,
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
    audioRegionSelection,
    clearAudioRegionSelection,
    clip,
    copySelectedAudioRegion,
    setAudioRegionSelection,
  ]);

  const contextMenuAudioRegionSelection = audioRegionContextMenu?.selection ?? audioRegionSelection;
  const audioRegionContextMenuModel = useMemo(() => createAudioRegionContextMenuModel({
    hasAudioRegionClipboard,
    onSplit: () => handleSplitAudioRegionAtSelection(contextMenuAudioRegionSelection),
    onCut: () => handleCutAudioRegion(contextMenuAudioRegionSelection),
    onCopy: copySelectedAudioRegion,
    onPaste: pasteAudioRegionToSelection,
    applyAudioRegionEdit,
  }), [
    applyAudioRegionEdit,
    contextMenuAudioRegionSelection,
    copySelectedAudioRegion,
    handleCutAudioRegion,
    handleSplitAudioRegionAtSelection,
    hasAudioRegionClipboard,
    pasteAudioRegionToSelection,
  ]);

  const runAudioRegionContextMenuCommand = useCallback((
    command: AudioRegionContextMenuCommand,
    selection: TimelineAudioRegionSelection,
  ) => {
    if (audioRegionCommandHandledRef.current) return;
    if (command.disabled) return;
    audioRegionCommandHandledRef.current = true;
    log.info('Audio region context command', {
      command: command.key,
      clipId: clip.id,
      selection,
    });
    setAudioRegionSelection(selection);
    command.action();
    closeAudioRegionContextMenu();
  }, [clip.id, closeAudioRegionContextMenu, setAudioRegionSelection]);

  const audioRegionContextMenuRenderPosition = useMemo(() => {
    if (!audioRegionContextMenu) return null;
    return {
      x: audioRegionContextMenuPosition?.x ?? audioRegionContextMenu.x,
      y: audioRegionContextMenuPosition?.y ?? audioRegionContextMenu.y,
    };
  }, [
    audioRegionContextMenu,
    audioRegionContextMenuPosition?.x,
    audioRegionContextMenuPosition?.y,
  ]);

  return {
    audioRegionOverlay,
    audioRegionGainControl,
    audioRegionContextMenu,
    audioRegionContextMenuRef,
    audioRegionContextMenuRenderPosition,
    audioRegionContextMenuModel,
    runAudioRegionContextMenuCommand,
    closeAudioRegionContextMenu,
    handleAudioRegionGainMouseDown,
    handleAudioRegionContextMenu,
    handleResetAudioRegionGain,
  };
}
