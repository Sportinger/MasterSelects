import { useTimelineStore } from '../../../../../stores/timeline';
import { useMediaStore } from '../../../../../stores/mediaStore';
import { useDockStore } from '../../../../../stores/dockStore';
import {
  HISTORY_DEBUG_DISABLE_STORAGE_KEY,
  isHistoryDisabledForDebug,
  setHistoryDisabledForDebug,
  useHistoryStore,
} from '../../../../../stores/historyStore';
import { layerPlaybackManager } from '../../../../layerPlaybackManager';
import { projectFileService } from '../../../../projectFileService';
import { loadProjectToStores } from '../../../../project/projectLoad';
import { proxyFrameCache } from '../../../../proxyFrameCache';
import { collectStemDebugState, runAudioElementBenchmark } from './audio';
import { measureClipDragInteraction } from './clipDragInteraction';
import { measureDockResizeInteraction } from './dock';
import {
  getCurrentExportPanelState,
  probeVideoEncoderConfigs,
  runExportPanelButtonProbe,
  startCurrentExportFromPanel,
} from './exportPanel';
import { measureTimelineInteraction } from './interaction';
import { loadProjectSnapshotForDebug } from './loadProjectSnapshot';
import { inspectLayoutOverflow } from './layoutOverflow';
import { probeMediaBitstream } from './mediaBitstream';
import { probeMediaPipeline } from './mediaPipelineProbe';
import { runMotionDesignMd1EvidenceDebugAction } from './motionDesignMd1Evidence';
import { runMotionDesignMd2EvidenceDebugAction } from './motionDesignMd2Evidence';
import {
  armMixerFaderRecording,
  clearMixerFaderRecording,
  getMixerFaderRecording,
  inspectMixerMeters,
  measureMixerFaderInteraction,
  recordMixerFaderInteraction,
} from './mixer';
import {
  measureIdleMainThread,
  measurePlaybackFrameLoop,
  measureRafCallbacks,
  measureScheduledCallbacks,
  measureUiFrameLoop,
  summarizeSourceBufferMixerEligibility,
  summarizePerformanceMemory,
  summarizeProxyAudioCache,
} from './performance';
import {
  isRealClipDragRecorderActive,
  isRealClipDragRecorderArmed,
  readLastRealClipDragRecord,
  readRealClipDragSession,
  REAL_CLIP_DRAG_RECORD_ARM_KEY,
  REAL_CLIP_DRAG_SESSION_KEY,
  setRealClipDragRecorderArmed,
  writeLastRealClipDragRecord,
  writeRealClipDragSession,
} from './realClipDragRecorder';
import { measureStoreChurn } from './storeChurn';

const waitForTransformProbe = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function cloneForTransformProbe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readTransformProbeValue(clipId: string, property: string): unknown {
  const clip = useTimelineStore.getState().clips.find((entry) => entry.id === clipId);
  if (!clip) return undefined;

  if (property === 'opacity') return clip.transform.opacity;
  if (property === 'position.x') return clip.transform.position.x;
  if (property === 'position.y') return clip.transform.position.y;
  if (property === 'scale.all') return clip.transform.scale.all ?? 1;
  if (property === 'scale.x') return clip.transform.scale.x;
  if (property === 'scale.y') return clip.transform.scale.y;
  if (property === 'rotation.z') return clip.transform.rotation.z;

  return undefined;
}

function findTransformProbeControl(clipId: string, property: string, inputIndex = 0): HTMLElement | null {
  const root = document.querySelector<HTMLElement>(
    `[data-guided-property="${property}"][data-guided-clip-id="${clipId}"]`,
  );
  if (!root) {
    const labelText = property === 'opacity' ? 'Opacity' : property === 'speed' ? 'Speed' : null;
    if (!labelText) return null;

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.control-row.transform-param-row'));
    const row = rows.find((entry) => entry.querySelector('.prop-label')?.textContent?.trim().startsWith(labelText));
    return row?.querySelectorAll<HTMLElement>('.draggable-number')[inputIndex] ?? null;
  }

  return root.querySelectorAll<HTMLElement>('.draggable-number')[inputIndex] ?? null;
}

function createTransformProbeMouseEvent(
  type: string,
  init: MouseEventInit & { movementX?: number } = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    ...init,
  });
  if (init.buttons !== undefined) {
    Object.defineProperty(event, 'buttons', { configurable: true, get: () => init.buttons });
  }
  if (init.movementX !== undefined) {
    Object.defineProperty(event, 'movementX', { configurable: true, get: () => init.movementX });
  }
  return event;
}

function setTransformProbeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

async function editTransformProbeControl(
  clipId: string,
  property: string,
  value: string,
  inputIndex = 0,
) {
  const control = findTransformProbeControl(clipId, property, inputIndex);
  if (!control) {
    return { success: false, error: `Control not found for ${property}` };
  }

  control.dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    detail: 2,
    view: window,
  }));
  await waitForTransformProbe(80);

  const root = control.closest<HTMLElement>('[data-guided-property]');
  const input = root?.querySelector<HTMLInputElement>('input.draggable-number-input')
    ?? (document.activeElement instanceof HTMLInputElement ? document.activeElement : null);
  if (!input) {
    return { success: false, error: `Editable input did not open for ${property}` };
  }

  input.focus();
  setTransformProbeInputValue(input, value);
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    data: value,
    inputType: 'insertText',
  }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForTransformProbe(80);
  input.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    code: 'Enter',
  }));
  await waitForTransformProbe(80);
  input.blur();
  await waitForTransformProbe(80);

  return { success: true };
}

async function dragTransformProbeControl(clipId: string, property: string, deltaX: number, inputIndex = 0) {
  const control = findTransformProbeControl(clipId, property, inputIndex);
  if (!control) {
    return { success: false, error: `Control not found for ${property}` };
  }

  const rect = control.getBoundingClientRect();
  const startX = rect.left + Math.max(2, rect.width / 2);
  const y = rect.top + Math.max(2, rect.height / 2);
  control.dispatchEvent(createTransformProbeMouseEvent('mousedown', {
    button: 0,
    buttons: 1,
    clientX: startX,
    clientY: y,
  }));
  await waitForTransformProbe(50);

  const steps = 5;
  for (let step = 1; step <= steps; step += 1) {
    const previousX = startX + (deltaX * (step - 1)) / steps;
    const nextX = startX + (deltaX * step) / steps;
    window.dispatchEvent(createTransformProbeMouseEvent('mousemove', {
      button: 0,
      buttons: 1,
      clientX: nextX,
      clientY: y,
      movementX: nextX - previousX,
    }));
    await waitForTransformProbe(20);
  }

  window.dispatchEvent(createTransformProbeMouseEvent('mouseup', {
    button: 0,
    buttons: 0,
    clientX: startX + deltaX,
    clientY: y,
  }));
  await waitForTransformProbe(120);

  return { success: true };
}

function transformProbeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function transformProbeClose(actual: unknown, expected: number, tolerance = 0.001): boolean {
  const value = transformProbeNumber(actual);
  return value !== null && Math.abs(value - expected) <= tolerance;
}

async function runTransformPanelInputProbe(args: Record<string, unknown> = {}) {
  const timeline = useTimelineStore.getState();
  const clipId = typeof args.clipId === 'string' && args.clipId.trim()
    ? args.clipId.trim()
    : timeline.primarySelectedClipId ?? Array.from(timeline.selectedClipIds)[0] ?? '';
  const clip = timeline.clips.find((entry) => entry.id === clipId);
  if (!clip) {
    return { success: false, error: 'No clip found for transform panel probe.' };
  }

  const restore = args.restore !== false;
  const originalTransform = cloneForTransformProbe(clip.transform);
  const activeComp = useMediaStore.getState().getActiveComposition();
  const compWidth = activeComp?.width ?? 1920;
  const compHeight = activeComp?.height ?? 1080;
  const tests: Array<Record<string, unknown>> = [];

  useDockStore.getState().activatePanelType('clip-properties');
  await waitForTransformProbe(180);

  document.querySelector<HTMLElement>('[data-guided-target="properties-tab:transform"]')?.click();
  await waitForTransformProbe(120);

  const panel = document.querySelector<HTMLElement>('[data-guided-properties-tab="transform"]');
  if (!panel) {
    return {
      success: false,
      error: 'Transform panel is not visible.',
      data: {
        clipId,
        availableProperties: Array.from(document.querySelectorAll<HTMLElement>('[data-guided-property]'))
          .map((element) => element.getAttribute('data-guided-property')),
      },
    };
  }

  useTimelineStore.getState().updateClipTransform(clipId, {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { all: 1, x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  });
  await waitForTransformProbe(120);

  const runEdit = async (
    name: string,
    property: string,
    inputValue: string,
    expected: number,
    inputIndex = 0,
    tolerance = 0.001,
  ) => {
    const before = readTransformProbeValue(clipId, property);
    const editResult = await editTransformProbeControl(clipId, property, inputValue, inputIndex);
    const after = readTransformProbeValue(clipId, property);
    tests.push({
      name,
      property,
      inputValue,
      before,
      after,
      expected,
      success: editResult.success && transformProbeClose(after, expected, tolerance),
      editResult,
    });
  };

  await runEdit('type Position X', 'position.x', '120.0', 120 / (compWidth / 2), 0, 0.0005);
  await runEdit('type Position Y', 'position.y', '-54.0', -54 / (compHeight / 2), 0, 0.0005);
  await runEdit('type Scale All', 'scale.all', '125.0', 1.25);
  await runEdit('type Opacity', 'opacity', '72.0', 0.72);
  await runEdit('type Rotation Z degrees', 'rotation.z', '18.5', 18.5, 1);

  const dragBefore = readTransformProbeValue(clipId, 'scale.x');
  const dragResult = await dragTransformProbeControl(clipId, 'scale.x', 80);
  const dragAfter = readTransformProbeValue(clipId, 'scale.x');
  const dragBeforeNumber = transformProbeNumber(dragBefore);
  const dragAfterNumber = transformProbeNumber(dragAfter);
  tests.push({
    name: 'drag Scale X',
    property: 'scale.x',
    before: dragBefore,
    after: dragAfter,
    success: dragResult.success &&
      dragBeforeNumber !== null &&
      dragAfterNumber !== null &&
      Math.abs(dragAfterNumber - dragBeforeNumber) > 0.0001,
    dragResult,
  });

  if (restore) {
    useTimelineStore.getState().updateClipTransform(clipId, originalTransform);
    await waitForTransformProbe(120);
  }

  return {
    success: tests.every((test) => test.success === true),
    data: {
      action: 'probe-transform-panel-inputs',
      clipId,
      restore,
      compWidth,
      compHeight,
      tests,
      restoredTransform: restore ? useTimelineStore.getState().clips.find((entry) => entry.id === clipId)?.transform : null,
    },
  };
}

export async function runDebugAction(action: string, args: Record<string, unknown> = {}) {
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();

  switch (action) {
    case 'measure-idle-main-thread':
      return measureIdleMainThread(args);
    case 'measure-store-churn':
      return measureStoreChurn(args);
    case 'measure-ui-frame-loop':
      return measureUiFrameLoop(args);
    case 'measure-playback-frame-loop':
      return measurePlaybackFrameLoop(args);
    case 'probe-transform-panel-inputs':
      return runTransformPanelInputProbe(args);
    case 'probe-export-panel-button':
      return runExportPanelButtonProbe(args);
    case 'start-current-export':
      return startCurrentExportFromPanel();
    case 'get-current-export-state':
      return getCurrentExportPanelState();
    case 'probe-video-encoder-configs':
      return probeVideoEncoderConfigs(args);
    case 'probe-media-bitstream':
      return probeMediaBitstream(args);
    case 'probe-media-pipeline':
      return probeMediaPipeline(args);
    case 'run-motion-design-md1-evidence':
      return runMotionDesignMd1EvidenceDebugAction(args);
    case 'run-motion-design-md2-evidence':
      return runMotionDesignMd2EvidenceDebugAction(args);
    case 'pause-playback': {
      timelineState.pause();
      return {
        success: true,
        data: {
          action,
          isPlaying: useTimelineStore.getState().isPlaying,
          playheadPosition: useTimelineStore.getState().playheadPosition,
        },
      };
    }
    case 'set-playhead-position': {
      const position = typeof args.position === 'number' && Number.isFinite(args.position)
        ? Math.max(0, args.position)
        : 0;
      timelineState.pause();
      timelineState.setPlayheadPosition(position);
      return {
        success: true,
        data: {
          action,
          requestedPosition: position,
          playheadPosition: useTimelineStore.getState().playheadPosition,
          isPlaying: useTimelineStore.getState().isPlaying,
        },
      };
    }
    case 'measure-raf-callbacks':
      return measureRafCallbacks(args);
    case 'measure-scheduled-callbacks':
      return measureScheduledCallbacks(args);
    case 'measure-timeline-interaction':
      return measureTimelineInteraction(args);
    case 'inspect-layout-overflow':
      return inspectLayoutOverflow(args);
    case 'measure-clip-drag-interaction':
      return measureClipDragInteraction(args);
    case 'arm-real-clip-drag-recording': {
      writeLastRealClipDragRecord(null);
      writeRealClipDragSession(null);
      setRealClipDragRecorderArmed(true);
      return {
        success: true,
        data: {
          armed: isRealClipDragRecorderArmed(),
          active: isRealClipDragRecorderActive(),
          storageKey: REAL_CLIP_DRAG_RECORD_ARM_KEY,
          message: 'Next real timeline clip drag will be recorded.',
        },
      };
    }
    case 'arm-real-clip-drag-session': {
      const maxRecords = typeof args.maxRecords === 'number' && Number.isFinite(args.maxRecords)
        ? Math.max(1, Math.min(100, Math.round(args.maxRecords)))
        : 12;
      writeLastRealClipDragRecord(null);
      writeRealClipDragSession({
        startedAt: new Date().toISOString(),
        maxRecords,
        records: [],
      });
      setRealClipDragRecorderArmed(true);
      return {
        success: true,
        data: {
          armed: isRealClipDragRecorderArmed(),
          active: isRealClipDragRecorderActive(),
          storageKey: REAL_CLIP_DRAG_SESSION_KEY,
          session: readRealClipDragSession(),
          message: `Next ${maxRecords} real timeline clip drags will be recorded.`,
        },
      };
    }
    case 'get-real-clip-drag-recording':
      return {
        success: true,
        data: {
          armed: isRealClipDragRecorderArmed(),
          active: isRealClipDragRecorderActive(),
          record: readLastRealClipDragRecord(),
        },
      };
    case 'get-real-clip-drag-session':
      return {
        success: true,
        data: {
          armed: isRealClipDragRecorderArmed(),
          active: isRealClipDragRecorderActive(),
          session: readRealClipDragSession(),
          lastRecord: readLastRealClipDragRecord(),
        },
      };
    case 'clear-real-clip-drag-recording':
      setRealClipDragRecorderArmed(false);
      writeLastRealClipDragRecord(null);
      writeRealClipDragSession(null);
      return {
        success: true,
        data: {
          armed: isRealClipDragRecorderArmed(),
          active: isRealClipDragRecorderActive(),
          record: null,
        },
      };
    case 'click-toolbar-layout-switch': {
      const requestedName = typeof args.name === 'string'
        ? args.name.trim().toLowerCase()
        : '';
      const requestedId = typeof args.id === 'string'
        ? args.id.trim().toLowerCase()
        : '';
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.toolbar-layout-switch'));
      const button = buttons.find((candidate) => {
        const label = candidate.textContent?.trim().toLowerCase() ?? '';
        const title = candidate.title.trim().toLowerCase();
        return (
          (requestedName && (label === requestedName || title === `load ${requestedName}`)) ||
          (requestedId && candidate.getAttribute('data-layout-id')?.toLowerCase() === requestedId)
        );
      }) ?? null;
      if (!button) {
        return {
          success: false,
          error: 'Toolbar layout switch button not found',
          data: {
            requestedName,
            requestedId,
            buttons: buttons.map((candidate) => ({
              text: candidate.textContent?.trim() ?? '',
              title: candidate.title,
              active: candidate.classList.contains('active'),
            })),
          },
        };
      }
      button.click();
      const waitMs = Math.max(0, Math.min(Number(args.waitMs) || 0, 5000));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      return {
        success: true,
        data: {
          action,
          clicked: button.textContent?.trim() ?? '',
          activeSavedLayoutId: useDockStore.getState().activeSavedLayoutId,
          buttons: buttons.map((candidate) => ({
            text: candidate.textContent?.trim() ?? '',
            title: candidate.title,
            active: candidate.classList.contains('active'),
          })),
        },
      };
    }
    case 'measure-dock-resize-interaction':
      return measureDockResizeInteraction(args);
    case 'measure-mixer-fader-interaction':
      return measureMixerFaderInteraction(args);
    case 'inspect-mixer-meters':
      return inspectMixerMeters();
    case 'arm-mixer-fader-recording':
      return armMixerFaderRecording(args);
    case 'get-mixer-fader-recording':
      return getMixerFaderRecording(args);
    case 'clear-mixer-fader-recording':
      return clearMixerFaderRecording();
    case 'record-mixer-fader-interaction':
      return recordMixerFaderInteraction(args);
    case 'set-history-disabled': {
      const disabled = args.disabled !== false;
      setHistoryDisabledForDebug(disabled);
      if (disabled) {
        useHistoryStore.getState().clearHistory();
      }
      return {
        success: true,
        data: {
          action,
          disabled: isHistoryDisabledForDebug(),
          storageKey: HISTORY_DEBUG_DISABLE_STORAGE_KEY,
        },
      };
    }
    case 'get-history-debug-state':
      {
        const history = useHistoryStore.getState();
        // Tree model: "undo stack" = ancestors of the active node (root first),
        // "redo stack" = the last-visited child chain below the active node.
        const undoLabels: string[] = [];
        let ancestor = history.activeNodeId ? history.nodes[history.activeNodeId] : undefined;
        while (ancestor?.parentId) {
          const parent = history.nodes[ancestor.parentId];
          if (!parent) break;
          undoLabels.unshift(parent.snapshot.label);
          ancestor = parent;
        }
        const redoLabels: string[] = [];
        let redoCursor = history.activeNodeId;
        while (redoCursor) {
          const childId = history.lastVisitedChildByNodeId[redoCursor];
          const child = childId ? history.nodes[childId] : undefined;
          if (!child) break;
          redoLabels.push(child.snapshot.label);
          redoCursor = child.id;
        }
        const activeNode = history.activeNodeId ? history.nodes[history.activeNodeId] : undefined;
      return {
        success: true,
        data: {
          action,
          disabled: isHistoryDisabledForDebug(),
          storageKey: HISTORY_DEBUG_DISABLE_STORAGE_KEY,
          undoStackLength: undoLabels.length,
          redoStackLength: redoLabels.length,
          hasCurrentSnapshot: activeNode !== undefined,
          nodeCount: Object.keys(history.nodes).length,
          activeNodeId: history.activeNodeId,
          batchId: history.batchId,
          batchLabel: history.batchLabel,
          undoLabels,
          redoLabels,
          currentLabel: activeNode?.snapshot.label ?? null,
        },
      };
      }
    case 'get-project-file-debug-state':
      return {
        success: true,
        data: {
          action,
          activeBackend: projectFileService.activeBackend,
          isOpen: projectFileService.isProjectOpen(),
          hasUnsavedChanges: projectFileService.hasUnsavedChanges(),
          projectPath: projectFileService.getProjectPath(),
          projectName: projectFileService.getProjectData()?.name ?? null,
          recentProjects: projectFileService.getRecentProjects(),
        },
      };
    case 'get-proxy-audio-cache-state':
      return {
        success: true,
        data: {
          memory: summarizePerformanceMemory(),
          proxyAudioCache: summarizeProxyAudioCache(),
        },
      };
    case 'get-source-buffer-mixer-eligibility':
      return {
        success: true,
        data: summarizeSourceBufferMixerEligibility(),
      };
    case 'clear-proxy-audio-buffer-cache': {
      const before = summarizeProxyAudioCache();
      proxyFrameCache.clearAudioBufferCache();
      return {
        success: true,
        data: {
          before,
          after: summarizeProxyAudioCache(),
          memory: summarizePerformanceMemory(),
        },
      };
    }
    case 'run-audio-element-benchmark':
      return runAudioElementBenchmark(args);
    case 'get-audio-proxy-state':
      return {
        success: true,
        data: {
          files: mediaState.files.map((file) => ({
            id: file.id,
            name: file.name,
            type: file.type,
            hasAudio: file.hasAudio ?? null,
            hasProxyAudio: file.hasProxyAudio === true,
            audioProxyStatus: file.audioProxyStatus ?? null,
            audioProxyProgress: file.audioProxyProgress ?? null,
            audioProxyStorageKey: file.audioProxyStorageKey ?? file.fileHash ?? file.id,
            hasAudioProxyUrl: Boolean(file.audioProxyUrl),
          })),
          clips: timelineState.clips.map((clip) => ({
            id: clip.id,
            name: clip.name,
            sourceType: clip.source?.type ?? null,
            mediaFileId: clip.source?.mediaFileId ?? clip.mediaFileId ?? null,
          })),
        },
      };
    case 'get-stem-state':
      return collectStemDebugState(args);
    case 'start-stem-separation': {
      const clipId = typeof args.clipId === 'string' && args.clipId.trim()
        ? args.clipId.trim()
        : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
      if (!clipId) {
        return { success: false, error: 'No clipId provided and no clip is selected.' };
      }

      const jobId = await timelineState.startClipStemSeparation(clipId, {
        force: args.force === true,
        modelId: typeof args.modelId === 'string' ? args.modelId : undefined,
      });
      const debugState = await collectStemDebugState({ ...args, clipId });
      return {
        success: jobId !== null,
        data: {
          action,
          clipId,
          jobId,
          debugState: debugState.success ? debugState.data : null,
        },
        ...(jobId === null ? { error: 'Stem separation did not start for this clip.' } : {}),
      };
    }
    case 'cancel-stem-separation': {
      const clipId = typeof args.clipId === 'string' && args.clipId.trim()
        ? args.clipId.trim()
        : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
      if (!clipId) {
        return { success: false, error: 'No clipId provided and no clip is selected.' };
      }

      timelineState.cancelClipStemSeparation(clipId);
      return collectStemDebugState({ ...args, clipId });
    }
    case 'set-clip-stem-solo': {
      const clipId = typeof args.clipId === 'string' && args.clipId.trim()
        ? args.clipId.trim()
        : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
      if (!clipId) {
        return { success: false, error: 'No clipId provided and no clip is selected.' };
      }
      const stemId = typeof args.stemId === 'string' && args.stemId.trim()
        ? args.stemId.trim()
        : null;
      timelineState.setClipStemSolo(clipId, stemId);
      return collectStemDebugState({ ...args, clipId });
    }
    case 'sync-clip-stem-copies': {
      const clipId = typeof args.clipId === 'string' && args.clipId.trim()
        ? args.clipId.trim()
        : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
      if (!clipId) {
        return { success: false, error: 'No clipId provided and no clip is selected.' };
      }
      const copyCount = timelineState.syncClipStemSeparationCopies(clipId);
      const debugState = await collectStemDebugState({ ...args, clipId });
      return {
        success: true,
        data: {
          action,
          clipId,
          copyCount,
          debugState: debugState.success ? debugState.data : null,
        },
      };
    }
    case 'set-slot-view': {
      const progress = typeof args.progress === 'number' ? args.progress : 1;
      timelineState.setSlotGridProgress(progress);
      return { success: true, data: { action, progress } };
    }
    case 'activate-slot': {
      const compositionId = typeof args.compositionId === 'string' ? args.compositionId : null;
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      const select = args.select !== false;
      const open = args.open === true;
      const play = args.play === true;
      if (!compositionId) {
        return { success: false, error: 'Missing compositionId' };
      }

      const composition = mediaState.compositions.find((entry) => entry.id === compositionId);
      if (!composition) {
        return { success: false, error: `Composition not found: ${compositionId}` };
      }

      mediaState.ensureSlotClipSettings(compositionId, composition.duration);
      if (select) {
        mediaState.selectSlotComposition(compositionId);
      }
      if (open) {
        mediaState.openCompositionTab(compositionId, { skipAnimation: true });
      }
      mediaState.activateOnLayer(compositionId, layerIndex);
      if (play) {
        layerPlaybackManager.playLayer(layerIndex);
      }

      return { success: true, data: { action, compositionId, layerIndex, select, open, play } };
    }
    case 'play-slot-layer': {
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      layerPlaybackManager.playLayer(layerIndex);
      return { success: true, data: { action, layerIndex } };
    }
    case 'pause-slot-layer': {
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      layerPlaybackManager.pauseLayer(layerIndex);
      return { success: true, data: { action, layerIndex } };
    }
    case 'stop-slot-layer': {
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      layerPlaybackManager.stopLayer(layerIndex);
      return { success: true, data: { action, layerIndex } };
    }
    case 'deactivate-all-slots': {
      mediaState.deactivateAllLayers();
      mediaState.selectSlotComposition(null);
      return { success: true, data: { action } };
    }
    case 'load-project-path': {
      const projectPath = typeof args.path === 'string' ? args.path : '';
      if (!projectPath) {
        return { success: false, error: 'Missing path' };
      }

      const loaded = await projectFileService.loadProject(projectPath);
      if (!loaded) {
        return { success: false, error: `Failed to load project: ${projectPath}` };
      }

      await loadProjectToStores();
      return {
        success: true,
        data: {
          action,
          projectPath,
          projectName: projectFileService.getProjectData()?.name ?? null,
        },
      };
    }
    case 'load-project-snapshot': {
      return loadProjectSnapshotForDebug(args);
    }
    case 'reload-page': {
      window.location.reload();
      return { success: true, data: { action } };
    }
    default:
      return { success: false, error: `Unknown debug action: ${action}` };
  }
}
