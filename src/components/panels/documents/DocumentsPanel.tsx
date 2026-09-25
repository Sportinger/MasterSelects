import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useDocumentsStore } from '../../../stores/documentsStore';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { importProjectDocument } from '../../../services/documents/importDocument';
import { paginateScreenplay, screenplayTitlePage } from '../../../services/documents/screenplayLayout';
import { exportScreenplayPdf } from '../../../services/documents/exportScreenplay';
import { exportFdx, exportFountain } from '../../../services/documents/exportExchange';
import type { ProjectDocument } from '../../../types/documents';
import { NotebookWritingEditor } from './NotebookWritingEditor';
import './DocumentsPanel.css';

function transaction(label: string, action: () => void) {
  const batch = startBatch(label);
  try { action(); } finally { if (batch.opened) endBatch(); }
}

function displayTitle(document: ProjectDocument): string {
  return document.title.trim() || document.blocks.map(block => block.text.trim())
    .find(Boolean)?.slice(0, 60) || 'Untitled note';
}

function OriginalView({ document }: { document: ProjectDocument }) {
  const source = document.source;
  if (!source && document.kind === 'screenplay') return <ProductionView document={document} />;
  if (!source) return <NotebookWritingEditor document={document} />;
  if (source.format === 'pdf' && source.originalData) {
    return <iframe className="documents-original-pdf" title={`${source.fileName} original PDF`}
      src={`data:application/pdf;base64,${source.originalData}`} />;
  }
  if (source.format === 'pdf') {
    return <div className="documents-original-fallback">
      <p>The original PDF pages were not saved with this earlier import. Re-import the PDF to view its pages.</p>
      <pre className="documents-original-text">{document.blocks.map(block => block.text).join('\n')}</pre>
    </div>;
  }
  if (source.format === 'html' && source.previewHtml) {
    return <iframe className="documents-original-pdf" sandbox="" title={`${source.fileName} safe HTML preview`}
      srcDoc={source.previewHtml} />;
  }
  return <pre className="documents-original-text">{source.originalText
    || document.blocks.map(block => block.text).join('\n')
    || source.report
    || 'Original layout preview unavailable.'}</pre>;
}

function ProductionView({ document }: { document: ProjectDocument }) {
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const updateBlock = useDocumentsStore(state => state.updateBlock);
  const titlePage = screenplayTitlePage(document);
  const pages = titlePage ? [titlePage, ...paginateScreenplay(document)] : paginateScreenplay(document);
  const editingBlock = document.blocks.find(block => block.id === editingBlockId);
  return <div className="documents-production-stack">
    {pages.map((page, index) => <div key={`${page.label}-${index}`} className="documents-page"
      style={{ width: `${page.width}pt`, height: `${page.height}pt` }}>
      {!page.titlePage && <span className="documents-page-number">{page.label}.</span>}
      {!page.titlePage && document.screenplay?.header && <span className="documents-page-header">{document.screenplay.header}</span>}
      {page.lines.map((line, lineIndex) => page.titlePage
        ? <span key={`${line.blockId}-${lineIndex}`} className="documents-page-line"
          style={{ left: `${line.x}pt`, top: `${line.y}pt` }}>{line.text}</span>
        : <button type="button"
        key={`${line.blockId}-${lineIndex}`} className="documents-page-line"
        title={`Edit ${line.kind}`} onClick={() => setEditingBlockId(line.blockId)}
        style={{ left: `${line.x}pt`, top: `${line.y}pt` }}>{line.text || ' '}</button>)}
      {!page.titlePage && document.screenplay?.footer && <span className="documents-page-footer">{document.screenplay.footer}</span>}
    </div>)}
    {editingBlock && <div className="documents-production-edit">
      <label htmlFor="documents-production-input">Edit {editingBlock.kind}</label>
      <textarea id="documents-production-input" value={editingBlock.text} rows={4}
        onFocus={() => startBatch('Edit screenplay text')} onBlur={() => endBatch()}
        onChange={event => updateBlock(document.id, editingBlock.id, event.currentTarget.value)} />
      <button type="button" onClick={() => setEditingBlockId(null)}>Done</button>
    </div>}
  </div>;
}

export function DocumentsPanel() {
  const documents = useDocumentsStore(state => state.documents);
  const activeDocumentId = useDocumentsStore(state => state.activeDocumentId);
  const navigationRequest = useDocumentsStore(state => state.navigationRequest);
  const selectDocument = useDocumentsStore(state => state.selectDocument);
  const createDocument = useDocumentsStore(state => state.createDocument);
  const deleteDocument = useDocumentsStore(state => state.deleteDocument);
  const importDocument = useDocumentsStore(state => state.importDocument);
  const renameDocument = useDocumentsStore(state => state.renameDocument);
  const setDocumentKind = useDocumentsStore(state => state.setDocumentKind);
  const setPageSize = useDocumentsStore(state => state.setPageSize);
  const setScreenplayDetails = useDocumentsStore(state => state.setScreenplayDetails);
  const setActiveRevision = useDocumentsStore(state => state.setActiveRevision);
  const lockProductionPages = useDocumentsStore(state => state.lockProductionPages);
  const lockSceneNumbers = useDocumentsStore(state => state.lockSceneNumbers);
  const addRevision = useDocumentsStore(state => state.addRevision);
  const [view, setView] = useState<'masterselects' | 'original'>('masterselects');
  const [query, setQuery] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [focusWriting, setFocusWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [encodingFile, setEncodingFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState('windows-1252');
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const active = documents.find(document => document.id === activeDocumentId) ?? documents[0];
  const editScreenplayDetails = (field: 'title' | 'author' | 'contact' | 'header' | 'footer', value: string) => {
    if (!active?.screenplay) return;
    const current = active.screenplay;
    setScreenplayDetails(active.id, {
      titlePage: field === 'title' || field === 'author' || field === 'contact'
        ? { title: current.titlePage?.title ?? '', author: current.titlePage?.author ?? '',
          contact: current.titlePage?.contact ?? '', [field]: value }
        : current.titlePage,
      header: field === 'header' ? value : current.header,
      footer: field === 'footer' ? value : current.footer,
    });
  };
  const download = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const exportScript = async (format: 'pdf' | 'fountain' | 'fdx') => {
    if (!active) return;
    try {
      const blob = format === 'pdf' ? await exportScreenplayPdf(active)
        : new Blob([format === 'fountain' ? exportFountain(active) : exportFdx(active)],
          { type: format === 'fdx' ? 'application/xml' : 'text/plain' });
      download(blob, `${displayTitle(active)}.${format}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Export failed.'); }
  };
  const exportText = () => {
    if (!active) return;
    const name = displayTitle(active).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    download(new Blob([active.blocks.map(block => block.text).join('\n\n')],
      { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
  };
  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await importFile(file);
    event.target.value = '';
  };
  const importFile = async (file: File, selectedEncoding?: string) => {
    setError(null);
    try {
      const parsed = await importProjectDocument(file, selectedEncoding);
      transaction('Import document', () => importDocument(file.name, parsed.kind, parsed.blocks,
        parsed.source, undefined, parsed.screenplayTitlePage));
      setEncodingFile(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Document import failed.';
      setError(message);
      if (message.includes('encoding is unclear')) setEncodingFile(file);
    }
  };
  return <div className="documents-panel" aria-label="Notebook"
    onDragOver={event => {
      if (event.dataTransfer.types.includes('Files')) event.preventDefault();
    }}
    onDrop={event => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        for (const file of Array.from(event.dataTransfer.files)) await importFile(file);
      })();
    }}>
    <header className="documents-toolbar">
      <strong className="notebook-heading-label">Notebook</strong>
      <select aria-label="Choose note" value={active?.id ?? ''}
        onChange={event => selectDocument(event.target.value || null)}>
        {!active && <option value="">New note</option>}
        {documents.map(item => <option key={item.id} value={item.id}>{displayTitle(item)}</option>)}
      </select>
      <div className="documents-toolbar-actions">
        <button type="button" aria-label="New note" onClick={() => transaction('Create Notebook note', () => createDocument('', 'general'))}>＋</button>
        <input aria-label="Find in Notebook" type="search" placeholder="Search" value={query}
          onChange={event => setQuery(event.currentTarget.value)} />
        <details ref={menu} className="notebook-menu">
          <summary aria-label="Notebook menu">⋯</summary>
          <div onClick={() => { if (menu.current) menu.current.open = false; }}>
            <button type="button" onClick={() => fileInput.current?.click()}>Import</button>
            {active && <button type="button" onClick={() => {
              titleInput.current?.focus();
              titleInput.current?.select();
            }}>Rename note</button>}
            {active && <button type="button" onClick={exportText}>Export text</button>}
            {active?.kind === 'screenplay' && <>
              <button type="button" onClick={() => void exportScript('pdf')}>Export PDF</button>
              <button type="button" onClick={() => void exportScript('fountain')}>Export Fountain</button>
              <button type="button" onClick={() => void exportScript('fdx')}>Export FDX</button>
            </>}
            <button type="button" onClick={() => transaction('Create screenplay', () => createDocument('', 'screenplay'))}>New screenplay</button>
            {active && <button type="button" onClick={() => transaction('Change Notebook writing mode', () =>
              setDocumentKind(active.id, active.kind === 'screenplay' ? 'general' : 'screenplay'))}>
              {active.kind === 'screenplay' ? 'Use normal writing mode' : 'Use screenplay mode'}
            </button>}
            {active && <button type="button" onClick={() => {
              if (window.confirm(`Delete note "${displayTitle(active)}" from this project?`))
                transaction('Delete Notebook note', () => deleteDocument(active.id));
            }}>Delete note</button>}
          </div>
        </details>
        <input ref={fileInput} type="file" className="documents-file-input" onChange={onImport} />
      </div>
    </header>
    {error && <p className="documents-error" role="alert">{error}</p>}
    {encodingFile && <div className="documents-encoding">
      <span>{encodingFile.name}</span>
      <select aria-label="Text encoding" value={encoding} onChange={event => setEncoding(event.target.value)}>
        <option value="windows-1252">Western (Windows-1252)</option>
        <option value="iso-8859-1">Latin-1</option>
        <option value="utf-16le">UTF-16 LE</option>
        <option value="utf-16be">UTF-16 BE</option>
      </select>
      <button type="button" onClick={() => void importFile(encodingFile, encoding)}>Retry import</button>
    </div>}
    {active ? <>
      <div className="documents-subtoolbar">
        <input ref={titleInput} aria-label="Note title (optional)" placeholder="Untitled note" value={active.title}
          onChange={event => renameDocument(active.id, event.currentTarget.value)} />
        <button type="button" aria-pressed={outlineOpen} onClick={() => setOutlineOpen(value => !value)}>Outline</button>
        <button type="button" aria-pressed={focusWriting} onClick={() => setFocusWriting(value => !value)}>
          {focusWriting ? 'Exit focus' : 'Focus'}
        </button>
        {(active.source || active.kind === 'screenplay') && <div className="documents-view-toggle" aria-label="Notebook view">
          <button type="button" aria-pressed={view === 'masterselects'} onClick={() => setView('masterselects')}>Write</button>
          <button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>{active.source ? 'Original' : 'Production layout'}</button>
        </div>}
      </div>
      {!focusWriting && active.kind === 'screenplay' && <div className="documents-script-toolbar">
        <label>Page size <select aria-label="Screenplay page size" value={active.screenplay?.pageSize ?? 'letter'}
          onChange={event => transaction('Change screenplay page size', () => setPageSize(active.id, event.target.value as 'letter' | 'a4'))}>
          <option value="letter">Letter</option><option value="a4">A4</option>
        </select></label>
        <button type="button" onClick={() => transaction('Lock screenplay pages', () => lockProductionPages(active.id))}>Lock pages</button>
        <button type="button" onClick={() => transaction('Lock screenplay scenes', () => lockSceneNumbers(active.id))}>Lock scenes</button>
        <button type="button" onClick={() => {
          const name = window.prompt('Revision name');
          if (name?.trim()) transaction('Add screenplay revision', () => addRevision(active.id, name.trim(), '#3366cc'));
        }}>Revision</button>
        <label>Active revision <select aria-label="Active screenplay revision"
          value={active.screenplay?.activeRevisionId ?? ''}
          onChange={event => transaction('Change active screenplay revision', () =>
            setActiveRevision(active.id, event.target.value || null))}>
          <option value="">None</option>
          {active.screenplay?.revisions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button type="button" onClick={() => void exportScript('pdf')}>PDF</button>
        <button type="button" onClick={() => void exportScript('fountain')}>Fountain</button>
        <button type="button" onClick={() => void exportScript('fdx')}>FDX</button>
      </div>}
      {!focusWriting && active.kind === 'screenplay' && <details className="documents-production-details">
        <summary>Production details</summary>
        <div>
          {(['title', 'author', 'contact', 'header', 'footer'] as const).map(field =>
            <label key={field}>{field === 'contact' ? 'Contact' : field[0].toUpperCase() + field.slice(1)}
              <input aria-label={`Screenplay ${field}`} value={field === 'header' || field === 'footer'
                ? active.screenplay?.[field] ?? '' : active.screenplay?.titlePage?.[field] ?? ''}
                onFocus={() => startBatch('Edit screenplay production details')}
                onBlur={() => endBatch()}
                onChange={event => editScreenplayDetails(field, event.currentTarget.value)} />
            </label>)}
        </div>
      </details>}
      {!focusWriting && <details className="notebook-source-details"><summary>Source and save details</summary><div className="documents-meta">
        <span>{active.source ? `${active.source.fileName} · imported ${new Date(active.source.importedAt).toLocaleDateString()}` : 'Created in MasterSelects'}</span>
        <span>Revision {active.revision}</span>
        {active.source && <span>{active.source.fidelity} preview{active.revision > 1 ? ' · project copy changed' : ''}</span>}
        {active.source?.format === 'pdf' && <span>{active.source.originalData ? 'PDF pages preserved' : 'Extracted text only'}</span>}
      </div></details>}
      {!focusWriting && active.source?.report && <p className="documents-report">{active.source.report}</p>}
      <div className="documents-body">
        {!focusWriting && outlineOpen && <nav className="documents-outline" aria-label="Notebook outline">
          {active.blocks.filter(block => ['heading', 'scene'].includes(block.kind))
            .map(block => <button key={block.id} type="button"
              onClick={() => useDocumentsStore.getState().showAnchor(active.id, block.id)}>
              {block.text || 'Untitled'}</button>)}
          {active.scenes?.map(scene => <button key={scene.id} type="button"
            onClick={() => useDocumentsStore.getState().showAnchor(active.id, scene.anchor.blockId)}>
            Scene · {scene.name || scene.anchor.quote.slice(0, 32) || 'Untitled'}</button>)}
        </nav>}
        <main className="documents-content">
          {view === 'original' ? <OriginalView document={active} />
            : <NotebookWritingEditor document={active} query={query} navigationRequest={navigationRequest}
              focusWriting={focusWriting} />}
        </main>
      </div>
    </> : <main className="documents-content"><NotebookWritingEditor document={null} query={query} /></main>}
  </div>;
}
