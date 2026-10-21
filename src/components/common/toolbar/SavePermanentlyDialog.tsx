import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Logger } from '../../../services/logger';
import { describeBrowserStorageFailure } from '../../../services/project/core/browserStorageFailure';
import { moveActiveProjectToPersistentBrowserStorage, moveTemporaryProject, type OpenBrowserStorageCopy } from '../../../services/project/permanentSave/browserStorageMigration';
import { downloadActiveProjectArchive, saveActiveProjectToFolder } from '../../../services/project/permanentSave/permanentSaveActions';
import { canMoveTemporaryProjects, needsHomeScreenStep, resolvePermanentSaveDestinations } from '../../../services/project/permanentSave/permanentSaveOptions';
import { HEADLINE, MESSAGES, PRIMARY, secondaryOption, whyLine, type ListedDestination, type Notice, type SavePermanentlyVariant } from './savePermanentlyCopy';
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

function describe(error: unknown): string {
  return describeBrowserStorageFailure(error) ?? (error instanceof Error ? error.message : String(error));
}

function OptionButton({ title, line, busy, primary, onClick }: { title: string; line: string; busy: boolean; primary?: boolean; onClick(): void }) {
  return <button type="button" className={primary ? 'save-permanently-primary save-permanently-primary-option' : 'save-permanently-option'}
    data-autofocus={primary ? 'true' : undefined} disabled={busy} onPointerUp={blurAfterPointer} onClick={onClick}>
    <span className="save-permanently-option-title">{title}</span>
    <span className="save-permanently-option-line">{line}</span>
  </button>;
}

export function SavePermanentlyDialog({ status, projectName, onClose, createProject, createBrowserStorageCopy, onProjectChanged }: SavePermanentlyDialogProps) {
  const titleId = useId();
  const moreId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const environment = useSavePermanentlyEnvironment();
  const [name, setName] = useState(projectName);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const destinations = environment.checking ? [] : resolvePermanentSaveDestinations({
    ...environment, activeTemporary: status.activeTemporary, activeBrowserLocal: status.activeBrowserLocal,
  });
  const safariTab = environment.homeScreen === 'browser-tab';
  const context = { safariTab, appleMobile: environment.appleMobile };
  // A browser-local project in a Safari tab: not temporary, but not safe from eviction either.
  const notSafe = !status.activeTemporary && needsHomeScreenStep({ ...status, homeScreen: environment.homeScreen });
  // Moved projects are only reachable via Open Project once this tab itself uses OPFS.
  const canMoveOthers = canMoveTemporaryProjects({ ...status, persistentBrowserStorage: environment.persistentBrowserStorage });
  const variant: SavePermanentlyVariant = status.activeTemporary ? 'temporary' : notSafe ? 'not-safe' : status.temporaryProjects.length > 0 ? 'move' : 'safe';
  const homeScreenFirst = destinations[0] === 'home-screen';
  const primary: ListedDestination | null = homeScreenFirst ? null : (destinations[0] as ListedDestination | undefined) ?? null;
  const secondary = destinations.filter((destination): destination is ListedDestination => destination !== 'home-screen' && destination !== primary);
  const othersPrimary = variant === 'move' && canMoveOthers;
  const why = whyLine(variant, safariTab);
  const projectFileName = () => name.trim() || projectName;

  useEffect(() => {
    mounted.current = true;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { mounted.current = false; if (focus?.isConnected) focus.focus(); };
  }, []);

  // Escape and the Tab trap listen on the document: after a pointer activation the
  // control blurs (no stuck focus ring), so focus sits on <body>, outside the dialog.
  const latest = useRef({ busy, onClose });
  latest.current = { busy, onClose };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = dialog.current;
      if (!root || event.defaultPrevented) return;
      if (event.key === 'Escape' && !latest.current.busy) { event.preventDefault(); latest.current.onClose(); return; }
      if (event.key !== 'Tab') return;
      // Document order, whatever order the selector engine returns.
      const controls = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
        .toSorted((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      const first = controls[0], last = controls[controls.length - 1];
      const active = document.activeElement;
      const outside = !active || !root.contains(active);
      if (event.shiftKey && (outside || active === first)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (outside || active === last)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Focus the one recommended action (not the name field, which would raise the iPad keyboard).
  const checking = environment.checking;
  useEffect(() => {
    if (checking) return;
    const root = dialog.current;
    if (!root || root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>('[data-autofocus="true"]:not(:disabled), button:not(:disabled)')?.focus();
  }, [checking]);

  async function run(key: string, action: () => Promise<Notice | null>) {
    setBusy(key); setError(null); setNotice(null);
    try {
      const result = await action();
      if (mounted.current && result) setNotice(result);
    } catch (cause) {
      log.warn(`Save permanently (${key}) did not complete`, cause);
      if (mounted.current) setError(`${describe(cause)} ${status.activeTemporary ? 'Nothing was removed.' : 'Nothing was changed.'}`);
    } finally {
      status.refresh(); environment.recheck();
      if (mounted.current) setBusy(null);
    }
  }

  const actions: Record<ListedDestination, () => Promise<Notice | null>> = {
    async folder() {
      const result = await saveActiveProjectToFolder(projectFileName(), createProject);
      if (result.status === 'cancelled') return MESSAGES.folderCancelled;
      onProjectChanged();
      return MESSAGES.folderSaved(projectFileName());
    },
    async browser() {
      const result = await moveActiveProjectToPersistentBrowserStorage(createBrowserStorageCopy);
      onProjectChanged();
      return safariTab ? MESSAGES.browserKeptInSafariTab : MESSAGES.browserSaved(result.persisted);
    },
    async archive() {
      const file = await downloadActiveProjectArchive(projectFileName());
      return file ? MESSAGES.archiveDownloaded(file, environment.appleMobile) : null;
    },
  };

  async function takeAlong(): Promise<Notice | null> {
    const file = await downloadActiveProjectArchive(projectFileName());
    if (!file) return null;
    if (mounted.current) setDownloaded(true);
    return MESSAGES.takeAlongDownloaded(file, environment.appleMobile);
  }

  async function moveOthers(): Promise<Notice | null> {
    const moved: string[] = []; const failed: string[] = [];
    for (const project of status.temporaryProjects) {
      try { moved.push((await moveTemporaryProject(project)).to); }
      catch (cause) { log.warn('Temporary project could not be moved', { project, cause }); failed.push(`${project}: ${describe(cause)}`); }
    }
    if (failed.length) throw new Error(`Moved ${moved.length}, kept ${failed.length} in temporary storage. ${failed.join(' ')}`);
    return MESSAGES.othersMoved(moved.length);
  }

  const count = status.temporaryProjects.length;
  const othersOption = canMoveOthers && <OptionButton key="others" primary={othersPrimary} busy={busy !== null}
    title={busy === 'others' ? 'Moving…' : `Move ${count} ${othersPrimary ? '' : 'other '}project${count === 1 ? '' : 's'} to permanent storage`}
    line={status.temporaryProjects.join(', ')} onClick={() => { void run('others', moveOthers); }} />;
  const moreItems = [
    ...secondary.map(destination => {
      const copy = secondaryOption(destination, context);
      return <OptionButton key={destination} busy={busy !== null} title={busy === destination ? 'Working…' : copy.title} line={copy.line}
        onClick={() => { void run(destination, actions[destination]); }} />;
    }),
    !othersPrimary && othersOption,
    !canMoveOthers && count > 0 && <p key="leftovers" className="save-permanently-more-line">
      Also temporary: {status.temporaryProjects.join(', ')}.{environment.persistentBrowserStorage && ' They can move once this project is in the browser.'}
    </p>,
    !environment.checking && environment.persistence === false && <OptionButton key="persist" busy={busy !== null}
      title={busy === 'persist' ? 'Asking…' : 'Ask to keep it'} line="Asks the browser not to delete MasterSelects data."
      onClick={() => { void run('persist', async () => (await environment.requestPersistence()) ? MESSAGES.persistGranted : MESSAGES.persistDeclined(destinations)); }} />,
    !environment.checking && environment.persistence === true && <p key="persisted" className="save-permanently-more-line">This browser promised to keep MasterSelects data.</p>,
    environment.homeScreen === 'home-screen-app' && <p key="home-app" className="save-permanently-more-line">Home Screen app: Safari keeps this app’s data.</p>,
  ].filter(Boolean);

  // Portaled: inside the toolbar's stacking context the phone/iPad workspace bar covered the dialog footer.
  return createPortal(<div className="project-name-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="project-name-dialog repository-archive-dialog save-permanently-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      data-variant={variant}>
      <div className="project-name-dialog-accent save-permanently-accent" />
      <div className="save-permanently-body">
        <div className="save-permanently-head">
          <span className="save-permanently-head-icon" aria-hidden="true">{variant === 'safe' ? '✓' : '!'}</span>
          <h2 id={titleId}>{HEADLINE[variant]}</h2>
        </div>
        {why && <p className="save-permanently-why">{why}</p>}
        {status.activeTemporary && <label className="save-permanently-name">Name
          <input value={name} disabled={busy !== null} onChange={event => setName(event.target.value)} />
        </label>}
        {environment.checking && variant !== 'safe' && <p className="save-permanently-checking">Checking this device…</p>}
        {homeScreenFirst && <SavePermanentlyHomeScreenStep busy={busy} downloaded={downloaded} onDownload={() => { void run('take-along', takeAlong); }} />}
        {primary && <OptionButton primary busy={busy !== null} title={busy === primary ? 'Saving…' : PRIMARY[primary].title} line={PRIMARY[primary].line}
          onClick={() => { void run(primary, actions[primary]); }} />}
        {othersPrimary && othersOption}
        {notice && <p role="status" className="save-permanently-notice" data-tone={notice.tone}>
          {notice.tone === 'success' && <span aria-hidden="true">✓ </span>}{notice.text}
        </p>}
        {error && <p role="alert" className="save-permanently-error">{error}</p>}
        {variant !== 'safe' && moreItems.length > 0 && <div className="save-permanently-more">
          <button type="button" className="save-permanently-more-toggle" aria-expanded={moreOpen} aria-controls={moreOpen ? moreId : undefined}
            onPointerUp={blurAfterPointer} onClick={() => setMoreOpen(open => !open)}>
            <span className="save-permanently-more-chevron" aria-hidden="true">›</span>More options
          </button>
          {moreOpen && <div id={moreId} className="save-permanently-more-list" role="group" aria-label="More options">{moreItems}</div>}
        </div>}
      </div>
      <div className="repository-archive-actions save-permanently-footer">
        <button type="button" disabled={busy !== null} onPointerUp={blurAfterPointer} onClick={onClose}>{notice?.tone === 'success' ? 'Done' : 'Close'}</button>
      </div>
    </div>
  </div>, document.body);
}
