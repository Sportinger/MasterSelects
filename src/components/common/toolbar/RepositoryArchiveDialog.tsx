import { useEffect, useId, useRef, useState } from 'react';
import type { MetadataPage, RevisionMetadata, JsonValue } from '../../../services/project/repository/contracts';
import { getActiveRepositorySession, flushEditorRepository } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { pickArchiveOutput, exportCurrentProjectArchive } from '../../../services/project/repository/lifecycle/exportProjectArchive';
import type { HistorySelection } from '../../../services/project/repository/archive/archiveManifest';
import '../ProjectNameDialog.css';
import './RepositoryArchiveDialog.css';
import { Logger } from '../../../services/logger';

const log = Logger.create('ProjectArchiveExport');

export function RepositoryArchiveDialog({ onClose }: { onClose(): void }) {
  const titleId = useId(); const dialog = useRef<HTMLDivElement>(null); const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [kind, setKind] = useState<'current' | 'named' | 'branches' | 'all'>('current');
  const [journals, setJournals] = useState(false); const [workspace, setWorkspace] = useState(true); const [embed, setEmbed] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; label: string }>>([]); const [selected, setSelected] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const session = getActiveRepositorySession();
  async function loadPage(nextCursor?: string) {
    if (!session || kind !== 'named' && kind !== 'branches') return;
    try {
      if (kind === 'named') {
        const page = await session.client.request<MetadataPage<{ key: string; value: JsonValue }>>({ type: 'metadata-query', options: { prefix: 'named-version:', limit: 50, cursor: nextCursor } });
        const items = page.items.flatMap(item => { const value = item.value as { revisionId?: string; name?: string };
          return typeof value.revisionId === 'string' ? [{ id: value.revisionId, label: value.name ?? value.revisionId }] : []; });
        setVersions(previous => nextCursor ? [...previous, ...items] : items); setCursor(page.nextCursor);
      } else {
        const page = await session.client.request<MetadataPage<RevisionMetadata>>({ type: 'query', options: { limit: 50, cursor: nextCursor, direction: 'desc' } });
        const items = page.items.map(item => ({ id: item.revisionId, label: item.label }));
        setVersions(previous => nextCursor ? [...previous, ...items] : items); setCursor(page.nextCursor);
      }
    } catch (cause) { setError(String(cause)); }
  }
  useEffect(() => { setSelected([]); setVersions([]); setCursor(null); void loadPage(); }, [kind]);
  useEffect(() => {
    mounted.current = true;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>('select')?.focus();
    // A toolbar remount must not cancel an already authorized file write.
    // Cancellation belongs to the explicit Cancel/Escape controls below.
    return () => { mounted.current = false; if (focus?.isConnected) focus.focus(); };
  }, []);
  async function startExport() {
    if (!session) return;
    log.info('Project archive export requested');
    setError(null); setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    let output: Awaited<ReturnType<typeof pickArchiveOutput>> = null;
    try {
      // File picker must precede asynchronous revision lookup to retain the user gesture.
      output = await pickArchiveOutput('MasterSelects Project'); if (!output) { if (mounted.current) setBusy(false); return; }
      if (getActiveRepositorySession() !== session) throw new Error('Project changed while choosing the destination. Export the selected project again.');
      if (session.opening.writable) await flushEditorRepository();
      let history: HistorySelection;
      if (kind === 'all') history = { kind: 'all' };
      else if (kind === 'branches') {
        const roots: Record<string, import('../../../services/project/repository/contracts').RecordReference> = {};
        for (const id of selected) { const metadata = await session.storage.getRevision(id); if (!metadata) throw new Error('Selected branch revision is unavailable'); roots[id] = metadata.reference; }
        if (!Object.keys(roots).length) throw new Error('Select at least one branch tip'); history = { kind, roots };
      } else {
        const id = kind === 'named' ? selected[0] : session.coordinator.getProjection().revisionId;
        if (!id) throw new Error('Select a confirmed version to export');
        const metadata = await session.storage.getRevision(id); if (!metadata) throw new Error('Selected revision is unavailable');
        history = { kind, revision: metadata.reference, name: kind === 'named' ? versions.find(item => item.id === id)?.label : undefined };
      }
      await exportCurrentProjectArchive({ history, journals: journals ? 'all' : 'none', workspace, media: embed ? 'self-contained' : 'linked' }, output, abort.signal, session);
      if (mounted.current) onClose();
    } catch (cause) {
      await output?.abort(cause).catch(() => {});
      log.error('Project archive export did not complete', cause);
      if (mounted.current) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
    } finally { if (controller.current === abort) controller.current = null; }
  }
  return <div className="project-name-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="project-name-dialog repository-archive-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); if (busy) controller.current?.abort(); else onClose(); }
        if (event.key === 'Tab') {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select,input') ?? []);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="project-name-dialog-accent" />
      <h2 id={titleId}>Export project archive</h2>
      <label>History <select value={kind} disabled={busy} onChange={event => setKind(event.target.value as typeof kind)}>
        <option value="current">Current state</option><option value="named">Named version</option><option value="branches">Selected branch tips</option><option value="all">All history</option>
      </select></label>
      {(kind === 'named' || kind === 'branches') && <>
        <select multiple={kind === 'branches'} value={kind === 'branches' ? selected : selected[0] ?? ''} disabled={busy}
          aria-label={kind === 'branches' ? 'Branch tips' : 'Named version'} onChange={event => setSelected(Array.from(event.target.selectedOptions, option => option.value))}>
          {kind === 'named' && <option value="">Choose a version</option>}
          {versions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        {cursor && <button disabled={busy} onPointerUp={event => event.currentTarget.blur()} onClick={() => { void loadPage(cursor); }}>More versions</button>}
      </>}
      <label><input type="checkbox" checked={journals} disabled={busy} onChange={event => setJournals(event.target.checked)} /> Include conversations and job journals</label>
      <label><input type="checkbox" checked={workspace} disabled={busy} onChange={event => setWorkspace(event.target.checked)} /> Include saved workspace views</label>
      <label><input type="checkbox" checked={embed} disabled={busy} onChange={event => setEmbed(event.target.checked)} /> Include verified original media</label>
      <p>{embed ? 'Export stops if a required original cannot be verified.' : 'Original media remain linked and must be available when restoring.'}</p>
      {error && <p role="alert">{error}</p>}
      <div className="repository-archive-actions"><button onPointerUp={event => event.currentTarget.blur()} onClick={() => busy ? controller.current?.abort() : onClose()}>{busy ? 'Cancel export' : 'Cancel'}</button>
        <button disabled={busy || !session} onPointerUp={event => event.currentTarget.blur()} onClick={() => { void startExport(); }}>{busy ? 'Exporting…' : 'Export .msproj'}</button></div>
    </div>
  </div>;
}
