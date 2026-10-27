// Rules of the phone project storage tools: the move of temporary projects (one at a time, a
// failure never stops the others) and whether this browser has a folder picker for folder backups.
import { Logger } from '../../../services/logger';
import { moveTemporaryProject } from '../../../services/project/permanentSave/browserStorageMigration';
import type { PhoneActionResult } from '../contracts';

const log = Logger.create('PhoneProjectStorage');

export const PHONE_FOLDER_BACKUP_REASON =
  'A folder backup writes the project into a folder you pick, and this phone browser has no folder picker. The full editor on a computer has it; here, Project archive (.msproj) saves a complete copy instead.';

export function phoneCanPickFolders(win: Window = window): boolean {
  return typeof (win as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Moves every listed temporary project; one failure (an open project) never stops the others. */
export async function movePhoneTemporaryProjects(
  names: readonly string[],
  move: (name: string) => Promise<{ to: string }> = moveTemporaryProject,
): Promise<PhoneActionResult> {
  const moved: string[] = [];
  const kept: string[] = [];
  for (const name of names) {
    try { moved.push((await move(name)).to); } catch (error) {
      log.warn('Temporary project kept', { name, error });
      kept.push(`"${name}" stays temporary: ${reason(error)}`);
    }
  }
  const head = `Moved ${moved.length} of ${names.length} to permanent storage.`;
  if (kept.length === 0) return { ok: true, message: head };
  const message = [head, ...kept].join(' ');
  return moved.length > 0 ? { ok: true, message } : { ok: false, message };
}
