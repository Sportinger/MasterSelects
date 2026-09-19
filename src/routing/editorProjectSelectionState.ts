import type { EditorEntryExperience } from './entryDockLayout';

export function shouldShowEditorProjectSelection(
  experience: EditorEntryExperience,
  isProjectOpen: boolean,
  isProjectPermissionPending = false,
): boolean {
  return (experience === 'editor' || experience === 'medium')
    && !isProjectOpen
    && !isProjectPermissionPending;
}
