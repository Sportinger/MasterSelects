import type { EditorEntryExperience } from './entryDockLayout';

/**
 * A project waiting for folder access is offered as "Resume" inside the chooser, so a direct
 * editor entry never ends on an empty editor without a visible way back to its project.
 */
export function shouldShowEditorProjectSelection(
  experience: EditorEntryExperience,
  isProjectOpen: boolean,
): boolean {
  return (experience === 'editor' || experience === 'medium') && !isProjectOpen;
}
