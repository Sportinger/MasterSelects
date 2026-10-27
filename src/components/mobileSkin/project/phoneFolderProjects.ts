// Folder projects on the phone: open an existing project folder (secondary to browser storage) and
// resume the last folder project whose access the browser asks for again after a restart.
// Both use the editor's own lifecycle; every failure is a sentence the phone can show as is.
import { projectFileService } from '../../../services/projectFileService';
import { openExistingProject } from '../../../services/projectSync';
import { resumePendingProject } from '../../../services/project/pendingProjectResume';
import type { PhoneActionResult } from '../contracts';
import { describePhoneProjectError } from './usePhoneProjectCommands';
import { phoneCanPickFolders } from './phoneProjectStorage';

export const PHONE_NO_FOLDER_PICKER_REASON =
  'This browser cannot open project folders. Import a .msproj archive instead, or open the folder in the full editor on a computer.';

/** Name of the last folder project that waits for folder access, or null. */
export function readPhonePendingProjectName(): string | null {
  return projectFileService.needsPermission() ? projectFileService.getPendingProjectName() ?? 'last project' : null;
}

/** Must start inside the tap handler: the browser's folder access prompt needs its user activation. */
export async function resumePhonePendingProject(): Promise<PhoneActionResult> {
  const name = readPhonePendingProjectName();
  if (!name) return { ok: false, message: 'No project is waiting for folder access.' };
  try {
    if (await resumePendingProject()) return { ok: true };
    return { ok: false, message: `Folder access was not allowed. Tap Reopen "${name}" again and allow access in the browser prompt.` };
  } catch (error) {
    return { ok: false, message: describePhoneProjectError('resume', error, `"${name}" could not be reopened.`) };
  }
}

/** Opens a project folder through the system folder picker; a cancelled picker changes nothing. */
export async function openPhoneFolderProject(): Promise<PhoneActionResult & { cancelled?: boolean }> {
  if (!phoneCanPickFolders()) return { ok: false, message: PHONE_NO_FOLDER_PICKER_REASON };
  try {
    if (await openExistingProject()) return { ok: true };
    return { ok: false, cancelled: true, message: 'No folder was picked; nothing changed.' };
  } catch (error) {
    return { ok: false, message: describePhoneProjectError('folder open', error, 'The project folder could not be opened.') };
  }
}
