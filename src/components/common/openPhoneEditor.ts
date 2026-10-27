// The Layouts menu, and the Mobile toggle on a phone, open the phone editor (/m) with the same project.
// The project is saved first so the page change never loses work; a failed save keeps this editor open.

import { PHONE_EDITOR_PATH, rememberFullEditorPreference } from '../../routing/phoneEntry';
import { Logger } from '../../services/logger';
import { projectFileService } from '../../services/projectFileService';
import { saveCurrentProject } from '../../services/projectSync';
import { describeEditorSwitchBlocker } from '../../services/project/editorSwitchGuard';
import { getActiveRepositorySession } from '../../services/project/repository/lifecycle/editorRepositoryLifecycle';

const log = Logger.create('OpenPhoneEditor');

export type OpenPhoneEditorResult = { ok: true } | { ok: false; message: string };

export async function openPhoneEditor(): Promise<OpenPhoneEditorResult> {
  const blocker = describeEditorSwitchBlocker();
  if (blocker) return { ok: false, message: blocker };
  try {
    // A read-only tab has nothing of its own to save.
    const writable = getActiveRepositorySession()?.opening.writable !== false;
    if (projectFileService.isProjectOpen() && writable && !await saveCurrentProject({ source: 'manual' })) {
      return { ok: false, message: 'The project could not be saved, so the phone editor did not open.' };
    }
  } catch (failure) {
    log.error('Saving before the phone editor failed', failure);
    return { ok: false, message: `The project could not be saved: ${failure instanceof Error ? failure.message : String(failure)}` };
  }
  // Choosing Mobile ends an earlier "full editor" choice on a phone.
  rememberFullEditorPreference(false);
  window.location.assign(PHONE_EDITOR_PATH);
  return { ok: true };
}
