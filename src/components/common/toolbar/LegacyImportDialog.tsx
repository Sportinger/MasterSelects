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
  async function choose() {
    setError(null); setBusy(true);
    try {
      const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
      if (!picker) throw new Error('This browser cannot choose a folder for the converted project');
      const parent = await picker({ id: 'ms-converted-project', mode: 'readwrite' });
      // The original folder must stay byte-identical, so the copy may not live inside it.
      if (await parent.isSameEntry(source) || await source.resolve(parent)) {
        setError('Choose a folder outside the original project. The original stays unchanged.'); return;
      }
      onDone(await parent.getDirectoryHandle(folderName, { create: true }));
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
      <h2 id={titleId}>Convert old project</h2>
      <p>“{source.name}” uses the previous project format. MasterSelects converts it into a new project folder.</p>
      <p>The original project stays unchanged. Media files stay where they are and are linked from the new project, so keep the original folder available.</p>
      <p>Choose where to create “{folderName}”.</p>
      {error && <p role="alert">{error}</p>}
      <div className="repository-archive-actions">
        <button disabled={busy} onPointerUp={event => event.currentTarget.blur()} onClick={() => onDone(null)}>Cancel</button>
        <button data-primary disabled={busy} onPointerUp={event => event.currentTarget.blur()} onClick={() => { void choose(); }}>Choose destination…</button>
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
