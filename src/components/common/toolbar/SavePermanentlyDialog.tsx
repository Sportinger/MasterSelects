import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Logger } from '../../../services/logger';
import { describeBrowserStorageFailure } from '../../../services/project/core/browserStorageFailure';
import { moveActiveProjectToPersistentBrowserStorage, moveTemporaryProject, type OpenBrowserStorageCopy } from '../../../services/project/permanentSave/browserStorageMigration';
import { downloadActiveProjectArchive, saveActiveProjectToFolder } from '../../../services/project/permanentSave/permanentSaveActions';
import { canMoveTemporaryProjects, needsHomeScreenStep, resolvePermanentSaveDestinations, type PermanentSaveDestination } from '../../../services/project/permanentSave/permanentSaveOptions';
import { SavePermanentlyHomeScreenStep } from './SavePermanentlyHomeScreenStep';
import type { PermanentSaveStatus } from './usePermanentSaveStatus';
import { useSavePermanentlyEnvironment } from './useSavePermanentlyEnvironment';
import '../ProjectNameDialog.css';
import './RepositoryArchiveDialog.css';
import './SavePermanently.css';

const log = Logger.create('PermanentSave');
const blurAfterPointer = (event: PointerEvent<HTMLElement>) => event.currentTarget.blur();

interface SavePermanentlyDialogProps {
  status: PermanentSaveStatus;
  projectName: string;
  onClose(): void;
  /** The toolbar's Save As: picks a folder and switches the open project to it. */
  createProject(name: string): Promise<boolean>;
  /** Opens a copy of the open project in this browser's persistent storage as the editor's project. */
  createBrowserStorageCopy: OpenBrowserStorageCopy;
  /** The open project moved; the toolbar re-reads its name and state. */
  onProjectChanged(): void;
}

type ListedDestination = Exclude<PermanentSaveDestination, 'home-screen'>;
const COPY: Record<ListedDestination, { title: string; description: string }> = {
  folder: { title: 'Save to a folder…', description: 'Pick a folder on this device. The project with its media and history is saved there and opens from it from now on.' },
  browser: { title: 'Keep in this browser', description: 'This browser’s permanent project storage works now. The project moves there and stays after the window closes.' },
  archive: { title: 'Download .msproj archive', description: 'One file with the whole project and its history. Open it again via Open Project > Import .msproj archive. The open project itself stays temporary.' },
};

/** A Safari tab can still evict browser storage; say so wherever "permanent" would overpromise. */
const SAFARI_TAB_EVICTION = ' In a Safari tab it can still be cleared after seven days without a visit.';
const BACKUP_ARCHIVE_DESCRIPTION = 'One file with the whole project and its history, a backup outside Safari’s storage. Open it again via Open Project > Import .msproj archive.';

function describe(error: unknown): string {
  return describeBrowserStorageFailure(error) ?? (error instanceof Error ? error.message : String(error));
}

export function SavePermanentlyDialog({ status, projectName, onClose, createProject, createBrowserStorageCopy, onProjectChanged }: SavePermanentlyDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const environment = useSavePermanentlyEnvironment();
  const [name, setName] = useState(projectName);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const destinations = environment.checking ? [] : resolvePermanentSaveDestinations({
    ...environment, activeTemporary: status.activeTemporary, activeBrowserLocal: status.activeBrowserLocal,
  });
  const safariTab = environment.homeScreen === 'browser-tab';
  // A browser-local project in a Safari tab: not temporary, but not safe from eviction either.
  const notSafe = !status.activeTemporary && needsHomeScreenStep({ ...status, homeScreen: environment.homeScreen });
  // Moved projects are only reachable via Open Project once this tab itself uses OPFS.
  const canMoveOthers = canMoveTemporaryProjects({ ...status, persistentBrowserStorage: environment.persistentBrowserStorage });

  useEffect(() => {
    mounted.current = true;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => { mounted.current = false; if (focus?.isConnected) focus.focus(); };
  }, []);

  // The body scrolls on short screens: bring a new result or error into view.
  useEffect(() => {
    if (message || error) dialog.current?.querySelector<HTMLElement>('[role=status], [role=alert]')?.scrollIntoView?.({ block: 'nearest' });
  }, [message, error]);

  async function run(key: string, action: () => Promise<string | null>) {
    setBusy(key); setError(null); setMessage(null);
    try {
      const result = await action();
      if (mounted.current && result) setMessage(result);
    } catch (cause) {
      log.warn(`Save permanently (${key}) did not complete`, cause);
      if (mounted.current) setError(`${describe(cause)} ${status.activeTemporary ? 'Nothing was removed; the temporary project is unchanged.' : 'Nothing was changed.'}`);
    } finally {
      status.refresh(); environment.recheck();
      if (mounted.current) setBusy(null);
    }
  }

  const actions: Record<ListedDestination, () => Promise<string | null>> = {
    async folder() {
      const result = await saveActiveProjectToFolder(name.trim() || projectName, createProject);
      if (result.status === 'cancelled') return 'No folder was chosen, or the project could not be saved there. The temporary project is unchanged.';
      onProjectChanged();
      return `Saved permanently. "${name.trim() || projectName}" now opens from the chosen folder.${result.removedTemporary ? ' The temporary copy was removed.' : ''}`;
    },
    async browser() {
      const result = await moveActiveProjectToPersistentBrowserStorage(createBrowserStorageCopy);
      onProjectChanged();
      const removed = result.removedTemporary ? ' The temporary copy was removed.' : '';
      if (safariTab) return `Kept in this browser as "${result.to}".${removed} Safari can still clear it after seven days without a visit: add MasterSelects to the Home Screen (above) to keep it safe.`;
      return `Saved permanently in this browser as "${result.to}".${removed}`
        + (result.persisted ? '' : ' The browser did not promise to keep its storage under disk pressure; also download an archive for a copy outside the browser.');
    },
    async archive() {
      const file = await downloadActiveProjectArchive(name.trim() || projectName);
      return file ? `Downloaded ${file}. Open it again via Open Project > Import .msproj archive.` : null;
    },
  };

  async function takeAlong(): Promise<string | null> {
    const file = await downloadActiveProjectArchive(name.trim() || projectName);
    return file ? `Downloaded ${file} to the Files app (Downloads). In the Home Screen app use Open Project > Import .msproj archive.` : null;
  }

  function describeDestination(destination: ListedDestination): string {
    if (destination === 'archive') {
      return (status.activeTemporary ? COPY.archive.description : BACKUP_ARCHIVE_DESCRIPTION)
        + (environment.appleMobile ? ' On iPhone and iPad it lands in the Files app (Downloads).' : '');
    }
    return COPY[destination].description + (destination === 'browser' && safariTab ? SAFARI_TAB_EVICTION : '');
  }

  async function moveOthers(): Promise<string | null> {
    const moved: string[] = []; const failed: string[] = [];
    for (const project of status.temporaryProjects) {
      try { moved.push((await moveTemporaryProject(project)).to); }
      catch (cause) { log.warn('Temporary project could not be moved', { project, cause }); failed.push(`${project}: ${describe(cause)}`); }
    }
    if (failed.length) throw new Error(`Moved ${moved.length}, kept ${failed.length} in temporary storage. ${failed.join(' ')}`);
    return `Moved ${moved.length} project${moved.length === 1 ? '' : 's'} into this browser’s permanent storage. Open them via Open Project.`;
  }

  // Portaled: the toolbar is a stacking context below the workspace bar, which would cover the footer.
  return createPortal(<div className="project-name-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="project-name-dialog repository-archive-dialog save-permanently-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
        if (event.key === 'Tab') {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="project-name-dialog-accent save-permanently-accent" />
      <h2 id={titleId}>{status.activeTemporary ? 'Save this project permanently' : notSafe ? 'Keep this project safe' : 'Move temporary projects'}</h2>
      <div className="save-permanently-body">
        {status.activeTemporary
          ? <p className="save-permanently-warning"><strong>Temporary.</strong> {status.scratch ? 'This unsaved work' : `"${projectName}"`} is only in a temporary browser database. Private Browsing and in-app browsers delete it when the window closes.</p>
          : notSafe ? <p className="save-permanently-warning"><strong>Not safe yet.</strong> "{projectName}" is stored in Safari’s website data, which Safari deletes after seven days of browsing without a visit.</p>
            : !message && <p>Projects from an earlier session are still in temporary browser storage.</p>}
        {status.activeTemporary && <label className="save-permanently-name">Project name
          <input value={name} disabled={busy !== null} onChange={event => setName(event.target.value)} />
        </label>}
        {environment.checking && (status.activeTemporary || notSafe) && <p>Checking where this device can save…</p>}
        {destinations.length > 0 && <ul className="save-permanently-options" aria-label="Destinations">
          {destinations.map((destination, index) => <li key={destination}>
            {destination === 'home-screen' ? <SavePermanentlyHomeScreenStep busy={busy} onDownload={() => { void run('take-along', takeAlong); }} /> : <button type="button" className="save-permanently-option" data-recommended={index === 0 ? 'true' : 'false'} disabled={busy !== null}
              onPointerUp={blurAfterPointer} onClick={() => { void run(destination, actions[destination]); }}>
              <span className="save-permanently-option-title">{busy === destination ? 'Saving…' : COPY[destination].title}{index === 0 && <em>Recommended</em>}</span>
              <span className="save-permanently-option-description">{describeDestination(destination)}</span>
            </button>}
          </li>)}
        </ul>}
        {canMoveOthers && <div className="save-permanently-others">
          <p>{status.activeTemporary ? 'Also in temporary storage' : 'In temporary storage'}: {status.temporaryProjects.join(', ')}</p>
          <button type="button" disabled={busy !== null} onPointerUp={blurAfterPointer} onClick={() => { void run('others', moveOthers); }}>
            {busy === 'others' ? 'Moving…' : `Move ${status.temporaryProjects.length} to this browser’s permanent storage`}
          </button>
        </div>}
        {!canMoveOthers && status.temporaryProjects.length > 0 && <p className="save-permanently-others">
          Also in temporary storage: {status.temporaryProjects.join(', ')}.
          {environment.persistentBrowserStorage && ' They can move into this browser’s permanent storage after this project was kept in this browser.'}
        </p>}
        {!environment.checking && <p className="save-permanently-persistence">
          {environment.persistence === true ? 'This browser keeps MasterSelects storage permanently.'
            : environment.persistence === 'unsupported' ? 'This browser does not report whether it keeps its storage.'
              : 'This browser may clear MasterSelects storage when space runs low.'}
          {environment.persistence === false && <button type="button" disabled={busy !== null} onPointerUp={blurAfterPointer}
            onClick={() => { void run('persist', async () => (await environment.requestPersistence())
              ? 'The browser will keep MasterSelects storage.'
              : `The browser declined to keep its storage permanently. ${safariTab ? 'Add MasterSelects to the Home Screen' : 'Save to a folder'} or download an archive to be safe.`); }}>
            Ask to keep it</button>}
        </p>}
        {environment.homeScreen === 'home-screen-app' && <p className="save-permanently-hint">Opened from the Home Screen: Safari does not apply its seven-day cleanup to this app’s storage, so projects kept in this browser stay. A downloaded .msproj archive is still a good backup.</p>}
        {message && <p role="status" className="save-permanently-message">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="repository-archive-actions save-permanently-footer">
        <button type="button" disabled={busy !== null} onPointerUp={blurAfterPointer} onClick={onClose}>{message ? 'Done' : 'Close'}</button>
      </div>
    </div>
  </div>, document.body);
}
