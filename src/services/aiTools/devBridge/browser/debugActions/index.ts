import { useTimelineStore } from '../../../../../stores/timeline';
import { useMediaStore } from '../../../../../stores/mediaStore';
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
import { measureTimelineInteraction } from './interaction';
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
      return {
        success: true,
        data: {
          action,
          disabled: isHistoryDisabledForDebug(),
          storageKey: HISTORY_DEBUG_DISABLE_STORAGE_KEY,
          undoStackLength: useHistoryStore.getState().undoStack.length,
          redoStackLength: useHistoryStore.getState().redoStack.length,
          hasCurrentSnapshot: useHistoryStore.getState().currentSnapshot !== null,
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
    case 'reload-page': {
      window.location.reload();
      return { success: true, data: { action } };
    }
    default:
      return { success: false, error: `Unknown debug action: ${action}` };
  }
}
