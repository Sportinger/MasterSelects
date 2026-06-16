// Global history hook - initializes undo/redo system and keyboard shortcuts

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../stores/timeline';
import { useMediaStore } from '../stores/mediaStore';
import { useDockStore } from '../stores/dockStore';
import { useFlashBoardStore } from '../stores/flashboardStore';
import { useExportStore } from '../stores/exportStore';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardComposerState,
  FlashBoardJobState,
} from '../stores/flashboardStore';
import type { Composition, MediaFile } from '../stores/mediaStore/types';
import type { TimelineClip } from '../types';
import type { DockLayout, DockNode, DockPanel, FloatingPanel } from '../types/dock';
import { getShortcutRegistry } from '../services/shortcutRegistry';
import { isAIExecutionRunning } from '../services/aiTools/executionState';
import { layerBuilder } from '../services/layerBuilder';
import { renderHostPort } from '../services/render/renderHostPort';
import {
  useHistoryStore,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  captureSnapshot,
  undo,
  redo,
  isHistoryDisabledForDebug,
} from '../stores/historyStore';
import { Logger } from '../services/logger';

const log = Logger.create('History');

function isHistoryCaptureSuppressed(): boolean {
  const historyState = useHistoryStore.getState();
  return (
    isHistoryDisabledForDebug() ||
    historyState.isApplying ||
    historyState.batchId !== null
  );
}

export interface HistoryFeedbackNotice {
  id: number;
  operation: 'undo' | 'redo';
  label: string;
}

// Shallow equality for subscription selectors — prevents callback from firing
// on unrelated store changes (e.g. playheadPosition updates at 60fps)
function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

function normalizeFlashBoardJobForHistory(job?: FlashBoardJobState) {
  if (!job || job.status === 'queued' || job.status === 'processing') {
    return null;
  }

  return {
    status: job.status,
    error: job.status === 'failed' ? job.error ?? null : null,
  };
}

function normalizeFlashBoardRecordsForHistory(records: FlashBoardActiveGenerationRecord[]) {
  return records.map((record) => ({
    id: record.id,
    kind: record.kind,
    request: record.request ?? null,
    result: record.result ?? null,
    job: normalizeFlashBoardJobForHistory(record.job),
  }));
}

function normalizeFlashBoardComposerForHistory(composer: FlashBoardComposerState) {
  return {
    service: composer.service ?? null,
    providerId: composer.providerId ?? null,
    version: composer.version ?? null,
    outputType: composer.outputType ?? null,
    voiceId: composer.voiceId ?? null,
    voiceName: composer.voiceName ?? null,
    languageOverride: composer.languageOverride ?? false,
    languageCode: composer.languageCode ?? null,
    outputFormat: composer.outputFormat ?? null,
    voiceSettings: composer.voiceSettings ?? null,
    generateAudio: composer.generateAudio ?? false,
    multiShots: composer.multiShots ?? false,
    multiPrompt: composer.multiPrompt ?? [],
    startMediaFileId: composer.startMediaFileId ?? null,
    endMediaFileId: composer.endMediaFileId ?? null,
    referenceMediaFileIds: composer.referenceMediaFileIds ?? [],
  };
}

function normalizeCompositionTimelineForHistory(timelineData: Composition['timelineData']) {
  if (!timelineData) return null;

  const {
    playheadPosition: _playheadPosition,
    zoom: _zoom,
    scrollX: _scrollX,
    ...undoableTimelineData
  } = timelineData;

  return undoableTimelineData;
}

function normalizeCompositionForHistory(
  composition: Composition,
  activeCompositionId: string | null
) {
  const { timelineData, ...undoableComposition } = composition;

  return {
    ...undoableComposition,
    timelineData: composition.id === activeCompositionId
      ? null
      : normalizeCompositionTimelineForHistory(timelineData),
  };
}

export function createCompositionHistorySignature(
  compositions: Composition[],
  activeCompositionId: string | null
): string {
  return JSON.stringify(
    compositions.map((composition) => normalizeCompositionForHistory(composition, activeCompositionId))
  );
}

const CLIP_HISTORY_SIGNATURE_SKIP_KEYS = new Set([
  'file',
  'mediaElement',
  'videoElement',
  'audioElement',
  'waveform',
  'waveformChannels',
  'waveformGenerating',
  'waveformProgress',
  'audioAnalysisJob',
  'sourceAnalysisRefs',
  'processedAnalysisRefs',
  'mixdownBuffer',
  'thumbnailUrl',
  'proxyVideoUrl',
]);

const MEDIA_FILE_HISTORY_SIGNATURE_SKIP_KEYS = new Set([
  'file',
  'url',
  'thumbnailUrl',
  'proxyVideoUrl',
  'waveform',
  'waveformChannels',
  'waveformProgress',
  'waveformStatus',
  'audioAnalysisRefs',
]);

function isHistorySignatureBinaryPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof AudioBuffer !== 'undefined' && value instanceof AudioBuffer) return true;
  return false;
}

function isHistorySignatureDomPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (typeof Element !== 'undefined' && value instanceof Element) return true;
  if (typeof HTMLMediaElement !== 'undefined' && value instanceof HTMLMediaElement) return true;
  if (typeof File !== 'undefined' && value instanceof File) return true;
  return false;
}

function normalizeValueForHistorySignature(
  value: unknown,
  skipKeys: Set<string>,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return null;
  if (isHistorySignatureBinaryPayload(value) || isHistorySignatureDomPayload(value)) return null;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => normalizeValueForHistorySignature(item, skipKeys, seen));
  }

  const proto = Object.getPrototypeOf(value);
  if (proto && proto !== Object.prototype) return null;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (skipKeys.has(key)) continue;
    const nested = normalizeValueForHistorySignature(
      (value as Record<string, unknown>)[key],
      skipKeys,
      seen,
    );
    if (nested !== undefined) {
      normalized[key] = nested;
    }
  }

  return normalized;
}

export function createTimelineClipsHistorySignature(clips: TimelineClip[]): string {
  return JSON.stringify(
    clips.map(clip => normalizeValueForHistorySignature(clip, CLIP_HISTORY_SIGNATURE_SKIP_KEYS))
  );
}

export function createMediaFilesHistorySignature(files: MediaFile[]): string {
  return JSON.stringify(
    files.map(file => normalizeValueForHistorySignature(file, MEDIA_FILE_HISTORY_SIGNATURE_SKIP_KEYS))
  );
}

function normalizeDockPanelForHistory(panel: DockPanel) {
  return {
    id: panel.id,
    type: panel.type,
    title: panel.title,
  };
}

function normalizeDockNodeForHistory(node: DockNode): unknown {
  if (node.kind === 'tab-group') {
    return {
      kind: node.kind,
      id: node.id,
      panels: node.panels.map(normalizeDockPanelForHistory),
    };
  }

  return {
    kind: node.kind,
    id: node.id,
    direction: node.direction,
    ratio: node.ratio,
    children: node.children.map(normalizeDockNodeForHistory),
  };
}

function normalizeFloatingPanelForHistory(panel: FloatingPanel) {
  return {
    id: panel.id,
    panel: normalizeDockPanelForHistory(panel.panel),
    position: panel.position,
    size: panel.size,
  };
}

export function createDockLayoutHistorySignature(layout: DockLayout): string {
  return JSON.stringify({
    root: normalizeDockNodeForHistory(layout.root),
    floatingPanels: layout.floatingPanels.map(normalizeFloatingPanelForHistory),
  });
}

export function useGlobalHistory() {
  const initialized = useRef(false);
  const lastCaptureTime = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLabel = useRef('');
  const suppressUntil = useRef(0);
  const feedbackId = useRef(0);
  const [historyNotice, setHistoryNotice] = useState<HistoryFeedbackNotice | null>(null);

  const showHistoryNotice = useCallback((notice: Omit<HistoryFeedbackNotice, 'id'>) => {
    feedbackId.current += 1;
    setHistoryNotice({ ...notice, id: feedbackId.current });
  }, []);

  const clearHistoryNotice = useCallback((id?: number) => {
    setHistoryNotice((current) => {
      if (id !== undefined && current?.id !== id) return current;
      return null;
    });
  }, []);

  // Initialize store references
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Initialize history store with store references
    initHistoryStoreRefs({
      timeline: {
        getState: useTimelineStore.getState,
        setState: useTimelineStore.setState,
      },
      media: {
        getState: useMediaStore.getState,
        setState: useMediaStore.setState,
      },
      dock: {
        getState: useDockStore.getState,
        setState: useDockStore.setState,
      },
      flashboard: {
        getState: useFlashBoardStore.getState,
        setState: useFlashBoardStore.setState,
      },
      export: {
        getState: useExportStore.getState,
        setState: useExportStore.setState,
      },
    });

    // Register callbacks so undo/redo can flush pending captures
    setHistoryCallbacks({
      flushPendingCapture: () => {
        if (isHistoryDisabledForDebug()) return;
        if (pendingTimer.current) {
          clearTimeout(pendingTimer.current);
          const label = pendingLabel.current;
          pendingTimer.current = null;
          pendingLabel.current = '';
          // Execute the capture immediately so the state isn't lost
          lastCaptureTime.current = Date.now();
          captureSnapshot(label || 'pending');
        }
      },
      suppressCaptures: () => {
        suppressUntil.current = Date.now() + 250;
      },
      // After an undo/redo restores state, rebuild layers from the restored clips
      // and render so the preview reflects them (e.g. restored deleted clips).
      afterApply: () => {
        try {
          layerBuilder.invalidateCache();
          const layers = layerBuilder.buildLayersFromStore();
          renderHostPort.render(layers);
        } catch {
          renderHostPort.requestNewFrameRender();
        }
      },
    });

    if (isHistoryDisabledForDebug()) {
      useHistoryStore.getState().clearHistory();
      log.warn('Undo/redo system disabled by debug flag');
      return;
    }

    // Capture initial state
    captureSnapshot('initial');

    log.info('Undo/redo system initialized');
  }, []);

  // Subscribe to store changes and capture snapshots
  useEffect(() => {
    // Debounced capture — stores timer ID and label so undo/redo can flush it
    const debouncedCapture = (label: string) => {
      if (isHistoryDisabledForDebug()) return;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
        pendingLabel.current = label;
        pendingTimer.current = setTimeout(() => {
          pendingTimer.current = null;
          pendingLabel.current = '';

        if (isHistoryCaptureSuppressed()) return;

        // Suppress captures shortly after undo/redo to prevent cascade re-captures
        if (Date.now() < suppressUntil.current) return;

        const now = Date.now();
        // Minimum 100ms between captures
        if (now - lastCaptureTime.current < 100) return;
        lastCaptureTime.current = now;
        captureSnapshot(label);
      }, 150);
    };

    if (isHistoryDisabledForDebug()) {
      return;
    }

    // Subscribe to timeline changes (clips, tracks, keyframes, markers)
    // Using shallowEqual so callback only fires when these specific properties change,
    // not on every store update (playheadPosition, isPlaying, etc.)
    const unsubTimeline = useTimelineStore.subscribe(
      (state) => ({
        clips: state.clips,
        tracks: state.tracks,
        clipKeyframes: state.clipKeyframes,
        markers: state.markers,
        masterAudioState: (state as { masterAudioState?: unknown }).masterAudioState,
      }),
      (curr, prev) => {
        if (isHistoryCaptureSuppressed()) return;

        // Skip captures during mask dragging — vertex updates fire at 60fps
        // and would cause expensive deep-clone snapshots every 150ms
        if (useTimelineStore.getState().maskDragging) return;

        if (
          curr.clips !== prev.clips &&
          createTimelineClipsHistorySignature(curr.clips) !== createTimelineClipsHistorySignature(prev.clips)
        ) {
          if (curr.clips.length !== prev.clips.length) {
            debouncedCapture(curr.clips.length > prev.clips.length ? 'Add clip' : 'Remove clip');
          } else {
            debouncedCapture('Modify clip');
          }
        } else if (curr.tracks !== prev.tracks) {
          debouncedCapture('Modify track');
        } else if (curr.clipKeyframes !== prev.clipKeyframes) {
          debouncedCapture('Modify keyframes');
        } else if (curr.markers !== prev.markers) {
          debouncedCapture('Modify markers');
        } else if (curr.masterAudioState !== prev.masterAudioState) {
          debouncedCapture('Modify master audio');
        }
      },
      { equalityFn: shallowEqual, fireImmediately: false }
    );

    // Subscribe to media changes
    const unsubMedia = useMediaStore.subscribe(
      (state) => ({
        files: state.files,
        compositions: state.compositions,
        activeCompositionId: state.activeCompositionId,
        folders: state.folders,
        textItems: state.textItems,
        solidItems: state.solidItems,
        mathSceneItems: state.mathSceneItems,
        motionShapeItems: state.motionShapeItems,
      }),
      (curr, prev) => {
        if (isHistoryCaptureSuppressed()) return;

        if (
          curr.files !== prev.files &&
          createMediaFilesHistorySignature(curr.files) !== createMediaFilesHistorySignature(prev.files)
        ) {
          debouncedCapture(curr.files.length > prev.files.length ? 'Import file' : 'Remove file');
        } else if (
          curr.compositions !== prev.compositions &&
          createCompositionHistorySignature(
            curr.compositions,
            curr.activeCompositionId
          ) !== createCompositionHistorySignature(prev.compositions, prev.activeCompositionId) &&
          createCompositionHistorySignature(
            curr.compositions,
            prev.activeCompositionId
          ) !== createCompositionHistorySignature(prev.compositions, prev.activeCompositionId)
        ) {
          debouncedCapture('Modify composition');
        } else if (curr.folders !== prev.folders) {
          debouncedCapture('Modify folder');
        } else if (curr.textItems !== prev.textItems) {
          debouncedCapture('Modify text items');
        } else if (curr.solidItems !== prev.solidItems) {
          debouncedCapture('Modify solid items');
        } else if (curr.mathSceneItems !== prev.mathSceneItems) {
          debouncedCapture('Modify math scene items');
        } else if (curr.motionShapeItems !== prev.motionShapeItems) {
          debouncedCapture('Modify motion shape items');
        }
      },
      { equalityFn: shallowEqual, fireImmediately: false }
    );

    // Subscribe to dock changes
    const unsubDock = useDockStore.subscribe(
      (state) => state.layout,
      (curr, prev) => {
        if (isHistoryCaptureSuppressed()) return;
        if (isAIExecutionRunning()) return;
        if (
          curr !== prev &&
          createDockLayoutHistorySignature(curr) !== createDockLayoutHistorySignature(prev)
        ) {
          debouncedCapture('Change layout');
        }
      },
      { fireImmediately: false }
    );

    const unsubFlashBoard = useFlashBoardStore.subscribe(
      (state) => ({
        activeGenerationRecords: state.activeGenerationRecords,
        composer: state.composer,
      }),
      (curr, prev) => {
        if (isHistoryCaptureSuppressed()) return;

        if (
          curr.composer !== prev.composer &&
          JSON.stringify(normalizeFlashBoardComposerForHistory(curr.composer)) !==
            JSON.stringify(normalizeFlashBoardComposerForHistory(prev.composer))
        ) {
          debouncedCapture('Modify composer');
        } else if (
          curr.activeGenerationRecords !== prev.activeGenerationRecords &&
          JSON.stringify(normalizeFlashBoardRecordsForHistory(curr.activeGenerationRecords)) !==
            JSON.stringify(normalizeFlashBoardRecordsForHistory(prev.activeGenerationRecords))
        ) {
          debouncedCapture('Modify generation records');
        }
      },
      { equalityFn: shallowEqual, fireImmediately: false }
    );

    const unsubExport = useExportStore.subscribe(
      (state) => ({
        settings: state.settings,
        presets: state.presets,
        selectedPresetId: state.selectedPresetId,
      }),
      (curr, prev) => {
        if (isHistoryCaptureSuppressed()) return;

        if (curr.presets !== prev.presets) {
          debouncedCapture('Modify export presets');
        } else if (curr.selectedPresetId !== prev.selectedPresetId) {
          debouncedCapture('Select export preset');
        } else if (curr.settings !== prev.settings) {
          debouncedCapture('Modify export settings');
        }
      },
      { equalityFn: shallowEqual, fireImmediately: false }
    );

    return () => {
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current);
        pendingTimer.current = null;
      }
      unsubTimeline();
      unsubMedia();
      unsubDock();
      unsubFlashBoard();
      unsubExport();
    };
  }, []);

  // Global keyboard shortcuts for undo/redo
  useEffect(() => {
    const registry = getShortcutRegistry();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (registry.matches('history.undo', e)) {
        e.preventDefault();
        const result = undo();
        if (result) {
          showHistoryNotice(result);
        }
        return;
      }

      if (registry.matches('history.redo', e)) {
        e.preventDefault();
        const result = redo();
        if (result) {
          showHistoryNotice(result);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showHistoryNotice]);

  return {
    undo,
    redo,
    historyNotice,
    clearHistoryNotice,
    canUndo: useHistoryStore((state) => !isHistoryDisabledForDebug() && state.undoStack.length > 0),
    canRedo: useHistoryStore((state) => !isHistoryDisabledForDebug() && state.redoStack.length > 0),
  };
}
