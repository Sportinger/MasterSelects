// Switching between the phone editor (/m) and the full editor reloads the page. Work that only lives
// in the page, like a running export, would be lost, so the switch waits for it.

import { useTimelineStore } from '../../stores/timeline';

/** Why the editor switch must wait, or null when it can go ahead. */
export function describeEditorSwitchBlocker(): string | null {
  if (useTimelineStore.getState().isExporting) {
    return 'An export is running. Let it finish or cancel it, then switch editors.';
  }
  return null;
}
