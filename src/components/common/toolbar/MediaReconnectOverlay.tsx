import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconFolder } from '@tabler/icons-react';
import { useMediaStore } from '../../../stores/mediaStore';
import { mediaNeedsRelink } from '../../../services/project/relinkMedia';
import { requestRelinkDialog } from '../../../services/project/relinkDialogRuntime';
import { getMediaReconnectProgress, mediaFoldersNeedingAccess, reconnectMedia, subscribeMediaReconnect, type MediaReconnectOptions, type MediaReconnectProgress } from '../../../services/project/mediaReconnect';
import { folderPickerId, offlineMediaFolders, type OfflineMediaFolder } from '../../../services/project/mediaReconnectFolders';
import { projectFileService } from '../../../services/projectFileService';
import { isLinkedMediaConnectionRunning, subscribeLinkedMediaConnection } from '../../../services/project/repository/transaction/editorLinkedMediaConnection';
import { getEditorRepositorySession, subscribeEditorRepositorySession } from '../../../services/project/repository/transaction/editorMutationRuntime';
import { takeOverEditing } from '../../../services/project/repository/lifecycle/editorWriterHandover';
import { InstallAppHint } from '../InstallAppHint';
import '../ProjectNameDialog.css';
import './RepositoryArchiveDialog.css';

type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle }) => Promise<FileSystemDirectoryHandle>;
const PHASES: Record<MediaReconnectProgress['phase'], string> = { access: 'Allowing folder access', connect: 'Connecting media', search: 'Searching media folders', relink: 'Relinking media' };
const blurAfterPointer = (event: PointerEvent<HTMLButtonElement>) => event.currentTarget.blur();
const fileCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'file' : 'files'}`;

function namePreview(names: string[]): string {
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${shown} +${(names.length - 2).toLocaleString()}` : shown;
}

/**
 * Reconnects offline media folder by folder. Each row names the folder the media were last found in;
 * a remembered folder is re-allowed with one click, any other folder picker opens where that folder was.
 * Allowed folders are searched without asking.
 */
export function MediaReconnectHost() {
  const offlineNames = useMediaStore(state => state.files.filter(mediaNeedsRelink).map(file => file.name).join('\n'));
  const offline = offlineNames ? offlineNames.split('\n').length : 0;
  const [session, setSession] = useState(getEditorRepositorySession());
  const [connecting, setConnecting] = useState(isLinkedMediaConnectionRunning());
  const [dismissed, setDismissed] = useState<object | null>(null);
  const [groups, setGroups] = useState<OfflineMediaFolder[]>([]);
  // Per row: the folder chosen for it did not hold its files.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
  const [ownBusy, setBusy] = useState<MediaReconnectProgress | null>(null);
  // Offline count when the current search started: everything gone from it since then was found.
  const searchBaseline = useRef(0);
  // A reconnect started elsewhere (relink dialog, tools) shows the same working view.
  const [externalBusy, setExternalBusy] = useState<MediaReconnectProgress | null>(getMediaReconnectProgress());
  useEffect(() => subscribeMediaReconnect(() => {
    const progress = getMediaReconnectProgress();
    setExternalBusy((previous) => {
      if (!previous && progress) searchBaseline.current = useMediaStore.getState().files.filter(mediaNeedsRelink).length;
      return progress;
    });
    if (!progress) setRefresh(value => value + 1);
  }), []);
  const busy = ownBusy ?? externalBusy;
  const [failure, setFailure] = useState<string | null>(null);
  const [denied, setDenied] = useState<string[]>([]);
  const titleId = useId(); const dialog = useRef<HTMLDivElement>(null);
  // Allowed folders are searched again when media go offline that no search has looked for yet; one search at a time.
  const autoSearched = useRef<{ session: object | null; names: Set<string> }>({ session: null, names: new Set() });
  const searching = useRef(false);
  useEffect(() => subscribeEditorRepositorySession(() => { setSession(getEditorRepositorySession()); setNotes({}); }), []);
  useEffect(() => subscribeLinkedMediaConnection(() => setConnecting(isLinkedMediaConnectionRunning())), []);
  // Shown while the opened composition is still being checked too, so the user sees the work instead of a silent wait.
  const visible = Boolean(session) && offline > 0 && dismissed !== session || busy !== null;
  // Folder states are read asynchronously; until then an automatic search may still start, so nothing is offered yet.
  const [foldersKnown, setFoldersKnown] = useState(false);
  // The automatic search calls the latest run() without re-running the folder lookup on every render.
  const autoRun = useRef<() => void>(() => {});
  // Only the tab that writes the project can save new media locations.
  const readOnly = Boolean(session && !session.opening.writable);
  useEffect(() => {
    if (!visible || connecting) return;
    let current = true;
    void Promise.all([mediaFoldersNeedingAccess(), offlineMediaFolders()]).then(([roots, folders]) => {
      if (!current) return;
      setGroups(folders);
      setFoldersKnown(true);
      // Folders that are still allowed need no prompt, so search them before asking for anything.
      if (autoSearched.current.session !== session) autoSearched.current = { session, names: new Set() };
      const unsearched = offlineNames.split('\n').filter(name => name && !autoSearched.current.names.has(name));
      if (roots.length === 0 && session && !readOnly && !searching.current && !getMediaReconnectProgress() && unsearched.length) {
        for (const name of unsearched) autoSearched.current.names.add(name);
        autoRun.current();
      }
    });
    return () => { current = false; };
  }, [visible, offlineNames, session, readOnly, connecting, refresh]);
  useEffect(() => { if (visible) dialog.current?.querySelector<HTMLElement>('[data-primary]')?.focus(); }, [visible, busy, foldersKnown]);
  if (!visible) return null;
  const close = () => { if (!busy) { setDismissed(session); setNotes({}); } };
  async function run(chosenFolder?: FileSystemDirectoryHandle, options: MediaReconnectOptions = {}): Promise<boolean> {
    if (searching.current) return false;
    searching.current = true;
    searchBaseline.current = offline;
    setFailure(null); setDenied([]); setBusy({ phase: 'access', done: 0, total: 0 });
    try { setDenied((await reconnectMedia(progress => setBusy(progress), chosenFolder, options)).deniedFolders); return true; }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); return false; }
    finally { searching.current = false; setBusy(null); setRefresh(value => value + 1); }
  }
  autoRun.current = () => { void run(); };
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  async function chooseFolder(group?: OfflineMediaFolder) {
    if (!picker) return;
    // Open where this folder was; a folder this browser no longer knows starts in the project folder next to it.
    const projectFolder = typeof projectFileService.getProjectHandle === 'function' ? projectFileService.getProjectHandle() : null;
    const startIn = group?.startIn ?? projectFolder ?? undefined;
    let folder: FileSystemDirectoryHandle;
    try { folder = await picker({ id: folderPickerId(group ?? { key: 'any' }), mode: 'read', ...(startIn ? { startIn } : {}) }); }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; throw error; }
    if (!await run(folder, group?.rootId ? { forRootId: group.rootId } : {}) || !group) return;
    const stillMissing = new Set(useMediaStore.getState().files.filter(mediaNeedsRelink).map(file => file.name));
    if (group.files.some(name => stillMissing.has(name))) setNotes(previous => ({ ...previous, [group.key]: `Not in “${folder.name}”` }));
  }
  const allow = (group: OfflineMediaFolder) => { void run(undefined, group.rootId ? { rootIds: [group.rootId] } : { requestFileAccess: true, rootIds: [] }); };
  const prompts = groups.filter(group => group.access === 'prompt');
  // Working: checking the composition or searching folders. One large status, live counts, no buttons.
  const working = busy !== null || (!readOnly && (connecting || !foldersKnown));
  const found = busy ? Math.max(0, searchBaseline.current - offline) : 0;
  const progress = busy?.total ? Math.min(1, busy.done / busy.total) : null;
  // The first row's action is the default; with several remembered folders one click allows them all.
  const allowAll = prompts.length > 1;
  return createPortal(<div className="project-name-dialog-backdrop legacy-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="project-name-dialog repository-archive-dialog media-reconnect-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <div className="project-name-dialog-accent" />
      <div className="media-reconnect-header">
        <h2 id={titleId}>Reconnect media</h2>
        <button type="button" className="project-name-dialog-close" aria-label="Reconnect later" disabled={working}
          onPointerUp={blurAfterPointer} onClick={close}>×</button>
      </div>
      {working ? <div className="media-reconnect-working" role="status" aria-live="polite">
        <div className="media-reconnect-headline">
          <span className="media-reconnect-spinner" aria-hidden="true" />
          {busy ? 'Reconnecting media…' : 'Checking media…'}
        </div>
        <div className={`media-reconnect-progress${progress === null ? ' indeterminate' : ''}`} aria-hidden="true">
          <span style={progress === null ? undefined : { width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="media-reconnect-counts">
          <span><strong>{found.toLocaleString()}</strong> found</span>
          <span><strong>{offline.toLocaleString()}</strong> missing</span>
        </div>
        <p>{busy ? `${PHASES[busy.phase]}${busy.total ? ` ${busy.done.toLocaleString()} / ${busy.total.toLocaleString()}` : ''}` : 'Opening the media of this composition'}</p>
      </div> : readOnly ? <>
        <p>{fileCount(offline)} offline. This project is open for editing in another tab, so this tab cannot save reconnected media. Take over editing here: the other tab saves its changes and switches to read-only.</p>
        <div className="repository-archive-actions">
          <button data-primary onPointerUp={blurAfterPointer} onClick={() => { void takeOverEditing(); }}>Take over editing</button>
        </div>
      </> : <>
        <p className="media-reconnect-summary">{fileCount(offline)} offline</p>
        <ul className="media-reconnect-folders" aria-label="Missing media by folder">
          {groups.map((group, index) => {
            const primary = index === 0 && !allowAll ? { 'data-primary': true } : {};
            const note = notes[group.key] ?? (group.access === 'granted' ? 'Not in this folder any more' : null);
            return <li key={group.key} className="media-reconnect-folder">
              <IconFolder size={18} stroke={1.6} aria-hidden="true" />
              <div className="media-reconnect-folder-text">
                <strong title={group.subPath ? `${group.name}/${group.subPath}` : group.name}>
                  {group.name}{group.subPath && <span> / {group.subPath}</span>}
                </strong>
                <span title={group.files.join('\n')}>{fileCount(group.files.length)} · {namePreview(group.files)}</span>
                {note && <span className="media-reconnect-folder-note">{note}</span>}
              </div>
              {group.access === 'prompt' && !notes[group.key]
                ? <button {...primary} aria-label={`Allow ${group.name}`} onPointerUp={blurAfterPointer} onClick={() => allow(group)}>Allow</button>
                : picker
                  ? <button {...primary} aria-label={`Choose ${group.name}`} onPointerUp={blurAfterPointer} onClick={() => { void chooseFolder(group); }}>Choose…</button>
                  : null}
            </li>;
          })}
        </ul>
        {prompts.length > 0 && <InstallAppHint />}
        {failure && <p role="alert">Reconnecting stopped: {failure}</p>}
        {denied.length ? <p role="alert">Access was not granted for “{denied.join('”, “')}”.</p> : null}
        <div className="repository-archive-actions">
          {picker
            ? <button className="media-reconnect-secondary" onPointerUp={blurAfterPointer} onClick={() => { void chooseFolder(); }}>Other folder or drive…</button>
            : <button onPointerUp={blurAfterPointer} onClick={() => { close(); requestRelinkDialog(); }}>Relink manually…</button>}
          {allowAll && <button data-primary onPointerUp={blurAfterPointer} onClick={() => { void run(undefined, { requestFileAccess: true }); }}>Allow all</button>}
        </div>
      </>}
    </div>
  </div>, document.body);
}
