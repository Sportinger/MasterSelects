// Storage tools of the phone project sheet: move the other projects left in the browser's temporary
// store into its permanent project storage (the editor's moveTemporaryProject, verified copy first,
// one project at a time, an open or locked one is skipped and named), and the independent folder
// backup (the editor's createBackup, a self-contained copy in a folder you pick). Folder backup needs
// a folder picker; a phone browser without one shows the row greyed with that reason.
import { useState } from 'react';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { Logger } from '../../../services/logger';
import { projectFileService } from '../../../services/projectFileService';
import { canMoveTemporaryProjects } from '../../../services/project/permanentSave/permanentSaveOptions';
import { usePermanentSaveStatus } from '../../common/toolbar/usePermanentSaveStatus';
import { PhoneStatusLine, usePhoneStatus } from '../library/phoneListUi';
import { movePhoneTemporaryProjects, PHONE_FOLDER_BACKUP_REASON, phoneCanPickFolders } from './phoneProjectStorage';
import { PHONE_PROJECT_STORAGE_TEST_IDS as IDS } from './phoneProjectTestIds';

const log = Logger.create('PhoneProjectStorage');

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PhoneProjectStorageTools({ projectOpen }: { projectOpen: boolean }) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const storage = usePermanentSaveStatus();
  const { status, report } = usePhoneStatus();
  const [busy, setBusy] = useState<'move' | 'backup' | null>(null);
  const names = storage.temporaryProjects;
  const canMove = canMoveTemporaryProjects(storage);
  const moveBlocked = names.length === 0
    ? 'No other project is in temporary storage on this device.'
    : !storage.persistentBrowserStorage
      ? 'This browser still refuses its permanent project storage, so the projects stay temporary. Save them as .msproj archives instead.'
      : !storage.tabOnPersistentStorage
        ? 'This tab still works from temporary storage. Move the open project first (tap the storage status), then the others.'
        : null;
  const pickFolders = phoneCanPickFolders();

  const move = async () => {
    if (busy) return;
    if (!canMove) { report({ ok: false, message: moveBlocked ?? 'Nothing to move.' }); return; }
    setBusy('move');
    report(await movePhoneTemporaryProjects(names));
    setBusy(null);
    storage.refresh();
  };

  const backup = async () => {
    if (!pickFolders) {
      showUnavailable({ actionId: 'project-folder-backup', label: 'Save to a folder', reason: PHONE_FOLDER_BACKUP_REASON });
      return;
    }
    if (!projectOpen) { report({ ok: false, message: 'Open a project first.' }); return; }
    if (busy) return;
    setBusy('backup');
    try {
      const made = await projectFileService.createBackup();
      report(made ? { ok: true, message: 'Saved to the folder. That copy opens on its own in any MasterSelects.' } : { ok: true, message: 'No folder picked; nothing was written.' });
    } catch (error) {
      log.warn('Folder backup failed', error);
      report({ ok: false, message: `The backup failed: ${reason(error)}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="phone-lib" data-testid={IDS.root}>
      <h3 className="phone-lib__section">Storage</h3>
      <PhoneStatusLine status={status} testId={IDS.status} />
      <p className="phone-lib__note" data-testid={IDS.temporaryList} data-count={names.length}>
        {names.length === 0 ? 'No other temporary projects on this device.' : `Temporary: ${names.join(', ')}`}
      </p>
      <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.temporaryMove}
        aria-disabled={!canMove || busy !== null}
        onClick={() => (moveBlocked && !canMove
          ? showUnavailable({ actionId: 'project-move-temporary', label: 'Move temporary projects', reason: moveBlocked })
          : void move())}>
        {busy === 'move' ? 'Moving…' : `Move ${names.length || ''} temporary project${names.length === 1 ? '' : 's'} to permanent storage`.replace('  ', ' ')}
      </button>
      <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.backup}
        aria-disabled={!pickFolders || busy !== null} data-available={pickFolders}
        onClick={() => void backup()}>
        {busy === 'backup' ? 'Saving to the folder…' : pickFolders ? 'Save to a folder' : 'Save to a folder · needs a folder picker'}
      </button>
      <p className="phone-lib__note">Phone projects live in this browser. Save to a folder writes a complete copy with its media into a folder you pick (picking it again adds only what changed); Export .msproj above makes one file to share.</p>
    </div>
  );
}
