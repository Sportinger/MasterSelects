import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { Logger } from '../../../services/logger';
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

const log = Logger.create('Toolbar');

interface UseToolbarProjectActionsArgs {
  closeMenu: () => void;
  editName: string;
  isRenamingRef: MutableRefObject<boolean>;
  openProjectNameDialog: (request: ProjectNameDialogRequest) => void;
  projectName: string;
  resetMediaProject: (name: string) => void;
  setEditName: Dispatch<SetStateAction<string>>;
  setIsEditingName: Dispatch<SetStateAction<boolean>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsProjectOpen: Dispatch<SetStateAction<boolean>>;
  setNeedsPermission: Dispatch<SetStateAction<boolean>>;
  setPendingProjectName: Dispatch<SetStateAction<string | null>>;
  setProjectName: Dispatch<SetStateAction<string>>;
  setRecentProjects: Dispatch<SetStateAction<RecentProjectEntry[]>>;
  setRenameError: Dispatch<SetStateAction<string | null>>;
  setShowSavedToast: Dispatch<SetStateAction<boolean>>;
}

export function useToolbarProjectActions({
  closeMenu,
  editName,
  isRenamingRef,
  openProjectNameDialog,
  projectName,
  resetMediaProject,
  setEditName,
  setIsEditingName,
  setIsLoading,
  setIsProjectOpen,
  setNeedsPermission,
  setPendingProjectName,
  setProjectName,
  setRecentProjects,
  setRenameError,
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
    } else {
      await saveCurrentProject({ source: 'manual', label: 'Manual save' });
      if (showToast) setShowSavedToast(true);
    }
    closeMenu();
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

  const handleNameSubmit = useCallback(async () => {
    if (isRenamingRef.current) return;

    setRenameError(null);

    if (editName.trim()) {
      const newName = editName.trim();
      const data = projectFileService.getProjectData();

      if (data && newName !== data.name) {
        isRenamingRef.current = true;
        setIsLoading(true);
        const success = await projectFileService.renameProject(newName);
        if (success) {
          setProjectName(newName);
          setShowSavedToast(true);
        } else {
          setEditName(data.name);
          setRenameError(`Could not rename to "${newName}" \u2014 a folder with that name may already exist.`);
          setTimeout(() => setRenameError(null), 4000);
        }
        setIsLoading(false);
        isRenamingRef.current = false;
      }
    }
    setIsEditingName(false);
  }, [
    editName,
    isRenamingRef,
    setEditName,
    setIsEditingName,
    setIsLoading,
    setProjectName,
    setRenameError,
    setShowSavedToast,
  ]);

  const handleProjectNameSubmit = useCallback(async (
    mode: ProjectNameDialogMode,
    name: string,
  ): Promise<string | null> => {
    setIsLoading(true);
    try {
      if (mode === 'new') {
        const folderCreated = await projectFileService.createProject(name);
        if (!folderCreated) {
          return 'No project folder was selected, or the folder could not be created.';
        }

        resetMediaProject(name);
        resetStoryboardProjectState();
        await syncStoresToProject();
        const saved = await projectFileService.saveProject();
        if (!saved) {
          return 'The project folder was created, but project.json could not be saved.';
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
    handleNameSubmit,
    handleNew,
    handleOpen,
    handleOpenRecent,
    handleProjectNameSubmit,
    handleRestorePermission,
    handleSave,
    handleSaveAs,
  };
}
