import { IconFileText } from '@tabler/icons-react';
import { useDocumentsStore } from '../../../../stores/documentsStore';
import { useDockStore } from '../../../../stores/dockStore';
import type { ProjectDocument } from '../../../../types/documents';
import './MediaPanelDocuments.css';

const noteName = (document: ProjectDocument) => document.title.trim()
  || document.blocks.map(block => block.text.trim()).find(Boolean)?.slice(0, 60) || 'Untitled note';

export function MediaPanelDocuments({ query }: { query: string }) {
  const documents = useDocumentsStore(state => state.documents);
  const selectedId = useDocumentsStore(state => state.activeDocumentId);
  const visible = documents.filter(document => noteName(document).toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase()));
  if (!visible.length) return null;
  const open = (id: string) => {
    useDocumentsStore.getState().selectDocument(id);
    useDockStore.getState().activatePanelType('documents');
  };
  return <section className="media-panel-documents" aria-label="Project Notebook">
    <div className="media-panel-documents-title">Notebook</div>
    <div className="media-panel-documents-items">
      {visible.map(document => <button key={document.id} type="button"
        className={document.id === selectedId ? 'active' : ''}
        title={`Double-click to open ${noteName(document)} in Notebook`}
        onDoubleClick={() => open(document.id)}
        onKeyDown={event => { if (event.key === 'Enter') open(document.id); }}>
        <IconFileText size={18} aria-hidden="true" />
        <span>{noteName(document)}</span>
      </button>)}
    </div>
  </section>;
}
