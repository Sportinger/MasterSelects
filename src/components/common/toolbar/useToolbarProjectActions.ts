import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Logger } from '../../../services/logger';
import { reportProjectSaveFailure } from '../../../services/project/projectSaveStatus';
import {
  projectFileService,
  type RecentProjectEntry,
} from '../../../services/projectFileService';
import {
  createNewProject,
  loadProjectToStores,
  openExistingProject,
  saveCurrentProject,
  setProjectLoadProgress,
  syncStoresToProject,
} from '../../../services/projectSync';
import type {
  ProjectNameDialogMode,
  ProjectNameDialogRequest,
} from '../ProjectNameDialog';
import { resetStoryboardProjectState } from '../../../stores/storyboardStore';
import { useTrackingStore } from '../../../stores/trackingStore';
import {
  markAndroidProjectAutoRestoreReady,
  prepareAndroidProjectAutoRestore,
} from '../../../services/project/androidProjectAutoRestore';

const log = Logger.create('Toolbar');

interface UseToolbarProjectActionsArgs {
  closeMenu: () => void;
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
  openProjectNameDialog,
  projectName,
  resetMediaProject,
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
    if (projectFileService.hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Open a different project?')) {
        return;
      }
    }
    setIsLoading(true);
    setProjectLoadProgress({
      phase: 'opening',
      percent: 3,
      message: 'Opening project',
      blocking: true,
    });
    const success = await openExistingProject();
    if (!success) {
      setProjectLoadProgress(null);
    }
    if (success) {
      const data = projectFileService.getProjectData();
      if (data) {
        setProjectName(data.name);
        setIsProjectOpen(true);
      }
    }
    setIsLoading(false);
    closeMenu();
  }, [closeMenu, setIsLoading, setIsProjectOpen, setProjectName]);

  const handleOpenRecent = useCallback(async (projectId: string) => {
    if (projectFileService.hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Open a different project?')) {
        return;
      }
    }

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

        // Tracking assets belong to the previous project, including large terrain
        // meshes. Clear them before media reset/sync can seed the first save.
        useTrackingStore.getState().reset();
        resetMediaProject(name);
        resetStoryboardProjectState();
        await syncStoresToProject();
        const saved = await projectFileService.saveProject();
        if (!saved) {
          return 'The project folder was created, but the .msproj package could not be saved.';
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
      log.error('Project creation failed', error);
      return 'The project could not be created. Please check the selected folder and try again.';
    } finally {
      setIsLoading(false);
    }
  }, [
    resetMediaProject,
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
    setProjectLoadProgress({
      phase: 'opening',
      percent: 3,
      message: 'Restoring project permission',
      blocking: true,
    });
    const success = await projectFileService.requestPendingPermission();
    if (success) {
      const sourceHandle = projectFileService.getProjectHandle();
      if (sourceHandle) {
        let copiedFileCount = 0;
        try {
          setProjectLoadProgress({
            phase: 'opening',
            percent: 12,
            message: 'Preparing automatic Android restore',
            blocking: true,
          });
          const mirrorHandle = await prepareAndroidProjectAutoRestore(sourceHandle, () => {
            copiedFileCount += 1;
            if (copiedFileCount === 1 || copiedFileCount % 25 === 0) {
              setProjectLoadProgress({
                phase: 'opening',
                percent: Math.min(85, 12 + copiedFileCount),
                message: `Preparing automatic Android restore (${copiedFileCount} files)`,
                blocking: true,
              });
            }
          });
          if (mirrorHandle) {
            const alreadyUsingMirror = await sourceHandle.isSameEntry(mirrorHandle);
            const mirrorLoaded = alreadyUsingMirror
              || await projectFileService.loadProject(mirrorHandle);
            if (mirrorLoaded) {
              markAndroidProjectAutoRestoreReady(mirrorHandle);
            } else {
              log.warn('Android project mirror could not be opened; keeping the original project open');
            }
          }
        } catch (error) {
          log.warn('Could not prepare Android project auto-restore; keeping the original project open', error);
        }
      }

      await loadProjectToStores();
      const data = projectFileService.getProjectData();
      if (data) {
        setProjectName(data.name);
        setIsProjectOpen(true);
      }
      setNeedsPermission(false);
      setPendingProjectName(null);
    } else {
      setProjectLoadProgress(null);
    }
    setIsLoading(false);
  }, [
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setPendingProjectName,
    setProjectName,
  ]);

  return {
    handleClearRecentProjects,
    handleNew,
    handleOpen,
    handleOpenRecent,
    handleProjectNameSubmit,
    handleRename,
    handleRestorePermission,
    handleSave,
    handleSaveAs,
  };
}
