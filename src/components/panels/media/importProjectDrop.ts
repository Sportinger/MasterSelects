import { importProjectDocument, isDocumentImportCandidate } from '../../../services/documents/importDocument';
import { Logger } from '../../../services/logger';
import { useDocumentsStore } from '../../../stores/documentsStore';
import { collectDroppedMediaFiles, importDroppedMediaFiles, type DroppedMediaImportActions } from './dropImport';

const log = Logger.create('MediaDrop');

/** Snapshot the native drop immediately, then share document/folder import with every surface. */
export async function importProjectDrop(
  transfer: DataTransfer, parentId: string | null, actions: DroppedMediaImportActions,
): Promise<unknown[]> {
  const records = await collectDroppedMediaFiles(transfer);
  const documents = records.filter(record => isDocumentImportCandidate(record.file));
  const media = records.filter(record => !isDocumentImportCandidate(record.file));
  for (const { file } of documents) {
    try {
      const parsed = await importProjectDocument(file);
      useDocumentsStore.getState().importDocument(file.name, parsed.kind, parsed.blocks,
        parsed.source, undefined, parsed.screenplayTitlePage);
    } catch (error) {
      log.warn('Document import failed', { name: file.name, error });
      window.alert(`Could not import ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  return media.length ? importDroppedMediaFiles(media, parentId, actions) : [];
}
