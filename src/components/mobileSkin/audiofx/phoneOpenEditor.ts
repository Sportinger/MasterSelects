// Opens one of the phone's landscape editors (Curves, Mixer, Piano roll, Nodes, ...) from a sheet row.
// Callers commit or cancel their own sheet session FIRST: opening an editor closes the sheet, and a
// sheet that unmounts with an open session rolls it back. This selects the clip the editor should
// show, pauses playback (the editors edit at a still frame) and, when asked, opens the side panel
// that holds the requested controls (that becomes the person's remembered choice for the editor).

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  getPhoneWorkspace, setPhoneWorkspaceSideCollapsed, type PhoneWorkspaceId, type PhoneWorkspaceSide,
} from '../workspace/phoneWorkspaceCatalog';

const log = Logger.create('PhoneOpenEditor');

export interface PhoneOpenEditorOptions {
  /** Clip the editor works on; selected alone before the editor opens. */
  clipId?: string | null;
  /** Deselect every clip first (e.g. the composition graph in Nodes instead of a clip graph). */
  clearSelection?: boolean;
  /** Side panel to show expanded (e.g. Properties on the right for warp points). */
  revealSide?: PhoneWorkspaceSide;
}

/** Returns false (and says why in the log and a toast) when the editor does not exist. */
export function openPhoneEditor(id: PhoneWorkspaceId, options: PhoneOpenEditorOptions = {}): boolean {
  const ui = usePhoneUiStore.getState();
  const definition = getPhoneWorkspace(id);
  if (!definition) {
    log.warn('Unknown phone editor requested', { id });
    ui.showToast('This editor is not available on the phone.', 'error');
    return false;
  }
  const timeline = useTimelineStore.getState();
  if (timeline.isPlaying) timeline.pause();
  const { clipId, revealSide, clearSelection } = options;
  if (clearSelection && timeline.selectedClipIds.size > 0) timeline.selectClips([], { revealProperties: false });
  if (clipId) {
    if (!timeline.clips.some((clip) => clip.id === clipId)) {
      log.warn('The clip for the editor no longer exists', { id, clipId });
    } else if (!(timeline.selectedClipIds.size === 1 && timeline.selectedClipIds.has(clipId))) {
      timeline.selectClips([clipId], { revealProperties: false });
    }
  }
  if (revealSide && definition[revealSide]) setPhoneWorkspaceSideCollapsed(id, revealSide, false);
  ui.openWorkspace(id);
  return true;
}
