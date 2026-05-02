// Project Sync Service — barrel re-export
// Synchronizes mediaStore and timelineStore with projectFileService

export { syncStoresToProject, saveCurrentProject } from './project/projectSave';
export { loadProjectToStores, setProjectLoadProgress } from './project/projectLoad';
export { createNewProject, openExistingProject, closeCurrentProject, setupAutoSync } from './project/projectLifecycle';
