import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMediaStore } from '../../../stores/mediaStore';
import { mediaNeedsRelink } from '../../../services/project/relinkMedia';
import { requestRelinkDialog } from '../../../services/project/relinkDialogRuntime';
import { mediaFoldersNeedingAccess, reconnectMedia, type MediaReconnectProgress, type MediaReconnectResult } from '../../../services/project/mediaReconnect';
import { isLinkedMediaConnectionRunning, subscribeLinkedMediaConnection } from '../../../services/project/repository/transaction/editorLinkedMediaConnection';
import { getEditorRepositorySession, subscribeEditorRepositorySession } from '../../../services/project/repository/transaction/editorMutationRuntime';
import '../ProjectNameDialog.css';
import './RepositoryArchiveDialog.css';

type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
const PHASES: Record<MediaReconnectProgress['phase'], string> = { access: 'Allowing folder access', connect: 'Connecting media', search: 'Searching media folders', relink: 'Relinking media' };

/**
 * Reconnects offline media with at most one click. Allowed folders are searched without asking;
 * the single action re-allows known folders, or lets the user pick the folder that holds the media.
 */
export function MediaReconnectHost() {
  const offline = useMediaStore(state => state.files.filter(mediaNeedsRelink).length);
  const [session, setSession] = useState(getEditorRepositorySession());
  const [connecting, setConnecting] = useState(isLinkedMediaConnectionRunning());
  const [dismissed, setDismissed] = useState<object | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState<MediaReconnectProgress | null>(null);
  const [result, setResult] = useState<MediaReconnectResult | null>(null);
  const titleId = useId(); const dialog = useRef<HTMLDivElement>(null);
  const autoSearchedSession = useRef<object | null>(null);
  useEffect(() => subscribeEditorRepositorySession(() => { setSession(getEditorRepositorySession()); setResult(null); }), []);
  useEffect(() => subscribeLinkedMediaConnection(() => setConnecting(isLinkedMediaConnectionRunning())), []);
  const visible = Boolean(session) && offline > 0 && !connecting && dismissed !== session || busy !== null;
  useEffect(() => {
    if (!visible) return;
    void mediaFoldersNeedingAccess().then(roots => {
      setFolders(roots.map(root => root.name));
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
  async function run(chosenFolder?: FileSystemDirectoryHandle) {
    setResult(null); setBusy({ phase: 'access', done: 0, total: 0 });
    try { setResult(await reconnectMedia(progress => setBusy(progress), chosenFolder)); }
    finally { setBusy(null); }
  }
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  async function chooseFolder() {
    if (!picker) return;
    try { await run(await picker({ id: 'ms-media-reconnect', mode: 'read' })); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) throw error; }
  }
  const done = Boolean(result && !result.missing);
  const stillMissing = Boolean(result?.missing);
  // Known folders only need the browser prompt again; otherwise the user shows where the media live.
  const primary = done ? { label: 'Done', action: close }
    : folders.length > 0 && !stillMissing ? { label: 'Reconnect media', action: () => { void run(); } }
    : picker ? { label: 'Choose folder…', action: () => { void chooseFolder(); } }
    : { label: 'Relink manually…', action: () => { close(); requestRelinkDialog(); } };
  const status = busy ? `${PHASES[busy.phase]}${busy.total ? ` ${busy.done.toLocaleString()} / ${busy.total.toLocaleString()}` : ''}…`
    : result ? (result.missing ? `${result.missing.toLocaleString()} media files are still missing.` : 'All media are connected.') : null;
  return createPortal(<div className="project-name-dialog-backdrop legacy-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="project-name-dialog repository-archive-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <div className="project-name-dialog-accent" />
      <h2 id={titleId}>Reconnect media</h2>
      <p>{offline.toLocaleString()} media files are offline.{' '}
        {folders.length && !stillMissing ? `Allow access to “${folders.join('”, “')}” once to reconnect them.`
          : 'Choose the folder that contains them. MasterSelects finds and reconnects the files automatically.'}</p>
      {folders.length > 0 && !stillMissing && <p>Tip: choose “Allow on every visit” in the browser prompt so this is not needed after a reload.</p>}
      {status && <p role="status" aria-live="polite">{status}</p>}
      {result?.deniedFolders.length ? <p role="alert">Access was not granted for “{result.deniedFolders.join('”, “')}”.</p> : null}
      <div className="repository-archive-actions">
        {stillMissing && picker && <button disabled={busy !== null} onPointerUp={event => event.currentTarget.blur()} onClick={() => { close(); requestRelinkDialog(); }}>Relink manually…</button>}
        {!done && <button disabled={busy !== null} onPointerUp={event => event.currentTarget.blur()} onClick={close}>Later</button>}
        <button data-primary disabled={busy !== null} onPointerUp={event => event.currentTarget.blur()} onClick={primary.action}>{primary.label}</button>
      </div>
    </div>
  </div>, document.body);
}
