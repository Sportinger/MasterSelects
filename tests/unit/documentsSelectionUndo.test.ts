import { afterEach, describe, expect, it } from 'vitest';
import { useDocumentsStore } from '../../src/stores/documentsStore';
import type { ProjectDocument } from '../../src/types/documents';

const document = (id: string): ProjectDocument => ({
  id, title: id, kind: 'general', schemaVersion: 1,
  revision: 1, createdAt: 1, updatedAt: 1,
  blocks: [{ id: `${id}-block`, kind: 'paragraph', text: id }],
  links: [], comments: [],
});

afterEach(() => useDocumentsStore.getState().reset());

describe('document selection across history hydration', () => {
  it('keeps the active document when an undo snapshot still contains it', () => {
    const documents = [document('first'), document('second')];
    useDocumentsStore.getState().hydrate({ schemaVersion: 1, documents });
    useDocumentsStore.getState().selectDocument('second');
    useDocumentsStore.getState().hydrate({ schemaVersion: 1,
      documents: [documents[0], { ...documents[1], revision: 2 }] });
    expect(useDocumentsStore.getState().activeDocumentId).toBe('second');
  });

  it('falls back to a surviving document when the selected document is removed', () => {
    useDocumentsStore.getState().hydrate({ schemaVersion: 1,
      documents: [document('first'), document('second')] });
    useDocumentsStore.getState().selectDocument('second');
    useDocumentsStore.getState().hydrate({ schemaVersion: 1, documents: [document('first')] });
    expect(useDocumentsStore.getState().activeDocumentId).toBe('first');
  });
});
