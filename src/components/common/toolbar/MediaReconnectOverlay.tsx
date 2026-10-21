import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMediaStore } from '../../../stores/mediaStore';
import { mediaNeedsRelink } from '../../../services/project/relinkMedia';
import { requestRelinkDialog } from '../../../services/project/relinkDialogRuntime';
import { MAX_FILE_ACCESS_PROMPTS, getMediaReconnectProgress, mediaFilesNeedingAccess, mediaFoldersNeedingAccess, reconnectMedia, subscribeMediaReconnect, type MediaReconnectProgress, type MediaReconnectResult } from '../../../services/project/mediaReconnect';
import { getProjectMediaSourceRootStates } from '../../../services/project/mediaSourceRoots';
import { isLinkedMediaConnectionRunning, subscribeLinkedMediaConnection } from '../../../services/project/repository/transaction/editorLinkedMediaConnection';
import { getEditorRepositorySession, subscribeEditorRepositorySession } from '../../../services/project/repository/transaction/editorMutationRuntime';
import { takeOverEditing } from '../../../services/project/repository/lifecycle/editorWriterHandover';
import { InstallAppHint } from '../InstallAppHint';
import '../ProjectNameDialog.css';
import './RepositoryArchiveDialog.css';

type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle }) => Promise<FileSystemDirectoryHandle>;
const PHASES: Record<MediaReconnectProgress['phase'], string> = { access: 'Allowing folder access', connect: 'Connecting media', search: 'Searching media folders', relink: 'Relinking media' };

/**
 * Reconnects offline media with at most one click. Allowed folders are searched without asking;
 * the single action re-allows known folders, or lets the user pick the folder that holds the media.
 */
export function MediaReconnectHost() {
  const offlineNames = useMediaStore(state => state.files.filter(mediaNeedsRelink).map(file => file.name).join('\n'));
  const offline = offlineNames ? offlineNames.split('\n').length : 0;
  const [session, setSession] = useState(getEditorRepositorySession());
  const [connecting, setConnecting] = useState(isLinkedMediaConnectionRunning());
  const [dismissed, setDismissed] = useState<object | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  // Offline media with a saved file location: re-allowed directly, and the folder picker starts there.
  const [knownFiles, setKnownFiles] = useState<string[]>([]);
  const lastKnownLocation = useRef<FileSystemHandle | undefined>(undefined);
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
  }), []);
  const busy = ownBusy ?? externalBusy;
  const [result, setResult] = useState<MediaReconnectResult | null>(null);
  const [choseFolder, setChoseFolder] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const titleId = useId(); const dialog = useRef<HTMLDivElement>(null);
  // Allowed folders are searched again when media go offline that no search has looked for yet; one search at a time.
  const autoSearched = useRef<{ session: object | null; names: Set<string> }>({ session: null, names: new Set() });
  const searching = useRef(false);
  useEffect(() => subscribeEditorRepositorySession(() => { setSession(getEditorRepositorySession()); setResult(null); setChoseFolder(false); }), []);
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
    void Promise.all([mediaFoldersNeedingAccess(), mediaFilesNeedingAccess()]).then(([roots, files]) => {
      setFolders(roots.map(root => root.name));
      setKnownFiles(files.map(file => file.name));
      lastKnownLocation.current = files[0]?.handle ?? roots[0]?.handle ?? undefined;
      setFoldersKnown(true);
      // Folders that are still allowed need no prompt, so search them before asking for anything.
      if (autoSearched.current.session !== session) autoSearched.current = { session, names: new Set() };
      const unsearched = offlineNames.split('\n').filter(name => name && !autoSearched.current.names.has(name));
      if (roots.length === 0 && session && !readOnly && !searching.current && !getMediaReconnectProgress() && unsearched.length) {
        for (const name of unsearched) autoSearched.current.names.add(name);
        autoRun.current();
      }
    });
  }, [visible, offlineNames, session, readOnly, connecting]);
  useEffect(() => { if (visible) dialog.current?.querySelector<HTMLElement>('[data-primary]')?.focus(); }, [visible, busy]);
  if (!visible) return null;
  const close = () => { if (!busy) { setDismissed(session); setResult(null); } };
  async function run(chosenFolder?: FileSystemDirectoryHandle, requestFileAccess = false) {
    if (searching.current) return;
    searching.current = true;
    searchBaseline.current = offline;
    setResult(null); setFailure(null); setBusy({ phase: 'access', done: 0, total: 0 });
    try { setResult(await reconnectMedia(progress => setBusy(progress), chosenFolder, { requestFileAccess })); }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { searching.current = false; setBusy(null); }
  }
  autoRun.current = () => { void run(); };
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  async function chooseFolder() {
    if (!picker) return;
    // Start where the media were last found; a remembered folder still helps when its access has lapsed.
    const startIn = lastKnownLocation.current ?? (await getProjectMediaSourceRootStates()).find(root => root.handle)?.handle ?? undefined;
    try { const folder = await picker({ id: 'ms-media-reconnect', mode: 'read', ...(startIn ? { startIn } : {}) }); setChoseFolder(true); await run(folder); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) throw error; }
  }
  const stillMissing = Boolean(result?.missing);
  // Known folders and saved file locations only need the browser prompt again; otherwise the user shows where the media live.
  const fileAccess = knownFiles.length > 0 && knownFiles.length <= MAX_FILE_ACCESS_PROMPTS;
  const oneClick = (folders.length > 0 || fileAccess) && !stillMissing;
  // Exactly one action; Escape, the backdrop and the close icon postpone it. Single files stay relinkable in the Media panel.
  // A read-only tab (e.g. the tab opened to check a new deploy while an older tab still writes) takes
  // over editing instead of reloading: the writing tab saves and steps back, then media reconnect here.
  const primary = readOnly ? { label: 'Take over editing', action: () => { void takeOverEditing(); } }
    : oneClick ? { label: 'Reconnect media', action: () => { void run(undefined, true); } }
    : picker ? { label: stillMissing && choseFolder ? 'Choose another folder…' : 'Choose folder…', action: () => { void chooseFolder(); } }
    : { label: 'Relink manually…', action: () => { close(); requestRelinkDialog(); } };
  const files = (count: number) => `${count.toLocaleString()} media ${count === 1 ? 'file is' : 'files are'}`;
  const missingNames = offlineNames.split('\n').slice(0, 3).join('”, “') + (offline > 3 ? '” …' : '”');
  // Counts come from the live media list: a finished search's own number goes stale as soon as anything reconnects.
  const status = result && offline > 0 ? `${files(offline)} still missing: “${missingNames}.` : null;
  // Working: checking the composition or searching folders. One large status, live counts, no buttons.
  const working = busy !== null || (!readOnly && (connecting || !foldersKnown));
  const found = busy ? Math.max(0, searchBaseline.current - offline) : 0;
  const progress = busy?.total ? Math.min(1, busy.done / busy.total) : null;
  return createPortal(<div className="project-name-dialog-backdrop legacy-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="project-name-dialog repository-archive-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <div className="project-name-dialog-accent" />
      <div className="media-reconnect-header">
        <h2 id={titleId}>Reconnect media</h2>
        <button type="button" className="project-name-dialog-close" aria-label="Reconnect later" disabled={working}
          onPointerUp={event => event.currentTarget.blur()} onClick={close}>×</button>
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
      </div> : <>
        <p>{files(offline)} offline.{' '}
          {readOnly ? 'This project is open for editing in another tab, so this tab cannot save reconnected media. Take over editing here: the other tab saves its changes and switches to read-only.'
            : oneClick ? `Allow access to “${[...folders, ...(fileAccess ? knownFiles : [])].join('”, “')}” once to reconnect them.`
            : `Choose the folder that contains ${offline === 1 ? 'it' : 'them'}; a whole drive works too. MasterSelects finds and reconnects the files automatically.${knownFiles.length ? ` The folder picker opens where “${knownFiles[0]}” was last found.` : ''}`}</p>
        {oneClick && !readOnly && <p>Tip: choose “Allow on every visit” in the browser prompt so this is not needed after a browser restart.</p>}
        {!readOnly && <InstallAppHint />}
        {status && <p role="status" aria-live="polite">{status}</p>}
        {failure && <p role="alert">Reconnecting stopped: {failure}</p>}
        {result?.deniedFolders.length ? <p role="alert">Access was not granted for “{result.deniedFolders.join('”, “')}”.</p> : null}
        <div className="repository-archive-actions">
          <button data-primary onPointerUp={event => event.currentTarget.blur()} onClick={primary.action}>{primary.label}</button>
        </div>
      </>}
    </div>
  </div>, document.body);
}
