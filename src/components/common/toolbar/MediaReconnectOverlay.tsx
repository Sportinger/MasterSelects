import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMediaStore } from '../../../stores/mediaStore';
import { mediaNeedsRelink } from '../../../services/project/relinkMedia';
import { requestRelinkDialog } from '../../../services/project/relinkDialogRuntime';
import { MAX_FILE_ACCESS_PROMPTS, mediaFilesNeedingAccess, mediaFoldersNeedingAccess, reconnectMedia, type MediaReconnectProgress, type MediaReconnectResult } from '../../../services/project/mediaReconnect';
import { getProjectMediaSourceRootStates } from '../../../services/project/mediaSourceRoots';
import { isLinkedMediaConnectionRunning, subscribeLinkedMediaConnection } from '../../../services/project/repository/transaction/editorLinkedMediaConnection';
import { getEditorRepositorySession, subscribeEditorRepositorySession } from '../../../services/project/repository/transaction/editorMutationRuntime';
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
  const [busy, setBusy] = useState<MediaReconnectProgress | null>(null);
  const [result, setResult] = useState<MediaReconnectResult | null>(null);
  const [choseFolder, setChoseFolder] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const titleId = useId(); const dialog = useRef<HTMLDivElement>(null);
  const autoSearchedSession = useRef<object | null>(null);
  useEffect(() => subscribeEditorRepositorySession(() => { setSession(getEditorRepositorySession()); setResult(null); setChoseFolder(false); }), []);
  useEffect(() => subscribeLinkedMediaConnection(() => setConnecting(isLinkedMediaConnectionRunning())), []);
  const visible = Boolean(session) && offline > 0 && !connecting && dismissed !== session || busy !== null;
  useEffect(() => {
    if (!visible) return;
    void Promise.all([mediaFoldersNeedingAccess(), mediaFilesNeedingAccess()]).then(([roots, files]) => {
      setFolders(roots.map(root => root.name));
      setKnownFiles(files.map(file => file.name));
      lastKnownLocation.current = files[0]?.handle ?? roots[0]?.handle ?? undefined;
      // Folders that are still allowed need no prompt, so search them before asking for anything.
      if (roots.length === 0 && session && autoSearchedSession.current !== session) {
        autoSearchedSession.current = session;
        void run();
      }
    });
  }, [visible, offline, session]);
  useEffect(() => { if (visible) dialog.current?.querySelector<HTMLElement>('[data-primary]')?.focus(); }, [visible, busy]);
  if (!visible) return null;
  const close = () => { if (!busy) { setDismissed(session); setResult(null); } };
  async function run(chosenFolder?: FileSystemDirectoryHandle, requestFileAccess = false) {
    setResult(null); setFailure(null); setBusy({ phase: 'access', done: 0, total: 0 });
    try { setResult(await reconnectMedia(progress => setBusy(progress), chosenFolder, { requestFileAccess })); }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  }
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
  const primary = oneClick ? { label: 'Reconnect media', action: () => { void run(undefined, true); } }
    : picker ? { label: stillMissing && choseFolder ? 'Choose another folder…' : 'Choose folder…', action: () => { void chooseFolder(); } }
    : { label: 'Relink manually…', action: () => { close(); requestRelinkDialog(); } };
  const files = (count: number) => `${count.toLocaleString()} media ${count === 1 ? 'file is' : 'files are'}`;
  const missingNames = offlineNames.split('\n').slice(0, 3).join('”, “') + (offline > 3 ? '” …' : '”');
  const status = busy ? `${PHASES[busy.phase]}${busy.total ? ` ${busy.done.toLocaleString()} / ${busy.total.toLocaleString()}` : ''}…`
    : result ? (result.missing ? `${files(result.missing)} still missing: “${missingNames}.` : 'All media are connected.') : null;
  return createPortal(<div className="project-name-dialog-backdrop legacy-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="project-name-dialog repository-archive-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <div className="project-name-dialog-accent" />
      <div className="media-reconnect-header">
        <h2 id={titleId}>Reconnect media</h2>
        <button type="button" className="project-name-dialog-close" aria-label="Reconnect later" disabled={busy !== null}
          onPointerUp={event => event.currentTarget.blur()} onClick={close}>×</button>
      </div>
      <p>{files(offline)} offline.{' '}
        {oneClick ? `Allow access to “${[...folders, ...(fileAccess ? knownFiles : [])].join('”, “')}” once to reconnect them.`
          : `Choose the folder that contains ${offline === 1 ? 'it' : 'them'}; a whole drive works too. MasterSelects finds and reconnects the files automatically.${knownFiles.length ? ` The folder picker opens where “${knownFiles[0]}” was last found.` : ''}`}</p>
      {oneClick && <p>Tip: choose “Allow on every visit” in the browser prompt so this is not needed after a reload.</p>}
      {status && <p role="status" aria-live="polite">{status}</p>}
      {failure && <p role="alert">Reconnecting stopped: {failure}</p>}
      {result?.deniedFolders.length ? <p role="alert">Access was not granted for “{result.deniedFolders.join('”, “')}”.</p> : null}
      <div className="repository-archive-actions">
        <button data-primary disabled={busy !== null} onPointerUp={event => event.currentTarget.blur()} onClick={primary.action}>{primary.label}</button>
      </div>
    </div>
  </div>, document.body);
}
