import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { getEditorRepositorySession, subscribeEditorRepositorySession } from '../../services/project/repository/transaction/editorRepositorySession';
import { RepositoryHistoryReader, HISTORY_PAGE_SIZE, type HistoryCollection, type HistoryPage, type HistoryRow } from '../../services/project/repository/history/RepositoryHistoryReader';
import type { CoordinatorStatus } from '../../services/project/repository/transaction/ProjectTransactionCoordinator';
import './HistoryPanel.css';
const ROW_HEIGHT = 42;
const collections: Array<{ id: HistoryCollection; label: string }> = [
  { id: 'revisions', label: 'Changes' }, { id: 'branches', label: 'Branches' }, { id: 'versions', label: 'Versions' },
  { id: 'roots', label: 'Starting points' }, { id: 'legacy', label: 'Imported history' },
];
function historyDisplayLabel(value: string): string {
  const sources: Record<string, string> = { user: 'Edit', gesture: 'Edit', background: 'Background task',
    'source-identity': 'Media verification', import: 'Import', project: 'Project change' };
  if (sources[value]) return sources[value];
  if (!/^[a-z][A-Za-z0-9_]*$/u.test(value)) return value;
  const words = value.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/_/gu, ' ').toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
interface IndexStatus { phase: 'ready' | 'rebuilding' | 'fallback'; scannedRecords: number; writable: boolean; }
export function HistoryPanel() {
  const session = useSyncExternalStore(subscribeEditorRepositorySession, getEditorRepositorySession, () => null);
  const reader = useMemo(() => session ? new RepositoryHistoryReader(session) : null, [session]);
  const [status, setStatus] = useState<CoordinatorStatus | null>(null);
  const [collection, setCollection] = useState<HistoryCollection>('revisions');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState<Map<number, HistoryPage>>(new Map());
  const [total, setTotal] = useState<number | undefined>();
  const [extent, setExtent] = useState(HISTORY_PAGE_SIZE);
  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(320);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [versionName, setVersionName] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const endRequest = useRef<AbortController | null>(null);
  const currentSession = useRef(session); currentSession.current = session;
  const base = Math.floor(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4) / HISTORY_PAGE_SIZE) * HISTORY_PAGE_SIZE;
  const pageSpan = Math.max(1, Math.ceil((height / ROW_HEIGHT + 8) / HISTORY_PAGE_SIZE) + 1);
  useEffect(() => {
    setStatus(session?.coordinator.getStatus() ?? null); setActionPending(false);
    return session?.coordinator.subscribe(setStatus);
  }, [session]);
  useEffect(() => () => endRequest.current?.abort(), [session]);
  useEffect(() => {
    endRequest.current?.abort();
    generation.current++; reader?.clear(); setPages(new Map()); setTotal(undefined); setExtent(HISTORY_PAGE_SIZE);
    setSelected(0); setScrollTop(0); setError(null);
    if (list.current) list.current.scrollTop = 0;
  }, [reader, collection, search]);
  useEffect(() => {
    // Durable saves refresh the existing list without clearing rows, selection or scroll.
    endRequest.current?.abort(); generation.current++; reader?.clear();
  }, [reader, status?.confirmedSequence]);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setHeight(entries[0]?.contentRect.height ?? 320));
    observer.observe(element); return () => observer.disconnect();
  }, [session]);
  useEffect(() => {
    if (!reader) return;
    const controller = new AbortController(); const epoch = generation.current;
    setLoading(true);
    void (async () => {
      const loaded: Array<[number, HistoryPage]> = [];
      for (let i = 0; i < pageSpan; i++) {
        const offset = base + i * HISTORY_PAGE_SIZE;
        const page = await reader.query(collection, offset, search.trim(), controller.signal);
        if (controller.signal.aborted || epoch !== generation.current) return;
        loaded.push([offset, page]);
        if (page.totalCount !== undefined) setTotal(page.totalCount);
        else if (!page.nextCursor) setTotal(page.offset + page.items.length);
        setExtent(previous => Math.max(previous, page.offset + page.items.length + (page.nextCursor ? HISTORY_PAGE_SIZE : 0)));
        if (!page.nextCursor) break;
      }
      if (controller.signal.aborted || epoch !== generation.current) return;
      setPages(previous => {
        const next = new Map(previous);
        for (const [offset, page] of loaded) next.set(offset, page);
        while (next.size > 6) {
          const farthest = [...next.keys()].toSorted((a, b) => Math.abs(b - base) - Math.abs(a - base))[0]; next.delete(farthest);
        }
        return next;
      });
    })().catch(reason => { if (!controller.signal.aborted && epoch === generation.current) setError(String(reason)); })
      .finally(() => { if (!controller.signal.aborted && epoch === generation.current) setLoading(false); });
    return () => controller.abort();
  }, [reader, collection, search, base, pageSpan, status?.confirmedSequence]);
  useEffect(() => {
    if (!session) { setIndex(null); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await session.client.request<IndexStatus>({ type: 'index-status' }, controller.signal);
        if (!controller.signal.aborted) setIndex(value);
      } catch (reason) { if (!controller.signal.aborted) setError(String(reason)); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [session]);
  const count = total ?? extent;
  useLayoutEffect(() => {
    const element = list.current;
    if (element && (selected * ROW_HEIGHT < element.scrollTop || (selected + 1) * ROW_HEIGHT > element.scrollTop + element.clientHeight)) {
      element.scrollTop = selected * ROW_HEIGHT; setScrollTop(element.scrollTop);
    }
  }, [selected]);
  const rowAt = (position: number) => {
    const page = pages.get(Math.floor(position / HISTORY_PAGE_SIZE) * HISTORY_PAGE_SIZE);
    return page?.items[position - page.offset];
  };
  const move = useCallback((position: number) => {
    const next = Math.max(0, Math.min(position, Math.max(0, count - 1))); setSelected(next);
    const element = list.current;
    if (element && (next * ROW_HEIGHT < element.scrollTop || (next + 1) * ROW_HEIGHT > element.scrollTop + element.clientHeight)) {
      element.scrollTop = next * ROW_HEIGHT; setScrollTop(element.scrollTop);
    }
  }, [count]);
  const run = async (action: () => Promise<unknown>) => {
    const original = session; setError(null); setActionPending(true);
    try {
      const result = await action() as { status?: string; error?: unknown } | null;
      if (currentSession.current === original && result?.status && result.status !== 'applied') {
        if (result.status === 'failed') throw result.error ?? new Error('Unable to restore this version');
        if (result.status === 'cancelled') setError('Restoring this version was cancelled because the project changed.');
      }
    } catch (reason) { if (currentSession.current === original) setError(String(reason)); }
    finally { if (currentSession.current === original) setActionPending(false); }
  };
  const checkout = (row: HistoryRow) => { if (session && row.revisionId && row.revisionId !== status?.revisionId) void run(() => session.coordinator.checkout(row.revisionId!)); };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'PageDown', 'PageUp', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'End' && reader) {
        endRequest.current?.abort();
        const original = session, epoch = generation.current, controller = new AbortController(); endRequest.current = controller;
        void reader.lastIndex(collection, search.trim(), controller.signal).then(last => {
          if (!controller.signal.aborted && currentSession.current === original && epoch === generation.current) { setTotal(last + 1); setExtent(last + 1); setSelected(last); if (list.current) { list.current.scrollTop = last * ROW_HEIGHT; setScrollTop(list.current.scrollTop); } }
        }).catch(reason => { if (!controller.signal.aborted && currentSession.current === original && epoch === generation.current) setError(String(reason)); });
      } else move(event.key === 'Home' ? 0 : selected + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : (event.key === 'PageUp' ? -1 : 1) * Math.max(1, Math.floor(height / ROW_HEIGHT))));
    } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const row = rowAt(selected); if (row) checkout(row); }
  };
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const last = Math.min(count, first + Math.ceil(height / ROW_HEIGHT) + 9);
  const rows = Array.from({ length: Math.max(0, last - first) }, (_, i) => ({ position: first + i, row: rowAt(first + i) }));
  return <div className="history-panel" onPointerUpCapture={event => { const target = event.target as HTMLElement; target.closest<HTMLButtonElement>('button')?.blur(); }}>
    <div className="history-panel-toolbar"><div className="history-panel-heading"><h2>History</h2><span>{session ? `${session.opening.writable ? '' : 'Read only - '}${total === undefined ? 'Retained history' : `${total} ${(collections.find(item => item.id === collection)?.label ?? 'changes').toLowerCase()}`}` : 'No project open'}</span></div>
      <div className="history-panel-actions">
        <button type="button" disabled={!session || !status?.revisionId} onClick={() => session && void run(() => session.coordinator.undo())}>Undo</button>
        <button type="button" disabled={!session || !status?.revisionId} onClick={() => session && void run(() => session.coordinator.redoRevision())}>Redo</button>
      </div></div>
    <div className="history-query"><select aria-label="History collection" value={collection} onChange={event => setCollection(event.target.value as HistoryCollection)}>{collections.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <input type="search" aria-label="Search history" placeholder="Search history" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {session && <div className="history-current" title={status?.revisionId ?? undefined}>{status?.revisionId ? 'Current version' : 'No saved version'}{status?.navigation === 'pending' || actionPending ? ' - Loading\u2026' : ''}</div>}
    {index && index.phase !== 'ready' && <div className="history-status" role="status">{index.phase === 'rebuilding' ? 'Preparing history' : 'Reading saved history'} - {index.scannedRecords} entries</div>}
    {(error || status?.error) && <div className="history-error" role="alert">{error ?? status?.error?.message}</div>}
    {!session ? <div className="history-panel-empty"><strong>No project open</strong><span>Open a project to browse its retained history.</span></div> : <div className="history-virtual-list" ref={list} role="listbox" aria-label="Project history" aria-busy={loading} aria-activedescendant={rowAt(selected) ? `history-row-${selected}` : undefined} tabIndex={0} onKeyDown={handleKey} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="history-virtual-space" style={{ height: count * ROW_HEIGHT }}>{rows.map(({ position, row }) => <div id={`history-row-${position}`} key={position} role="option" aria-selected={selected === position} aria-posinset={position + 1} aria-setsize={total ?? -1}
        className={`history-virtual-row${selected === position ? ' selected' : ''}${row?.revisionId === status?.revisionId ? ' current' : ''}`} style={{ top: position * ROW_HEIGHT, height: ROW_HEIGHT }} onPointerDown={() => { setSelected(position); list.current?.blur(); }} onClick={() => row && checkout(row)} title={row ? `${historyDisplayLabel(row.label)} - ${row.revisionId ?? 'Imported history without a saved version'}` : 'Loading version'}>
        <span className="history-revision-dot" aria-hidden="true" /><span className="history-revision-description"><span>{row?.label ? historyDisplayLabel(row.label) : loading ? 'Loading\u2026' : 'Version unavailable'}</span><small>{row ? `${row.createdAt ? dateFormatter.format(new Date(row.createdAt)) : 'Imported'} - ${historyDisplayLabel(row.source)}` : ''}</small></span>
        {row?.parentRevisionId && <button className="history-parent" type="button" tabIndex={-1} title="Restore previous version" aria-label={`Restore version before ${historyDisplayLabel(row.label)}`} onClick={event => { event.stopPropagation(); if (session) void run(() => session.coordinator.checkout(row.parentRevisionId!)); }}>{'\u2190'}</button>}
        <span className="history-revision-badge">{row?.revisionId === status?.revisionId ? 'Current' : row && !row.revisionId ? 'Uncertain' : ''}</span>
      </div>)}</div>{count === 0 && <div className="history-panel-empty"><strong>No matching history</strong></div>}
    </div>}
    {session && <form className="history-name-version" onSubmit={event => { event.preventDefault(); if (!versionName.trim()) return; void run(async () => { const receipt = session.coordinator.createNamedVersion(versionName); await session.coordinator.flush(receipt); if (currentSession.current === session) setVersionName(''); }); }}>
      <input aria-label="Version name" placeholder="Name current version" value={versionName} disabled={!session.opening.writable || !status?.revisionId} onChange={event => setVersionName(event.target.value)} />
      <button disabled={!session.opening.writable || !status?.revisionId || !versionName.trim() || actionPending}>Save version</button>
    </form>}
  </div>;
}
