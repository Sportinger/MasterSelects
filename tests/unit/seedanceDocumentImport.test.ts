import { afterEach, describe, expect, it } from 'vitest';

import {
  extractPlanningDocument,
  isPlanningDocumentFile,
  planningDocumentFormat,
} from '../../src/services/seedancePreproduction/documentImport';
import { useSeedancePreproductionStore } from '../../src/stores/seedancePreproductionStore';

afterEach(() => useSeedancePreproductionStore.getState().reset());

describe('Seedance planning document import', () => {
  it('recognizes TXT, Markdown and PDF by MIME type or extension', () => {
    expect(planningDocumentFormat(new File(['text'], 'notes.txt'))).toBe('text');
    expect(planningDocumentFormat(new File(['# title'], 'brief.md'))).toBe('markdown');
    expect(planningDocumentFormat(new File(['%PDF'], 'source.bin', { type: 'application/pdf' }))).toBe('pdf');
    expect(isPlanningDocumentFile(new File(['{}'], 'data.json'))).toBe(false);
  });

  it('extracts and normalizes plain text without uploading it', async () => {
    const document = await extractPlanningDocument(new File([
      'First line\r\n\r\n\r\n\r\nSecond line\u0000',
    ], 'research.txt', { type: 'text/plain', lastModified: 42 }));

    expect(document).toMatchObject({
      name: 'research.txt',
      format: 'text',
      lastModified: 42,
      text: 'First line\n\n\nSecond line',
      truncated: false,
    });
    expect(document.id).toMatch(/^seedance-document-/u);
  });

  it('rejects unsupported files and empty documents', async () => {
    await expect(extractPlanningDocument(new File(['{}'], 'data.json'))).rejects.toThrow(/Only TXT/u);
    await expect(extractPlanningDocument(new File(['   '], 'empty.md'))).rejects.toThrow(/no machine-readable text/u);
  });

  it('keeps imported planning documents when only the workflow is restarted', async () => {
    const document = await extractPlanningDocument(new File(['Project facts'], 'facts.txt'));
    const store = useSeedancePreproductionStore.getState();
    store.putDocument(document);
    store.resetRuns();

    expect(useSeedancePreproductionStore.getState().documents).toHaveLength(1);
    expect(useSeedancePreproductionStore.getState().activeRunId).toBeNull();
  });

  it('invalidates the reusable bundle reference when a document changes', async () => {
    const store = useSeedancePreproductionStore.getState();
    const fingerprint = 'c'.repeat(64);
    store.setSourceBundle({
      schemaVersion: 1,
      id: `source-bundle-${fingerprint}`,
      fingerprint,
      createdAt: 1,
      entryCount: 1,
    });
    store.putDocument(await extractPlanningDocument(new File(['New facts'], 'facts.txt')));

    expect(useSeedancePreproductionStore.getState().sourceBundle).toBeUndefined();
  });
});
