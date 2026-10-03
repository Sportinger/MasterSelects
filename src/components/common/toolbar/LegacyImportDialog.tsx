import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { convertedProjectFolderName, setLegacyImportTargetResolver } from '../../../services/project/legacyImportTarget';
import { setProjectLoadProgress } from '../../../services/project/load/loadProgress';
import '../ProjectNameDialog.css';
import './RepositoryArchiveDialog.css';

type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
type Choice = FileSystemDirectoryHandle | null;

function LegacyImportDialog({ source, onDone }: { source: FileSystemDirectoryHandle; onDone(target: Choice): void }) {
  const titleId = useId(); const dialog = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const folderName = convertedProjectFolderName(source.name);
  useEffect(() => {
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>('[data-primary]')?.focus();
    return () => { if (focus?.isConnected) focus.focus(); };
  }, []);
  async function openConverted() {
    setError(null); setBusy(true);
    try {
      const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
      if (!picker) throw new Error('This browser cannot choose a project folder');
      const folder = await picker({ id: 'ms-converted-project', mode: 'readwrite' });
      if (await folder.isSameEntry(source)) { onDone(source); return; }
      try { await folder.getFileHandle('project.msrepo.json'); } catch {
        setError(`“${folder.name}” is not a converted project. Choose the “${folderName}” folder.`); return;
      }
      onDone(folder);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }
  return <div className="project-name-dialog-backdrop legacy-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onDone(null); }}>
    <div className="project-name-dialog repository-archive-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) { event.preventDefault(); onDone(null); }
        if (event.key === 'Tab') {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="project-name-dialog-accent" />
      <h2 id={titleId}>Project already converted</h2>
      <p>“{source.name}” was converted earlier into a separate project folder, usually “{folderName}”. Changes made there are not in this folder.</p>
      <p>Open that project to keep working on it, or convert this folder in place from its original state. Its old files stay unchanged either way.</p>
      {error && <p role="alert">{error}</p>}
      <div className="repository-archive-actions">
        <button disabled={busy} onPointerUp={event => event.currentTarget.blur()} onClick={() => onDone(null)}>Cancel</button>
        <button disabled={busy} onPointerUp={event => event.currentTarget.blur()} onClick={() => onDone(source)}>Convert here</button>
        <button data-primary disabled={busy} onPointerUp={event => event.currentTarget.blur()} onClick={() => { void openConverted(); }}>Open converted project…</button>
      </div>
    </div>
  </div>;
}

/** Answers conversion-target requests from the project service with a user-driven folder choice. */
export function LegacyImportTargetHost() {
  const [request, setRequest] = useState<{ source: FileSystemDirectoryHandle; resolve(target: Choice): void } | null>(null);
  useEffect(() => setLegacyImportTargetResolver(source => new Promise<Choice>(resolve => {
    // The blocking load overlay sits above dialogs; conversion progress resumes after the choice.
    setProjectLoadProgress(null);
    setRequest({ source, resolve: target => { setRequest(null); resolve(target); } });
  })), []);
  // Portaled to <body>: the start-up project chooser and load overlay form their own stacking contexts.
  return request ? createPortal(<LegacyImportDialog source={request.source} onDone={request.resolve} />, document.body) : null;
}
