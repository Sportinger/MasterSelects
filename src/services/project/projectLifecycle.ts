// Project Lifecycle — create, open, close, auto-sync

import { Logger } from '../logger';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useYouTubeStore } from '../../stores/youtubeStore';
import { useDockStore } from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFlashBoardStore } from '../../stores/flashboardStore';
import { useExportStore } from '../../stores/exportStore';
import { useMIDIStore } from '../../stores/midiStore';
import { projectFileService } from '../projectFileService';
import { isProjectStoreSyncInProgress, syncStoresToProject, saveCurrentProject } from './projectSave';
import { loadProjectToStores } from './projectLoad';

const log = Logger.create('ProjectSync');

// Debounced continuous save — saves 1s after the last change
let continuousSaveTimer: ReturnType<typeof setTimeout> | null = null;
let isContinuousSaving = false;
let scheduledContinuousSaveDelayMs: number | null = null;
let queuedContinuousSaveDelayMs: number | null = null;
let autoSyncDisposers: Array<() => void> = [];
let beforeUnloadHandler: (() => void) | null = null;

const DEFAULT_CONTINUOUS_SAVE_DELAY_MS = 1000;

function registerAutoSyncDisposer(disposer: unknown): void {
  if (typeof disposer === 'function') {
    autoSyncDisposers.push(disposer as () => void);
  }
}

function clearScheduledContinuousSave(): void {
  if (continuousSaveTimer) {
    clearTimeout(continuousSaveTimer);
    continuousSaveTimer = null;
  }
  scheduledContinuousSaveDelayMs = null;
}

function queueContinuousSave(delayMs: number): void {
  queuedContinuousSaveDelayMs = queuedContinuousSaveDelayMs === null
    ? delayMs
    : Math.min(queuedContinuousSaveDelayMs, delayMs);
}

function scheduleContinuousSave(delayMs: number = DEFAULT_CONTINUOUS_SAVE_DELAY_MS): void {
  if (isContinuousSaving) {
    queueContinuousSave(delayMs);
    return;
  }

  if (
    continuousSaveTimer &&
    scheduledContinuousSaveDelayMs !== null &&
    scheduledContinuousSaveDelayMs <= delayMs
  ) {
    return;
  }

  clearScheduledContinuousSave();
  scheduledContinuousSaveDelayMs = delayMs;
  continuousSaveTimer = setTimeout(() => {
    void executeContinuousSave();
  }, delayMs);
}

async function executeContinuousSave(): Promise<void> {
  clearScheduledContinuousSave();
  if (isContinuousSaving) {
    queueContinuousSave(0);
    return;
  }
  if (!projectFileService.isProjectOpen()) {
    log.debug('Continuous save skipped — no project open');
    return;
  }

  isContinuousSaving = true;
  try {
    const saved = await saveCurrentProject();
    if (saved) {
      log.info('Continuous save completed');
    } else {
      log.warn('Continuous save did not complete');
    }
  } catch (err) {
    log.error('Continuous save failed:', err);
  } finally {
    isContinuousSaving = false;
    if (queuedContinuousSaveDelayMs !== null) {
      const nextDelay = queuedContinuousSaveDelayMs;
      queuedContinuousSaveDelayMs = null;
      scheduleContinuousSave(nextDelay);
    }
  }
}

/**
 * Flush pending continuous save immediately (used on beforeunload).
 * Calls syncStoresToProject synchronously so project data is up-to-date,
 * then fires off saveProject (may or may not complete before page unload).
 */
function flushContinuousSave(): void {
  if (!projectFileService.isProjectOpen()) return;

  clearScheduledContinuousSave();

  // Sync stores to project data (mostly synchronous work)
  void syncStoresToProject();
  // Fire off disk write — may or may not complete before unload
  void projectFileService.saveProject();
  log.info('Continuous save flushed on beforeunload');
}

function triggerContinuousSaveIfEnabled(options?: { immediate?: boolean; delayMs?: number }): void {
  const { saveMode } = useSettingsStore.getState();
  if (saveMode === 'continuous') {
    if (options?.immediate) {
      void executeContinuousSave();
      return;
    }
    scheduleContinuousSave(options?.delayMs ?? DEFAULT_CONTINUOUS_SAVE_DELAY_MS);
  }
}

/**
 * Create a new project
 */
export async function createNewProject(name: string): Promise<boolean> {
  // Create project folder on filesystem first
  const success = await projectFileService.createProject(name);
  if (!success) return false;

  // Now sync current store state into the newly created project
  // This overwrites the empty initial project data with actual user edits
  await syncStoresToProject();
  await projectFileService.saveProject();

  return true;
}

/**
 * Open an existing project
 */
export async function openExistingProject(): Promise<boolean> {
  const success = await projectFileService.openProject();
  if (!success) return false;

  // Load project data to stores
  await loadProjectToStores();

  return true;
}

/**
 * Close current project
 */
export function closeCurrentProject(): void {
  projectFileService.closeProject();
  useFlashBoardStore.setState({
    activeBoardId: null,
    boards: [],
    selectedNodeIds: [],
    composer: {
      draftNodeId: null,
      isOpen: false,
      generateAudio: false,
      multiShots: false,
      multiPrompt: [],
      referenceMediaFileIds: [],
    },
  });
  useExportStore.getState().reset();
  useMediaStore.getState().newProject();
}

/**
 * Mark project as dirty when stores change.
 * In continuous save mode, also triggers a debounced save to disk.
 */
export function setupAutoSync(): void {
  teardownAutoSync();

  const markProjectDirtyAndMaybeSave = (options?: { immediate?: boolean; delayMs?: number }) => {
    if (projectFileService.isProjectOpen() && !isProjectStoreSyncInProgress()) {
      projectFileService.markDirty();
      triggerContinuousSaveIfEnabled(options);
    }
  };

  // Subscribe to store changes and mark project dirty
  registerAutoSyncDisposer(useMediaStore.subscribe(
    (state) => [state.files, state.compositions, state.folders, state.slotAssignments, state.slotClipSettings],
    () => {
      markProjectDirtyAndMaybeSave();
    }
  ));

  registerAutoSyncDisposer(useTimelineStore.subscribe(
    (state) => [
      state.clips,
      state.tracks,
      state.markers,
      state.inPoint,
      state.outPoint,
      state.loopPlayback,
      state.durationLocked,
    ],
    () => {
      markProjectDirtyAndMaybeSave();
    }
  ));

  registerAutoSyncDisposer(useTimelineStore.subscribe(
    (state) => state.clipKeyframes,
    () => {
      markProjectDirtyAndMaybeSave({ immediate: true });
    }
  ));

  const handleMIDIProjectStateChange = () => {
    markProjectDirtyAndMaybeSave();
  };

  registerAutoSyncDisposer(useMIDIStore.subscribe((state) => state.isEnabled, handleMIDIProjectStateChange));
  registerAutoSyncDisposer(useMIDIStore.subscribe((state) => state.transportBindings, handleMIDIProjectStateChange));
  registerAutoSyncDisposer(useMIDIStore.subscribe((state) => state.slotBindings, handleMIDIProjectStateChange));
  registerAutoSyncDisposer(useMIDIStore.subscribe((state) => state.parameterBindings, handleMIDIProjectStateChange));

  registerAutoSyncDisposer(useFlashBoardStore.subscribe(
    (state) => [state.boards, state.activeBoardId],
    () => {
      markProjectDirtyAndMaybeSave();
    }
  ));

  registerAutoSyncDisposer(useExportStore.subscribe(
    (state) => [state.settings, state.presets, state.selectedPresetId],
    () => {
      markProjectDirtyAndMaybeSave();
    }
  ));

  // Subscribe to YouTube store changes
  let prevYouTubeVideos = useYouTubeStore.getState().videos;
  registerAutoSyncDisposer(useYouTubeStore.subscribe((state) => {
    if (state.videos !== prevYouTubeVideos) {
      prevYouTubeVideos = state.videos;
      markProjectDirtyAndMaybeSave();
    }
  }));

  // Subscribe to dock layout changes
  let prevDockLayout = useDockStore.getState().layout;
  registerAutoSyncDisposer(useDockStore.subscribe((state) => {
    if (state.layout !== prevDockLayout) {
      prevDockLayout = state.layout;
      markProjectDirtyAndMaybeSave();
    }
  }));

  // In continuous mode, flush pending save on page unload
  beforeUnloadHandler = () => {
    const { saveMode } = useSettingsStore.getState();
    if (saveMode === 'continuous') {
      flushContinuousSave();
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  log.info(`Auto-sync setup complete (saveMode: ${useSettingsStore.getState().saveMode})`);
}

export function teardownAutoSync(): void {
  clearScheduledContinuousSave();
  queuedContinuousSaveDelayMs = null;

  for (const dispose of autoSyncDisposers) {
    dispose();
  }
  autoSyncDisposers = [];

  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    teardownAutoSync();
  });
}
