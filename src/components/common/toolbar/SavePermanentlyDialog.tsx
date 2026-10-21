import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Logger } from '../../../services/logger';
import { describeBrowserStorageFailure } from '../../../services/project/core/browserStorageFailure';
import { moveActiveProjectToPersistentBrowserStorage, moveTemporaryProject } from '../../../services/project/permanentSave/browserStorageMigration';
import { downloadActiveProjectArchive, saveActiveProjectToFolder } from '../../../services/project/permanentSave/permanentSaveActions';
import { resolvePermanentSaveDestinations, type PermanentSaveDestination } from '../../../services/project/permanentSave/permanentSaveOptions';
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
  /** The open project moved; the toolbar re-reads its name and state. */
  onProjectChanged(): void;
}

const COPY: Record<PermanentSaveDestination, { title: string; description: string }> = {
  folder: { title: 'Save to a folder…', description: 'Pick a folder on this device. The project with its media and history is saved there and opens from it from now on.' },
  browser: { title: 'Keep in this browser', description: 'This browser’s permanent project storage works now. The project moves there and stays after the window closes.' },
  archive: { title: 'Download .msproj archive', description: 'One file with the whole project and its history. Open it again via Open Project > Import .msproj archive. The open project itself stays temporary.' },
};

function describe(error: unknown): string {
  return describeBrowserStorageFailure(error) ?? (error instanceof Error ? error.message : String(error));
}

export function SavePermanentlyDialog({ status, projectName, onClose, createProject, onProjectChanged }: SavePermanentlyDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const environment = useSavePermanentlyEnvironment();
  const [name, setName] = useState(projectName);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const destinations = environment.checking ? [] : resolvePermanentSaveDestinations({ ...environment, activeTemporary: status.activeTemporary });
  const canMoveOthers = environment.persistentBrowserStorage && status.temporaryProjects.length > 0;

  useEffect(() => {
    mounted.current = true;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => { mounted.current = false; if (focus?.isConnected) focus.focus(); };
  }, []);

  async function run(key: string, action: () => Promise<string | null>) {
    setBusy(key); setError(null); setMessage(null);
    try {
      const result = await action();
      if (mounted.current && result) setMessage(result);
    } catch (cause) {
      log.warn(`Save permanently (${key}) did not complete`, cause);
      if (mounted.current) setError(`${describe(cause)} Nothing was removed; the temporary project is unchanged.`);
    } finally {
      status.refresh(); environment.recheck();
      if (mounted.current) setBusy(null);
    }
  }

  const actions: Record<PermanentSaveDestination, () => Promise<string | null>> = {
    async folder() {
      const result = await saveActiveProjectToFolder(name.trim() || projectName, createProject);
      if (result.status === 'cancelled') return 'No folder was chosen, or the project could not be saved there. The temporary project is unchanged.';
      onProjectChanged();
      return `Saved permanently. "${name.trim() || projectName}" now opens from the chosen folder.${result.removedTemporary ? ' The temporary copy was removed.' : ''}`;
    },
    async browser() {
      const result = await moveActiveProjectToPersistentBrowserStorage();
      onProjectChanged();
      return `Saved permanently in this browser as "${result.to}".${result.removedTemporary ? ' The temporary copy was removed.' : ''}`
        + (result.persisted ? '' : ' The browser did not promise to keep its storage under disk pressure; also download an archive for a copy outside the browser.');
    },
    async archive() {
      const file = await downloadActiveProjectArchive(name.trim() || projectName);
      return file ? `Downloaded ${file}. Open it again via Open Project > Import .msproj archive.` : null;
    },
  };

  async function moveOthers(): Promise<string | null> {
    const moved: string[] = []; const failed: string[] = [];
    for (const project of status.temporaryProjects) {
      try { moved.push((await moveTemporaryProject(project)).to); }
      catch (cause) { log.warn('Temporary project could not be moved', { project, cause }); failed.push(`${project}: ${describe(cause)}`); }
    }
    if (failed.length) throw new Error(`Moved ${moved.length}, kept ${failed.length} in temporary storage. ${failed.join(' ')}`);
    return `Moved ${moved.length} project${moved.length === 1 ? '' : 's'} into this browser’s permanent storage. Open them via Open Project.`;
  }

  return <div className="project-name-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
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
      <h2 id={titleId}>{status.activeTemporary ? 'Save this project permanently' : 'Move temporary projects'}</h2>
      {status.activeTemporary
        ? <p className="save-permanently-warning"><strong>Temporary.</strong> {status.scratch ? 'This unsaved work' : `"${projectName}"`} is only in a temporary browser database. Private Browsing and in-app browsers delete it when the window closes.</p>
        : !message && <p>Projects from an earlier session are still in temporary browser storage.</p>}
      {status.activeTemporary && <label className="save-permanently-name">Project name
        <input value={name} disabled={busy !== null} onChange={event => setName(event.target.value)} />
      </label>}
      {environment.checking && status.activeTemporary && <p>Checking where this device can save…</p>}
      {destinations.length > 0 && <ul className="save-permanently-options" aria-label="Destinations">
        {destinations.map((destination, index) => <li key={destination}>
          <button type="button" className="save-permanently-option" data-recommended={index === 0 ? 'true' : 'false'} disabled={busy !== null}
            onPointerUp={blurAfterPointer} onClick={() => { void run(destination, actions[destination]); }}>
            <span className="save-permanently-option-title">{busy === destination ? 'Saving…' : COPY[destination].title}{index === 0 && <em>Recommended</em>}</span>
            <span className="save-permanently-option-description">{COPY[destination].description}
              {destination === 'archive' && environment.appleMobile && ' On iPhone and iPad it lands in the Files app (Downloads).'}</span>
          </button>
        </li>)}
      </ul>}
      {canMoveOthers && <div className="save-permanently-others">
        <p>{status.activeTemporary ? 'Also in temporary storage' : 'In temporary storage'}: {status.temporaryProjects.join(', ')}</p>
        <button type="button" disabled={busy !== null} onPointerUp={blurAfterPointer} onClick={() => { void run('others', moveOthers); }}>
          {busy === 'others' ? 'Moving…' : `Move ${status.temporaryProjects.length} to this browser’s permanent storage`}
        </button>
      </div>}
      {!environment.checking && <p className="save-permanently-persistence">
        {environment.persistence === true ? 'This browser keeps MasterSelects storage permanently.'
          : environment.persistence === 'unsupported' ? 'This browser does not report whether it keeps its storage.'
            : 'This browser may clear MasterSelects storage when space runs low.'}
        {environment.persistence === false && <button type="button" disabled={busy !== null} onPointerUp={blurAfterPointer}
          onClick={() => { void run('persist', async () => (await environment.requestPersistence())
            ? 'The browser will keep MasterSelects storage.' : 'The browser declined to keep its storage permanently. Save to a folder or download an archive to be safe.'); }}>
          Ask to keep it</button>}
      </p>}
      {environment.appleMobile && <p className="save-permanently-hint">iPhone and iPad: Safari decides itself whether storage is kept, most likely when MasterSelects is opened from the Home Screen (Share &gt; Add to Home Screen). The Home Screen app has its own storage, so take this project along as a .msproj archive.</p>}
      {message && <p role="status" className="save-permanently-message">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="repository-archive-actions">
        <button type="button" disabled={busy !== null} onPointerUp={blurAfterPointer} onClick={onClose}>{message ? 'Done' : 'Close'}</button>
      </div>
    </div>
  </div>;
}
