import { Logger } from '../../logger';
import { projectDB } from '../../projectDB';
import type { NativeProjectCoreService } from '../core/NativeProjectCoreService';
import type { ProjectCoreService } from '../core/ProjectCoreService';
import {
  getRecentProject,
  removeRecentProject,
} from '../recentProjects';

const log = Logger.create('ProjectFileService');

export interface RecentProjectOpeningContext {
  isFsaAvailable: boolean;
  coreService: ProjectCoreService;
  ensureNativeBackendReady: () => Promise<NativeProjectCoreService | null>;
  activateFsaBackend: () => void;
}

export async function openRecentProject(context: RecentProjectOpeningContext, id: string): Promise<boolean> {
  const recentProject = getRecentProject(id);
  if (!recentProject) {
    return false;
  }

  if (recentProject.backend === 'native') {
    if (!recentProject.path) {
      await removeRecentProject(id);
      return false;
    }

    const nativeCore = await context.ensureNativeBackendReady();
    return nativeCore ? nativeCore.loadProject(recentProject.path) : false;
  }

  if (recentProject.backend === 'opfs') {
    return recentProject.path
      ? context.coreService.openStoredProject(recentProject.path)
      : false;
  }

  if (!context.isFsaAvailable || !recentProject.handleKey) {
    // WebKit may have legacy FSA-shaped metadata even though it could not
    // clone the OPFS directory handle into IndexedDB. The folder name is
    // enough to re-derive the project from the origin-private root.
    return !context.isFsaAvailable
      ? context.coreService.openStoredProject(recentProject.name)
      : false;
  }

  let storedHandle: FileSystemHandle | null = null;
  try {
    storedHandle = await projectDB.getStoredHandle(recentProject.handleKey);
  } catch (error) {
    log.warn('Failed to read recent project handle', error);
    return false;
  }

  if (!storedHandle || storedHandle.kind !== 'directory') {
    throw new Error(`The saved folder access for "${recentProject.name}" is unavailable. Use Open existing to reconnect its project folder. The recent entry has been kept.`);
  }

  const projectHandle = storedHandle as FileSystemDirectoryHandle;
  let permission = await projectHandle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    permission = await projectHandle.requestPermission({ mode: 'readwrite' });
  }

  if (permission !== 'granted') {
    throw new Error(`Folder access was not granted for "${recentProject.name}". Retry or use Open existing to reconnect it.`);
  }

  context.activateFsaBackend();
  const loaded = await context.coreService.loadProject(projectHandle);
  if (!loaded) {
    throw new Error(`"${recentProject.name}" could not be read. Its folder link has been kept; retry or choose its folder with Open existing.`);
  }
  return loaded;
}
