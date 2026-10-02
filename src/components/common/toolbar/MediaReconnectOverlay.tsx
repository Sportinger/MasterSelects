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

/** One button reconnects offline media: folder access, stored links, then a search of allowed folders. */
export function MediaReconnectHost() {
  const offline = useMediaStore(state => state.files.filter(mediaNeedsRelink).length);
  const [session, setSession] = useState(getEditorRepositorySession());
  const [connecting, setConnecting] = useState(isLinkedMediaConnectionRunning());
  const [dismissed, setDismissed] = useState<object | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState<MediaReconnectProgress | null>(null);
  const [result, setResult] = useState<MediaReconnectResult | null>(null);
  const titleId = useId(); const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => subscribeEditorRepositorySession(() => { setSession(getEditorRepositorySession()); setResult(null); }), []);
  useEffect(() => subscribeLinkedMediaConnection(() => setConnecting(isLinkedMediaConnectionRunning())), []);
  const visible = Boolean(session) && offline > 0 && !connecting && dismissed !== session || busy !== null;
  useEffect(() => { if (visible) void mediaFoldersNeedingAccess().then(roots => setFolders(roots.map(root => root.name))); }, [visible, offline]);
  useEffect(() => { if (visible) dialog.current?.querySelector<HTMLElement>('[data-primary]')?.focus(); }, [visible]);
  if (!visible) return null;
  const close = () => { if (!busy) { setDismissed(session); setResult(null); } };
  async function run(chosenFolder?: FileSystemDirectoryHandle) {
    setResult(null); setBusy({ phase: 'access', done: 0, total: 0 });
    try { setResult(await reconnectMedia(progress => setBusy(progress), chosenFolder)); }
    finally { setBusy(null); }
  }
  async function chooseFolder() {
    const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker; if (!picker) return;
    try { await run(await picker({ id: 'ms-media-reconnect', mode: 'read' })); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) throw error; }
  }
  const status = busy ? `${PHASES[busy.phase]}${busy.total ? ` ${busy.done.toLocaleString()} / ${busy.total.toLocaleString()}` : ''}…`
    : result ? (result.missing ? `${result.missing.toLocaleString()} media files are still missing.` : 'All media are connected.') : null;
  return createPortal(<div className="project-name-dialog-backdrop legacy-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="project-name-dialog repository-archive-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <div className="project-name-dialog-accent" />
      <h2 id={titleId}>Reconnect media</h2>
      <p>{offline.toLocaleString()} media files are offline.{' '}
        {folders.length ? `Allow access to “${folders.join('”, “')}” once to reconnect them.` : 'MasterSelects searches your media folders and reconnects them.'}</p>
      {folders.length > 0 && <p>Tip: choose “Allow on every visit” in the browser prompt so this is not needed after a reload.</p>}
      {status && <p role="status" aria-live="polite">{status}</p>}
      {result?.deniedFolders.length ? <p role="alert">Access was not granted for “{result.deniedFolders.join('”, “')}”.</p> : null}
      <div className="repository-archive-actions">
        <button disabled={busy !== null} onPointerUp={event => event.currentTarget.blur()} onClick={() => { close(); requestRelinkDialog(); }}>Details…</button>
        <button disabled={busy !== null} onPointerUp={event => event.currentTarget.blur()} onClick={close}>Later</button>
        <button disabled={busy !== null} onPointerUp={event => event.currentTarget.blur()} onClick={() => { void chooseFolder(); }}>Choose folder…</button>
        {result && !result.missing ? <button data-primary onPointerUp={event => event.currentTarget.blur()} onClick={close}>Done</button>
          : <button data-primary disabled={busy !== null} onPointerUp={event => event.currentTarget.blur()} onClick={() => { void run(); }}>Reconnect media</button>}
      </div>
    </div>
  </div>, document.body);
}
