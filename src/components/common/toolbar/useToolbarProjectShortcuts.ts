import { useEffect } from 'react';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import {
  claimShortcut,
  isTextEntryTarget,
} from '../../../services/shortcutFocusPolicy';

interface UseToolbarProjectShortcutsArgs {
  handleNew: () => void;
  handleOpen: () => void;
  handleSave: () => void;
  handleSaveAs: () => void;
}

export function useToolbarProjectShortcuts({
  handleNew,
  handleOpen,
  handleSave,
  handleSaveAs,
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

        if (saveAction === 'project.saveAs') handleSaveAs();
        else handleSave();
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
    handleSave,
    handleSaveAs,
  ]);
}
