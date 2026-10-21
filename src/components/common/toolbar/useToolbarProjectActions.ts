import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Logger } from '../../../services/logger';
import { failProjectLoadProgress } from '../../../services/project/load/loadProgress';
import {
  isExpectedArchiveImportRejection,
  isProjectBackendUnavailable,
  ProjectBackendUnavailableError,
} from '../../../services/project/projectBackendAvailability';
import { reportProjectSaveFailure } from '../../../services/project/projectSaveStatus';
import { describeBrowserStorageFailure } from '../../../services/project/core/browserStorageFailure';
import {
  projectFileService,
  type RecentProjectEntry,
} from '../../../services/projectFileService';
import {
  createNewProject,
  loadProjectToStores,
  openExistingProject,
  openProjectArchive,
  openStoredProject,
  saveCurrentProject,
  setProjectLoadProgress,
} from '../../../services/projectSync';
import type {
  ProjectNameDialogMode,
  ProjectNameDialogRequest,
} from '../ProjectNameDialog';

import { resumePendingProject } from '../../../services/project/pendingProjectResume';

const log = Logger.create('Toolbar');

interface UseToolbarProjectActionsArgs {
  closeMenu: () => void;
  /** Open Project without a folder picker or Native Helper: browser-stored projects and .msproj import. */
  openBrowserProjectDialog: () => void;
  openProjectNameDialog: (request: ProjectNameDialogRequest) => void;
  projectName: string;
  resetMediaProject: (name: string) => void;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsProjectOpen: Dispatch<SetStateAction<boolean>>;
  setNeedsPermission: Dispatch<SetStateAction<boolean>>;
  setPendingProjectName: Dispatch<SetStateAction<string | null>>;
  setProjectName: Dispatch<SetStateAction<string>>;
  setRecentProjects: Dispatch<SetStateAction<RecentProjectEntry[]>>;
  setShowSavedToast: Dispatch<SetStateAction<boolean>>;
}

export function useToolbarProjectActions({
  closeMenu,
  openBrowserProjectDialog,
  openProjectNameDialog,
  projectName,
  setIsLoading,
  setIsProjectOpen,
  setNeedsPermission,
  setPendingProjectName,
  setProjectName,
  setRecentProjects,
  setShowSavedToast,
}: UseToolbarProjectActionsArgs) {
  const handleSave = useCallback(async (showToast = true) => {
    if (!projectFileService.isProjectOpen()) {
      closeMenu();
      openProjectNameDialog({
        mode: 'save',
        initialName: 'New Project',
      });
      return;
    }
    setShowSavedToast(false);
    try {
      // Request access from the Save gesture, before asynchronous serialization.
      const handle = projectFileService.getProjectHandle();
      if (handle?.requestPermission
        && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        reportProjectSaveFailure(handle);
        window.alert('Project not saved. Allow access to the project folder and try Save again, or use Save As.');
        return;
      }
      const saved = await saveCurrentProject({ source: 'manual', label: 'Manual save' });
      if (saved) {
        if (showToast) setShowSavedToast(true);
      } else {
        reportProjectSaveFailure(projectFileService.getProjectHandle() ?? projectFileService.getProjectPath());
        window.alert('Project not saved. Check access to the project folder and available disk space, then try again or use Save As.');
      }
    } catch (error) {
      reportProjectSaveFailure(projectFileService.getProjectHandle() ?? projectFileService.getProjectPath());
      log.error('Failed to save project', error);
      window.alert('Project not saved. Your changes are still in this tab. Try Save again or use Save As before closing it.');
    } finally {
      closeMenu();
    }
  }, [closeMenu, openProjectNameDialog, setShowSavedToast]);

  const handleSaveAs = useCallback(() => {
    closeMenu();
    openProjectNameDialog({
      mode: 'saveAs',
      initialName: projectName || 'New Project',
    });
  }, [
    closeMenu,
    openProjectNameDialog,
    projectName,
  ]);

  const handleOpen = useCallback(async () => {
    setIsLoading(true);
    setProjectLoadProgress({
      phase: 'opening',
      percent: 3,
      message: 'Opening project',
      blocking: true,
    });
    try {
      const route = await projectFileService.resolveOpenProjectRoute();
      if (route === 'browser-storage') {
        // No folder can be picked here; projects in this browser and .msproj archives still open.
        setProjectLoadProgress(null);
        openBrowserProjectDialog();
        return;
      }
      if (route === 'unavailable') throw new ProjectBackendUnavailableError();
      const success = await openExistingProject();
      if (!success) {
        setProjectLoadProgress(null);
        return;
      }
      const data = projectFileService.getProjectData();
      if (data) {
        setProjectName(data.name);
        setIsProjectOpen(true);
      }
    } catch (error) {
      if (isProjectBackendUnavailable(error)) log.warn('Project folder selection unavailable', { message: error.message });
      else log.error('Failed to open project', error);
      // Keep the import error visible; clearing progress would discard its detail.
      failProjectLoadProgress(error);
    } finally {
      setIsLoading(false);
      closeMenu();
    }
  }, [closeMenu, openBrowserProjectDialog, setIsLoading, setIsProjectOpen, setProjectName]);

  /** Shared by the browser-storage open dialog; resolves to the message to show, or null once open. */
  const openFromBrowserStorage = useCallback(async (
    action: 'open' | 'import',
    open: () => Promise<boolean>,
    signal?: AbortSignal,
  ): Promise<string | null> => {
    setIsLoading(true);
    setProjectLoadProgress({
      phase: 'opening',
      percent: 3,
      message: action === 'import' ? 'Importing project archive' : 'Opening project',
      blocking: true,
    });
    try {
      if (!await open()) {
        setProjectLoadProgress(null);
        return 'The project could not be opened.';
      }
      const data = projectFileService.getProjectData();
      if (data) {
        setProjectName(data.name);
        setIsProjectOpen(true);
        setNeedsPermission(false);
        setPendingProjectName(null);
      }
      setRecentProjects(projectFileService.getRecentProjects());
      return null;
    } catch (error) {
      setProjectLoadProgress(null);
      if (signal?.aborted) {
        // The person cancelled; the import already removed its partial copy and staging.
        log.info(`Browser project ${action} cancelled`);
        return action === 'import' ? 'The project archive import was cancelled.' : 'Opening the project was cancelled.';
      }
      const storageFailure = describeBrowserStorageFailure(error);
      const fallback = action === 'import' ? 'The project archive could not be imported.' : 'The project could not be opened.';
      if (storageFailure) {
        log.warn(`Browser project ${action} blocked: browser storage is unavailable`, error);
        return `${fallback} ${storageFailure}`;
      }
      if (isExpectedArchiveImportRejection(error)) log.warn(`Browser project ${action} rejected`, error);
      else log.error(`Browser project ${action} failed`, error);
      const reason = error instanceof Error ? error.message.trim() : '';
      return reason ? `${fallback} ${reason}` : fallback;
    } finally {
      setIsLoading(false);
    }
  }, [setIsLoading, setIsProjectOpen, setNeedsPermission, setPendingProjectName, setProjectName, setRecentProjects]);

  const handleOpenStoredProject = useCallback((name: string) => (
    openFromBrowserStorage('open', () => openStoredProject(name))
  ), [openFromBrowserStorage]);

  const handleImportProjectArchive = useCallback((file: File, signal?: AbortSignal) => (
    openFromBrowserStorage('import', () => openProjectArchive(file, signal), signal)
  ), [openFromBrowserStorage]);

  const handleOpenRecent = useCallback(async (projectId: string) => {

    setIsLoading(true);
    setProjectLoadProgress({
      phase: 'opening',
      percent: 3,
      message: 'Opening recent project',
      blocking: true,
    });

    try {
      const success = await projectFileService.openRecentProject(projectId);
      if (!success) {
        setProjectLoadProgress(null);
        window.alert('Could not open that recent project. It may have moved, or the browser may need permission again.');
        return;
      }

      await loadProjectToStores();
      const data = projectFileService.getProjectData();
      if (data) {
        setProjectName(data.name);
        setIsProjectOpen(true);
        setNeedsPermission(false);
        setPendingProjectName(null);
      }
    } catch (error) {
      log.error('Failed to open recent project', error);
      setProjectLoadProgress(null);
      window.alert('Could not open that recent project.');
    } finally {
      setRecentProjects(projectFileService.getRecentProjects());
      setIsLoading(false);
      closeMenu();
    }
  }, [
    closeMenu,
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setPendingProjectName,
    setProjectName,
    setRecentProjects,
  ]);

  const handleClearRecentProjects = useCallback(async () => {
    await projectFileService.clearRecentProjects();
    setRecentProjects([]);
    closeMenu();
  }, [closeMenu, setRecentProjects]);

  const handleProjectNameSubmit = useCallback(async (
    mode: ProjectNameDialogMode,
    name: string,
  ): Promise<string | null> => {
    setIsLoading(true);
    try {
      if (mode === 'rename') {
        const data = projectFileService.getProjectData();
        if (!data) {
          return 'No project is open.';
        }
        if (name === data.name) {
          return null;
        }

        const renamed = await projectFileService.renameProject(name);
        if (!renamed) {
          return `Could not rename to "${name}" \u2014 a folder with that name may already exist.`;
        }

        setProjectName(name);
        setShowSavedToast(true);
        return null;
      }

      if (mode === 'new') {
        const folderCreated = await projectFileService.createProject(name);
        if (!folderCreated) {
          return 'No project folder was selected, or the folder could not be created.';
        }

        const saved = await projectFileService.saveProject();
        if (!saved) {
          return 'The project folder was created, but the repository could not be confirmed.';
        }
      } else {
        const created = await createNewProject(name);
        if (!created) {
          return 'No project folder was selected, or the project could not be saved.';
        }
        setShowSavedToast(true);
      }

      setProjectName(name);
      setIsProjectOpen(true);
      setNeedsPermission(false);
      return null;
    } catch (error) {
      const storageFailure = describeBrowserStorageFailure(error);
      if (storageFailure) {
        log.warn('Project creation blocked: browser storage is unavailable', error);
        return `The project could not be created. ${storageFailure}`;
      }
      log.error('Project creation failed', error);
      return 'The project could not be created. Please check the selected folder and try again.';
    } finally {
      setIsLoading(false);
    }
  }, [
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setProjectName,
    setShowSavedToast,
  ]);

  const handleNew = useCallback(() => {
    closeMenu();
    openProjectNameDialog({
      mode: 'new',
      initialName: 'New Project',
      hasUnsavedChanges: projectFileService.hasUnsavedChanges(),
    });
  }, [
    closeMenu,
    openProjectNameDialog,
  ]);

  const handleRename = useCallback(() => {
    if (!projectFileService.isProjectOpen()) return;

    closeMenu();
    openProjectNameDialog({
      mode: 'rename',
      initialName: projectFileService.getProjectData()?.name || projectName,
    });
  }, [closeMenu, openProjectNameDialog, projectName]);

  const handleRestorePermission = useCallback(async () => {
    setIsLoading(true);
    try {
      if (await resumePendingProject()) {
        const data = projectFileService.getProjectData();
        if (data) {
          setProjectName(data.name);
          setIsProjectOpen(true);
        }
        setNeedsPermission(false);
        setPendingProjectName(null);
      }
    } catch (error) {
      log.error('Project could not be resumed', error);
      failProjectLoadProgress(error);
    } finally {
      setIsLoading(false);
    }
  }, [
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setPendingProjectName,
    setProjectName,
  ]);

  return {
    handleClearRecentProjects,
    handleImportProjectArchive,
    handleNew,
    handleOpen,
    handleOpenRecent,
    handleOpenStoredProject,
    handleProjectNameSubmit,
    handleRename,
    handleRestorePermission,
    handleSave,
    handleSaveAs,
  };
}
