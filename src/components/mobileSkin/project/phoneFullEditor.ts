// Leave the phone editor for the full desktop editor with the same project. The project is saved
// first, so the reload never loses work; a failed save keeps the user here with a reason.

import { openFullEditorFromPhone } from '../../../routing/phoneEntry';
import { Logger } from '../../../services/logger';
import { projectFileService } from '../../../services/projectFileService';
import { saveCurrentProject } from '../../../services/projectSync';
import { getActiveRepositorySession } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';

const log = Logger.create('PhoneFullEditor');

export type PhoneFullEditorResult = { ok: true } | { ok: false; message: string };

export async function saveAndOpenFullEditor(): Promise<PhoneFullEditorResult> {
  try {
    // A read-only tab has nothing of its own to save.
    const writable = getActiveRepositorySession()?.opening.writable !== false;
    if (projectFileService.isProjectOpen() && writable && !await saveCurrentProject({ source: 'manual' })) {
      return { ok: false, message: 'The project could not be saved, so the phone editor stays open. Check the save status and try again.' };
    }
  } catch (failure) {
    log.error('Saving before the full editor failed', failure);
    return { ok: false, message: `The project could not be saved. ${failure instanceof Error ? failure.message : String(failure)}` };
  }
  openFullEditorFromPhone();
  return { ok: true };
}
