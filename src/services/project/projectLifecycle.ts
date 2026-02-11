// Project Lifecycle — create, open, close, auto-sync

import { Logger } from '../logger';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useYouTubeStore } from '../../stores/youtubeStore';
import { useDockStore } from '../../stores/dockStore';
import { projectFileService } from '../projectFileService';
import { syncStoresToProject } from './projectSave';
import { loadProjectToStores } from './projectLoad';

const log = Logger.create('ProjectSync');

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
 * Mark project as dirty when stores change
 */
export function setupAutoSync(): void {
  // Subscribe to store changes and mark project dirty
  useMediaStore.subscribe(
    (state) => [state.files, state.compositions, state.folders, state.slotAssignments],
    () => {
      if (projectFileService.isProjectOpen()) {
        projectFileService.markDirty();
      }
    }
  );

  useTimelineStore.subscribe(
    (state) => [state.clips, state.tracks],
    () => {
      if (projectFileService.isProjectOpen()) {
        projectFileService.markDirty();
      }
    }
  );

  // Subscribe to YouTube store changes
  let prevYouTubeVideos = useYouTubeStore.getState().videos;
  useYouTubeStore.subscribe((state) => {
    if (state.videos !== prevYouTubeVideos) {
      prevYouTubeVideos = state.videos;
      if (projectFileService.isProjectOpen()) {
        projectFileService.markDirty();
      }
    }
  });

  // Subscribe to dock layout changes
  let prevDockLayout = useDockStore.getState().layout;
  useDockStore.subscribe((state) => {
    if (state.layout !== prevDockLayout) {
      prevDockLayout = state.layout;
      if (projectFileService.isProjectOpen()) {
        projectFileService.markDirty();
      }
    }
  });

  log.info(' Auto-sync setup complete');
}
