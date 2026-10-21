import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { projectFileService } from '../../../services/projectFileService';
import { describeBrowserStorageFailure } from '../../../services/project/core/browserStorageFailure';
import { Logger } from '../../../services/logger';
import '../ProjectNameDialog.css';
import './RepositoryArchiveDialog.css';
import './BrowserProjectOpenDialog.css';

const log = Logger.create('BrowserProjectOpen');

/** Resolves to null when the project opened, otherwise to the message to show. */
type BrowserProjectAction = () => Promise<string | null>;

interface BrowserProjectOpenDialogProps {
  onClose(): void;
  onOpenStored(name: string): Promise<string | null>;
  /** The signal aborts when the person cancels; the import then removes its partial copy. */
  onImportArchive(file: File, signal: AbortSignal): Promise<string | null>;
}

const blurAfterPointer = (event: PointerEvent<HTMLElement>) => event.currentTarget.blur();

/**
 * File > Open Project for browsers without a folder picker or Native Helper:
 * lists the projects stored in this browser and imports .msproj archives.
 */
export function BrowserProjectOpenDialog({ onClose, onOpenStored, onImportArchive }: BrowserProjectOpenDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const importAbort = useRef<AbortController | null>(null);
  const [projects, setProjects] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    mounted.current = true;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    projectFileService.listStoredProjects().then(names => {
      if (mounted.current) setProjects(names);
    }, (cause: unknown) => {
      const storageFailure = describeBrowserStorageFailure(cause);
      if (storageFailure) log.warn('Stored projects unavailable: browser storage could not be opened', cause);
      else log.error('Stored projects could not be listed', cause);
      if (!mounted.current) return;
      setProjects([]);
      setError(`Stored projects could not be listed. ${storageFailure ?? (cause instanceof Error ? cause.message : '')}`.trim());
    });
    return () => {
      mounted.current = false;
      // Closing the dialog while an archive import runs cancels it.
      importAbort.current?.abort();
      if (focus?.isConnected) focus.focus();
    };
  }, []);

  async function run(key: string, action: BrowserProjectAction, controller?: AbortController) {
    setBusy(key);
    setError(null);
    const message = await action();
    if (importAbort.current === controller) importAbort.current = null;
    if (!mounted.current) return;
    setCancelling(false);
    // A cancelled import has cleaned up after itself; the person asked to leave the dialog.
    if (message === null || controller?.signal.aborted) { onClose(); return; }
    setError(message);
    setBusy(null);
  }

  function importArchive(file: File) {
    const controller = new AbortController();
    importAbort.current = controller;
    void run('archive', () => onImportArchive(file, controller.signal), controller);
  }

  /** Cancel closes the dialog, or stops a running archive import (the dialog closes once it has stopped). */
  function cancel() {
    if (busy === 'archive' && importAbort.current) {
      if (!importAbort.current.signal.aborted) { setCancelling(true); importAbort.current.abort(); }
      return;
    }
    if (!busy) onClose();
  }

  return <div className="project-name-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="project-name-dialog repository-archive-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key === 'Escape' && (!busy || busy === 'archive')) { event.preventDefault(); cancel(); }
        if (event.key === 'Tab') {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="project-name-dialog-accent" />
      <h2 id={titleId}>Open project</h2>
      <p>Projects stored in this browser on this device.</p>
      {projects === null ? <p>Loading stored projects…</p>
        : projects.length === 0 ? <p>No projects are stored in this browser yet.</p>
          : <ul className="browser-project-list" aria-label="Stored projects">
            {projects.map(name => <li key={name}>
              <button type="button" title={name} disabled={busy !== null} onPointerUp={blurAfterPointer}
                onClick={() => { void run(name, () => onOpenStored(name)); }}>
                {busy === name ? `Opening ${name}…` : name}
              </button>
            </li>)}
          </ul>}
      <button type="button" className="browser-project-import" disabled={busy !== null} onPointerUp={blurAfterPointer}
        onClick={() => fileInput.current?.click()}>
        {busy === 'archive' ? 'Importing archive…' : 'Import .msproj archive…'}
      </button>
      <input ref={fileInput} type="file" accept=".msproj" hidden aria-hidden="true" tabIndex={-1}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) importArchive(file);
        }} />
      <p>Project folders on disk open in Chrome or Edge, or with the MasterSelects Native Helper running on this computer.</p>
      {error && <p role="alert">{error}</p>}
      <div className="repository-archive-actions">
        <button type="button" disabled={(busy !== null && busy !== 'archive') || cancelling} onPointerUp={blurAfterPointer} onClick={cancel}>
          {busy === 'archive' ? (cancelling ? 'Cancelling import…' : 'Cancel import') : 'Cancel'}
        </button>
      </div>
    </div>
  </div>;
}
