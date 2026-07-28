import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { projectFileService } from '../../../services/projectFileService';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import {
  claimShortcut,
  isTextEntryTarget,
} from '../../../services/shortcutFocusPolicy';
import {
  createNewProject,
  saveCurrentProject,
} from '../../../services/projectSync';

interface UseToolbarProjectShortcutsArgs {
  handleNew: () => void;
  handleOpen: () => void;
  projectName: string;
  setIsProjectOpen: Dispatch<SetStateAction<boolean>>;
  setProjectName: Dispatch<SetStateAction<string>>;
  setShowSavedToast: Dispatch<SetStateAction<boolean>>;
}

export function useToolbarProjectShortcuts({
  handleNew,
  handleOpen,
  projectName,
  setIsProjectOpen,
  setProjectName,
  setShowSavedToast,
}: UseToolbarProjectShortcutsArgs): void {
  useEffect(() => {
    const registry = getShortcutRegistry();

    const handleKeyDown = (event: KeyboardEvent) => {
      const saveAction = registry.matches('project.saveAs', event)
        ? 'project.saveAs'
        : registry.matches('project.save', event)
          ? 'project.save'
          : null;
      if (saveAction) {
        if (
          isTextEntryTarget(event.target) ||
          isTextEntryTarget(document.activeElement)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!claimShortcut(event, saveAction, { stopPropagation: true })) return;

        if (saveAction === 'project.saveAs') {
          const name = prompt('Save project as:', projectName || 'New Project');
          if (name) {
            createNewProject(name).then((success) => {
              if (success) {
                setProjectName(name);
                setIsProjectOpen(true);
                setShowSavedToast(true);
              }
            });
          }
        } else if (!projectFileService.isProjectOpen()) {
          const name = prompt('Enter project name:', 'New Project');
          if (name) {
            createNewProject(name).then((success) => {
              if (success) {
                setProjectName(name);
                setIsProjectOpen(true);
                setShowSavedToast(true);
              }
            });
          }
        } else {
          saveCurrentProject({ source: 'manual', label: 'Ctrl+S save' }).then(() => {
            setShowSavedToast(true);
          });
        }
        return;
      }

      if (registry.matches('project.new', event)) {
        if (!claimShortcut(event, 'project.new')) return;
        handleNew();
        return;
      }

      if (registry.matches('project.open', event)) {
        if (!claimShortcut(event, 'project.open')) return;
        handleOpen();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    handleNew,
    handleOpen,
    projectName,
    setIsProjectOpen,
    setProjectName,
    setShowSavedToast,
  ]);
}
