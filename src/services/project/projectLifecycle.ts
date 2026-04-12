// Project Lifecycle — create, open, close, auto-sync

import { Logger } from '../logger';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useYouTubeStore } from '../../stores/youtubeStore';
import { useDockStore } from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { projectFileService } from '../projectFileService';
import { isProjectStoreSyncInProgress, syncStoresToProject, saveCurrentProject } from './projectSave';
import { loadProjectToStores } from './projectLoad';

const log = Logger.create('ProjectSync');

// Debounced continuous save — saves 1s after the last change
let continuousSaveTimer: ReturnType<typeof setTimeout> | null = null;
let isContinuousSaving = false;
let scheduledContinuousSaveDelayMs: number | null = null;
let queuedContinuousSaveDelayMs: number | null = null;

const DEFAULT_CONTINUOUS_SAVE_DELAY_MS = 1000;

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
    await saveCurrentProject();
    log.info('Continuous save completed');
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
  useMediaStore.getState().newProject();
}

/**
 * Mark project as dirty when stores change.
 * In continuous save mode, also triggers a debounced save to disk.
 */
export function setupAutoSync(): void {
  // Subscribe to store changes and mark project dirty
  useMediaStore.subscribe(
    (state) => [state.files, state.compositions, state.folders, state.slotAssignments, state.slotClipSettings],
    () => {
      if (projectFileService.isProjectOpen() && !isProjectStoreSyncInProgress()) {
        projectFileService.markDirty();
        triggerContinuousSaveIfEnabled();
      }
    }
  );

  useTimelineStore.subscribe(
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
      if (projectFileService.isProjectOpen() && !isProjectStoreSyncInProgress()) {
        projectFileService.markDirty();
        triggerContinuousSaveIfEnabled();
      }
    }
  );

  useTimelineStore.subscribe(
    (state) => state.clipKeyframes,
    () => {
      if (projectFileService.isProjectOpen() && !isProjectStoreSyncInProgress()) {
        projectFileService.markDirty();
        triggerContinuousSaveIfEnabled({ immediate: true });
      }
    }
  );

  // Subscribe to YouTube store changes
  let prevYouTubeVideos = useYouTubeStore.getState().videos;
  useYouTubeStore.subscribe((state) => {
    if (state.videos !== prevYouTubeVideos) {
      prevYouTubeVideos = state.videos;
      if (projectFileService.isProjectOpen() && !isProjectStoreSyncInProgress()) {
        projectFileService.markDirty();
        triggerContinuousSaveIfEnabled();
      }
    }
  });

  // Subscribe to dock layout changes
  let prevDockLayout = useDockStore.getState().layout;
  useDockStore.subscribe((state) => {
    if (state.layout !== prevDockLayout) {
      prevDockLayout = state.layout;
      if (projectFileService.isProjectOpen() && !isProjectStoreSyncInProgress()) {
        projectFileService.markDirty();
        triggerContinuousSaveIfEnabled();
      }
    }
  });

  // In continuous mode, flush pending save on page unload
  window.addEventListener('beforeunload', () => {
    const { saveMode } = useSettingsStore.getState();
    if (saveMode === 'continuous') {
      flushContinuousSave();
    }
  });

  log.info(`Auto-sync setup complete (saveMode: ${useSettingsStore.getState().saveMode})`);
}
